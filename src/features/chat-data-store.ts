import { chat, chat_metadata } from "@st/script.js";

/**
 * A single stored data entry.
 */
export interface DataEntry {
    /** Who wrote this entry, e.g. '@@replace' / 'tool_call' / 'user-edit' / 'summary-gen'. */
    source: string;
    content: string;
}

/** namespace -> key -> entry */
type CgData = Record<string, Record<string, DataEntry>>;

// Legacy storage fields (read-only fallback, never written).
interface LegacyWIOverride {
    type: string;
    content: string;
}
type LegacyWIOverrides = Record<string, Record<string, LegacyWIOverride>>;

type SwipeInfoEx = SwipeInfo & {
    cg_data?: CgData;
    wi_overrides?: LegacyWIOverrides;
    mes_override?: string;
};
type ChatMessageEx = ChatMessage & { swipe_info?: SwipeInfoEx[] };

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
} as const;

/** Build the `worldinfo` namespace key for a WI entry. */
export function worldInfoKey(world: string, uid: string | number): string {
    return `${world}/${String(uid)}`;
}

/**
 * Generic layered chat data store.
 *
 * Data lives at `chat[messageId].swipe_info[swipeId].cg_data[namespace][key]`, so it
 * is persisted with the chat file, isolated per swipe, and read with message
 * backtracking (a value set at message N is visible at message N+1 unless overridden).
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
     */
    get(ns: string, key: string, opts: { messageId?: number; swipeId?: number; maxDepth?: number } = {}): DataEntry | null {
        const { messageId, swipeId, maxDepth = 999 } = opts;
        let depth = maxDepth;

        for (let i = messageId ?? this.chat.length - 1; i >= 0; --i) {
            if (depth < 0)
                return null;

            const message = this.chat[i];
            const swipe = (i === messageId || i === this.chat.length - 1) ? swipeId ?? message.swipe_id ?? 0 : message.swipe_id ?? 0;
            const entry = this.readSwipeEntry(message?.swipe_info?.[swipe], ns, key);
            if (entry)
                return entry;

            depth -= 1;
        }

        return null;
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
        swipeId: number = this.chat[messageId]?.swipe_id ?? 0,
    ): void {
        const message = this.chat[messageId];
        if (!message)
            return;

        if (!message.swipe_info)
            message.swipe_info = [];
        if (!message.swipe_info[swipeId])
            message.swipe_info[swipeId] = {};

        const info = message.swipe_info[swipeId];
        if (!info.cg_data)
            info.cg_data = {};
        if (!info.cg_data[ns])
            info.cg_data[ns] = {};

        info.cg_data[ns][key] = { source, content };
    }

    /**
     * Collect the latest visible entry for every key in a namespace,
     * walking back from the latest message (first hit wins per key).
     */
    lookup(ns: string, depth: number = 9): DataLookupResult[] {
        const results = new Map<string, DataLookupResult>();

        for (let i = this.chat.length - 1; i >= 0; --i) {
            if (depth < 0)
                break;

            const message = this.chat[i];
            if (!message)
                continue;

            const swipeId = message.swipe_id ?? 0;
            const entries = this.readSwipeEntries(message.swipe_info?.[swipeId], ns);
            for (const [key, entry] of Object.entries(entries)) {
                if (!results.has(key)) {
                    results.set(key, { key, entry, messageId: i, swipeId });
                }
            }

            depth -= 1;
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
                results.push({ key, entry, messageId: i, swipeId });
            }
        }

        return results;
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
            const slash = key.indexOf('/');
            if (slash >= 0) {
                const legacy = info.wi_overrides?.[key.slice(0, slash)]?.[key.slice(slash + 1)];
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
        if (ns === DATA_NAMESPACES.WORLDINFO && info.wi_overrides) {
            for (const [world, entries] of Object.entries(info.wi_overrides)) {
                for (const [uid, legacy] of Object.entries(entries)) {
                    results[worldInfoKey(world, uid)] = { source: legacy.type, content: legacy.content };
                }
            }
        } else if (ns === DATA_NAMESPACES.MESSAGE && info.mes_override != null) {
            results[''] = { source: 'legacy', content: info.mes_override };
        }

        for (const [key, entry] of Object.entries(info.cg_data?.[ns] ?? {})) {
            results[key] = entry;
        }

        return results;
    }
}
