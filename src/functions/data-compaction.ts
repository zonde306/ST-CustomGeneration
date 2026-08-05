import { saveMetadata } from "@st/script.js";
import { settings } from "@/ui/state";
import {
    ChatMessageEx,
    CgData,
    CgPersistedState,
    DataEntry,
    DATA_NAMESPACES,
    HOT_WINDOW,
    SwipeInfoEx,
    invalidateHeadIndex,
    isCompactableNamespace,
    layeredNamespacesIn,
    readPersistedState,
    worldInfoKey,
} from "@/functions/chat-data-store";

export interface CompactionReport {
    /** Whether anything would change (or did change). */
    changed: boolean;
    /** Messages whose layers were (or would be) flattened: `chat[0..coldEnd)`. */
    coldEnd: number;
    /** Previous watermark. */
    watermark: number;
    /** Keys written into the base layer. */
    flattened: number;
    /** Tombstones carried into the base layer. */
    tombstones: number;
    /** Layers physically removed from `swipe_info`. */
    removedLayers: number;
    /** Orphan swipe layers (swipeId beyond `swipes.length`) removed. */
    removedOrphans: number;
    /** Legacy `wi_overrides` / `mes_override` fields migrated away. */
    migratedLegacy: number;
    /** Estimated bytes released from the chat file. */
    releasedBytes: number;
}

const EMPTY_REPORT: CompactionReport = {
    changed: false,
    coldEnd: 0,
    watermark: 0,
    flattened: 0,
    tombstones: 0,
    removedLayers: 0,
    removedOrphans: 0,
    migratedLegacy: 0,
    releasedBytes: 0,
};

/** Rough serialized size of every `cg_data` / legacy field in the chat. */
export function estimateDataSize(chat: ChatMessageEx[], metadata?: ChatMetadata): number {
    let size = 0;

    for (const message of chat) {
        for (const info of message?.swipe_info ?? []) {
            if (!info)
                continue;
            if (info.cg_data)
                size += JSON.stringify(info.cg_data).length;
            if (info.wi_overrides)
                size += JSON.stringify(info.wi_overrides).length;
            if (typeof info.mes_override === 'string')
                size += info.mes_override.length;
        }
    }

    const state = metadata ? readPersistedState(metadata) : null;
    if (state?.base)
        size += JSON.stringify(state.base).length;

    return size;
}

/** Number of stored layers, for the storage report in the UI. */
export function countDataLayers(chat: ChatMessageEx[]): number {
    let count = 0;

    for (const message of chat) {
        for (const info of message?.swipe_info ?? []) {
            for (const ns of Object.keys(info?.cg_data ?? {})) {
                count += Object.keys(info!.cg_data![ns]).length;
            }
        }
    }

    return count;
}

/**
 * Flatten the layers of cold messages into the persisted base layer.
 *
 * Idempotent. Pass `dryRun` to obtain the report without touching anything.
 *
 * Trade-off, deliberate and user visible: historical versions and inactive swipe
 * branches of cold messages are discarded, so swiping a compacted message no
 * longer rolls its overrides back. `keepDepth` bounds the damage and
 * `autoCompact: false` disables it entirely.
 */
export function compactChatData(
    env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata },
    dryRun: boolean = false,
): CompactionReport {
    const storage = settings.storage;
    const chat = env.chat;
    const keepDepth = Math.max(HOT_WINDOW + 1, storage?.keepDepth ?? 32);
    const state = readPersistedState(env.chat_metadata, !dryRun) ?? { base: {}, watermark: 0, version: 1 as const };
    const coldEnd = chat.length - keepDepth;

    if (coldEnd <= state.watermark)
        return { ...EMPTY_REPORT, coldEnd: Math.max(0, coldEnd), watermark: state.watermark };

    const pruneLegacy = storage?.pruneLegacy !== false;
    const report: CompactionReport = {
        ...EMPTY_REPORT,
        coldEnd,
        watermark: state.watermark,
    };

    // 1. Collect the newest visible layer per key across the cold region.
    const base: CgData = dryRun ? cloneData(state.base) : state.base;
    const collected = collectHeads(chat, coldEnd);

    for (const [ns, entries] of Object.entries(collected)) {
        if (!base[ns])
            base[ns] = {};

        for (const [key, { entry, messageId, swipeId }] of Object.entries(entries)) {
            base[ns][key] = {
                source: `${entry.source}+compacted@${messageId}#${swipeId}`,
                content: entry.content,
                // Tombstones must survive compaction, or deletes get resurrected
                // by the value the base still holds.
                ...(entry.deleted ? { deleted: true } : {}),
            };

            report.flattened += 1;
            if (entry.deleted)
                report.tombstones += 1;
        }
    }

    // 2. Drop the flattened layers.
    for (let i = 0; i < coldEnd; ++i) {
        const message = chat[i];
        if (!message?.swipe_info)
            continue;

        for (let swipeId = 0; swipeId < message.swipe_info.length; ++swipeId) {
            const info = message.swipe_info[swipeId];
            if (!info)
                continue;

            report.releasedBytes += swipeDataSize(info, pruneLegacy);

            for (const ns of Object.keys(info.cg_data ?? {})) {
                if (!isCompactableNamespace(ns))
                    continue; // Per-message namespaces stay untouched.

                report.removedLayers += Object.keys(info.cg_data![ns]).length;
                if (!dryRun)
                    delete info.cg_data![ns];
            }

            if (!dryRun && info.cg_data && !Object.keys(info.cg_data).length)
                delete info.cg_data;

            if (pruneLegacy && info.wi_overrides) {
                report.migratedLegacy += 1;
                if (!dryRun)
                    delete info.wi_overrides;
            }
        }

        // 3. Orphan layers of swipes that no longer exist.
        const swipes = message.swipes?.length ?? 1;
        for (let swipeId = swipes; swipeId < message.swipe_info.length; ++swipeId) {
            if (!message.swipe_info[swipeId])
                continue;

            report.removedOrphans += 1;
            if (!dryRun)
                delete message.swipe_info[swipeId];
        }
    }

    report.changed = report.flattened > 0 || report.removedLayers > 0 ||
        report.removedOrphans > 0 || report.migratedLegacy > 0 || coldEnd > state.watermark;

    if (dryRun)
        return report;

    state.base = base;
    state.watermark = coldEnd;
    invalidateHeadIndex();

    return report;
}

/**
 * Collect, per layered namespace, the newest visible entry of every key within
 * `chat[0..coldEnd)`, following each message's active swipe.
 */
function collectHeads(chat: ChatMessageEx[], coldEnd: number): Record<string, Record<string, {
    entry: DataEntry; messageId: number; swipeId: number;
}>> {
    const collected: Record<string, Record<string, { entry: DataEntry; messageId: number; swipeId: number }>> = {};

    for (let i = coldEnd - 1; i >= 0; --i) {
        const message = chat[i];
        if (!message)
            continue;

        const swipeId = message.swipe_id ?? 0;
        const info = message.swipe_info?.[swipeId];
        if (!info)
            continue;

        for (const ns of layeredNamespacesIn(info)) {
            if (!isCompactableNamespace(ns))
                continue;

            if (!collected[ns])
                collected[ns] = {};

            for (const [key, entry] of Object.entries(collectSwipeEntries(info, ns))) {
                if (!collected[ns][key])
                    collected[ns][key] = { entry, messageId: i, swipeId };
            }
        }
    }

    return collected;
}

/** Entries of one namespace in one swipe, legacy fields included. */
function collectSwipeEntries(info: SwipeInfoEx, ns: string): Record<string, DataEntry> {
    const results: Record<string, DataEntry> = {};

    if (ns === DATA_NAMESPACES.WORLDINFO && info.wi_overrides) {
        for (const [world, entries] of Object.entries(info.wi_overrides)) {
            for (const [uid, legacy] of Object.entries(entries)) {
                results[worldInfoKey(world, uid)] = { source: legacy.type, content: legacy.content };
            }
        }
    }

    for (const [key, entry] of Object.entries(info.cg_data?.[ns] ?? {})) {
        results[key] = entry;
    }

    return results;
}

function swipeDataSize(info: SwipeInfoEx, includeLegacy: boolean): number {
    let size = 0;

    for (const ns of Object.keys(info.cg_data ?? {})) {
        if (isCompactableNamespace(ns))
            size += JSON.stringify(info.cg_data![ns]).length;
    }

    if (includeLegacy && info.wi_overrides)
        size += JSON.stringify(info.wi_overrides).length;

    return size;
}

function cloneData(data: CgData): CgData {
    return JSON.parse(JSON.stringify(data ?? {})) as CgData;
}

/**
 * Compact when enabled and the stored data grew past the configured threshold,
 * then persist. Safe to call after every generation.
 */
export async function maybeCompact(env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata }): Promise<CompactionReport | null> {
    const storage = settings.storage;
    if (!storage?.autoCompact)
        return null;

    const size = estimateDataSize(env.chat, env.chat_metadata);
    if (size <= (storage.sizeThreshold ?? 256 * 1024))
        return null;

    const report = compactChatData(env);
    if (!report.changed)
        return report;

    console.log('[CG] compacted chat data', report);
    await saveMetadata();
    return report;
}

export type { CgPersistedState };
