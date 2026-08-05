import { Preset } from '@/utils/defines';
import { openLargeEditor } from '@/utils/large-editor';
import {
    FILE_MAP_SIZE_LIMIT,
    fileMapSize,
    getErrorMessage,
    validateFileName,
} from '@/utils/values';
import { buildListRow, buildRowButton, renderList } from '@/ui/common';
import { commitSettings, getCurrentPreset, registerSection } from '@/ui/state';

/**
 * `Preset.files` management.
 *
 * These files are read-only for the model (`/preset/<name>`), so this drawer is
 * the only way to change them. They live inside the preset object, which means
 * they are exported and imported along with it at no extra cost.
 */

type FileEntry = { name: string; content: string };

function listFiles(preset: Preset): FileEntry[] {
    return Object.entries(preset.files ?? {}).map(([name, content]) => ({ name, content }));
}

/**
 * Reject a name that is unusable or already taken.
 * @returns the accepted name, or `null` when the user should try again.
 */
function acceptName(preset: Preset, raw: string, previous?: string): string | null {
    const name = raw.trim();
    const problem = validateFileName(name);
    if (problem) {
        toastr.warning(problem, 'Preset Files');
        return null;
    }

    if (name !== previous && preset.files[name] !== undefined) {
        toastr.warning(`"${name}" already exists`, 'Preset Files');
        return null;
    }

    return name;
}

/** Guard the shared size cap before growing the map. */
function fitsLimit(preset: Preset, name: string, content: string, replacing?: string): boolean {
    const current = fileMapSize(preset.files);
    const removed = replacing !== undefined && preset.files[replacing] !== undefined
        ? replacing.length + preset.files[replacing].length
        : 0;

    if (current - removed + name.length + content.length <= FILE_MAP_SIZE_LIMIT)
        return true;

    toastr.error(`Preset files would exceed the ${Math.floor(FILE_MAP_SIZE_LIMIT / 1024)} KB limit.`, 'Preset Files');
    return false;
}

function setFile(preset: Preset, name: string, content: string): void {
    if (!fitsLimit(preset, name, content, name))
        return;

    preset.files[name] = content;
    commitSettings();
}

/** Rename in place: the map is rebuilt so the list keeps its visible order. */
function renameFile(preset: Preset, from: string, to: string): void {
    if (from === to)
        return;

    const rebuilt: Record<string, string> = {};
    for (const [key, value] of Object.entries(preset.files)) {
        rebuilt[key === from ? to : key] = value;
    }

    preset.files = rebuilt;
    commitSettings();
}

function downloadFile(name: string, content: string): void {
    const url = window.URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');

    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

function formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

// ============================================
// List
// ============================================

function buildFileRow(file: FileEntry, index: number): JQuery {
    const row = buildListRow(index, false);

    const left = $('<div class="flex-container alignItemsCenter flex1"></div>').append(
        $('<div class="flex1"></div>').text(file.name),
        $('<small class="text_muted"></small>').text(formatSize(file.content.length)),
    );

    const editButton = buildRowButton('fa-pen-to-square', 'Edit');
    const renameButton = buildRowButton('fa-i-cursor', 'Rename');
    const downloadButton = buildRowButton('fa-download', 'Download');
    const deleteButton = buildRowButton('fa-trash', 'Delete');
    const actions = $('<div class="flex-container alignItemsCenter"></div>')
        .append(editButton, renameButton, downloadButton, deleteButton);

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        openLargeEditor(file.name, preset.files[file.name] ?? '', (content) => {
            setFile(getCurrentPreset(), file.name, content);
        });
    });

    renameButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        const raw = window.prompt('New file name', file.name);
        if (raw === null)
            return;

        const name = acceptName(preset, raw, file.name);
        if (name)
            renameFile(preset, file.name, name);
    });

    downloadButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        downloadFile(file.name, getCurrentPreset().files[file.name] ?? '');
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        if (!window.confirm(`Delete file "${file.name}"?`))
            return;

        delete getCurrentPreset().files[file.name];
        commitSettings();
    });

    row.append(left, actions);
    return row;
}

function renderFileList(): void {
    renderList($('#custom_generation_files_list'), listFiles(getCurrentPreset()), 'No files', buildFileRow);
}

// ============================================
// Actions
// ============================================

function addFile(): void {
    const preset = getCurrentPreset();
    const raw = window.prompt('New file name', 'notes.md');
    if (raw === null)
        return;

    const name = acceptName(preset, raw);
    if (!name || !fitsLimit(preset, name, ''))
        return;

    preset.files[name] = '';
    commitSettings();

    openLargeEditor(name, '', (content) => {
        setFile(getCurrentPreset(), name, content);
    });
}

/** Upload one or more text files, asking before replacing an existing name. */
async function uploadFiles(files: FileList): Promise<void> {
    const preset = getCurrentPreset();
    let added = 0;

    for (const file of Array.from(files)) {
        // Browsers may report a relative path; only the file name is addressable.
        const raw = file.name.split(/[/\\]/).pop() ?? '';
        const problem = validateFileName(raw);
        if (problem) {
            toastr.warning(`${file.name}: ${problem}`, 'Preset Files');
            continue;
        }

        if (preset.files[raw] !== undefined && !window.confirm(`Replace "${raw}"?`))
            continue;

        const content = await file.text();
        if (!fitsLimit(preset, raw, content, raw))
            break;

        preset.files[raw] = content;
        ++added;
    }

    if (added) {
        commitSettings();
        toastr.success(`${added} file(s) added`, 'Preset Files');
    }
}

export function setupFilesSection(): void {
    $('#custom_generation_add_file').on('click', addFile);

    const input = document.getElementById('custom_generation_files_upload_input');
    $('#custom_generation_upload_file').on('click', () => {
        if (!(input instanceof HTMLInputElement))
            return;

        input.value = '';
        input.click();
    });

    $('#custom_generation_files_upload_input').on('change', async () => {
        if (!(input instanceof HTMLInputElement) || !input.files?.length)
            return;

        try {
            await uploadFiles(input.files);
        } catch (error) {
            toastr.error(getErrorMessage(error, 'Upload failed'), 'Preset Files');
        } finally {
            input.value = '';
        }
    });

    registerSection({ render: renderFileList });
}
