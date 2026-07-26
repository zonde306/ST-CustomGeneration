import { ListExportDialogState, ListExportItem, ListExportKind, ListExportPayload } from '@/utils/defines';
import { closeDialog, downloadJson, openDialog } from '@/ui/common';
import { clone, isRecord } from '@/utils/values';
import { convertRegex } from '@/utils/compatibility';

const listExportSchemaVersion = '1.0.0';

const dialogState: ListExportDialogState = {
    kind: null,
    items: [],
};

const filenameSuffixes: Record<ListExportKind, string> = {
    prompt: 'prompts',
    regex: 'regex',
    template: 'templates',
    tool: 'tools',
};

export function buildListExportItems<T>(kind: ListExportKind, items: T[], getLabel: (item: T, index: number) => string): ListExportItem[] {
    return items.map((item, index) => ({
        id: `${kind}-${index}`,
        label: getLabel(item, index),
        checked: true,
        data: clone(item) as ListExportItem['data'],
    }));
}

export function openListExportDialog(kind: ListExportKind, items: ListExportItem[], title: string): void {
    dialogState.kind = kind;
    dialogState.items = items;
    $('#custom_generation_list_export_title').text(title);

    const container = $('#custom_generation_list_export_items');
    container.empty();
    items.forEach((item) => {
        const row = $('<label class="checkbox_label"></label>');
        const checkbox = $('<input type="checkbox" />').prop('checked', item.checked);
        checkbox.on('change', () => {
            item.checked = Boolean(checkbox.prop('checked'));
        });
        row.append(checkbox, $('<span></span>').text(item.label));
        container.append(row);
    });

    openDialog('#custom_generation_list_export_dialog');
}

function closeListExportDialog(): void {
    closeDialog('#custom_generation_list_export_dialog');
    dialogState.kind = null;
    dialogState.items = [];
}

function confirmListExport(): void {
    const kind = dialogState.kind;
    if (!kind) {
        return;
    }

    const selected = dialogState.items.filter(item => item.checked);
    if (selected.length === 0) {
        window.alert('Please select at least one item to export.');
        return;
    }

    const payload: ListExportPayload = {
        version: listExportSchemaVersion,
        kind,
        items: selected.map(item => item.data),
    };

    closeListExportDialog();
    downloadJson(`st-custom-generation-${filenameSuffixes[kind]}-${Date.now()}.json`, payload);
}

/**
 * Validates an imported list payload and returns the raw items for the expected kind.
 * Also accepts a bare SillyTavern regex script as a single regex item.
 */
export function parseListImportPayload(raw: unknown, expectedKind: ListExportKind): unknown[] {
    if (!isRecord(raw)) {
        throw new Error('Invalid JSON payload.');
    }

    if (raw.findRegex) {
        if (expectedKind !== 'regex') {
            throw new Error(`Import type mismatch: expected ${expectedKind}.`);
        }

        return [convertRegex(raw)];
    }

    const kind = String(raw.kind ?? '').trim();
    if (kind !== 'prompt' && kind !== 'regex' && kind !== 'template' && kind !== 'tool') {
        throw new Error('Invalid import format: kind is required.');
    }

    if (kind !== expectedKind) {
        throw new Error(`Import type mismatch: expected ${expectedKind}.`);
    }

    if (!Array.isArray(raw.items)) {
        throw new Error('Invalid import format: items is required.');
    }

    if (raw.items.length === 0) {
        throw new Error('Invalid import format: items cannot be empty.');
    }

    return raw.items;
}

export function setupListExportDialog(): void {
    $('#custom_generation_list_export_cancel').on('click', () => {
        closeListExportDialog();
    });

    $('#custom_generation_list_export_confirm').on('click', () => {
        confirmListExport();
    });
}
