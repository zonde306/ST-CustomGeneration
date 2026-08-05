import { getErrorMessage } from '@/utils/values';

// ============================================
// UI update guard
// ============================================

let uiUpdateDepth = 0;

export function isUiUpdating(): boolean {
    return uiUpdateDepth > 0;
}

/**
 * Suppresses change handlers while the callback repopulates the DOM.
 */
export function withUiUpdate(update: () => void): void {
    uiUpdateDepth++;
    try {
        update();
    } finally {
        uiUpdateDepth = Math.max(0, uiUpdateDepth - 1);
    }
}

// ============================================
// Select helpers
// ============================================

export function normalizeSelectValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) {
            return [];
        }
        return text.split(',').map(item => item.trim()).filter(Boolean);
    }

    return [];
}

export function ensureSelectOption(select: JQuery, option: string | number): void {
    const value = String(option);
    const exists = select.find('option').toArray().some(item => String($(item).val()) === value);
    if (!exists) {
        const i18nKey = value.startsWith('@@') ? value.substring(2) : value;
        select.append($(`<option data-i18n="cg_${i18nKey}"></option>`).val(value).text(value));
    }
}

export function ensureSelectOptions(select: JQuery, options: Array<string | number>): void {
    options.forEach((option) => {
        ensureSelectOption(select, option);
    });
}

export function getSelectValues(selector: string): string[] {
    return normalizeSelectValues($(selector).val());
}

export function setSelectValues(selector: string, values: Array<string | number>): void {
    const select = $(selector);
    const normalized = values.map(value => String(value).trim()).filter(Boolean);
    normalized.forEach(value => ensureSelectOption(select, value));
    select.val(normalized);
    if (select.data('select2')) {
        select.trigger('change.select2');
    } else {
        select.trigger('change');
    }
}

export function initSelect2Multi(selector: string, options: string[]): void {
    const select = $(selector);
    if (!select.length || typeof (select as any).select2 !== 'function') {
        return;
    }

    ensureSelectOptions(select, options);

    if (select.data('select2')) {
        return;
    }

    const dialogParent = select.closest('dialog');
    (select as any).select2({
        width: '100%',
        placeholder: String(select.data('placeholder') ?? ''),
        allowClear: true,
        tags: true,
        closeOnSelect: false,
        tokenSeparators: [','],
        dropdownParent: dialogParent.length ? dialogParent : $(document.body),
    });
}

export function setControlsDisabled(selectors: string[], disabled: boolean): void {
    for (const selector of selectors) {
        $(selector).prop('disabled', disabled);
    }
}

// ============================================
// Dialog helpers
// ============================================

function getDialog(selector: string): HTMLDialogElement | null {
    const element = document.querySelector(selector);
    return element instanceof HTMLDialogElement ? element : null;
}

export function openDialog(selector: string): void {
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

export function closeDialog(selector: string): void {
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

export function setDrawerExpanded(bodySelector: string, iconSelector: string, expanded: boolean): void {
    const body = $(bodySelector);
    const icon = $(iconSelector);
    if (expanded) {
        body.slideDown(200);
    } else {
        body.slideUp(200);
    }
    icon.toggleClass('fa-circle-chevron-down', !expanded);
    icon.toggleClass('fa-circle-chevron-up', expanded);
}

/**
 * Binds a drawer header so clicking it (outside of action buttons) toggles the body.
 */
export function bindDrawerToggle(toggleSelector: string, bodySelector: string, iconSelector: string): void {
    $(toggleSelector).on('click', (event: JQuery.TriggeredEvent) => {
        if ($(event.target).closest('.custom_generation_button').length) {
            return;
        }
        setDrawerExpanded(bodySelector, iconSelector, !$(bodySelector).is(':visible'));
    });
}

// ============================================
// List rows and sorting
// ============================================

export function buildListRow(index: number, active: boolean, extraClass: string = ''): JQuery {
    const row = $(`<div class="custom_generation_list_row ${extraClass} flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>`);
    row.attr('data-index', String(index));
    row.toggleClass('active', active);
    return row;
}

export function buildRowButton(icon: string, title: string): JQuery {
    return $(`<i class="menu_button fa-solid ${icon}" title="${title}" data-i18n="[title]${title}"></i>`);
}

export function buildDragHandle(): JQuery {
    return $('<i class="menu_button fa-solid fa-grip-lines custom_generation_drag_handle" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
}

/**
 * Renders a list container, falling back to the container's `no-items-text` when empty.
 */
export function renderList<T>(list: JQuery, items: T[], fallbackText: string, buildRow: (item: T, index: number) => JQuery): void {
    if (!list.length) {
        return;
    }

    list.empty();

    if (items.length === 0) {
        list.text(String(list.attr('no-items-text') ?? fallbackText));
        return;
    }

    items.forEach((item, index) => {
        list.append(buildRow(item, index));
    });
}

/**
 * Reads the drag-and-drop order of a list, or null when it is unchanged or inconsistent.
 */
export function readReorder(list: JQuery, itemCount: number): number[] | null {
    const order = list.children('.custom_generation_list_row').toArray().map((element) => {
        const value = Number($(element).attr('data-index'));
        return Number.isFinite(value) ? Math.trunc(value) : -1;
    }).filter(value => value >= 0);

    if (order.length !== itemCount || order.every((value, index) => value === index)) {
        return null;
    }

    return order;
}

export function resolveReorderedIndex(order: number[], current: number | null): number | null {
    if (current === null) {
        return null;
    }

    const nextIndex = order.indexOf(current);
    return nextIndex >= 0 ? nextIndex : current;
}

export function initSortableList(list: JQuery, onUpdate: () => void): void {
    if (!list.length || typeof (list as any).sortable !== 'function') {
        return;
    }

    if (list.data('ui-sortable')) {
        try {
            (list as any).sortable('destroy');
        } catch {
            // ignore
        }
    }

    if (list.children('.custom_generation_list_row').length < 2) {
        return;
    }

    (list as any).sortable({
        handle: '.custom_generation_drag_handle',
        items: '> .custom_generation_list_row',
        tolerance: 'pointer',
        update: () => {
            if (isUiUpdating()) {
                return;
            }
            onUpdate();
        },
    });
}

// ============================================
// File helpers
// ============================================

export function downloadJson(filename: string, payload: unknown): void {
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<unknown> {
    const text = await file.text();

    try {
        return JSON.parse(text);
    } catch {
        throw new Error('Invalid JSON file.');
    }
}

/**
 * Binds a button that opens a hidden file input and handles the selected file.
 */
export function bindFileImport(buttonSelector: string, inputId: string, onFile: (file: File) => Promise<void>): void {
    const getInput = (): HTMLInputElement | null => {
        const input = document.getElementById(inputId);
        return input instanceof HTMLInputElement ? input : null;
    };

    $(buttonSelector).on('click', () => {
        const input = getInput();
        if (!input) {
            return;
        }

        input.value = '';
        input.click();
    });

    $(`#${inputId}`).on('change', async () => {
        const input = getInput();
        if (!input?.files?.length) {
            return;
        }

        try {
            await onFile(input.files[0]);
        } catch (error) {
            window.alert(`Import failed: ${getErrorMessage(error, 'Unknown import error')}`);
        } finally {
            input.value = '';
        }
    });
}
