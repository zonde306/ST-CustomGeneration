import { z } from 'zod';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "@st/scripts/popup.js";
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { DOMPurify } from '@st/lib.js';

/**
 * Display a confirmation dialog with OK/Cancel buttons for the user to make a binary choice.
 *
 * Returns a JSON object: { ok: true, selected: string } where `selected` is the label
 * of the button that was clicked (the `ok` text if confirmed, the `cancel` text if dismissed).
 *
 * Use this when you need to ask the user a yes/no or proceed/cancel question.
 */
const TOOL_NAME = 'confirm';
const SCHEMA = z.object({
    message: z.string().describe('The message to display in the confirmation dialog. Supports HTML and inline CSS for formatting.'),
    ok: z.string().describe('Label for the confirm/OK button.').default('OK').optional(),
    cancel: z.string().describe('Label for the cancel/dismiss button.').default('Cancel').optional(),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Display a confirmation dialog with OK/Cancel buttons for the user to make a binary choice. Returns the label of the button that was clicked.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    const result = await callGenericPopup(
        DOMPurify.sanitize(args.message),
        POPUP_TYPE.CONFIRM,
        '',
        {
            okButton: args.ok ?? 'OK',
            cancelButton: args.cancel ?? 'Cancel',
        }
    ) as number;

    return JSON.stringify({
        ok: true,
        selected: result == POPUP_RESULT.AFFIRMATIVE ? args.ok : args.cancel,
    });
}
