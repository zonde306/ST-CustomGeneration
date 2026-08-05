import { chat, chat_metadata, characters, this_chid, saveCharacterDebounced, saveMetadata } from "@st/script.js";
import { settings, saveSettings, updateSettingsUI } from '@/settings'
import { eventSource, event_types } from "@st/scripts/events.js";
import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { v1CharData } from "@st/scripts/char-data.js";
import { power_user } from "@st/scripts/power-user.js";
import { accountStorage } from "@st/scripts/util/AccountStorage.js";
import { callGenericPopup, POPUP_TYPE } from "@st/scripts/popup.js";
import { EmbeddedFiles, Preset } from "@/utils/defines";
import { templatePath } from "@/utils/default-settings";
import { FILE_MAP_SIZE_LIMIT, fileMapSize, getErrorMessage, normalizeFileMap } from "@/utils/values";
import { getCurrentPreset } from "@/ui/state";
import { DATA_NAMESPACES, MessageDataStore } from "@/functions/chat-data-store";

let isEmbedCardEventsBound = false;
let isEmbedFilesEventsBound = false;

export async function setup() {
    eventSource.on(event_types.CHARACTER_EDITOR_OPENED, createSelectOption);
}

function createSelectOption() {
    const select = $("#char-management-dropdown");
    if(select.find("#cg-card-link").length <= 0) {
        select.off("change", selectEventHandler);
        select.on("change", selectEventHandler);
        
        select.append(`<option id="cg-card-link" data-i18n="Link to Preset">Link to Preset</option>`);
        select.append(`<option id="cg-card-import" data-i18n="Import Card Preset">Import Card Preset</option>`);
        select.append(`<option id="cg-card-link-files" data-i18n="Link Files to Card">Link Files to Card</option>`);
        select.append(`<option id="cg-card-import-files" data-i18n="Import Card Files">Import Card Files</option>`);
    }

    window.setTimeout(checkEmbeddedPreset, 1000);
    window.setTimeout(checkEmbeddedFiles, 1000);
}

async function selectEventHandler(e: JQuery.ChangeEvent<HTMLElement>) {
    const select = e.target as HTMLSelectElement;
    const target = $(select.options[select.selectedIndex]).attr('id');

    switch(target) {
        case "cg-card-link":
            popupLinkedToCard();
            $(select).val("default");
            break;
        case "cg-card-import":
            importCardPreset();
            $(select).val("default");
            break;
        case "cg-card-link-files":
            popupLinkedFilesToCard();
            $(select).val("default");
            break;
        case "cg-card-import-files":
            importCardFiles();
            $(select).val("default");
            break;
    }
}

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

function t(key: string, fallback: string): string {
    const i18n = (window as unknown as { i18n?: { t?: (value: string) => string } }).i18n;
    const translated = i18n?.t?.(key);
    if (typeof translated === 'string' && translated.trim()) {
        return translated;
    }

    return fallback;
}

function normalizeLinkedPresets(raw: unknown): Preset[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .filter((preset): preset is Preset => Boolean(preset) && typeof preset === 'object')
        .filter(preset => typeof (preset as Preset).name === 'string');
}

async function ensureEmbedCardModalInjected(): Promise<void> {
    if (!$('#custom_generation_embed_card_dialog').length) {
        $('#char-management-dropdown').closest('.inline-drawer, .drawer, body').append(
            await renderExtensionTemplateAsync(templatePath, 'embed-card-modal'),
        );
    }

    if (isEmbedCardEventsBound) {
        return;
    }

    isEmbedCardEventsBound = true;

    $('#custom_generation_embed_card_cancel').on('click', () => {
        closeDialog('#custom_generation_embed_card_dialog');
    });

    $('#custom_generation_embed_card_save').on('click', () => {
        const dialog = getDialog('#custom_generation_embed_card_dialog');
        if (!(dialog instanceof HTMLDialogElement)) {
            return;
        }

        const chidRaw = dialog.dataset.chid;
        const chid = chidRaw ? Number(chidRaw) : undefined;
        const linkedNames = new Set<string>();
        $('#custom_generation_embed_card_list input[type="checkbox"]').each((_, element) => {
            const input = element as HTMLInputElement;
            if (!input.checked) {
                return;
            }

            const name = String(input.dataset.presetName ?? '').trim();
            if (name) {
                linkedNames.add(name);
            }
        });

        const linkedPresets = Object.values(settings.presets ?? {}).filter(preset => linkedNames.has(preset.name));
        setLinkedToCard(linkedPresets, chid);
        saveCharacterDebounced();
        closeDialog('#custom_generation_embed_card_dialog');
    });
}

function buildEmbedCardRow(preset: Preset, linkedNames: Set<string>) {
    const row = $('<div class="cg_embed_card_row"></div>');
    const checkbox = $('<input type="checkbox" />');
    checkbox.prop('checked', linkedNames.has(preset.name));
    checkbox.attr('data-preset-name', preset.name);

    const name = $('<div class="cg_embed_card_name"></div>').text(preset.name || 'Preset');
    const meta = $('<div class="cg_embed_card_badge text_muted"></div>');
    meta.text(`${preset.prompts.length}P · ${preset.regexs.length}R · ${Object.keys(preset.templates ?? {}).length}T`);

    row.append(checkbox, name, meta);
    return row;
}

async function popupLinkedToCard(chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if(!character)
        return;

    await ensureEmbedCardModalInjected();

    // @ts-expect-error: 2339
    const linkedPresets = normalizeLinkedPresets(character.data.extensions.cg_embed_presets);
    const linkedNames = new Set(linkedPresets.map(preset => preset.name));

    const list = $('#custom_generation_embed_card_list');
    list.empty();

    if (Object.keys(settings.presets ?? {}).length === 0) {
        list.text(String(list.attr('no-items-text') ?? 'No presets'));
    } else {
        Object.values(settings.presets ?? {}).forEach(preset => {
            list.append(buildEmbedCardRow(preset, linkedNames));
        });
    }

    const dialog = getDialog('#custom_generation_embed_card_dialog');
    if (dialog) {
        dialog.dataset.chid = String(currentChid ?? '');
    }
    openDialog('#custom_generation_embed_card_dialog');
}

function setLinkedToCard(presets: Preset[], chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if(!character) {
        console.error(`Character ${currentChid} not found`);
        return;
    }

    // @ts-expect-error: 2339
    character.data.extensions.cg_embed_presets = presets;

    const jsonData = JSON.parse(character.json_data) as v1CharData;
    // @ts-expect-error: 2339
    jsonData.data.extensions.cg_embed_presets = presets;
    character.json_data = JSON.stringify(jsonData);

    // @ts-expect-error: 2339
    const input = $($('#form_create').get(0))?.find("[name=json_data]");
    if(input) {
        const data = JSON.parse(input.val() as string) as v1CharData;
        // @ts-expect-error: 2339
        data.data.extensions.cg_embed_presets = presets;
        input.val(JSON.stringify(data));
    }
}

async function importCardPreset(chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if(!character) {
        console.error(`Character ${currentChid} not found`);
        return;
    }

    // @ts-expect-error: 2339
    const linkedPresets = normalizeLinkedPresets(character.data.extensions.cg_embed_presets);
    if (linkedPresets.length === 0) {
        window.alert(t('No linked presets', 'No linked presets'));
        return;
    }

    if (!await popupImportCardPreset()) {
        return;
    }

    for(const preset of linkedPresets) {
        const exist = settings.presets[preset.name];
        if(!exist) {
            settings.presets[preset.name] = preset;
            continue;
        }

        settings.presets[preset.name] = preset;
    }

    updateSettingsUI();
    saveSettings();
}

async function checkEmbeddedPreset(chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if(!character) {
        console.error(`Character ${currentChid} not found`);
        return;
    }

    // @ts-expect-error: 2339
    const embedded = character.data.extensions.cg_embed_presets as Preset[];
    if(!embedded || embedded.length < 1)
        return;

    // Only show the alert once per character
    const checkKey = `AlertCG_${character.avatar}`;
    const names = new Set<string>(embedded.map(preset => preset.name));
    if (!accountStorage.getItem(checkKey) && Object.values(settings.presets ?? {}).some(preset => names.has(preset.name))) {
        accountStorage.setItem(checkKey, 'true');

        if (power_user.world_import_dialog) {
            if(await popupImportCardPreset()) {
                importCardPreset(Number(currentChid));
            }
        }
    }
}

async function popupImportCardPreset(): Promise<string | number | boolean | null> {
    const html = `
        <h3 data-i18n="cg_embed_title">This character has an embedded Preset.</h3>
        <h3 data-i18n="cg_embed_ask">Would you like to import it now?</h3>
        <div class="m-b-1" data-i18n="cg_embed_desc">If you want to import it later, select "Import Card Preset" in the "More..." dropdown menu on the character panel.</div>
    `;
    
    return await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: 'Yes' });
}

// ============================================
// Embedded files
// ============================================

/**
 * Files travelling with a character card, stored in
 * `character.data.extensions.cg_embed_files`.
 *
 * They import into the chat workspace rather than `/global` or the preset:
 * `/global` would let one card's material leak into every chat, and a preset is
 * an orthogonal dimension, so files parked there vanish on the next preset
 * switch.
 */

/** Which files the link dialog currently offers, keyed by the name it would use. */
let embedFileCandidates: Map<string, string> = new Map();

function normalizeEmbeddedFiles(raw: unknown): EmbeddedFiles {
    const record = raw as { files?: unknown } | null | undefined;

    try {
        return { version: 1, files: normalizeFileMap(record?.files) };
    } catch (error) {
        console.warn(`[CG] ignoring embedded card files: ${getErrorMessage(error)}`);
        return { version: 1, files: {} };
    }
}

function getEmbeddedFiles(character: { data?: unknown }): EmbeddedFiles {
    // @ts-expect-error: 2339
    return normalizeEmbeddedFiles(character.data?.extensions?.cg_embed_files);
}

/**
 * Store of the chat workspace, pinned to the newest message.
 *
 * Unpinned writes land in the staging layer, which only exists for the message a
 * generation is about to create; a UI import has no such message, so it pins to
 * the latest one instead and rolls back with it like any other workspace file.
 */
function workspaceStore(source: string): MessageDataStore {
    const store = new MessageDataStore({ chat, chat_metadata }, DATA_NAMESPACES.FILES, source);
    if (chat.length > 0) {
        store.messageId = chat.length - 1;
    }

    return store;
}

function buildEmbedFileRow(name: string, origin: string, size: number, linked: boolean) {
    const row = $('<div class="cg_embed_card_row"></div>');
    const checkbox = $('<input type="checkbox" />');
    checkbox.prop('checked', linked);
    checkbox.attr('data-file-name', name);

    const label = $('<div class="cg_embed_card_name"></div>').text(name);
    const meta = $('<div class="cg_embed_card_badge text_muted"></div>')
        .text(`${origin} · ${size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KiB`}`);

    row.append(checkbox, label, meta);
    return row;
}

async function ensureEmbedFilesModalInjected(): Promise<void> {
    if (!$('#custom_generation_embed_files_dialog').length) {
        $('#char-management-dropdown').closest('.inline-drawer, .drawer, body').append(
            await renderExtensionTemplateAsync(templatePath, 'embed-files-modal'),
        );
    }

    if (isEmbedFilesEventsBound) {
        return;
    }

    isEmbedFilesEventsBound = true;

    $('#custom_generation_embed_files_cancel').on('click', () => {
        closeDialog('#custom_generation_embed_files_dialog');
    });

    $('#custom_generation_embed_files_save').on('click', () => {
        const dialog = getDialog('#custom_generation_embed_files_dialog');
        if (!(dialog instanceof HTMLDialogElement)) {
            return;
        }

        const chidRaw = dialog.dataset.chid;
        const chid = chidRaw ? Number(chidRaw) : undefined;
        const files: Record<string, string> = {};

        $('#custom_generation_embed_files_list input[type="checkbox"]').each((_, element) => {
            const input = element as HTMLInputElement;
            const name = String(input.dataset.fileName ?? '');
            const content = embedFileCandidates.get(name);
            if (input.checked && content !== undefined) {
                files[name] = content;
            }
        });

        // A card is a PNG text chunk: an oversized payload bloats the file and
        // slows down every character list load.
        const total = fileMapSize(files);
        if (total > FILE_MAP_SIZE_LIMIT) {
            const largest = Object.entries(files)
                .sort(([, a], [, b]) => b.length - a.length)
                .slice(0, 3)
                .map(([name, content]) => `${name} (${(content.length / 1024).toFixed(1)} KiB)`)
                .join(', ');

            toastr.error(
                `Selected files are ${(total / 1024).toFixed(1)} KiB, over the `
                + `${Math.floor(FILE_MAP_SIZE_LIMIT / 1024)} KB limit. Largest: ${largest}.`,
                'Card Files',
            );
            return;
        }

        setLinkedFilesToCard({ version: 1, files }, chid);
        saveCharacterDebounced();
        closeDialog('#custom_generation_embed_files_dialog');
    });
}

async function popupLinkedFilesToCard(chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if (!character) {
        return;
    }

    await ensureEmbedFilesModalInjected();

    const linked = getEmbeddedFiles(character).files;
    const list = $('#custom_generation_embed_files_list');
    list.empty();
    embedFileCandidates = new Map();

    const rows: JQuery[] = [];

    // Chat workspace files.
    for (const [path, content] of workspaceStore('card-link').snapshot()) {
        embedFileCandidates.set(path, content);
        rows.push(buildEmbedFileRow(path, 'workspace', content.length, linked[path] !== undefined));
    }

    // Files of the active preset, which is the other place a user curates them.
    for (const [name, content] of Object.entries(getCurrentPreset().files ?? {})) {
        if (embedFileCandidates.has(name)) {
            continue;
        }

        embedFileCandidates.set(name, content);
        rows.push(buildEmbedFileRow(name, 'preset', content.length, linked[name] !== undefined));
    }

    // Already embedded files whose source is gone stay selectable, so saving
    // does not silently drop them.
    for (const [name, content] of Object.entries(linked)) {
        if (embedFileCandidates.has(name)) {
            continue;
        }

        embedFileCandidates.set(name, content);
        rows.push(buildEmbedFileRow(name, 'card', content.length, true));
    }

    if (rows.length === 0) {
        list.text(String(list.attr('no-items-text') ?? 'No files'));
    } else {
        rows.forEach(row => list.append(row));
    }

    const dialog = getDialog('#custom_generation_embed_files_dialog');
    if (dialog) {
        dialog.dataset.chid = String(currentChid ?? '');
    }
    openDialog('#custom_generation_embed_files_dialog');
}

/**
 * Write the payload to all three places the character data is mirrored.
 *
 * Missing any one of them means the value is overwritten again on save; this is
 * the same trap `setLinkedToCard` already has to work around.
 */
function setLinkedFilesToCard(payload: EmbeddedFiles, chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if (!character) {
        console.error(`Character ${currentChid} not found`);
        return;
    }

    // 1. Live object.
    // @ts-expect-error: 2339
    character.data.extensions.cg_embed_files = payload;

    // 2. Serialized copy kept alongside it.
    const jsonData = JSON.parse(character.json_data) as v1CharData;
    // @ts-expect-error: 2339
    jsonData.data.extensions.cg_embed_files = payload;
    character.json_data = JSON.stringify(jsonData);

    // 3. The edit form, which wins on save if left stale.
    const input = $('#form_create').find("[name=json_data]");
    if (input.length) {
        const data = JSON.parse(input.val() as string) as v1CharData;
        // @ts-expect-error: 2339
        data.data.extensions.cg_embed_files = payload;
        input.val(JSON.stringify(data));
    }
}

async function importCardFiles(chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if (!character) {
        console.error(`Character ${currentChid} not found`);
        return;
    }

    const embedded = getEmbeddedFiles(character).files;
    if (Object.keys(embedded).length === 0) {
        window.alert(t('No linked files', 'No linked files'));
        return;
    }

    if (!await popupImportCardFiles()) {
        return;
    }

    const store = workspaceStore('card-import');
    const existing = store.snapshot();
    let imported = 0;

    for (const [name, content] of Object.entries(embedded)) {
        // Overwriting is confirmed per file, and skipping is the default: the
        // workspace file is the user's, the card's copy is just an offer.
        if (existing.has(name) && !window.confirm(`"${name}" already exists in this chat. Overwrite it?`)) {
            continue;
        }

        try {
            await store.set(name, content);
            ++imported;
        } catch (error) {
            toastr.error(`${name}: ${getErrorMessage(error, 'Write failed')}`, 'Card Files');
        }
    }

    if (imported > 0) {
        await saveMetadata();
        toastr.success(`${imported} file(s) imported into this chat`, 'Card Files');
    }
}

async function checkEmbeddedFiles(chid?: number) {
    const currentChid = chid ?? this_chid;
    const character = characters[Number(currentChid)];
    if (!character) {
        return;
    }

    const embedded = getEmbeddedFiles(character).files;
    if (Object.keys(embedded).length === 0) {
        return;
    }

    // Only prompt once per character, mirroring the preset flow.
    const checkKey = `AlertCGFiles_${character.avatar}`;
    if (accountStorage.getItem(checkKey)) {
        return;
    }

    accountStorage.setItem(checkKey, 'true');

    if (power_user.world_import_dialog && await popupImportCardFiles()) {
        await importCardFiles(Number(currentChid));
    }
}

async function popupImportCardFiles(): Promise<string | number | boolean | null> {
    const html = `
        <h3 data-i18n="cg_embed_files_title">This character card carries files.</h3>
        <h3 data-i18n="cg_embed_files_ask">Would you like to import them into this chat now?</h3>
        <div class="m-b-1" data-i18n="cg_embed_files_desc">They become workspace files of the current chat. To import later, select "Import Card Files" in the "More..." dropdown menu on the character panel.</div>
    `;

    return await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: 'Yes' });
}
