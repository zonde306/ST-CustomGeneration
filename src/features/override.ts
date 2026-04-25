import { eventSource, event_types } from "@st/scripts/events.js";
import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { chat, chat_metadata, name1, name2 } from "@st/script.js";
import { WorldInfoLoaded } from "@/utils/defines";
import { copyText } from "@st/scripts/utils.js";

interface WIOverride {
    type: string;
    content: string;
}

type WIOverrides = Record<string, Record<string, WIOverride>>;

type SwipeInfoEx = SwipeInfo & { wi_overrides?: WIOverrides, mes_override?: string };
type ChatMessageEx = ChatMessage & { swipe_info?: SwipeInfoEx[] };

type WorldInfoOverrideEntry = WIOverride & { world: string; uid: string; messageId: number; swipeId: number; };
type ChatMessageOverrideEntry = { messageId: number; swipeId: number; content: string; name: string; };

const PREVIEW_LIMIT = 120;
let isOverridesEventsBound = false;

function getDialog(selector: string): HTMLDialogElement | null {
    const element = document.querySelector(selector);
    return element instanceof HTMLDialogElement ? element : null;
}

function openDialog(selector: string): void {
    const dialog = getDialog(selector);
    if (!dialog || dialog.open) {
        return;
    }

    try {
        dialog.showModal();
    } catch {
        dialog.setAttribute('open', 'open');
    }
}

function closeDialog(selector: string): void {
    const dialog = getDialog(selector);
    if (!dialog) {
        return;
    }

    if (dialog.open) {
        dialog.close();
    } else {
        dialog.removeAttribute('open');
    }
}

function getPreviewText(text: string): string {
    return String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, PREVIEW_LIMIT);
}

function buildOverrideInfoItem(label: string, value: string): JQuery<HTMLElement> {
    const item = $('<div class="custom_generation_overrides_info_item"></div>');
    const labelEl = $('<span class="custom_generation_overrides_info_label"></span>').text(label);
    const valueEl = $('<span class="custom_generation_overrides_info_value"></span>').text(value);
    item.append(labelEl, valueEl);
    return item;
}

function createCopyButton(content: string): JQuery<HTMLElement> {
    const button = $('<button class="menu_button fa-solid fa-copy custom_generation_copy_button" type="button" title="Copy" data-i18n="[title]Copy"></button>');
    button.on('click', async (event: JQuery.ClickEvent) => {
        event.preventDefault();
        event.stopPropagation();

        try {
            await copyText(content);
            toastr.success('Copied to clipboard', 'Copy');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Copy failed');
            toastr.error(message, 'Copy');
        }
    });
    return button;
}

function buildOverrideBlock(title: string, content: string): JQuery<HTMLElement> {
    const block = $('<div class="custom_generation_overrides_block"></div>');
    const header = $('<div class="custom_generation_overrides_block_header"></div>');
    const titleEl = $('<div class="custom_generation_overrides_block_title"></div>').text(title);
    const copyButton = createCopyButton(content);
    const pre = $('<pre class="custom_generation_overrides_pre"></pre>').text(content);
    header.append(titleEl, copyButton);
    block.append(header, pre);
    return block;
}

function buildOverrideTitle(base: string, content: string): string {
    const preview = getPreviewText(content);
    return preview ? `${base}: ${preview}` : base;
}

function buildWorldInfoEntry(entry: WorldInfoOverrideEntry): JQuery<HTMLElement> {
    const details = $('<details class="custom_generation_overrides_entry"></details>');
    const summary = $('<summary class="custom_generation_overrides_summary"></summary>');
    const caret = $('<i class="fa-solid fa-chevron-right custom_generation_overrides_caret"></i>');

    const left = $('<div class="custom_generation_overrides_summary_left"></div>');
    const title = $('<div class="custom_generation_overrides_title"></div>').text(
        buildOverrideTitle(`World ${entry.world} · UID ${entry.uid}`, entry.content),
    );
    const meta = $('<div class="custom_generation_overrides_meta"></div>').text(
        `Message ${entry.messageId + 1} · Swipe ${entry.swipeId}`,
    );
    left.append(title, meta);

    const right = $('<div class="custom_generation_overrides_summary_right"></div>');
    const typeBadge = $('<span class="custom_generation_overrides_badge"></span>').text(entry.type || 'Override');
    const kindBadge = $('<span class="custom_generation_overrides_badge"></span>').text('World Info');
    right.append(kindBadge, typeBadge);

    summary.append(caret, left, right);

    const body = $('<div class="custom_generation_overrides_body"></div>');
    const info = $('<div class="custom_generation_overrides_info"></div>');
    info.append(
        buildOverrideInfoItem('World', entry.world),
        buildOverrideInfoItem('UID', entry.uid),
        buildOverrideInfoItem('Type', entry.type || '-'),
        buildOverrideInfoItem('Message', String(entry.messageId + 1)),
        buildOverrideInfoItem('Swipe', String(entry.swipeId)),
    );

    body.append(info);
    body.append(buildOverrideBlock('Content', entry.content));

    details.append(summary, body);
    return details;
}

function buildChatOverrideEntry(entry: ChatMessageOverrideEntry): JQuery<HTMLElement> {
    const details = $('<details class="custom_generation_overrides_entry"></details>');
    const summary = $('<summary class="custom_generation_overrides_summary"></summary>');
    const caret = $('<i class="fa-solid fa-chevron-right custom_generation_overrides_caret"></i>');

    const left = $('<div class="custom_generation_overrides_summary_left"></div>');
    const title = $('<div class="custom_generation_overrides_title"></div>').text(
        buildOverrideTitle(`${entry.name ?? 'Unknown'} · Message ${entry.messageId + 1}`, entry.content),
    );
    const meta = $('<div class="custom_generation_overrides_meta"></div>').text(
        `Swipe ${entry.swipeId}`,
    );
    left.append(title, meta);

    const right = $('<div class="custom_generation_overrides_summary_right"></div>');
    const kindBadge = $('<span class="custom_generation_overrides_badge"></span>').text('Chat Message');
    right.append(kindBadge);

    summary.append(caret, left, right);

    const body = $('<div class="custom_generation_overrides_body"></div>');
    const info = $('<div class="custom_generation_overrides_info"></div>');
    info.append(
        buildOverrideInfoItem('Name', entry.name ?? '-'),
        buildOverrideInfoItem('Message', String(entry.messageId + 1)),
        buildOverrideInfoItem('Swipe', String(entry.swipeId)),
    );

    body.append(info);
    body.append(buildOverrideBlock('Content', entry.content));

    details.append(summary, body);
    return details;
}

function buildOverridesSection(title: string, entries: JQuery<HTMLElement>[], i18nKey?: string): JQuery<HTMLElement> {
    const section = $('<div class="custom_generation_overrides_section"></div>');
    const titleEl = $('<div class="custom_generation_overrides_section_title"></div>').text(title);
    if (i18nKey) {
        titleEl.attr('data-i18n', i18nKey);
    }
    const body = $('<div class="custom_generation_overrides_section_body"></div>');
    entries.forEach(entry => body.append(entry));
    section.append(titleEl, body);
    return section;
}

function updateOverridesList(): void {
    const list = $('#custom_generation_overrides_list');
    if (!list.length) {
        return;
    }

    list.empty();

    const override = DataOverride.global();
    const worldInfoOverrides = override.lookupOverrides();
    const chatOverrides = override.lookupChatOverrides();

    if (!worldInfoOverrides.length && !chatOverrides.length) {
        const emptyText = String(list.attr('no-items-text') ?? 'No overrides');
        const empty = $('<div class="custom_generation_logger_empty text_muted"></div>').text(emptyText);
        list.append(empty);
        return;
    }

    if (worldInfoOverrides.length) {
        const entries = worldInfoOverrides.map(buildWorldInfoEntry);
        list.append(buildOverridesSection('World Info Overrides', entries, 'World Info Overrides'));
    }

    if (chatOverrides.length) {
        const entries = chatOverrides.map(buildChatOverrideEntry);
        list.append(buildOverridesSection('Chat Message Overrides', entries, 'Chat Message Overrides'));
    }
}

function bindOverridesEvents(): void {
    if (isOverridesEventsBound) {
        return;
    }

    isOverridesEventsBound = true;

    $('#custom_generation_overrides_close').on('click', () => {
        closeDialog('#custom_generation_overrides_dialog');
    });
}

export class DataOverride {
    public chat: ChatMessageEx[];
    public chat_metadata: ChatMetadata;

    constructor(_chat: ChatMessage[], _metadata: ChatMetadata) {
        this.chat = Array.isArray(_chat) ? _chat : [];
        this.chat_metadata = _metadata ?? {};
    }

    /**
     * WI overrides of the current chat file
     */
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
        for(let i = mesId ?? this.chat.length - 1; i >= 0; --i) {
            if(maxDepth < 0)
                return null;

            const message = this.chat[i];
            const swipe = (i === mesId || i === this.chat.length - 1) ? swipeId ?? message.swipe_id ?? 0 : message.swipe_id ?? 0;
            const override = message.swipe_info?.[swipe]?.wi_overrides?.[world]?.[String(uid)];
            if(override)
                return override;

            maxDepth -= 1;
        }

        return null;
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
        messageId: number = this.chat.length - 1,
        swipeId: number = this.chat[messageId].swipe_id ?? 0,
    ) {
        const last = this.chat[messageId];
        if(!last.swipe_info)
            last.swipe_info = [];
        if(!last.swipe_info[swipeId])
            last.swipe_info[swipeId] = {};
        if(!last.swipe_info[swipeId].wi_overrides)
            last.swipe_info[swipeId].wi_overrides = {};
        if(!last.swipe_info[swipeId].wi_overrides?.[world])
            last.swipe_info[swipeId].wi_overrides[world] = {};
        last.swipe_info[swipeId].wi_overrides[world][String(uid)] = { type, content };
    }

    getChatOverride(messageId: number): string | null {
        const message = this.chat[messageId];
        return message?.swipe_info?.[message.swipe_id ?? 0]?.mes_override ?? null;
    }

    setChatOverride(messageId: number, content: string) {
        const message = this.chat[messageId];
        if(!message.swipe_info)
            message.swipe_info = [];
        if(!message.swipe_info[message.swipe_id ?? 0])
            message.swipe_info[message.swipe_id ?? 0] = {};
        message.swipe_info[message.swipe_id ?? 0].mes_override = content;
    }

    lookupOverrides(depth: number = 9): (WIOverride & {
        world: string; uid: string; messageId: number; swipeId: number;
    })[] {
        const results = new Map<string, WIOverride & { world: string; uid: string; messageId: number; swipeId: number; }>();

        for(let i = this.chat.length - 1; i >= 0; --i) {
            if(depth < 0)
                break;

            const message = this.chat[i];
            if(!message)
                continue;

            const overrides = message.swipe_info?.[message.swipe_id ?? 0]?.wi_overrides;
            if(overrides) {
                for(const [world, entries] of Object.entries(overrides)) {
                    for(const [uid, override] of Object.entries(entries)) {
                        if(!results.has(`${world}/${uid}`)) {
                            results.set(`${world}/${uid}`, {
                                ...override,
                                world: world,
                                uid: uid,
                                messageId: i,
                                swipeId: message.swipe_id ?? 0,
                            });
                        }
                    }
                }
            }
        }

        return Array.from(results.values());
    }

    lookupChatOverrides(depth: number = 9): ({
        messageId: number; swipeId: number; content: string; name: string;
    })[] {
        const results: {
            messageId: number; swipeId: number; content: string; name: string;
        }[] = [];

        const startIndex = Math.max(0, this.chat.length - 1 - depth);
        for(let i = startIndex; i < this.chat.length; ++i) {
            const message = this.chat[i];

            // message is hidden
            if(!message || message.is_system)
                continue;

            const content = message.swipe_info?.[message.swipe_id ?? 0]?.mes_override;
            if(content) {
                results.push({
                    messageId: i,
                    swipeId: message.swipe_id ?? 0,
                    content: content,
                    name: message.name ?? (message.is_user ? name1 : name2),
                });
            }
        }

        return results;
    }
}

async function onWorldInfoLoaded(data: WorldInfoLoaded) {
    const override: DataOverride = data.context ?
        new DataOverride(data.context.chat, data.context.chat_metadata) :
        DataOverride.global();
    
    await override.onWorldInfoLoaded(data);
}

export async function setup() {
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded);
    eventSource.on(event_types.APP_READY, onAppReady);
}

async function onAppReady() {
    if (!$('#custom_generation_overrides_dialog').length) {
        const host = document.body ?? document.documentElement;
        $(host).append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'overrides-modal'));
    }

    bindOverridesEvents();

    if (!$('#extensionsMenu')?.find('custom_generation_overrides_button')?.length) {
        $('#extensionsMenu').append(`
            <div id="custom_generation_overrides_button" class="extension_container interactable" tabindex="0">
                <div id="customGenerateOverrides" class="list-group-item flex-container flexGap5 interactable" title="View Overrides." tabindex="0" role="listitem">
                    <div class="fa-fw fa-solid fa-book extensionsMenuExtensionButton"></div>
                    <span data-i18n="View Overrides">View Overrides</span>
                </div>
            </div>
        `);

        $('#customGenerateOverrides').on('click', () => {
            updateOverridesList();
            openDialog('#custom_generation_overrides_dialog');
        });
    }
}
