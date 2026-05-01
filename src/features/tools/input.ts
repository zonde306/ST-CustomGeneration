import { z } from 'zod';
import { callGenericPopup, POPUP_TYPE } from "@st/scripts/popup.js";
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { DOMPurify } from '@st/lib.js';

/**
 * Display a text input dialog for the user to enter or edit text.
 *
 * Returns a JSON object: { ok: boolean, value: string | null }
 * - If the user confirms with OK: `ok` is true and `value` contains the entered text.
 * - If the user cancels: `ok` is false and `value` is null/false.
 *
 * Use this when you need the user to provide free-form text input.
 */
const TOOL_NAME = 'input';
const SCHEMA = z.object({
    message: z.string().describe('The message or prompt to display above the input box. Supports HTML and inline CSS for formatting.'),
    default: z.string().describe('Default text to pre-fill in the input box.').optional(),
    large: z.coerce.boolean().describe('Set to true to use a larger multi-line text area instead of a single-line input.').default(false).optional(),
    wide: z.coerce.boolean().describe('Set to true to make the input dialog wider.').default(false).optional(),
    rows: z.coerce.number().int().describe('Number of visible text rows when `large` is true.').default(4).optional(),
    placeholder: z.string().describe('Placeholder text shown when the input box is empty.').optional(),
    tooltip: z.string().describe('Tooltip text that appears on hover over the input box.').optional(),
    ok: z.string().describe('Label for the confirm/OK button.').default('OK').optional(),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Display a text input dialog for the user to enter or edit text. Returns the entered text or null if cancelled.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    const safeValue = DOMPurify.sanitize(args.message ?? '');
    const defaultInput = args?.default !== undefined && typeof args?.default === 'string' ? args.default : '';
    const popupOptions = {
        large: !!args.large,
        wide: !!args.wide,
        okButton: args.ok ?? 'OK',
        rows: args.rows ?? 4,
        placeholder: args.placeholder ?? '',
        tooltip: args.tooltip ?? null,
    };

    const result = await callGenericPopup(safeValue, POPUP_TYPE.INPUT, defaultInput, popupOptions);

    return JSON.stringify({
        ok: result !== null && result !== false,
        value: result,
    });
}
