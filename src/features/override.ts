import { eventSource, event_types } from "@st/scripts/events.js";
import { chat, chat_metadata } from "@st/script.js";
import { WorldInfoLoaded } from "@/utils/defines";

interface WIOverride {
    type: string;
    content: string;
}

type WIOverrides = Record<string, Record<string, WIOverride>>;

type SwipeInfoEx = SwipeInfo & { wi_overrides?: WIOverrides, mes_overrides?: string };
type ChatMessageEx = ChatMessage & { swipe_info?: SwipeInfoEx[] };

export class DataOverride {
    public chat: ChatMessageEx[];
    public chat_metadata: ChatMetadata;

    constructor(_chat: ChatMessage[], _metadata: ChatMetadata) {
        this.chat = _chat;
        this.chat_metadata = _metadata;
        
        // FIXME: Listening to Events Multiple Times
        // eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded.bind(null, new WeakRef(this)));
    }

    static global(): DataOverride {
        return new DataOverride(chat, chat_metadata);
    }

    async onWorldInfoLoaded(data: WorldInfoLoaded) {
        for(let i = 0; i < data.globalLore.length; ++i) {
            const entry = data.globalLore[i];
            const override = this.getOverride(entry.world, String(entry.uid));
            if(override) {
                data.globalLore[i] = {  ...entry, content: override.content };
                console.debug(`override global lore ${entry.world}/${entry.uid}-${entry.comment} to `, override.content);
            }
        }
        for(let i = 0; i < data.personaLore.length; ++i) {
            const entry = data.personaLore[i];
            const override = this.getOverride(entry.world, String(entry.uid));
            if(override) {
                data.personaLore[i] = {  ...entry, content: override.content };
                console.debug(`override persona lore ${entry.world}/${entry.uid}-${entry.comment} to `, override.content);
            }
        }
        for(let i = 0; i < data.characterLore.length; ++i) {
            const entry = data.characterLore[i];
            const override = this.getOverride(entry.world, String(entry.uid));
            if(override) {
                data.characterLore[i] = {  ...entry, content: override.content };
                console.debug(`override character lore ${entry.world}/${entry.uid}-${entry.comment} to `, override.content);
            }
        }
        for(let i = 0; i < data.chatLore.length; ++i) {
            const entry = data.chatLore[i];
            const override = this.getOverride(entry.world, String(entry.uid));
            if(override) {
                data.chatLore[i] = {  ...entry, content: override.content };
                console.debug(`override chat lore ${entry.world}/${entry.uid}-${entry.comment} to `, override.content);
            }
        }
    }

    getOverride(world: string, uid: string | number): WIOverride | null {
        const last = this.chat[this.chat.length - 1];
        return last?.swipe_info?.[last.swipe_id ?? 0]?.wi_overrides?.[world]?.[String(uid)] ?? null;
    }

    setOverride(world: string, uid: string | number, type: string, content: string) {
        const last = this.chat[this.chat.length - 1];
        if(!last.swipe_info)
            last.swipe_info = [];
        if(!last.swipe_info[last.swipe_id ?? 0])
            last.swipe_info[last.swipe_id ?? 0] = {};
        if(!last.swipe_info[last.swipe_id ?? 0].wi_overrides)
            last.swipe_info[last.swipe_id ?? 0].wi_overrides = {};
        if(!last.swipe_info[last.swipe_id ?? 0].wi_overrides?.[world]) // @ts-expect-error: 2339
            last.swipe_info[last.swipe_id ?? 0].wi_overrides[world] = {}; // @ts-expect-error: 2339
        last.swipe_info[last.swipe_id ?? 0].wi_overrides[world][String(uid)] = { type, content };
    }

    getChatOverride(message_id: number): string | null {
        const message = this.chat[message_id];
        return message?.swipe_info?.[message.swipe_id ?? 0]?.mes_overrides ?? null;
    }

    setChatOverride(message_id: number, content: string) {
        const message = this.chat[message_id];
        if(!message.swipe_info)
            message.swipe_info = [];
        if(!message.swipe_info[message.swipe_id ?? 0])
            message.swipe_info[message.swipe_id ?? 0] = {};
        message.swipe_info[message.swipe_id ?? 0].mes_overrides = content;
    }
}

async function onWorldInfoLoaded(self: WeakRef<DataOverride> | DataOverride, data: WorldInfoLoaded) {
    if(self instanceof WeakRef)
        await self.deref()?.onWorldInfoLoaded(data);
    else
        await self.onWorldInfoLoaded(data);
}

export async function setup() {
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded.bind(null, DataOverride.global()));
}
