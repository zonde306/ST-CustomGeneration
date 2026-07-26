import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { copyText } from '@st/scripts/utils.js';
import { openLargeEditor } from '@/utils/large-editor';
import { templatePath } from '@/utils/default-settings';
import { ChatDataStore, DataLookupResult } from '@/features/chat-data-store';

const PREVIEW_LIMIT = 120;
let isOverridesEventsBound = false;

export interface DataSectionDescription {
    /** Entry title shown in the summary row. */
    name: string;
    /** Secondary line, e.g. `Message 3 · Swipe 0`. */
    meta?: string;
    /** Badges shown on the right of the summary row. */
    badges?: string[];
    /** Label/value pairs shown in the expanded info grid. */
    info?: Array<[string, string]>;
}

export interface DataSection {
    /** ChatDataStore namespace this section renders. */
    namespace: string;
    /** Section title. */
    title: string;
    /** i18n key for the title; defaults to the title itself. */
    i18nKey?: string;
    /** Collect entries to display. Defaults to `store.lookup(namespace)`. */
    list?: (store: ChatDataStore) => DataLookupResult[];
    /** Describe an entry for display. */
    describe: (item: DataLookupResult) => DataSectionDescription;
    /** Persist an edited entry. Omit to render read-only. */
    onEdit?: (item: DataLookupResult, content: string, store: ChatDataStore) => void;
}

const sections: DataSection[] = [];

/**
 * Register a section in the Overrides dialog. New namespaces (memory, summary, ...)
 * only need to call this; no UI code changes required.
 */
export function registerDataSection(section: DataSection): void {
    sections.push(section);
}

export async function setup() {
    if (!$('#custom_generation_overrides_dialog').length) {
        const host = document.body ?? document.documentElement;
        $(host).append(await renderExtensionTemplateAsync(templatePath, 'overrides-modal'));
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

function buildOverrideBlock(title: string, content: string, onEdit?: (newContent: string) => void): JQuery<HTMLElement> {
    const block = $('<div class="custom_generation_overrides_block"></div>');
    const header = $('<div class="custom_generation_overrides_block_header"></div>');
    const titleEl = $('<div class="custom_generation_overrides_block_title"></div>').text(title);
    const copyButton = createCopyButton(content);
    const pre = $('<pre class="custom_generation_overrides_pre"></pre>').text(content);
    const buttonGroup = $('<div class="custom_generation_overrides_buttons"></div>');
    header.append(titleEl, buttonGroup);
    block.append(header, pre);
    buttonGroup.append(copyButton);

    // Add edit button (if edit callback provided)
    if (onEdit) {
        const expandButton = $('<button class="menu_button fa-solid fa-expand custom_generation_large_editor_button" type="button" title="Open in large editor" data-i18n="[title]Open in large editor"></button>');
        buttonGroup.append(expandButton);
        expandButton.on('click', async (event: JQuery.ClickEvent) => {
            event.preventDefault();
            event.stopPropagation();
            openLargeEditor('Override Content', pre.text() ?? '', (newContent) => {
                pre.text(newContent);
                onEdit(newContent);
            });
        });

        const editButton = $('<button class="menu_button fa-solid fa-edit custom_generation_edit_button" type="button" title="Edit" data-i18n="[title]Edit"></button>');
        const saveButton = $('<button class="menu_button fa-solid fa-check custom_generation_save_button" type="button" title="Save" data-i18n="[title]Save" style="display:none;"></button>');
        const cancelButton = $('<button class="menu_button fa-solid fa-times custom_generation_cancel_button" type="button" title="Cancel" data-i18n="[title]Cancel" style="display:none;"></button>');
        const textarea = $('<textarea class="custom_generation_overrides_textarea" style="display:none;"></textarea>').val(content);

        buttonGroup.append(editButton, saveButton, cancelButton);

        const toggleEditMode = (editing: boolean) => {
            if (editing) {
                pre.hide();
                textarea.show();
                copyButton.hide();
                expandButton.hide();
                editButton.hide();
                saveButton.show();
                cancelButton.show();
            } else {
                pre.show();
                textarea.hide();
                copyButton.show();
                expandButton.show();
                editButton.show();
                saveButton.hide();
                cancelButton.hide();
            }
        };

        editButton.on('click', (event: JQuery.ClickEvent) => {
            event.preventDefault();
            event.stopPropagation();
            textarea.val(pre.text());
            toggleEditMode(true);
        });

        cancelButton.on('click', (event: JQuery.ClickEvent) => {
            event.preventDefault();
            event.stopPropagation();
            textarea.val(pre.text());
            toggleEditMode(false);
        });

        saveButton.on('click', (event: JQuery.ClickEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const newContent = String(textarea.val() ?? '');
            pre.text(newContent);
            toggleEditMode(false);
            onEdit(newContent);
        });

        block.append(textarea);
    }

    return block;
}

function buildOverrideTitle(base: string, content: string): string {
    const preview = getPreviewText(content);
    return preview ? `${base}: ${preview}` : base;
}

function buildSectionEntry(section: DataSection, item: DataLookupResult, store: ChatDataStore): JQuery<HTMLElement> {
    const description = section.describe(item);

    const details = $('<details class="custom_generation_overrides_entry"></details>');
    const summary = $('<summary class="custom_generation_overrides_summary"></summary>');
    const caret = $('<i class="fa-solid fa-chevron-right custom_generation_overrides_caret"></i>');

    const left = $('<div class="custom_generation_overrides_summary_left"></div>');
    const title = $('<div class="custom_generation_overrides_title"></div>').text(
        buildOverrideTitle(description.name, item.entry.content),
    );
    left.append(title);
    if (description.meta) {
        left.append($('<div class="custom_generation_overrides_meta"></div>').text(description.meta));
    }

    const right = $('<div class="custom_generation_overrides_summary_right"></div>');
    for (const badge of description.badges ?? []) {
        right.append($('<span class="custom_generation_overrides_badge"></span>').text(badge));
    }

    summary.append(caret, left, right);

    const body = $('<div class="custom_generation_overrides_body"></div>');
    if (description.info?.length) {
        const info = $('<div class="custom_generation_overrides_info"></div>');
        info.append(...description.info.map(([label, value]) => buildOverrideInfoItem(label, value)));
        body.append(info);
    }

    const onEdit = section.onEdit
        ? (newContent: string) => {
            section.onEdit!(item, newContent, store);
            toastr.success('Override updated', 'Edit');
        }
        : undefined;
    body.append(buildOverrideBlock('Content', item.entry.content, onEdit));

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

    const store = ChatDataStore.global();
    let hasEntries = false;

    for (const section of sections) {
        const items = section.list ? section.list(store) : store.lookup(section.namespace);
        if (!items.length) {
            continue;
        }

        hasEntries = true;
        const entries = items.map(item => buildSectionEntry(section, item, store));
        list.append(buildOverridesSection(section.title, entries, section.i18nKey ?? section.title));
    }

    if (!hasEntries) {
        const emptyText = String(list.attr('no-items-text') ?? 'No overrides');
        const empty = $('<div class="custom_generation_logger_empty text_muted"></div>').text(emptyText);
        list.append(empty);
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
