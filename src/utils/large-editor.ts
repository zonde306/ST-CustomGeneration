import { AreaEditor } from '@/3rd/areaeditor'

/**
 * Large Editor Modal
 * 
 * Provides a larger text editor dialog for editing lengthy text content.
 * Supports: prompt content, override content, request headers, body parameters,
 * exclude body parameters, and tool descriptions.
 */

let onSaveCallback: ((content: string) => void) | null = null;
let isDialogOpen = false;

/**
 * Get the large editor dialog element
 */
function getDialog(): HTMLDialogElement | null {
    const element = document.querySelector('#custom_generation_large_editor_dialog');
    return element instanceof HTMLDialogElement ? element : null;
}

/**
 * Get the large editor textarea element
 */
function getTextarea(): HTMLTextAreaElement | null {
    const element = document.querySelector('#custom_generation_large_editor_textarea');
    return element instanceof HTMLTextAreaElement ? element : null;
}

/**
 * Open the large editor dialog
 */
function openDialog(): void {
    const dialog = getDialog();
    if (!dialog || dialog.open) {
        return;
    }

    try {
        dialog.showModal();
    } catch {
        dialog.setAttribute('open', 'open');
    }

    isDialogOpen = true;
}

/**
 * Close the large editor dialog
 */
function closeDialog(): void {
    const dialog = getDialog();
    if (!dialog) {
        return;
    }

    if (dialog.open) {
        dialog.close();
    } else {
        dialog.removeAttribute('open');
    }

    isDialogOpen = false;
    onSaveCallback = null;
}

/**
 * Set the title of the large editor dialog
 */
function setTitle(title: string): void {
    const titleEl = document.querySelector('#custom_generation_large_editor_title');
    if (titleEl) {
        titleEl.textContent = title;
    }
}

/**
 * Set the content of the large editor textarea
 */
function setContent(content: string): void {
    const textarea = getTextarea();
    if (textarea) {
        textarea.value = content ?? '';
    }
}

/**
 * Get the content of the large editor textarea
 */
function getContent(): string {
    const textarea = getTextarea();
    return textarea?.value ?? '';
}

/**
 * Save the current content and close the dialog
 */
function saveAndClose(): void {
    const content = getContent();
    const callback = onSaveCallback;
    closeDialog();
    
    if (callback) {
        try {
            callback(content);
        } catch (error) {
            console.error('[LargeEditor] Error in save callback:', error);
        }
    }
}

/**
 * Cancel editing and close the dialog
 */
function cancelAndClose(): void {
    closeDialog();
}

/**
 * Bind events to the large editor dialog
 */
function bindEvents(): void {
    // Cancel button
    $('#custom_generation_large_editor_cancel').off('click').on('click', () => {
        cancelAndClose();
    });

    // Save button
    $('#custom_generation_large_editor_save').off('click').on('click', () => {
        saveAndClose();
    });

    // Dialog close event (e.g., pressing Escape)
    $('#custom_generation_large_editor_dialog').off('close').on('close', () => {
        if (isDialogOpen) {
            onSaveCallback = null;
            isDialogOpen = false;
        }
    });

    // Ctrl+Enter to save
    $('#custom_generation_large_editor_textarea').off('keydown').on('keydown', (event: JQuery.KeyDownEvent) => {
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault();
            saveAndClose();
        }
    });

    new AreaEditor(document.querySelector('#custom_generation_large_editor_textarea') as HTMLTextAreaElement);
}

/**
 * Open the large editor for editing text content.
 * 
 * @param title - The title to display in the dialog header
 * @param content - The initial text content to edit
 * @param onSave - Callback function that receives the edited content when saved
 * @returns true if the dialog was opened successfully, false otherwise
 * 
 * @example
 * // Open editor for prompt content
 * openLargeEditor('Prompt Content', currentPrompt, (newContent) => {
 *     $('#myTextarea').val(newContent);
 * });
 */
export function openLargeEditor(
    title: string,
    content: string,
    onSave: (content: string) => void,
): boolean {
    const dialog = getDialog();
    if (!dialog) {
        console.error('[LargeEditor] Dialog element not found. Ensure large-editor.html is injected.');
        return false;
    }

    if (isDialogOpen) {
        console.warn('[LargeEditor] Editor is already open.');
        return false;
    }

    onSaveCallback = onSave;
    setTitle(title);
    setContent(content);
    bindEvents();
    openDialog();

    // Focus the textarea and move cursor to the end
    const textarea = getTextarea();
    if (textarea) {
        textarea.focus();
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
    }

    return true;
}

/**
 * Check if the large editor dialog is currently open
 */
export function isLargeEditorOpen(): boolean {
    return isDialogOpen;
}

/**
 * Update the content of the large editor textarea without changing the save callback
 */
export function updateLargeEditorContent(content: string): void {
    setContent(content);
}
