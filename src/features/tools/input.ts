import { z } from 'zod';
import { callGenericPopup, POPUP_TYPE } from "@st/scripts/popup.js";
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { DOMPurify } from '@st/lib.js';

const TOOL_NAME = 'input';
const SCHEMA = z.object({
    message: z.string().describe('Dialog messages allow the use of HTML and inline CSS code.'),
    default: z.string().describe('The default value to be displayed in the input box.').optional(),
    large: z.boolean().describe('Whether to use a large input box.').default(false),
    wide: z.boolean().describe('Whether to use a wide input box.').default(false),
    rows: z.number().describe('The number of rows to display in the input box.').default(4),
    placeholder: z.string().describe('The placeholder text to display in the input box.').optional(),
    tooltip: z.string().describe('The tooltip text to display in the input box.').optional(),
    ok: z.any().describe('The text of the "OK" button.').default('OK'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'An input box pops up, prompting the user to enter text.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    const safeValue = DOMPurify.sanitize(args.message || '');
    const defaultInput = args?.default !== undefined && typeof args?.default === 'string' ? args.default : '';
    const popupOptions = {
        large: args.large,
        wide: args.wide,
        okButton: args.ok,
        rows: args.rows,
        placeholder: args.placeholder ?? '',
        tooltip: args.tooltip ?? null,
    };

    const result = await callGenericPopup(safeValue, POPUP_TYPE.INPUT, defaultInput, popupOptions);

    return JSON.stringify({
        ok: result !== null && result !== false,
        value: result,
    });
}
