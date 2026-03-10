import { characters, this_chid, saveCharacterDebounced } from "../../../../../script.js";
import { Preset, settings, saveSettings, updateSettingsUI } from './settings'
import { eventSource, event_types } from "../../../../events.js";
import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { v1CharData } from "../../../../char-data.js";
import { power_user } from "../../../../power-user.js";
import { accountStorage } from "../../../../util/AccountStorage.js";
import { callGenericPopup, POPUP_TYPE } from "../../../../popup.js";

let isEmbedCardEventsBound = false;

export function setup() {
    eventSource.on(event_types.CHARACTER_EDITOR_OPENED, createSelectOption);
}

function createSelectOption() {
    const select = $("#char-management-dropdown");
    if(select.find("#cg-card-link").length <= 0) {
        select.off("change", selectEventHandler);
        select.on("change", selectEventHandler);
        
        select.append(`<option id="cg-card-link" data-i18n="Link to Preset">Link to Preset</option>`);
        select.append(`<option id="cg-card-import" data-i18n="Import Card Preset">Import Card Preset</option>`);
    }

    window.setTimeout(checkEmbeddedPreset, 1000);
}

async function selectEventHandler(e: JQuery.ChangeEvent<HTMLElement>) {
    const select = e.target as HTMLSelectElement;
    const target = $(select.options[select.selectedIndex]).attr('id');
    $(select).val("default");

    switch(target) {
        case "cg-card-link":
            popupLinkedToCard();
            break;
        case "cg-card-import":
            importCardPreset();
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
            await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'embed-card-modal'),
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

        const linkedPresets = settings.presets.filter(preset => linkedNames.has(preset.name));
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
    meta.text(`${preset.prompts.length}P · ${preset.regexs.length}R · ${preset.templates.length}T`);

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

    if (settings.presets.length === 0) {
        list.text(String(list.attr('no-items-text') ?? 'No presets'));
    } else {
        settings.presets.forEach(preset => {
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
        const exist = settings.presets.findIndex(p => p.name === preset.name);
        if(exist < 0) {
            settings.presets.push(preset);
            continue;
        }

        settings.presets.splice(exist, 1, preset);
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
    if (!accountStorage.getItem(checkKey) && settings.presets.some(preset => names.has(preset.name))) {
        accountStorage.setItem(checkKey, 'true');

        if (power_user.world_import_dialog) {
            if(await popupImportCardPreset()) {
                importCardPreset(Number(currentChid));
            }
        }
    }
}

async function popupImportCardPreset(): Promise<string | number | boolean | null> {
    return new Promise((resolve) => {
        const html = `<h3>This character has an embedded Preset.</h3>
        <h3>Would you like to import it now?</h3>
        <div class="m-b-1">If you want to import it later, select "Import Card Preset" in the "More..." dropdown menu on the character panel.</div>`;
        const checkResult = (value: string | number | boolean | null) => {
            if (value) {
                resolve(value);
            }
        };
        callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: 'Yes' }).then(checkResult);
    });
}
