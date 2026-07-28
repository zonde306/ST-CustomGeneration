import { chat, chat_metadata } from "@st/script.js";
import { DataStore } from "@/functions/filesystem";

/**
 * A single stored data entry.
 */
export interface DataEntry {
    /** Who wrote this entry, e.g. '@@replace' / 'tool_call' / 'user-edit' / 'summary-gen'. */
    source: string;
    content: string;
    /**
     * Tombstone marker: from this layer downwards the key is considered absent.
     * Reading stops here instead of falling through to older layers, so a delete
     * can never resurrect a previous version.
     */
    deleted?: boolean;
}

/** namespace -> key -> entry */
export type CgData = Record<string, Record<string, DataEntry>>;

// Legacy storage fields (read-only fallback, never written).
interface LegacyWIOverride {
    type: string;
    content: string;
}
type LegacyWIOverrides = Record<string, Record<string, LegacyWIOverride>>;

export type SwipeInfoEx = SwipeInfo & {
    cg_data?: CgData;
    wi_overrides?: LegacyWIOverrides;
    mes_override?: string;
};
export type ChatMessageEx = ChatMessage & { swipe_info?: SwipeInfoEx[] };

export interface DataLookupResult {
    key: string;
    entry: DataEntry;
    messageId: number;
    swipeId: number;
}

/** Well-known namespaces. Callers may define their own. */
export const DATA_NAMESPACES = {
    WORLDINFO: 'worldinfo',
    MESSAGE: 'message',
    FILES: 'files',
} as const;

export interface NamespacePolicy {
    /**
     * `true` = layered namespace (`get`/`lookup` semantics): a value written at
     * message N stays visible at N+1, so history can be indexed and compacted.
     * `false` = per-message namespace (`scan` semantics): each message owns its
     * own entry and flattening would destroy data.
     */
    layered: boolean;
}

/**
 * Policy per namespace. Unregistered namespaces default to layered (the common
 * shape), but compaction only ever touches namespaces registered here so that
 * third-party data is never damaged.
 */
export const NAMESPACE_POLICY: Record<string, NamespacePolicy> = {
    [DATA_NAMESPACES.WORLDINFO]: { layered: true },
    [DATA_NAMESPACES.FILES]: { layered: true },
    [DATA_NAMESPACES.MESSAGE]: { layered: false },
};

/** Whether a namespace uses layered (backtracking) semantics. */
export function isLayeredNamespace(ns: string): boolean {
    return NAMESPACE_POLICY[ns]?.layered ?? true;
}

/** Whether a namespace opted in to indexing and compaction. */
export function isCompactableNamespace(ns: string): boolean {
    return NAMESPACE_POLICY[ns]?.layered === true;
}

/** Build the `worldinfo` namespace key for a WI entry. */
export function worldInfoKey(world: string, uid: string | number): string {
    return `${world}/${String(uid)}`;
}

/** Split a `worldinfo` namespace key back into world and uid. */
export function splitWorldInfoKey(key: string): { world: string; uid: string } {
    const slash = key.lastIndexOf('/');
    return slash >= 0
        ? { world: key.slice(0, slash), uid: key.slice(slash + 1) }
        : { world: key, uid: '' };
}

/** `chat_metadata` field holding the compacted base layer. */
export const CG_STATE_KEY = 'cg_state';

/**
 * Persisted state living in `chat_metadata`: the compaction product plus the
 * watermark describing how far the per-message layers have been flattened.
 */
export interface CgPersistedState {
    /** Flattened history; the bottom of the read chain. Includes tombstones. */
    base: CgData;
    /** Layers of `chat[0..watermark)` were flattened and removed. */
    watermark: number;
    version: 1;
}

/** Read the persisted state, optionally creating it. */
export function readPersistedState(metadata: ChatMetadata | undefined, create: boolean = false): CgPersistedState | null {
    if (!metadata)
        return null;

    const existing = metadata[CG_STATE_KEY] as CgPersistedState | undefined;
    if (existing && typeof existing === 'object') {
        if (typeof existing.base !== 'object' || existing.base === null)
            existing.base = {};
        if (typeof existing.watermark !== 'number')
            existing.watermark = 0;
        existing.version = 1;
        return existing;
    }

    if (!create)
        return null;

    const created: CgPersistedState = { base: {}, watermark: 0, version: 1 };
    metadata[CG_STATE_KEY] = created;
    return created;
}

/**
 * Number of most recent messages excluded from the head index. Reads inside the
 * hot window always use exact per-swipe backtracking, so freshly written values
 * are visible immediately and near-end swipes never invalidate the index.
 */
export const HOT_WINDOW = 16;

interface HeadIndex {
    /** `ns\0key` -> position of the newest visible layer inside the cold region. */
    heads: Map<string, { messageId: number; swipeId: number }>;
    /** The index covers `chat[0..coldEnd)`; the hot region is never indexed. */
    coldEnd: number;
    /** `chat.length` when the index was built, used to detect growth. */
    chatLength: number;
    /** Global invalidation epoch this index was built in. */
    epoch: number;
}

const INDEX_CACHE = new WeakMap<ChatMessageEx[], HeadIndex>();
let indexEpoch = 0;

/**
 * Drop every cached head index. Cheap: indices are rebuilt lazily by a single
 * reverse pass. Indices are intentionally never persisted, because a stale
 * on-disk index would resolve to swiped-away branches.
 */
export function invalidateHeadIndex(): void {
    indexEpoch += 1;
}

/**
 * Generic layered chat data store.
 *
 * Data lives at `chat[messageId].swipe_info[swipeId].cg_data[namespace][key]`, so it
 * is persisted with the chat file, isolated per swipe, and read with message
 * backtracking (a value set at message N is visible at message N+1 unless overridden).
 *
 * Reads follow a three-stage chain: exact backtracking inside the hot window,
 * then the {@link HeadIndex} for the cold region, then the compacted base layer
 * in `chat_metadata`.
 *
 * Legacy fields (`wi_overrides`, `mes_override`) are still readable as fallback but
 * are never written.
 */
export class ChatDataStore {
    public chat: ChatMessageEx[];
    public chat_metadata: ChatMetadata;

    constructor({ chat, chat_metadata }: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata }) {
        this.chat = Array.isArray(chat) ? chat : [];
        this.chat_metadata = chat_metadata ?? {};
    }

    /** Data store of the current chat file. */
    static global(): ChatDataStore {
        return new ChatDataStore({ chat, chat_metadata });
    }

    /**
     * Read an entry, backtracking through message history.
     * @param ns namespace
     * @param key entry key within the namespace
     * @param opts.messageId Start message ID; defaults to the latest message.
     * @param opts.swipeId Swipe ID for the start message; defaults to its active swipe.
     * @param opts.maxDepth Maximum number of messages to walk back through.
     * @param opts.includeDeleted Return tombstones instead of treating them as absent.
     */
    get(ns: string, key: string, opts: {
        messageId?: number;
        swipeId?: number;
        maxDepth?: number;
        includeDeleted?: boolean;
    } = {}): DataEntry | null {
        if (this.canUseIndex(ns, opts))
            return this.getIndexed(ns, key, opts.swipeId, opts.includeDeleted === true);

        return this.getSlow(ns, key, opts);
    }

    /**
     * Whether the fast read chain applies. Anything unusual (reading a historical
     * message, an explicit depth limit, a non-layered namespace) falls back to the
     * exhaustive walk: correctness first, those paths are all low frequency.
     */
    private canUseIndex(ns: string, opts: { messageId?: number; maxDepth?: number }): boolean {
        if (!isLayeredNamespace(ns))
            return false;
        if (opts.maxDepth !== undefined)
            return false;
        if (opts.messageId !== undefined && opts.messageId !== this.chat.length - 1)
            return false;

        return this.chat.length > 0;
    }

    /** Three-stage read: hot window -> head index -> compacted base. */
    private getIndexed(ns: string, key: string, swipeId: number | undefined, includeDeleted: boolean): DataEntry | null {
        const index = this.ensureIndex();
        const start = this.chat.length - 1;

        for (let i = start; i >= index.coldEnd; --i) {
            const entry = this.readAt(i, i === start ? swipeId : undefined, ns, key);
            if (entry)
                return this.visible(entry, includeDeleted);
        }

        const head = index.heads.get(indexKey(ns, key));
        if (head) {
            const entry = this.readAt(head.messageId, undefined, ns, key);
            if (entry)
                return this.visible(entry, includeDeleted);

            // The active swipe of an indexed message changed: rebuild and be exact.
            invalidateHeadIndex();
            return this.getSlow(ns, key, { swipeId, includeDeleted });
        }

        return this.visible(this.readBase(ns, key), includeDeleted);
    }

    /** Exhaustive per-message backtracking. */
    private getSlow(ns: string, key: string, opts: {
        messageId?: number;
        swipeId?: number;
        maxDepth?: number;
        includeDeleted?: boolean;
    }): DataEntry | null {
        const { messageId, swipeId, maxDepth, includeDeleted } = opts;
        const start = messageId ?? this.chat.length - 1;
        let depth = maxDepth ?? Number.MAX_SAFE_INTEGER;

        for (let i = start; i >= 0; --i) {
            if (depth < 0)
                return null;

            const entry = this.readAt(i, i === start ? swipeId : undefined, ns, key);
            if (entry)
                return this.visible(entry, includeDeleted === true);

            depth -= 1;
        }

        // The walk reached the bottom of the chat, so the compacted history is next
        // in line. Depth-limited reads deliberately stop above it.
        if (maxDepth === undefined)
            return this.visible(this.readBase(ns, key), includeDeleted === true);

        return null;
    }

    /**
     * Like {@link get}, but writes staged by the current turn take precedence.
     *
     * Use this on any read that has to observe changes a tool made during the
     * generation currently in flight (World Info override application, for
     * example), because those writes have no message layer to live on yet.
     */
    getPending(ns: string, key: string, opts: {
        messageId?: number;
        swipeId?: number;
        maxDepth?: number;
        includeDeleted?: boolean;
    } = {}): DataEntry | null {
        if (opts.messageId === undefined) {
            const staged = STAGING.get(this.chat)?.[ns]?.[key];
            if (staged)
                return this.visible(staged, opts.includeDeleted === true);
        }

        return this.get(ns, key, opts);
    }

    /**
     * Write an entry.
     * @param ns namespace
     * @param key entry key within the namespace
     * @param source source tag, see {@link DataEntry.source}
     * @param content entry content
     * @param messageId Target message ID; defaults to the latest message.
     * @param swipeId Target swipe ID; defaults to the message's active swipe.
     */
    set(
        ns: string,
        key: string,
        source: string,
        content: string,
        messageId: number = this.chat.length - 1,
        swipeId?: number,
    ): void {
        this.write(ns, key, { source, content }, messageId, swipeId);
    }

    /**
     * Write a tombstone: the key reads as absent from this layer downwards,
     * without touching the value stored in older layers or in the base.
     */
    setDeleted(ns: string, key: string, source: string, messageId: number = this.chat.length - 1, swipeId?: number): void {
        this.write(ns, key, { source, content: '', deleted: true }, messageId, swipeId);
    }

    private write(ns: string, key: string, entry: DataEntry, messageId: number, swipeId?: number): void {
        const message = this.chat[messageId];
        if (!message)
            return;

        const swipe = swipeId ?? message.swipe_id ?? 0;

        if (!message.swipe_info)
            message.swipe_info = [];
        if (!message.swipe_info[swipe])
            message.swipe_info[swipe] = {};

        const info = message.swipe_info[swipe];
        if (!info.cg_data)
            info.cg_data = {};
        if (!info.cg_data[ns])
            info.cg_data[ns] = {};

        info.cg_data[ns][key] = entry;
        this.touchIndex(ns, key, messageId, swipe);
    }

    /**
     * Physically remove the key from one layer (no tombstone is written, so older
     * layers and the base become visible again).
     * @returns true when something was removed.
     */
    remove(ns: string, key: string, messageId: number = this.chat.length - 1, swipeId?: number): boolean {
        const message = this.chat[messageId];
        if (!message)
            return false;

        const swipe = swipeId ?? message.swipe_id ?? 0;
        const entries = message.swipe_info?.[swipe]?.cg_data?.[ns];
        if (!entries || !Object.hasOwn(entries, key))
            return false;

        delete entries[key];
        if (!Object.keys(entries).length)
            delete message.swipe_info![swipe].cg_data![ns];

        invalidateHeadIndex();
        return true;
    }

    /**
     * Delete a key as seen from one layer: drop the layer's own value, and add a
     * tombstone when an older layer (or the base) would otherwise resurface.
     * @returns true when the key is no longer visible.
     */
    erase(ns: string, key: string, source: string = 'delete', messageId: number = this.chat.length - 1, swipeId?: number): boolean {
        const target = this.chat[messageId] ? messageId : this.chat.length - 1;
        if (!this.chat[target])
            return false;

        const swipe = swipeId ?? this.chat[target].swipe_id ?? 0;
        const removed = this.remove(ns, key, target, swipe);

        // Anything still visible below this layer has to be masked explicitly.
        if (this.get(ns, key, { messageId: target, swipeId: swipe }) != null) {
            this.setDeleted(ns, key, source, target, swipe);
            return true;
        }

        return removed;
    }

    /**
     * Collect the latest visible entry for every key in a namespace,
     * walking back from the latest message (first hit wins per key).
     * Tombstones mask older layers without producing a result.
     * @param opts A plain number is accepted as `depth` for backwards compatibility.
     */
    lookup(ns: string, opts: number | {
        messageId?: number;
        swipeId?: number;
        depth?: number;
        includeDeleted?: boolean;
    } = {}): DataLookupResult[] {
        const options = typeof opts === 'number' ? { depth: opts } : opts;
        const { messageId, swipeId, includeDeleted } = options;
        const start = messageId ?? this.chat.length - 1;
        let depth = options.depth ?? Number.MAX_SAFE_INTEGER;

        const results = new Map<string, DataLookupResult>();
        const seen = new Set<string>();
        let reachedBottom = true;

        for (let i = start; i >= 0; --i) {
            if (depth < 0) {
                reachedBottom = false;
                break;
            }

            const info = this.swipeInfoAt(i, i === start ? swipeId : undefined);
            const swipe = this.swipeIdAt(i, i === start ? swipeId : undefined);
            for (const [key, entry] of Object.entries(this.readSwipeEntries(info, ns))) {
                if (seen.has(key))
                    continue;

                seen.add(key);
                if (entry.deleted && !includeDeleted)
                    continue;

                results.set(key, { key, entry, messageId: i, swipeId: swipe });
            }

            depth -= 1;
        }

        if (reachedBottom) {
            for (const [key, entry] of Object.entries(this.baseEntries(ns))) {
                if (seen.has(key))
                    continue;

                seen.add(key);
                if (entry.deleted && !includeDeleted)
                    continue;

                results.set(key, { key, entry, messageId: -1, swipeId: 0 });
            }
        }

        return Array.from(results.values());
    }

    /**
     * Enumerate entries per message within the last `depth` messages, without
     * deduplication. Useful for message-scoped namespaces where each message
     * carries its own entry.
     * @param includeHidden include system (hidden) messages
     */
    scan(ns: string, depth: number = 9, includeHidden: boolean = false): DataLookupResult[] {
        const results: DataLookupResult[] = [];

        const startIndex = Math.max(0, this.chat.length - 1 - depth);
        for (let i = startIndex; i < this.chat.length; ++i) {
            const message = this.chat[i];
            if (!message || (!includeHidden && message.is_system))
                continue;

            const swipeId = message.swipe_id ?? 0;
            const entries = this.readSwipeEntries(message.swipe_info?.[swipeId], ns);
            for (const [key, entry] of Object.entries(entries)) {
                if (entry.deleted)
                    continue;

                results.push({ key, entry, messageId: i, swipeId });
            }
        }

        return results;
    }

    /** Resolve the swipe index used when reading message `index`. */
    private swipeIdAt(index: number, swipeId?: number): number {
        return swipeId ?? this.chat[index]?.swipe_id ?? 0;
    }

    private swipeInfoAt(index: number, swipeId?: number): SwipeInfoEx | undefined {
        return this.chat[index]?.swipe_info?.[this.swipeIdAt(index, swipeId)];
    }

    /** Read one key from a single layer. */
    private readAt(index: number, swipeId: number | undefined, ns: string, key: string): DataEntry | null {
        return this.readSwipeEntry(this.swipeInfoAt(index, swipeId), ns, key);
    }

    private visible(entry: DataEntry | null, includeDeleted: boolean): DataEntry | null {
        if (!entry)
            return null;

        return entry.deleted && !includeDeleted ? null : entry;
    }

    /** Read one key from the compacted base layer. */
    private readBase(ns: string, key: string): DataEntry | null {
        const state = readPersistedState(this.chat_metadata);
        return state?.base?.[ns]?.[key] ?? null;
    }

    /** All entries of a namespace in the compacted base layer. */
    private baseEntries(ns: string): Record<string, DataEntry> {
        const state = readPersistedState(this.chat_metadata);
        return state?.base?.[ns] ?? {};
    }

    /** Read a single entry from one swipe, with legacy field fallback. */
    private readSwipeEntry(info: SwipeInfoEx | undefined, ns: string, key: string): DataEntry | null {
        if (!info)
            return null;

        const entry = info.cg_data?.[ns]?.[key];
        if (entry)
            return entry;

        // Legacy fallback: chat files written before cg_data existed.
        if (ns === DATA_NAMESPACES.WORLDINFO) {
            const { world, uid } = splitWorldInfoKey(key);
            if (uid) {
                const legacy = info.wi_overrides?.[world]?.[uid];
                if (legacy)
                    return { source: legacy.type, content: legacy.content };
            }
        } else if (ns === DATA_NAMESPACES.MESSAGE && key === '') {
            if (info.mes_override != null)
                return { source: 'legacy', content: info.mes_override };
        }

        return null;
    }

    /** Read all entries of a namespace from one swipe, with legacy field fallback. */
    private readSwipeEntries(info: SwipeInfoEx | undefined, ns: string): Record<string, DataEntry> {
        if (!info)
            return {};

        const results: Record<string, DataEntry> = {};

        // Legacy first, so cg_data wins on key conflicts.
        for (const [key, entry] of Object.entries(readLegacyEntries(info, ns))) {
            results[key] = entry;
        }

        for (const [key, entry] of Object.entries(info.cg_data?.[ns] ?? {})) {
            results[key] = entry;
        }

        return results;
    }

    /** Get (building if needed) the head index for this chat array. */
    private ensureIndex(): HeadIndex {
        const cached = INDEX_CACHE.get(this.chat);
        const coldEnd = Math.max(0, this.chat.length - HOT_WINDOW);

        if (cached && cached.epoch === indexEpoch) {
            if (cached.chatLength === this.chat.length)
                return cached;

            // Messages were appended: only the newly cold ones need scanning.
            if (this.chat.length > cached.chatLength) {
                this.extendIndex(cached, coldEnd);
                return cached;
            }
        }

        const index = this.buildIndex(coldEnd);
        INDEX_CACHE.set(this.chat, index);
        return index;
    }

    private buildIndex(coldEnd: number): HeadIndex {
        const index: HeadIndex = {
            heads: new Map(),
            coldEnd: 0,
            chatLength: this.chat.length,
            epoch: indexEpoch,
        };

        this.indexRange(index, 0, coldEnd);
        index.coldEnd = coldEnd;
        return index;
    }

    private extendIndex(index: HeadIndex, coldEnd: number): void {
        this.indexRange(index, index.coldEnd, coldEnd);
        index.coldEnd = coldEnd;
        index.chatLength = this.chat.length;
    }

    /**
     * Record head positions for `chat[from..to)`. Walking backwards keeps the
     * first hit per key, which is the newest layer; entries already known from a
     * newer range are never overwritten.
     */
    private indexRange(index: HeadIndex, from: number, to: number): void {
        for (let i = to - 1; i >= from; --i) {
            const message = this.chat[i];
            if (!message)
                continue;

            const swipeId = message.swipe_id ?? 0;
            const info = message.swipe_info?.[swipeId];
            if (!info)
                continue;

            for (const ns of layeredNamespacesIn(info)) {
                for (const key of Object.keys(this.readSwipeEntries(info, ns))) {
                    const id = indexKey(ns, key);
                    const known = index.heads.get(id);
                    if (!known || known.messageId < i)
                        index.heads.set(id, { messageId: i, swipeId });
                }
            }
        }
    }

    /** Keep the index in sync with a write instead of rebuilding it. */
    private touchIndex(ns: string, key: string, messageId: number, swipeId: number): void {
        if (!isLayeredNamespace(ns))
            return;

        const index = INDEX_CACHE.get(this.chat);
        if (!index || index.epoch !== indexEpoch)
            return;

        if (messageId >= index.coldEnd)
            return; // Hot region: always read exactly, nothing to record.

        const id = indexKey(ns, key);
        const known = index.heads.get(id);
        if (!known || known.messageId <= messageId)
            index.heads.set(id, { messageId, swipeId });
    }
}

function indexKey(ns: string, key: string): string {
    return `${ns}\u0000${key}`;
}

/** Legacy field entries mapped into a namespace. */
function readLegacyEntries(info: SwipeInfoEx, ns: string): Record<string, DataEntry> {
    const results: Record<string, DataEntry> = {};

    if (ns === DATA_NAMESPACES.WORLDINFO && info.wi_overrides) {
        for (const [world, entries] of Object.entries(info.wi_overrides)) {
            for (const [uid, legacy] of Object.entries(entries)) {
                results[worldInfoKey(world, uid)] = { source: legacy.type, content: legacy.content };
            }
        }
    } else if (ns === DATA_NAMESPACES.MESSAGE && info.mes_override != null) {
        results[''] = { source: 'legacy', content: info.mes_override };
    }

    return results;
}

/** Layered namespaces carrying data in one swipe, including legacy fields. */
export function layeredNamespacesIn(info: SwipeInfoEx | undefined): string[] {
    if (!info)
        return [];

    const namespaces = new Set<string>();
    for (const ns of Object.keys(info.cg_data ?? {})) {
        if (isLayeredNamespace(ns))
            namespaces.add(ns);
    }

    if (info.wi_overrides && Object.keys(info.wi_overrides).length)
        namespaces.add(DATA_NAMESPACES.WORLDINFO);

    return Array.from(namespaces);
}

/**
 * {@link DataStore} adapter over a layered namespace of {@link ChatDataStore},
 * used as the backing store of the root file system.
 *
 * Reads resolve through the full layer chain; writes only ever touch the pinned
 * layer, which is what makes files roll back together with swipes.
 */
export class MessageDataStore implements DataStore {
    /** Message the next write is pinned to; -1 means "the latest message". */
    public messageId = -1;
    /** Swipe the next write is pinned to; -1 means "the active swipe". */
    public swipeId = -1;

    /**
     * @param env Held as an object reference on purpose: `Context` reassigns its
     * own `chat` / `chat_metadata` after construction, so caching the arrays here
     * would pin this store to a stale chat.
     */
    constructor(
        private env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata },
        public ns: string = DATA_NAMESPACES.FILES,
        public source: string = 'filesystem',
    ) {}

    get store(): ChatDataStore {
        return new ChatDataStore(this.env);
    }

    /** Explicit read position, or the latest layer when unpinned. */
    private readPin(): { messageId?: number; swipeId?: number } {
        return {
            messageId: this.messageId >= 0 ? this.messageId : undefined,
            swipeId: this.swipeId >= 0 ? this.swipeId : undefined,
        };
    }

    /**
     * Layer a write lands on. Unpinned writes go to the staging layer so they can
     * be flushed onto the assistant message once it exists; landing them on the
     * user message instead would make files survive a reroll.
     */
    private writePin(): { messageId: number; swipeId?: number } {
        if (this.messageId >= 0)
            return { messageId: this.messageId, swipeId: this.swipeId >= 0 ? this.swipeId : undefined };

        return { messageId: STAGED_MESSAGE_ID };
    }

    async get(key: string): Promise<string | undefined> {
        return readStaged(this.env, this.ns, key, this.readPin())?.content;
    }

    async set(key: string, value: string): Promise<this> {
        // Deduplicate: `edit_file` loops are the main source of layer bloat.
        const current = await this.get(key);
        if (current === value)
            return this;

        const pin = this.writePin();
        writeStaged(this.env, this.ns, key, { source: this.source, content: value }, pin);
        return this;
    }

    async delete(key: string): Promise<boolean> {
        if (await this.get(key) === undefined)
            return false;

        const pin = this.writePin();
        eraseStaged(this.env, this.ns, key, this.source, pin);
        return true;
    }

    async *keys(): AsyncIterableIterator<string> {
        for (const key of this.snapshot().keys()) {
            yield key;
        }
    }

    async *entries(): AsyncIterableIterator<[string, string]> {
        for (const entry of this.snapshot().entries()) {
            yield entry;
        }
    }

    /** Visible key/value view of the namespace, including staged writes. */
    snapshot(): Map<string, string> {
        const result = new Map<string, string>();
        for (const item of this.store.lookup(this.ns, this.readPin())) {
            result.set(item.key, item.entry.content);
        }

        if (this.messageId < 0) {
            for (const [key, entry] of Object.entries(stagedData(this.env)[this.ns] ?? {})) {
                if (entry.deleted)
                    result.delete(key);
                else
                    result.set(key, entry.content);
            }
        }

        return result;
    }
}

/**
 * Sentinel message id meaning "the message this generation is about to create".
 * @see MessageDataStore.writePin
 */
export const STAGED_MESSAGE_ID = -1;

/** Staged writes per chat array, waiting for their target message to exist. */
const STAGING = new WeakMap<ChatMessageEx[], CgData>();

function stagedData(env: { chat: ChatMessageEx[] }): CgData {
    let data = STAGING.get(env.chat);
    if (!data) {
        data = {};
        STAGING.set(env.chat, data);
    }
    return data;
}

function hasStaged(env: { chat: ChatMessageEx[] }): boolean {
    const data = STAGING.get(env.chat);
    return !!data && Object.keys(data).some(ns => Object.keys(data[ns]).length > 0);
}

function readStaged(
    env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata },
    ns: string,
    key: string,
    pin: { messageId?: number; swipeId?: number },
): DataEntry | null {
    return new ChatDataStore(env).getPending(ns, key, pin);
}

function writeStaged(
    env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata },
    ns: string,
    key: string,
    entry: DataEntry,
    pin: { messageId: number; swipeId?: number },
): void {
    if (pin.messageId === STAGED_MESSAGE_ID) {
        const data = stagedData(env);
        if (!data[ns])
            data[ns] = {};
        data[ns][key] = entry;
        return;
    }

    const store = new ChatDataStore(env);
    if (entry.deleted)
        store.setDeleted(ns, key, entry.source, pin.messageId, pin.swipeId);
    else
        store.set(ns, key, entry.source, entry.content, pin.messageId, pin.swipeId);
}

function eraseStaged(
    env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata },
    ns: string,
    key: string,
    source: string,
    pin: { messageId: number; swipeId?: number },
): void {
    if (pin.messageId === STAGED_MESSAGE_ID) {
        const data = stagedData(env);
        if (!data[ns])
            data[ns] = {};

        // Nothing older to mask: drop the staged value entirely.
        if (new ChatDataStore(env).get(ns, key) == null)
            delete data[ns][key];
        else
            data[ns][key] = { source, content: '', deleted: true };
        return;
    }

    new ChatDataStore(env).erase(ns, key, source, pin.messageId, pin.swipeId);
}

/**
 * Move staged writes onto a real message layer. Called once the assistant
 * message (or swipe) created by a generation exists, so that rerolling it also
 * discards everything written during that turn.
 * @returns number of flushed entries
 */
export function flushStagedData(
    env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata },
    messageId: number = env.chat.length - 1,
    swipeId?: number,
): number {
    if (!hasStaged(env))
        return 0;

    const data = STAGING.get(env.chat)!;
    STAGING.delete(env.chat);

    const message = env.chat[messageId];
    if (!message) {
        console.warn('[CG] discarding staged data: no message to flush into', data);
        return 0;
    }

    const store = new ChatDataStore(env);
    const swipe = swipeId ?? message.swipe_id ?? 0;
    let count = 0;

    for (const [ns, entries] of Object.entries(data)) {
        for (const [key, entry] of Object.entries(entries)) {
            if (entry.deleted)
                store.setDeleted(ns, key, entry.source, messageId, swipe);
            else
                store.set(ns, key, entry.source, entry.content, messageId, swipe);
            count += 1;
        }
    }

    return count;
}

/** Drop staged writes, e.g. when a new turn starts or the chat changes. */
export function clearStagedData(env: { chat: ChatMessageEx[] }): void {
    STAGING.delete(env.chat);
}
