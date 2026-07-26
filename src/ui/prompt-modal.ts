import { DEFAULT_DEPTH, DEFAULT_WEIGHT } from '@st/scripts/world-info.js';
import { PresetPrompt, TEMPLATE_FILTER_OPTIONS } from '@/utils/defines';
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
    commitSettings,
    getCurrentPreset,
    normalizePrompt,
    normalizePromptInternal,
    registerSection,
    updateSettingsUI,
} from '@/ui/state';
import { buildListExportItems, openListExportDialog, parseListImportPayload } from '@/ui/list-export';

/**
 * A prompt list that the shared prompt editor can edit,
 * either the current preset's prompts or the prompts of the trigger being edited.
 */
export interface PromptEditorTarget {
    /** Resolved lazily so the editor keeps working across UI refreshes. */
    getPrompts(): PresetPrompt[] | null;
    setSelectedIndex(index: number): void;
    /** Called before a change that triggers a UI refresh, so the owner can stash unsaved edits. */
    beforeChange?(): void;
}

const DIALOG = '#custom_generation_prompt_dialog';

const EDITOR_CONTROLS = [
    '#custom_generation_prompt_name',
    '#custom_generation_prompt_role',
    '#custom_generation_prompt_injection_position',
    '#custom_generation_prompt_injection_depth',
    '#custom_generation_prompt_injection_order',
    '#custom_generation_prompt_max_depth',
    '#custom_generation_prompt_triggers',
    '#custom_generation_prompt_internal',
    '#custom_generation_prompt_enable',
    '#custom_generation_prompt_content',
    '#custom_generation_prompt_delete',
    '#custom_generation_prompt_save_as',
    '#custom_generation_prompt_save',
];

const NEW_PROMPT_DEFAULTS: Partial<PresetPrompt> = {
    role: 'system',
    triggers: [],
    prompt: '',
    injectionPosition: 'relative',
    enabled: true,
    internal: null,
    injectionDepth: DEFAULT_DEPTH,
    injectionOrder: DEFAULT_WEIGHT,
    maxDepth: 999,
};

let selectedIndex = 0;
let editingIndex: number | null = null;
let editorTarget: PromptEditorTarget | null = null;
let creatingDraft: PresetPrompt | null = null;

const presetTarget: PromptEditorTarget = {
    getPrompts: () => getCurrentPreset().prompts,
    setSelectedIndex: (index) => {
        selectedIndex = index;
    },
};

// ============================================
// Unique keys
// ============================================

export function buildPromptUniqueKey(prompt: PresetPrompt): string {
    return `${String(prompt.internal ?? '')}:${String(prompt.name ?? '').trim()}`;
}

function promptUniqueKeyExists(prompts: PresetPrompt[], prompt: PresetPrompt): boolean {
    const targetKey = buildPromptUniqueKey(prompt);
    return prompts.some(item => buildPromptUniqueKey(item) === targetKey);
}

function getPromptDuplicateMessage(prompt: PresetPrompt): string {
    const name = String(prompt.name ?? '').trim() || 'Prompt';
    const internal = String(prompt.internal ?? '').trim();
    return internal
        ? `A prompt with the same unique key already exists: ${internal} / ${name}`
        : `A prompt with the same name already exists: ${name}`;
}

function buildPromptDisplayName(prompt: PresetPrompt, index: number): string {
    return prompt.name || `Prompt ${index + 1}`;
}

// ============================================
// List row
// ============================================

/**
 * Builds a prompt row for either the preset prompt list or a trigger's prompt list.
 */
export function buildPromptRow(target: PromptEditorTarget, prompt: PresetPrompt, index: number, options: { active: boolean; exportable: boolean }): JQuery {
    const row = buildListRow(index, options.active);

    const toggle = $('<input type="checkbox" />').prop('checked', prompt.enabled === true);
    const left = $('<div class="flex-container alignItemsCenter flex1"></div>')
        .append(buildDragHandle(), toggle, $('<div class="flex1"></div>').text(buildPromptDisplayName(prompt, index)));

    const editButton = buildRowButton('fa-pen-to-square', 'Edit');
    const deleteButton = buildRowButton('fa-trash', 'Delete');
    const actions = $('<div class="flex-container alignItemsCenter"></div>').append(editButton);

    if (options.exportable) {
        const exportButton = buildRowButton('fa-file-export', 'Export');
        exportButton.on('click', (event: JQuery.TriggeredEvent) => {
            event.stopPropagation();
            openPromptExportDialog([prompt], 'Export Prompt');
        });
        actions.append(exportButton);
    }

    actions.append(deleteButton);

    row.on('click', () => {
        target.beforeChange?.();
        target.setSelectedIndex(index);
        updateSettingsUI();
    });

    toggle.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
    });

    toggle.on('change', () => {
        const prompts = target.getPrompts();
        const item = prompts?.[index];
        if (!item) {
            return;
        }

        target.beforeChange?.();
        item.enabled = Boolean(toggle.prop('checked'));
        target.setSelectedIndex(index);
        commitSettings();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        target.beforeChange?.();
        openPromptEditor(target, index);
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const prompts = target.getPrompts();
        const item = prompts?.[index];
        if (!item || !window.confirm(`Delete prompt "${item.name}"?`)) {
            return;
        }

        target.beforeChange?.();
        prompts.splice(index, 1);
        target.setSelectedIndex(clamp(index, 0, Math.max(0, prompts.length - 1)));
        commitSettings();
    });

    row.append(left, actions);
    return row;
}

/**
 * Renders a prompt list and wires drag-and-drop reordering.
 */
export function renderPromptList(list: JQuery, target: PromptEditorTarget, options: { selectedIndex: number; exportable: boolean }): void {
    const prompts = target.getPrompts() ?? [];

    renderList(list, prompts, 'No prompts', (prompt, index) => buildPromptRow(target, prompt, index, {
        active: index === options.selectedIndex,
        exportable: options.exportable,
    }));

    initSortableList(list, () => {
        const order = readReorder(list, prompts.length);
        if (!order) {
            return;
        }

        const next = order.map(index => prompts[index]).filter(Boolean);
        if (next.length !== prompts.length) {
            return;
        }

        target.beforeChange?.();
        prompts.splice(0, prompts.length, ...next);
        target.setSelectedIndex(resolveReorderedIndex(order, options.selectedIndex) ?? options.selectedIndex);
        if (target === editorTarget) {
            editingIndex = resolveReorderedIndex(order, editingIndex);
        }
        commitSettings();
    });
}

// ============================================
// Editor
// ============================================

function getEditingPrompt(): PresetPrompt | null {
    if (creatingDraft) {
        return creatingDraft;
    }

    if (!editorTarget || editingIndex === null) {
        return null;
    }

    return editorTarget.getPrompts()?.[editingIndex] ?? null;
}

function updateInjectionControlsVisibility(position: string): void {
    $('#custom_generation_prompt_inchat_controls').toggle(position === 'inChat');
}

function updateInternalControls(internal: PresetPrompt['internal']): void {
    const isChatHistory = internal === 'chatHistory';
    $('#custom_generation_prompt_chat_history_controls').toggle(isChatHistory);
    $('#custom_generation_prompt_max_depth').prop('disabled', !isChatHistory);
    $('#custom_generation_prompt_content').prop('disabled', internal !== null && internal !== 'main');
}

function fillInternalOptions(): void {
    const select = $('#custom_generation_prompt_internal');
    if (!select.length) {
        return;
    }

    select.empty();
    select.append('<option value="" data-i18n="cg_none">none</option>');
    TEMPLATE_FILTER_OPTIONS.forEach((option) => {
        select.append(`<option value="${option}" data-i18n="cg_${option}">${option}</option>`);
    });
}

function renderPromptEditor(): void {
    const prompt = getEditingPrompt();

    withUiUpdate(() => {
        fillInternalOptions();

        if (!prompt) {
            setControlsDisabled(EDITOR_CONTROLS, true);
            $('#custom_generation_prompt_name').val('');
            $('#custom_generation_prompt_role').val('system');
            $('#custom_generation_prompt_injection_position').val('relative');
            $('#custom_generation_prompt_injection_depth').val(DEFAULT_DEPTH);
            $('#custom_generation_prompt_injection_order').val(DEFAULT_WEIGHT);
            $('#custom_generation_prompt_max_depth').val(999);
            $('#custom_generation_prompt_internal').val('');
            updateInjectionControlsVisibility('relative');
            updateInternalControls(null);
            setSelectValues('#custom_generation_prompt_triggers', []);
            $('#custom_generation_prompt_enable').prop('checked', false);
            $('#custom_generation_prompt_content').val('');
            $('#custom_generation_prompt_delete').toggle(false);
            $('#custom_generation_prompt_save_as').toggle(false);
            return;
        }

        setControlsDisabled(EDITOR_CONTROLS, false);
        $('#custom_generation_prompt_name').val(prompt.name);
        $('#custom_generation_prompt_role').val(prompt.role);
        $('#custom_generation_prompt_injection_position').val(prompt.injectionPosition);
        $('#custom_generation_prompt_injection_depth').val(prompt.injectionDepth);
        $('#custom_generation_prompt_injection_order').val(prompt.injectionOrder);
        $('#custom_generation_prompt_max_depth').val(prompt.maxDepth);
        $('#custom_generation_prompt_internal').val(String(prompt.internal ?? ''));
        updateInjectionControlsVisibility(prompt.injectionPosition);
        updateInternalControls(prompt.internal);
        setSelectValues('#custom_generation_prompt_triggers', prompt.triggers);
        $('#custom_generation_prompt_enable').prop('checked', prompt.enabled === true);
        $('#custom_generation_prompt_content').val(prompt.prompt);
        $('#custom_generation_prompt_delete').toggle(!creatingDraft);
        $('#custom_generation_prompt_save_as').toggle(!creatingDraft);
    });
}

function readPromptEditor(fallbackName: string): PresetPrompt {
    return normalizePrompt({
        name: String($('#custom_generation_prompt_name').val() ?? ''),
        role: String($('#custom_generation_prompt_role').val() ?? 'system') as PresetPrompt['role'],
        triggers: getSelectValues('#custom_generation_prompt_triggers'),
        prompt: String($('#custom_generation_prompt_content').val() ?? ''),
        injectionPosition: String($('#custom_generation_prompt_injection_position').val() ?? 'relative') as PresetPrompt['injectionPosition'],
        enabled: Boolean($('#custom_generation_prompt_enable').prop('checked')),
        internal: normalizePromptInternal($('#custom_generation_prompt_internal').val()),
        injectionDepth: parseNumber($('#custom_generation_prompt_injection_depth').val(), DEFAULT_DEPTH, 0, 9999, true),
        injectionOrder: parseNumber($('#custom_generation_prompt_injection_order').val(), DEFAULT_WEIGHT, -1_000_000, 1_000_000, true),
        maxDepth: parseNumber($('#custom_generation_prompt_max_depth').val(), 999, 0, 9999, true),
    }, fallbackName);
}

export function openPromptEditor(target: PromptEditorTarget, index: number): void {
    if (!target.getPrompts()?.[index]) {
        return;
    }

    editorTarget = target;
    editingIndex = index;
    creatingDraft = null;
    target.setSelectedIndex(index);
    renderPromptEditor();
    openDialog(DIALOG);
}

/**
 * Opens the editor with an unsaved prompt that is appended to the target list on save.
 */
export function openPromptCreator(target: PromptEditorTarget, name: string): void {
    const prompts = target.getPrompts();
    if (!prompts) {
        return;
    }

    editorTarget = target;
    editingIndex = null;
    creatingDraft = normalizePrompt({ ...clone(NEW_PROMPT_DEFAULTS), name }, 'Prompt');
    target.setSelectedIndex(prompts.length);
    renderPromptEditor();
    openDialog(DIALOG);
}

function resetEditorState(): void {
    editorTarget = null;
    editingIndex = null;
    creatingDraft = null;
}

export function closePromptEditor(): void {
    resetEditorState();
    closeDialog(DIALOG);
}

function savePromptEditor(saveAs: boolean): void {
    const prompts = editorTarget?.getPrompts();
    if (!editorTarget || !prompts) {
        return;
    }

    const target = editorTarget;
    const nextPrompt = readPromptEditor(`Prompt ${prompts.length + 1}`);

    const append = () => {
        prompts.push(nextPrompt);
        target.setSelectedIndex(prompts.length - 1);
        closePromptEditor();
        commitSettings();
    };

    if (creatingDraft) {
        append();
        return;
    }

    if (editingIndex === null) {
        return;
    }

    const prompt = prompts[editingIndex];
    if (!prompt) {
        return;
    }

    if (saveAs) {
        if (buildPromptUniqueKey(prompt) === buildPromptUniqueKey(nextPrompt)) {
            window.alert('Save As requires a different unique key from the original prompt.');
            return;
        }

        if (promptUniqueKeyExists(prompts, nextPrompt)) {
            window.alert(getPromptDuplicateMessage(nextPrompt));
            return;
        }

        append();
        return;
    }

    prompts[editingIndex] = nextPrompt;
    target.setSelectedIndex(editingIndex);
    closePromptEditor();
    commitSettings();
}

function deletePromptFromEditor(): void {
    const prompts = editorTarget?.getPrompts();
    if (!editorTarget || !prompts) {
        return;
    }

    if (creatingDraft) {
        closePromptEditor();
        updateSettingsUI();
        return;
    }

    if (editingIndex === null) {
        return;
    }

    const prompt = prompts[editingIndex];
    if (!prompt || !window.confirm(`Delete prompt "${prompt.name}"?`)) {
        return;
    }

    const removedIndex = editingIndex;
    const target = editorTarget;
    prompts.splice(removedIndex, 1);
    closePromptEditor();
    target.setSelectedIndex(clamp(removedIndex, 0, Math.max(0, prompts.length - 1)));
    commitSettings();
}

/**
 * Re-renders the open editor, or closes it when its prompt no longer exists.
 */
export function refreshPromptEditor(): void {
    if (!editorTarget) {
        return;
    }

    if (getEditingPrompt()) {
        renderPromptEditor();
    } else {
        closePromptEditor();
    }
}

// ============================================
// Import / export
// ============================================

function openPromptExportDialog(prompts: PresetPrompt[], title: string): void {
    openListExportDialog('prompt', buildListExportItems('prompt', prompts, buildPromptDisplayName), title);
}

async function importPromptsFromFile(file: File): Promise<void> {
    const items = parseListImportPayload(await readJsonFile(file), 'prompt');
    const prompts = items.map((item, index) => normalizePrompt(
        isRecord(item) ? item as Partial<PresetPrompt> : {},
        `Prompt ${index + 1}`,
    ));

    const preset = getCurrentPreset();
    const indexByKey = new Map(preset.prompts.map((prompt, index) => [buildPromptUniqueKey(prompt), index]));

    for (const prompt of prompts) {
        const key = buildPromptUniqueKey(prompt);
        const existingIndex = indexByKey.get(key);
        if (existingIndex !== undefined) {
            preset.prompts[existingIndex] = prompt;
        } else {
            indexByKey.set(key, preset.prompts.length);
            preset.prompts.push(prompt);
        }
    }

    selectedIndex = Math.max(0, preset.prompts.length - 1);
    commitSettings();
    window.alert('Prompts imported successfully.');
}

// ============================================
// Setup
// ============================================

export function setupPromptSection(): void {
    $('#custom_generation_add_prompt').on('click', () => {
        openPromptCreator(presetTarget, 'Unnamed Prompt');
    });

    $('#custom_generation_export_prompt').on('click', () => {
        const preset = getCurrentPreset();
        if (preset.prompts.length === 0) {
            window.alert('No prompts to export.');
            return;
        }

        openPromptExportDialog(preset.prompts, 'Export Prompts');
    });

    bindFileImport('#custom_generation_import_prompt', 'custom_generation_prompt_import_input', importPromptsFromFile);

    $('#custom_generation_prompt_injection_position').on('change', () => {
        if (isUiUpdating()) {
            return;
        }

        updateInjectionControlsVisibility(String($('#custom_generation_prompt_injection_position').val() ?? 'relative'));
    });

    $('#custom_generation_prompt_internal').on('change', () => {
        if (isUiUpdating()) {
            return;
        }

        updateInternalControls(normalizePromptInternal($('#custom_generation_prompt_internal').val()));
    });

    $('#custom_generation_prompt_cancel').on('click', () => {
        closePromptEditor();
    });

    $('#custom_generation_prompt_save').on('click', () => {
        savePromptEditor(false);
    });

    $('#custom_generation_prompt_save_as').on('click', () => {
        savePromptEditor(true);
    });

    $('#custom_generation_prompt_delete').on('click', () => {
        deletePromptFromEditor();
    });

    $(DIALOG).on('close', () => {
        resetEditorState();
    });

    registerSection({
        render: () => {
            const preset = getCurrentPreset();
            selectedIndex = clamp(selectedIndex, 0, Math.max(0, preset.prompts.length - 1));
            renderPromptList($('#custom_generation_prompt_list'), presetTarget, { selectedIndex, exportable: true });
            refreshPromptEditor();
        },
        reset: () => {
            selectedIndex = 0;
            resetEditorState();
        },
    });
}
