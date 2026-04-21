import { z } from 'zod';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "@st/scripts/popup.js";
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { DOMPurify } from '@st/lib.js';

/**
 * Display a confirmation dialog box, allowing the user to choose whether to accept.
 */
const TOOL_NAME = 'confirm';
const SCHEMA = z.object({
    message: z.string().describe('Dialog messages allow the use of HTML and inline CSS code.'),
    ok: z.string().describe('The text of the "OK" button.').default('OK').optional(),
    cancel: z.string().describe('The text of the "Cancel" button.').default('Cancel').optional(),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'A dialog box pops up, providing "OK" and "Cancel" buttons for the user to choose from.',
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
