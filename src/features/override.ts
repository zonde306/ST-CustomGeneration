import { eventSource, event_types } from "@st/scripts/events.js";
import { chat, chat_metadata, name1, name2 } from "@st/script.js";
import { WorldInfoLoaded } from "@/utils/defines";
import { ChatDataStore, DataEntry, DATA_NAMESPACES, worldInfoKey } from "@/features/chat-data-store";
import { setup as setupOverridesModal, registerDataSection } from "@/ui/overrides-modal";

interface WIOverride {
    type: string;
    content: string;
}

/**
 * World Info override adapter: consumes the `worldinfo` namespace of
 * {@link ChatDataStore} and substitutes entry contents when WI entries load.
 * Stateless besides the store itself.
 */
function applyWorldInfoOverrides(store: ChatDataStore, data: WorldInfoLoaded) {
    const lores: Array<[string, (typeof data.globalLore)]> = [
        ['global', data.globalLore],
        ['persona', data.personaLore],
        ['character', data.characterLore],
        ['chat', data.chatLore],
    ];

    for (const [kind, lore] of lores) {
        for (let i = 0; i < lore.length; ++i) {
            const entry = lore[i];
            const override = store.get(DATA_NAMESPACES.WORLDINFO, worldInfoKey(entry.world, entry.uid));
            if (override) {
                lore[i] = { ...entry, content: override.content };
                console.debug(`override ${kind} lore ${entry.world}/${entry.uid}-${entry.comment} to `, override.content);
            }
        }
    }
}

/**
 * @deprecated Use {@link ChatDataStore} instead. Kept as a thin wrapper because
 * `globalThis.CustomGeneration.DataOverride` is a public API.
 */
export class DataOverride {
    public store: ChatDataStore;

    constructor(env: { chat: ChatMessage[]; chat_metadata: ChatMetadata }) {
        this.store = new ChatDataStore(env);
    }

    get chat() {
        return this.store.chat;
    }

    get chat_metadata() {
        return this.store.chat_metadata;
    }

    /**
     * WI overrides of the current chat file
     */
    static global(): DataOverride {
        return new DataOverride({ chat, chat_metadata });
    }

    /**
     * Retrieve the overridden content of a specified WorldInfo.
     * @param world world info name
     * @param uid entry uid
     * @param mesId Specify message ID, otherwise specify the latest message.
     * @param swipeId Specify swipe ID, otherwise specify the latest swipe.
     * @param maxDepth Maximum query depth
     * @returns Returns overwritten data on success, otherwise returns null.
     */
    getOverride(world: string, uid: string | number, mesId?: number, swipeId?: number, maxDepth: number = 999): WIOverride | null {
        const entry = this.store.get(DATA_NAMESPACES.WORLDINFO, worldInfoKey(world, uid), { messageId: mesId, swipeId, maxDepth });
        return entry ? { type: entry.source, content: entry.content } : null;
    }

    /**
     * Modify the content of WorldInfo overwrite data
     * @param world world info name
     * @param uid entry uid
     * @param type Override type tags
     * @param content Rewritten content
     * @param messageId Specify message ID, otherwise specify the latest message.
     * @param swipeId Specify swipe ID, otherwise specify the latest swipe.
     */
    setOverride(
        world: string,
        uid: string | number,
        type: string,
        content: string,
        messageId?: number,
        swipeId?: number,
    ) {
        this.store.set(DATA_NAMESPACES.WORLDINFO, worldInfoKey(world, uid), type, content, messageId, swipeId);
    }

    getChatOverride(messageId: number): string | null {
        const message = this.store.chat[messageId];
        return this.store.get(DATA_NAMESPACES.MESSAGE, '', { messageId, maxDepth: 0, swipeId: message?.swipe_id ?? 0 })?.content ?? null;
    }

    setChatOverride(messageId: number, content: string) {
        this.store.set(DATA_NAMESPACES.MESSAGE, '', 'user-edit', content, messageId);
    }

    lookupOverrides(depth: number = 9): (WIOverride & {
        world: string; uid: string; messageId: number; swipeId: number;
    })[] {
        return this.store.lookup(DATA_NAMESPACES.WORLDINFO, depth).map(({ key, entry, messageId, swipeId }) => {
            const slash = key.indexOf('/');
            return {
                type: entry.source,
                content: entry.content,
                world: slash >= 0 ? key.slice(0, slash) : key,
                uid: slash >= 0 ? key.slice(slash + 1) : '',
                messageId,
                swipeId,
            };
        });
    }

    lookupChatOverrides(depth: number = 9): ({
        messageId: number; swipeId: number; content: string; name: string;
    })[] {
        return this.store.scan(DATA_NAMESPACES.MESSAGE, depth).map(({ entry, messageId, swipeId }) => {
            const message = this.store.chat[messageId];
            return {
                messageId,
                swipeId,
                content: entry.content,
                name: message?.name ?? (message?.is_user ? name1 : name2),
            };
        });
    }
}

async function onWorldInfoLoaded(data: WorldInfoLoaded) {
    const store: ChatDataStore = data.context ?
        new ChatDataStore(data.context) :
        ChatDataStore.global();

    applyWorldInfoOverrides(store, data);
}

function splitWorldInfoKey(key: string): { world: string; uid: string } {
    const slash = key.indexOf('/');
    return slash >= 0
        ? { world: key.slice(0, slash), uid: key.slice(slash + 1) }
        : { world: key, uid: '' };
}

function describeSource(entry: DataEntry): string {
    return entry.source === 'legacy' ? '' : entry.source;
}

export async function setup() {
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded);
    eventSource.on(event_types.APP_READY, setupOverridesModal);

    registerDataSection({
        namespace: DATA_NAMESPACES.WORLDINFO,
        title: 'World Info Overrides',
        describe: (item) => {
            const { world, uid } = splitWorldInfoKey(item.key);
            return {
                name: `World ${world} · UID ${uid}`,
                meta: `Message ${item.messageId + 1} · Swipe ${item.swipeId}`,
                badges: ['World Info', describeSource(item.entry) || 'Override'],
                info: [
                    ['World', world],
                    ['UID', uid],
                    ['Type', describeSource(item.entry) || '-'],
                    ['Message', String(item.messageId + 1)],
                    ['Swipe', String(item.swipeId)],
                ],
            };
        },
        onEdit: (item, content, store) => {
            store.set(DATA_NAMESPACES.WORLDINFO, item.key, item.entry.source, content, item.messageId, item.swipeId);
        },
    });

    registerDataSection({
        namespace: DATA_NAMESPACES.MESSAGE,
        title: 'Chat Message Overrides',
        list: (store) => store.scan(DATA_NAMESPACES.MESSAGE),
        describe: (item) => {
            const message = chat[item.messageId];
            const name = message?.name ?? (message?.is_user ? name1 : name2);
            return {
                name: `${name ?? 'Unknown'} · Message ${item.messageId + 1}`,
                meta: `Swipe ${item.swipeId}`,
                badges: ['Chat Message'],
                info: [
                    ['Name', name ?? '-'],
                    ['Message', String(item.messageId + 1)],
                    ['Swipe', String(item.swipeId)],
                ],
            };
        },
        onEdit: (item, content, store) => {
            store.set(DATA_NAMESPACES.MESSAGE, item.key, 'user-edit', content, item.messageId, item.swipeId);
        },
    });
}
