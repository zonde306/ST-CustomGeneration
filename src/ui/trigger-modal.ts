import { copyText } from '@st/scripts/utils.js';
import { Template } from '@/utils/defines';
import { defaultTemplate } from '@/utils/default-settings';
import { clamp, clone, isRecord, parseNumber } from '@/utils/values';
import {
    bindFileImport,
    buildDragHandle,
    buildListRow,
    buildRowButton,
    closeDialog,
    getSelectValues,
    initSortableList,
    isUiUpdating,
    openDialog,
    readJsonFile,
    readReorder,
    renderList,
    resolveReorderedIndex,
    setControlsDisabled,
    setSelectValues,
    withUiUpdate,
} from '@/ui/common';
import {
    ALL_DECORATORS,
    DEFAULT_TRIGGER_DECORATOR,
    TriggerEntry,
    buildTriggerMap,
    buildTriggerMatchKey,
    commitSettings,
    getCurrentPreset,
    getTriggerCount,
    getTriggerEntries,
    getTriggerKey,
    normalizeTrigger,
    registerSection,
    updateSettingsUI,
} from '@/ui/state';
import { buildListExportItems, openListExportDialog, parseListImportPayload } from '@/ui/list-export';
import { PromptEditorTarget, closePromptEditor, openPromptCreator, renderPromptList } from '@/ui/prompt-modal';

const DIALOG = '#custom_generation_template_dialog';

const FIELD_CONTROLS = [
    '#custom_generation_template_decorator',
    '#custom_generation_template_tag',
    '#custom_generation_template_filters',
    '#custom_generation_template_regex',
    '#custom_generation_template_find_regex',
    '#custom_generation_template_retry_count',
    '#custom_generation_template_retry_interval',
];

const EDITOR_CONTROLS = [
    ...FIELD_CONTROLS,
    '#custom_generation_template_delete',
    '#custom_generation_template_save_as',
    '#custom_generation_template_save',
    '#custom_generation_template_add_prompt',
];

/** Fields kept in a draft so unsaved edits survive UI refreshes. */
type TriggerDraft = Pick<Template, 'decorator' | 'tag' | 'filters' | 'regex' | 'findRegex' | 'retryCount' | 'retryInterval'>;

const CREATING_KEY = '__creating__';

let selectedIndex = 0;
let editingIndex: number | null = null;
let creatingDraft: Template | null = null;
let selectedPromptIndex = 0;
let editorDraft: TriggerDraft | null = null;
let editorDraftKey: string | null = null;

const promptTarget: PromptEditorTarget = {
    getPrompts: () => getEditingTrigger()?.prompts ?? null,
    setSelectedIndex: (index) => {
        selectedPromptIndex = index;
    },
    // Prompt edits repaint the trigger editor, so stash the unsaved field values first.
    beforeChange: () => syncEditorDraft(),
};

function getTriggerTagLabel(trigger: Template): string {
    return String(trigger.tag ?? '').trim();
}

function buildTriggerDisplayName(trigger: Template): string {
    const label = getTriggerTagLabel(trigger);
    return `${trigger.decorator} ${label.includes(' ') ? `"${label}"` : label}`;
}

function triggerMatchKeyExists(triggers: Record<string, Template>, trigger: Template, excludeKey: string | null = null): boolean {
    const targetKey = buildTriggerMatchKey(trigger);
    return Object.entries(triggers).some(([key, item]) => key !== excludeKey && buildTriggerMatchKey(item) === targetKey);
}

// ============================================
// List
// ============================================

function buildTriggerRow(entry: TriggerEntry, index: number): JQuery {
    const row = buildListRow(index, index === selectedIndex, 'custom_generation_template_row');

    const meta = $('<div class="flex-container flexFlowColumn flex1 custom_generation_template_meta"></div>')
        .append($('<div class="custom_generation_template_title"></div>').text(buildTriggerDisplayName(entry.template)));
    const left = $('<div class="flex-container alignItemsCenter flex1 custom_generation_template_row_body"></div>')
        .append(buildDragHandle(), meta);

    const copyButton = buildRowButton('fa-copy', 'Copy');
    const editButton = buildRowButton('fa-pen-to-square', 'Edit');
    const exportButton = buildRowButton('fa-file-export', 'Export');
    const deleteButton = buildRowButton('fa-trash', 'Delete');
    const actions = $('<div class="flex-container alignItemsCenter"></div>').append(copyButton, editButton, exportButton, deleteButton);

    row.on('click', () => {
        selectedIndex = index;
        updateSettingsUI();
    });

    copyButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const tag = getTriggerTagLabel(entry.template);
        const suffix = tag.includes(' ') ? ` "${tag}"` : tag ? ` ${tag}` : '';
        copyText(`${entry.template.decorator}${suffix}`).then(() => toastr.success('Copied to clipboard'));
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openTriggerEditor(index);
    });

    exportButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openTriggerExportDialog([entry.template], 'Export Template');
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        const target = getTriggerEntries(preset)[index];
        if (!target || !window.confirm(getTriggerDeleteConfirmationText(target.template))) {
            return;
        }

        delete preset.templates[target.key];
        selectedIndex = clamp(index, 0, Math.max(0, getTriggerCount(preset) - 1));
        commitSettings();
    });

    row.append(left, actions);
    return row;
}

function getTriggerDeleteConfirmationText(trigger: Template): string {
    return `Delete template ${trigger.decorator} / ${getTriggerTagLabel(trigger)}?`;
}

function renderTriggerList(): void {
    const list = $('#custom_generation_template_list');
    const entries = getTriggerEntries();

    renderList(list, entries, 'No templates', buildTriggerRow);

    initSortableList(list, () => {
        const order = readReorder(list, entries.length);
        if (!order) {
            return;
        }

        const nextEntries = order.map(index => entries[index]).filter(Boolean);
        if (nextEntries.length !== entries.length) {
            return;
        }

        const preset = getCurrentPreset();
        preset.templates = Object.fromEntries(nextEntries.map(entry => [entry.key, entry.template]));
        selectedIndex = resolveReorderedIndex(order, selectedIndex) ?? selectedIndex;
        editingIndex = resolveReorderedIndex(order, editingIndex);
        commitSettings();
    });
}

// ============================================
// Editor draft
// ============================================

function getEditingEntry(): TriggerEntry | null {
    if (creatingDraft) {
        return { key: CREATING_KEY, template: creatingDraft };
    }

    return editingIndex === null ? null : getTriggerEntries()[editingIndex] ?? null;
}

function getEditingTrigger(): Template | null {
    return getEditingEntry()?.template ?? null;
}

function readEditorDraft(): TriggerDraft {
    return {
        decorator: String($('#custom_generation_template_decorator').val() ?? DEFAULT_TRIGGER_DECORATOR),
        tag: String($('#custom_generation_template_tag').val() ?? ''),
        filters: getSelectValues('#custom_generation_template_filters') as Template['filters'],
        regex: String($('#custom_generation_template_regex').val() ?? ''),
        findRegex: String($('#custom_generation_template_find_regex').val() ?? ''),
        retryCount: parseNumber($('#custom_generation_template_retry_count').val(), defaultTemplate.retryCount, 0, 9999, true),
        retryInterval: parseNumber($('#custom_generation_template_retry_interval').val(), defaultTemplate.retryInterval, 0, 86_400_000, true),
    };
}

function applyEditorDraft(draft: TriggerDraft): void {
    $('#custom_generation_template_decorator').val(draft.decorator);
    $('#custom_generation_template_tag').val(draft.tag);
    setSelectValues('#custom_generation_template_filters', draft.filters);
    $('#custom_generation_template_regex').val(draft.regex);
    $('#custom_generation_template_find_regex').val(draft.findRegex);
    $('#custom_generation_template_retry_count').val(draft.retryCount);
    $('#custom_generation_template_retry_interval').val(draft.retryInterval);
}

function resetEditorDraft(): void {
    editorDraft = null;
    editorDraftKey = null;
}

function syncEditorDraft(): void {
    const entry = getEditingEntry();
    if (!entry) {
        resetEditorDraft();
        return;
    }

    editorDraftKey = entry.key;
    editorDraft = readEditorDraft();
}

// ============================================
// Editor
// ============================================

function renderTriggerPromptList(): void {
    const trigger = getEditingTrigger();
    const list = $('#custom_generation_template_prompt_list');

    if (!trigger) {
        renderList(list, [], 'No prompts', () => $());
        return;
    }

    selectedPromptIndex = clamp(selectedPromptIndex, 0, Math.max(0, trigger.prompts.length - 1));
    renderPromptList(list, promptTarget, { selectedIndex: selectedPromptIndex, exportable: false });
}

function renderTriggerEditor(): void {
    const entry = getEditingEntry();

    withUiUpdate(() => {
        if (!entry) {
            setControlsDisabled(EDITOR_CONTROLS, true);
            resetEditorDraft();
            applyEditorDraft({
                decorator: DEFAULT_TRIGGER_DECORATOR,
                tag: '',
                filters: [],
                regex: '',
                findRegex: '',
                retryCount: defaultTemplate.retryCount,
                retryInterval: defaultTemplate.retryInterval,
            });
            $('#custom_generation_template_delete').toggle(false);
            $('#custom_generation_template_save_as').toggle(false);
            renderTriggerPromptList();
            return;
        }

        setControlsDisabled(EDITOR_CONTROLS, false);
        $('#custom_generation_template_delete').toggle(!creatingDraft);
        $('#custom_generation_template_save_as').toggle(!creatingDraft);

        if (editorDraft && editorDraftKey === entry.key) {
            applyEditorDraft(editorDraft);
        } else {
            applyEditorDraft(entry.template);
            editorDraft = readEditorDraft();
            editorDraftKey = entry.key;
        }

        renderTriggerPromptList();
    });
}

function readTriggerEditor(): Template {
    return normalizeTrigger({
        ...readEditorDraft(),
        prompts: getEditingTrigger()?.prompts ?? [],
    });
}

function openTriggerEditor(index: number): void {
    if (!getTriggerEntries()[index]) {
        return;
    }

    creatingDraft = null;
    editingIndex = index;
    selectedIndex = index;
    selectedPromptIndex = 0;
    renderTriggerEditor();
    openDialog(DIALOG);
}

function resetEditorState(): void {
    editingIndex = null;
    creatingDraft = null;
    selectedPromptIndex = 0;
    resetEditorDraft();
}

function closeTriggerEditor(): void {
    resetEditorState();
    closeDialog(DIALOG);
}

function saveTriggerEditor(saveAs: boolean): void {
    const preset = getCurrentPreset();
    const nextTrigger = readTriggerEditor();

    const append = () => {
        preset.templates[getTriggerKey(nextTrigger, Object.keys(preset.templates))] = nextTrigger;
        selectedIndex = getTriggerCount(preset) - 1;
        closeTriggerEditor();
        commitSettings();
    };

    if (creatingDraft) {
        append();
        return;
    }

    if (editingIndex === null) {
        return;
    }

    const entry = getTriggerEntries(preset)[editingIndex];
    if (!entry) {
        return;
    }

    if (saveAs) {
        if (buildTriggerMatchKey(entry.template) === buildTriggerMatchKey(nextTrigger)) {
            window.alert('Save As requires a different unique key from the original template.');
            return;
        }

        if (triggerMatchKeyExists(preset.templates, nextTrigger)) {
            window.alert(`A template with the same unique key already exists: ${buildTriggerMatchKey(nextTrigger)}`);
            return;
        }

        append();
        return;
    }

    const previousKey = entry.key;
    const nextKey = getTriggerKey(nextTrigger, Object.keys(preset.templates).filter(key => key !== previousKey), previousKey);

    if (previousKey !== nextKey) {
        delete preset.templates[previousKey];
    }

    preset.templates[nextKey] = nextTrigger;
    selectedIndex = editingIndex;
    closeTriggerEditor();
    commitSettings();
}

function deleteTriggerFromEditor(): void {
    if (creatingDraft) {
        closeTriggerEditor();
        updateSettingsUI();
        return;
    }

    if (editingIndex === null) {
        return;
    }

    const preset = getCurrentPreset();
    const entry = getTriggerEntries(preset)[editingIndex];
    if (!entry || !window.confirm(getTriggerDeleteConfirmationText(entry.template))) {
        return;
    }

    delete preset.templates[entry.key];

    const removedIndex = editingIndex;
    closeTriggerEditor();
    selectedIndex = clamp(removedIndex, 0, Math.max(0, getTriggerCount(preset) - 1));
    commitSettings();
}

// ============================================
// Import / export
// ============================================

function openTriggerExportDialog(triggers: Template[], title: string): void {
    openListExportDialog('template', buildListExportItems('template', triggers, buildTriggerDisplayName), title);
}

async function importTriggersFromFile(file: File): Promise<void> {
    const items = parseListImportPayload(await readJsonFile(file), 'template');
    const triggers = items.map(item => normalizeTrigger(isRecord(item) ? item as Partial<Template> : {}));

    const preset = getCurrentPreset();
    const existingKeys = Object.keys(preset.templates);
    const incoming = buildTriggerMap(triggers, existingKeys);

    const merged: Record<string, Template> = {};
    for (const key of existingKeys) {
        merged[key] = incoming[key] ?? preset.templates[key];
    }
    for (const [key, trigger] of Object.entries(incoming)) {
        merged[key] ??= trigger;
    }

    preset.templates = merged;
    selectedIndex = Math.max(0, getTriggerCount(preset) - 1);
    commitSettings();
    window.alert('Templates imported successfully.');
}

// ============================================
// Setup
// ============================================

export function fillDecoratorOptions(): void {
    const select = $('#custom_generation_template_decorator');
    if (!select.length || select.children().length > 0) {
        return;
    }

    for (const decorator of ALL_DECORATORS) {
        select.append(`<option value="${decorator}" data-i18n="cg_${decorator.substring(2)}">${decorator.substring(2)}</option>`);
    }
}

export function setupTriggerSection(): void {
    fillDecoratorOptions();

    $('#custom_generation_add_template').on('click', () => {
        resetEditorDraft();
        creatingDraft = normalizeTrigger(clone(defaultTemplate));
        editingIndex = null;
        selectedPromptIndex = 0;
        renderTriggerEditor();
        openDialog(DIALOG);
    });

    $('#custom_generation_export_template').on('click', () => {
        const entries = getTriggerEntries();
        if (entries.length === 0) {
            window.alert('No templates to export.');
            return;
        }

        openTriggerExportDialog(entries.map(entry => entry.template), 'Export Templates');
    });

    bindFileImport('#custom_generation_import_template', 'custom_generation_template_import_input', importTriggersFromFile);

    $('#custom_generation_template_cancel').on('click', () => {
        closeTriggerEditor();
    });

    $('#custom_generation_template_save').on('click', () => {
        saveTriggerEditor(false);
    });

    $('#custom_generation_template_save_as').on('click', () => {
        saveTriggerEditor(true);
    });

    $('#custom_generation_template_delete').on('click', () => {
        deleteTriggerFromEditor();
    });

    // Keep unsaved field edits when the prompt sub-editor forces a UI refresh.
    $(FIELD_CONTROLS.join(', ')).on('input change', () => {
        if (isUiUpdating() || editingIndex === null) {
            return;
        }
        syncEditorDraft();
    });

    $('#custom_generation_template_add_prompt').on('click', () => {
        promptTarget.beforeChange?.();
        openPromptCreator(promptTarget, '');
    });

    $(DIALOG).on('close', () => {
        resetEditorState();
    });

    registerSection({
        render: () => {
            selectedIndex = clamp(selectedIndex, 0, Math.max(0, getTriggerCount() - 1));
            renderTriggerList();

            if (editingIndex !== null || creatingDraft) {
                if (getEditingEntry()) {
                    renderTriggerEditor();
                } else {
                    closeTriggerEditor();
                    closePromptEditor();
                }
            }
        },
        reset: () => {
            selectedIndex = 0;
            resetEditorState();
        },
    });
}
