import { eventSource, event_types } from "@st/scripts/events.js";
import { chat, chat_metadata, saveMetadata } from "@st/script.js";
import { settings, saveSettings } from "@/ui/state";
import {
    DATA_NAMESPACES,
    clearStagedData,
    invalidateHeadIndex,
    readPersistedState,
} from "@/functions/chat-data-store";
import {
    compactChatData,
    countDataLayers,
    estimateDataSize,
    maybeCompact,
} from "@/functions/data-compaction";
import { invalidateLorebookCache } from "@/functions/fs-worldinfo";
import { registerDataSection, registerInfoPanel } from "@/ui/overrides-modal";

/** Global environment used by the event handlers. */
function globalEnv() {
    return { chat, chat_metadata };
}

/**
 * Wiring for the virtual file system: cache lifetime, storage maintenance and
 * the storage/file views in the Overrides dialog.
 */
export async function setup() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        invalidateHeadIndex();
        invalidateLorebookCache();
        clearStagedData(globalEnv());
    });

    // The head index maps keys to cold-region positions, so any structural change
    // below the hot window has to drop it. Rebuilding is one reverse pass.
    eventSource.on(event_types.MESSAGE_DELETED, invalidateHeadIndex);
    eventSource.on(event_types.MESSAGE_SWIPED, invalidateHeadIndex);
    eventSource.on(event_types.WORLDINFO_UPDATED, invalidateLorebookCache);

    eventSource.on(event_types.GENERATION_ENDED, () => maybeCompact(globalEnv()));

    registerStorageSection();
    registerFilesSection();
}

function formatBytes(bytes: number): string {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * Storage panel: what the layered data currently costs, and the manual
 * compaction controls. Compaction is lossy by design, so a dry run reports the
 * damage before anything is touched.
 */
function registerStorageSection(): void {
    registerInfoPanel({
        title: 'Storage',
        render: (refresh) => {
            const env = globalEnv();
            const state = readPersistedState(env.chat_metadata);
            const container = $('<div class="custom_generation_overrides_body"></div>');
            const info = $('<div class="custom_generation_overrides_info"></div>');

            const row = (label: string, value: string) => {
                const item = $('<div class="custom_generation_overrides_info_item"></div>');
                item.append(
                    $('<span class="custom_generation_overrides_info_label"></span>').text(label),
                    $('<span class="custom_generation_overrides_info_value"></span>').text(value),
                );
                info.append(item);
            };

            row('Estimated size', formatBytes(estimateDataSize(env.chat, env.chat_metadata)));
            row('Stored layers', String(countDataLayers(env.chat)));
            row('Compacted up to', String(state?.watermark ?? 0));
            row('Auto compaction', settings.storage.autoCompact ? 'on' : 'off');
            row('Keep depth', String(settings.storage.keepDepth));
            row('Threshold', formatBytes(settings.storage.sizeThreshold));
            container.append(info);

            const warning = $('<div class="custom_generation_overrides_meta"></div>').text(
                'Compaction flattens history: older versions and inactive swipe branches of compacted messages are discarded, so swiping them no longer restores their overrides.',
            );
            container.append(warning);

            // Text buttons, not the 26px icon group used in block headers.
            const buttons = $('<div class="custom_generation_overrides_actions"></div>');

            const dryRun = $('<button class="menu_button" type="button" data-i18n="Preview compaction">Preview compaction</button>');
            dryRun.on('click', () => {
                const report = compactChatData(globalEnv(), true);
                if (!report.changed) {
                    toastr.info('Nothing to compact yet', 'Storage');
                    return;
                }

                toastr.info(
                    `${report.flattened} entries (${report.tombstones} deletions) would be flattened, ` +
                    `${report.removedLayers} layers and ${report.removedOrphans} orphans removed, ` +
                    `${report.migratedLegacy} legacy fields migrated, about ${formatBytes(report.releasedBytes)} released.`,
                    'Compaction preview',
                    { timeOut: 12000 },
                );
            });

            const compact = $('<button class="menu_button" type="button" data-i18n="Compact now">Compact now</button>');
            compact.on('click', async () => {
                const report = compactChatData(globalEnv());
                if (!report.changed) {
                    toastr.info('Nothing to compact yet', 'Storage');
                    return;
                }

                await saveMetadata();
                toastr.success(`Released about ${formatBytes(report.releasedBytes)}`, 'Compaction');
                refresh();
            });

            const toggle = $('<button class="menu_button" type="button"></button>')
                .text(settings.storage.autoCompact ? 'Disable auto compaction' : 'Enable auto compaction');
            toggle.on('click', () => {
                settings.storage.autoCompact = !settings.storage.autoCompact;
                saveSettings();
                refresh();
            });

            buttons.append(dryRun, compact, toggle);
            container.append(buttons);
            return container;
        },
    });
}

/**
 * Workspace files get the same per-message view as the other namespaces: which
 * message wrote which file, plus editing and rollback.
 */
function registerFilesSection(): void {
    registerDataSection({
        namespace: DATA_NAMESPACES.FILES,
        title: 'Workspace Files',
        describe: (item) => ({
            name: item.key,
            meta: item.messageId < 0
                ? 'Compacted history'
                : `Message ${item.messageId + 1} · Swipe ${item.swipeId}`,
            badges: ['File', item.entry.source || 'write'],
            info: [
                ['Path', item.key],
                ['Source', item.entry.source || '-'],
                ['Message', item.messageId < 0 ? 'compacted' : String(item.messageId + 1)],
                ['Swipe', String(item.swipeId)],
                ['Size', formatBytes(item.entry.content.length)],
            ],
        }),
        onEdit: (item, content, store) => {
            if (item.messageId < 0) {
                // Base-layer entries have no message to write back to; put the edit
                // on the latest message so it shadows the compacted value.
                store.set(DATA_NAMESPACES.FILES, item.key, 'user-edit', content);
                return;
            }

            store.set(DATA_NAMESPACES.FILES, item.key, 'user-edit', content, item.messageId, item.swipeId);
        },
        onDelete: (item, store) => {
            store.erase(DATA_NAMESPACES.FILES, item.key, 'user-delete',
                item.messageId < 0 ? undefined : item.messageId,
                item.messageId < 0 ? undefined : item.swipeId);
        },
    });
}
