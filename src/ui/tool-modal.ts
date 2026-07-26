import { TOOL_DEFINITION } from '@/features/tool-manager';
import { ToolSettings } from '@/utils/defines';
import { clamp, isRecord } from '@/utils/values';
import {
    bindFileImport,
    buildListRow,
    buildRowButton,
    closeDialog,
    getSelectValues,
    openDialog,
    readJsonFile,
    renderList,
    setControlsDisabled,
    setSelectValues,
    withUiUpdate,
} from '@/ui/common';
import {
    ToolEntry,
    commitSettings,
    getCurrentPreset,
    getToolEntries,
    getToolKeys,
    normalizeToolSettings,
    registerSection,
    updateSettingsUI,
} from '@/ui/state';
import { buildListExportItems, openListExportDialog, parseListImportPayload } from '@/ui/list-export';

const DIALOG = '#custom_generation_tool_dialog';
const PARAMETERS_CONTAINER = '#custom_generation_tool_parameters_container';

const EDITOR_CONTROLS = [
    '#custom_generation_tool_enabled',
    '#custom_generation_tool_triggers',
    '#custom_generation_tool_description',
    '#custom_generation_tool_save',
];

let selectedIndex = 0;
let editingIndex: number | null = null;

// ============================================
// List
// ============================================

function buildToolRow(entry: ToolEntry, index: number): JQuery {
    const row = buildListRow(index, index === selectedIndex);

    const toggle = $('<input type="checkbox" />').prop('checked', entry.settings.enabled);
    const left = $('<div class="flex-container alignItemsCenter flex1"></div>')
        .append(toggle, $(`<div class="flex1" data-i18n="cg_tool_${entry.key}"></div>`).text(entry.key));

    const editButton = buildRowButton('fa-pen-to-square', 'Edit');
    const exportButton = buildRowButton('fa-file-export', 'Export');
    const actions = $('<div class="flex-container alignItemsCenter"></div>').append(editButton, exportButton);

    row.on('click', () => {
        selectedIndex = index;
        updateSettingsUI();
    });

    toggle.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
    });

    toggle.on('change', () => {
        entry.settings.enabled = Boolean(toggle.prop('checked'));
        getCurrentPreset().tools[entry.key] = entry.settings;
        selectedIndex = index;
        commitSettings();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openToolEditor(index);
    });

    exportButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openToolExportDialog([entry], 'Export Tool');
    });

    row.append(left, actions);
    return row;
}

// ============================================
// Editor
// ============================================

/**
 * Renders one description input per parameter declared by the tool's schema,
 * falling back to whatever parameters are stored in the settings.
 */
function renderParameterInputs(entry: ToolEntry): void {
    const container = $(PARAMETERS_CONTAINER);
    container.empty();

    const defaults = getSchemaParameterDescriptions(entry.key);
    const paramNames = defaults ? Object.keys(defaults) : Object.keys(entry.settings.parameters ?? {});

    for (const paramName of paramNames) {
        const row = $('<div class="tool-parameter-row"></div>');
        const label = $('<div class="tool-parameter-label"></div>').text(paramName);
        const input = $('<input type="text" class="text_pole tool-parameter-input">')
            .attr('data-param-name', paramName)
            .attr('placeholder', 'Parameter description')
            .val(entry.settings.parameters?.[paramName] ?? defaults?.[paramName] ?? '');
        row.append(label, input);
        container.append(row);
    }
}

function getSchemaParameterDescriptions(toolKey: string): Record<string, string> | null {
    const schema = TOOL_DEFINITION.get(toolKey)?.parameters;
    if (!schema) {
        return null;
    }

    try {
        const properties = schema.toJSONSchema()?.properties;
        if (!isRecord(properties)) {
            return null;
        }

        return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
            key,
            isRecord(value) ? String(value.description ?? '') : '',
        ]));
    } catch {
        return null;
    }
}

function renderToolEditor(): void {
    const entry = editingIndex === null ? null : getToolEntries()[editingIndex] ?? null;

    withUiUpdate(() => {
        if (!entry) {
            setControlsDisabled(EDITOR_CONTROLS, true);
            $('#custom_generation_tool_name').text('');
            $('#custom_generation_tool_enabled').prop('checked', false);
            setSelectValues('#custom_generation_tool_triggers', []);
            $('#custom_generation_tool_description').val('');
            $(PARAMETERS_CONTAINER).empty();
            return;
        }

        setControlsDisabled(EDITOR_CONTROLS, false);
        $('#custom_generation_tool_name').text(entry.key);
        $('#custom_generation_tool_enabled').prop('checked', entry.settings.enabled);
        setSelectValues('#custom_generation_tool_triggers', entry.settings.triggers ?? []);
        $('#custom_generation_tool_description').val(entry.settings.description ?? '');
        renderParameterInputs(entry);
        $(`${PARAMETERS_CONTAINER} input`).prop('disabled', false);
    });
}

function openToolEditor(index: number): void {
    if (!getToolEntries()[index]) {
        return;
    }

    editingIndex = index;
    selectedIndex = index;
    renderToolEditor();
    openDialog(DIALOG);
}

function closeToolEditor(): void {
    editingIndex = null;
    closeDialog(DIALOG);
}

function saveToolEditor(): void {
    if (editingIndex === null) {
        return;
    }

    const entry = getToolEntries()[editingIndex];
    if (!entry) {
        return;
    }

    const parameters: Record<string, string> = {};
    $(`${PARAMETERS_CONTAINER} input[data-param-name]`).each(function () {
        const paramName = $(this).attr('data-param-name');
        if (paramName) {
            parameters[paramName] = String($(this).val() ?? '');
        }
    });

    getCurrentPreset().tools[entry.key] = {
        enabled: Boolean($('#custom_generation_tool_enabled').prop('checked')),
        triggers: getSelectValues('#custom_generation_tool_triggers'),
        description: String($('#custom_generation_tool_description').val() ?? entry.settings.description ?? ''),
        parameters,
    };

    selectedIndex = editingIndex;
    closeToolEditor();
    commitSettings();
}

// ============================================
// Import / export
// ============================================

function openToolExportDialog(entries: ToolEntry[], title: string): void {
    const items = buildListExportItems('tool', entries.map(entry => entry.settings), (_settings, index) => entries[index].key);
    openListExportDialog('tool', items, title);
}

/**
 * Tools are keyed by their definition name, and exports keep the definition order,
 * so imported settings are applied back positionally.
 */
async function importToolsFromFile(file: File): Promise<void> {
    const items = parseListImportPayload(await readJsonFile(file), 'tool');
    const tools = items.map(item => normalizeToolSettings(item)) as ToolSettings[];

    const preset = getCurrentPreset();
    const toolKeys = getToolKeys();

    for (let i = 0; i < toolKeys.length && i < tools.length; i++) {
        preset.tools[toolKeys[i]] = tools[i];
    }

    selectedIndex = Math.max(0, toolKeys.length - 1);
    commitSettings();
    window.alert('Tools imported successfully.');
}

// ============================================
// Setup
// ============================================

export function setupToolSection(): void {
    $('#custom_generation_export_tool').on('click', () => {
        const entries = getToolEntries();
        if (entries.length === 0) {
            window.alert('No tools to export.');
            return;
        }

        openToolExportDialog(entries, 'Export Tools');
    });

    bindFileImport('#custom_generation_import_tool', 'custom_generation_tool_import_input', importToolsFromFile);

    $('#custom_generation_tool_cancel').on('click', () => {
        closeToolEditor();
    });

    $('#custom_generation_tool_save').on('click', () => {
        saveToolEditor();
    });

    $(DIALOG).on('close', () => {
        editingIndex = null;
    });

    registerSection({
        render: () => {
            const entries = getToolEntries();
            selectedIndex = clamp(selectedIndex, 0, Math.max(0, entries.length - 1));
            renderList($('#custom_generation_tool_list'), entries, 'No tools', buildToolRow);

            if (editingIndex !== null) {
                if (entries[editingIndex]) {
                    renderToolEditor();
                } else {
                    closeToolEditor();
                }
            }
        },
        reset: () => {
            selectedIndex = 0;
            editingIndex = null;
        },
    });
}
