import { RegEx } from '@/utils/defines';
import { clamp, isRecord, parseNullableInt } from '@/utils/values';
import {
    bindFileImport,
    buildDragHandle,
    buildListRow,
    buildRowButton,
    closeDialog,
    initSortableList,
    openDialog,
    readJsonFile,
    readReorder,
    renderList,
    resolveReorderedIndex,
    setControlsDisabled,
    withUiUpdate,
} from '@/ui/common';
import { commitSettings, getCurrentPreset, normalizeRegex, registerSection, updateSettingsUI } from '@/ui/state';
import { buildListExportItems, openListExportDialog, parseListImportPayload } from '@/ui/list-export';

const DIALOG = '#custom_generation_regex_dialog';

const EDITOR_CONTROLS = [
    '#custom_generation_regex_name',
    '#custom_generation_regex_regex',
    '#custom_generation_regex_replace',
    '#custom_generation_regex_user_input',
    '#custom_generation_regex_ai_output',
    '#custom_generation_regex_world_info',
    '#custom_generation_regex_request',
    '#custom_generation_regex_response',
    '#custom_generation_regex_ephemerality',
    '#custom_generation_regex_enable',
    '#custom_generation_regex_min_depth',
    '#custom_generation_regex_max_depth',
    '#custom_generation_regex_delete',
    '#custom_generation_regex_save_as',
    '#custom_generation_regex_save',
];

let selectedIndex = 0;
let editingIndex: number | null = null;
let creatingDraft: RegEx | null = null;

function buildRegexDisplayName(regex: RegEx, index: number): string {
    return regex.name || `Regex ${index + 1}`;
}

function regexNameExists(regexs: RegEx[], regex: RegEx): boolean {
    const targetName = String(regex.name ?? '').trim();
    return regexs.some(item => String(item.name ?? '').trim() === targetName);
}

// ============================================
// List
// ============================================

function buildRegexRow(regex: RegEx, index: number): JQuery {
    const row = buildListRow(index, index === selectedIndex);

    const toggle = $('<input type="checkbox" />').prop('checked', regex.enabled);
    const left = $('<div class="flex-container alignItemsCenter flex1"></div>')
        .append(buildDragHandle(), toggle, $('<div class="flex1"></div>').text(buildRegexDisplayName(regex, index)));

    const editButton = buildRowButton('fa-pen-to-square', 'Edit');
    const exportButton = buildRowButton('fa-file-export', 'Export');
    const deleteButton = buildRowButton('fa-trash', 'Delete');
    const actions = $('<div class="flex-container alignItemsCenter"></div>').append(editButton, exportButton, deleteButton);

    row.on('click', () => {
        selectedIndex = index;
        updateSettingsUI();
    });

    toggle.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
    });

    toggle.on('change', () => {
        const target = getCurrentPreset().regexs[index];
        if (!target) {
            return;
        }

        target.enabled = Boolean(toggle.prop('checked'));
        selectedIndex = index;
        commitSettings();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openRegexEditor(index);
    });

    exportButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openRegexExportDialog([regex], 'Export Regex');
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        const target = preset.regexs[index];
        if (!target || !window.confirm(`Delete regex "${target.name}"?`)) {
            return;
        }

        preset.regexs.splice(index, 1);
        selectedIndex = clamp(index, 0, Math.max(0, preset.regexs.length - 1));
        commitSettings();
    });

    row.append(left, actions);
    return row;
}

function renderRegexList(): void {
    const list = $('#custom_generation_regex_list');
    const regexs = getCurrentPreset().regexs;

    renderList(list, regexs, 'No scripts', buildRegexRow);

    initSortableList(list, () => {
        const order = readReorder(list, regexs.length);
        if (!order) {
            return;
        }

        const next = order.map(index => regexs[index]).filter(Boolean);
        if (next.length !== regexs.length) {
            return;
        }

        getCurrentPreset().regexs = next;
        selectedIndex = resolveReorderedIndex(order, selectedIndex) ?? selectedIndex;
        editingIndex = resolveReorderedIndex(order, editingIndex);
        commitSettings();
    });
}

// ============================================
// Editor
// ============================================

function getEditingRegex(): RegEx | null {
    if (creatingDraft) {
        return creatingDraft;
    }

    return editingIndex === null ? null : getCurrentPreset().regexs[editingIndex] ?? null;
}

function renderRegexEditor(): void {
    const regex = getEditingRegex();

    withUiUpdate(() => {
        if (!regex) {
            setControlsDisabled(EDITOR_CONTROLS, true);
            $('#custom_generation_regex_name').val('');
            $('#custom_generation_regex_regex').val('');
            $('#custom_generation_regex_replace').val('');
            $('#custom_generation_regex_user_input').prop('checked', false);
            $('#custom_generation_regex_ai_output').prop('checked', false);
            $('#custom_generation_regex_world_info').prop('checked', false);
            $('#custom_generation_regex_request').prop('checked', false);
            $('#custom_generation_regex_response').prop('checked', false);
            $('#custom_generation_regex_ephemerality').prop('checked', false);
            $('#custom_generation_regex_enable').prop('checked', false);
            $('#custom_generation_regex_min_depth').val('');
            $('#custom_generation_regex_max_depth').val('');
            $('#custom_generation_regex_delete').toggle(false);
            $('#custom_generation_regex_save_as').toggle(false);
            return;
        }

        setControlsDisabled(EDITOR_CONTROLS, false);
        $('#custom_generation_regex_name').val(regex.name);
        $('#custom_generation_regex_regex').val(regex.regex);
        $('#custom_generation_regex_replace').val(regex.replace);
        $('#custom_generation_regex_user_input').prop('checked', regex.userInput);
        $('#custom_generation_regex_ai_output').prop('checked', regex.aiOutput);
        $('#custom_generation_regex_world_info').prop('checked', regex.worldInfo);
        $('#custom_generation_regex_request').prop('checked', regex.request);
        $('#custom_generation_regex_response').prop('checked', regex.response);
        $('#custom_generation_regex_ephemerality').prop('checked', regex.ephemerality);
        $('#custom_generation_regex_enable').prop('checked', regex.enabled);
        $('#custom_generation_regex_min_depth').val(regex.minDepth ?? '');
        $('#custom_generation_regex_max_depth').val(regex.maxDepth ?? '');
        $('#custom_generation_regex_delete').toggle(!creatingDraft);
        $('#custom_generation_regex_save_as').toggle(!creatingDraft);
    });
}

function readRegexEditor(fallbackName: string): RegEx {
    return normalizeRegex({
        name: String($('#custom_generation_regex_name').val() ?? ''),
        regex: String($('#custom_generation_regex_regex').val() ?? ''),
        replace: String($('#custom_generation_regex_replace').val() ?? ''),
        userInput: Boolean($('#custom_generation_regex_user_input').prop('checked')),
        aiOutput: Boolean($('#custom_generation_regex_ai_output').prop('checked')),
        worldInfo: Boolean($('#custom_generation_regex_world_info').prop('checked')),
        enabled: Boolean($('#custom_generation_regex_enable').prop('checked')),
        minDepth: parseNullableInt($('#custom_generation_regex_min_depth').val(), -1),
        maxDepth: parseNullableInt($('#custom_generation_regex_max_depth').val(), 0),
        ephemerality: Boolean($('#custom_generation_regex_ephemerality').prop('checked')),
        request: Boolean($('#custom_generation_regex_request').prop('checked')),
        response: Boolean($('#custom_generation_regex_response').prop('checked')),
    }, fallbackName);
}

function openRegexEditor(index: number): void {
    if (!getCurrentPreset().regexs[index]) {
        return;
    }

    creatingDraft = null;
    editingIndex = index;
    selectedIndex = index;
    renderRegexEditor();
    openDialog(DIALOG);
}

function resetEditorState(): void {
    editingIndex = null;
    creatingDraft = null;
}

function closeRegexEditor(): void {
    resetEditorState();
    closeDialog(DIALOG);
}

function saveRegexEditor(saveAs: boolean): void {
    const preset = getCurrentPreset();
    const nextRegex = readRegexEditor(`Regex ${preset.regexs.length + 1}`);

    const append = () => {
        preset.regexs.push(nextRegex);
        selectedIndex = preset.regexs.length - 1;
        closeRegexEditor();
        commitSettings();
    };

    if (creatingDraft) {
        append();
        return;
    }

    if (editingIndex === null) {
        return;
    }

    const regex = preset.regexs[editingIndex];
    if (!regex) {
        return;
    }

    if (saveAs) {
        if (String(regex.name ?? '').trim() === String(nextRegex.name ?? '').trim()) {
            window.alert('Save As requires a different name from the original regex.');
            return;
        }

        if (regexNameExists(preset.regexs, nextRegex)) {
            window.alert(`A regex with the same name already exists: ${nextRegex.name}`);
            return;
        }

        append();
        return;
    }

    preset.regexs[editingIndex] = nextRegex;
    selectedIndex = editingIndex;
    closeRegexEditor();
    commitSettings();
}

function deleteRegexFromEditor(): void {
    if (creatingDraft) {
        closeRegexEditor();
        updateSettingsUI();
        return;
    }

    if (editingIndex === null) {
        return;
    }

    const preset = getCurrentPreset();
    const regex = preset.regexs[editingIndex];
    if (!regex || !window.confirm(`Delete regex "${regex.name}"?`)) {
        return;
    }

    const removedIndex = editingIndex;
    preset.regexs.splice(removedIndex, 1);
    closeRegexEditor();
    selectedIndex = clamp(removedIndex, 0, Math.max(0, preset.regexs.length - 1));
    commitSettings();
}

// ============================================
// Import / export
// ============================================

function openRegexExportDialog(regexs: RegEx[], title: string): void {
    openListExportDialog('regex', buildListExportItems('regex', regexs, buildRegexDisplayName), title);
}

async function importRegexsFromFile(file: File): Promise<void> {
    const items = parseListImportPayload(await readJsonFile(file), 'regex');
    const regexs = items.map((item, index) => normalizeRegex(
        isRecord(item) ? item as Partial<RegEx> : {},
        `Regex ${index + 1}`,
    ));

    const preset = getCurrentPreset();
    const indexByName = new Map(preset.regexs.map((regex, index) => [regex.name, index]));

    for (const regex of regexs) {
        const existingIndex = indexByName.get(regex.name);
        if (existingIndex !== undefined) {
            preset.regexs[existingIndex] = regex;
        } else {
            indexByName.set(regex.name, preset.regexs.length);
            preset.regexs.push(regex);
        }
    }

    selectedIndex = Math.max(0, preset.regexs.length - 1);
    commitSettings();
    window.alert('Regex scripts imported successfully.');
}

// ============================================
// Setup
// ============================================

export function setupRegexSection(): void {
    $('#custom_generation_add_regex').on('click', () => {
        creatingDraft = normalizeRegex({
            name: '',
            regex: '',
            replace: '',
            userInput: true,
            aiOutput: true,
            worldInfo: false,
            enabled: true,
            minDepth: null,
            maxDepth: null,
            ephemerality: false,
            request: true,
            response: true,
        }, 'Regex');
        editingIndex = null;
        renderRegexEditor();
        openDialog(DIALOG);
    });

    $('#custom_generation_export_regex').on('click', () => {
        const preset = getCurrentPreset();
        if (preset.regexs.length === 0) {
            window.alert('No regex scripts to export.');
            return;
        }

        openRegexExportDialog(preset.regexs, 'Export Regex');
    });

    bindFileImport('#custom_generation_import_regex', 'custom_generation_regex_import_input', importRegexsFromFile);

    $('#custom_generation_regex_cancel').on('click', () => {
        closeRegexEditor();
    });

    $('#custom_generation_regex_save').on('click', () => {
        saveRegexEditor(false);
    });

    $('#custom_generation_regex_save_as').on('click', () => {
        saveRegexEditor(true);
    });

    $('#custom_generation_regex_delete').on('click', () => {
        deleteRegexFromEditor();
    });

    $(DIALOG).on('close', () => {
        resetEditorState();
    });

    registerSection({
        render: () => {
            const preset = getCurrentPreset();
            selectedIndex = clamp(selectedIndex, 0, Math.max(0, preset.regexs.length - 1));
            renderRegexList();

            if (editingIndex !== null || creatingDraft) {
                if (getEditingRegex()) {
                    renderRegexEditor();
                } else {
                    closeRegexEditor();
                }
            }
        },
        reset: () => {
            selectedIndex = 0;
            resetEditorState();
        },
    });
}
