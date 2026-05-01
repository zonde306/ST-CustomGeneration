import { z } from 'zod';
import { Popup, POPUP_TYPE, POPUP_RESULT } from "@st/scripts/popup.js";
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { DOMPurify } from '@st/lib.js';

const STRING_ARRAY = z.preprocess(
v => {
    if(v && typeof v === 'object')
        return Object.values(v);
    return v;
},
z.array(z.string())
);

/**
* Display a popup menu with custom options for the user to choose from.
*
* When `multiple` is false (default): the user clicks one option and the popup closes immediately.
*   The selected value is returned as a single string. If the user dismisses the popup, `ok` is false.
*
* When `multiple` is true: the user can toggle one or more options, then confirm with the OK button.
*   The selected values are returned as a string array.
*
* Returns a JSON object: { ok: boolean, selected: string | string[] | null }
*/
const TOOL_NAME = 'buttons';
const SCHEMA = z.object({
message: z.string().describe('The message to display in the popup dialog. Supports HTML and inline CSS for formatting.'),
options: STRING_ARRAY.describe('A list of option labels (strings) to present to the user. Each label becomes a clickable button.'),
multiple: z.coerce.boolean().describe('Set to true to allow the user to select multiple options before confirming. When false (or omitted), clicking any option immediately selects it and closes the popup.').default(false).optional(),
ok: z.string().describe('Label for the confirm/OK button. Only used when `multiple` is true.').default('OK').optional(),
cancel: z.string().describe('Label for the dismiss/cancel button. When `multiple` is false, this button cancels the selection; when `multiple` is true, it is shown as the confirmation button.').default('Cancel').optional(),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Display a popup menu with custom options for the user to select one or more items. Use this when you need the user to choose from a list of choices.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    const buttons = args.options.map(btn => typeof btn === 'string' ? { text: btn } : btn);
    const resultToButtonMap = new Map(buttons.map((button, index) => [index + 2, button]));
    const multipleToggledState = new Set<number>();

    const buttonContainer = document.createElement('div');
    buttonContainer.classList.add('flex-container', 'flexFlowColumn', 'wide100p');

    const scrollableContainer = document.createElement('div');
    scrollableContainer.classList.add('scrollable-buttons-container');

    for (const [result, button] of resultToButtonMap) {
        const buttonElement = document.createElement('div');
        buttonElement.classList.add('menu_button', 'wide100p');

        if (args.multiple) {
            buttonElement.classList.add('toggleable');
            buttonElement.dataset.toggleValue = String(result);
            buttonElement.addEventListener('click', async () => {
                buttonElement.classList.toggle('toggled');
                if (buttonElement.classList.contains('toggled')) {
                    multipleToggledState.add(result);
                } else {
                    multipleToggledState.delete(result);
                }
            });
        } else {
            buttonElement.classList.add('result-control');
            buttonElement.dataset.result = String(result);
        }

        buttonElement.innerText = button.text;
        buttonContainer.appendChild(buttonElement);
    }

    scrollableContainer.appendChild(buttonContainer);

    const popupContainer = document.createElement('div');
    popupContainer.innerHTML = DOMPurify.sanitize(args.message);
    popupContainer.appendChild(scrollableContainer);

    // Ensure the popup uses flex layout
    popupContainer.style.display = 'flex';
    popupContainer.style.flexDirection = 'column';
    popupContainer.style.maxHeight = '80vh'; // Limit the overall height of the popup

    const popup = new Popup(
        popupContainer,
        POPUP_TYPE.TEXT,
        '',
        {
            okButton: args.multiple ? (args.ok ?? 'OK') : (args.cancel ?? 'Cancel'),
            allowVerticalScrolling: true
        }
    );
    const result = (await popup.show()) as number;

    let selected : null | string | string[] = null;
    if(args.multiple) {
        if(result === POPUP_RESULT.AFFIRMATIVE)
            selected = Array.from(multipleToggledState).map(r => resultToButtonMap.get(r)?.text ?? '').filter(x => !!x);
    } else {
        selected = resultToButtonMap.get(result)?.text ?? null;
    }

    return JSON.stringify({
        ok: selected != null,
        selected
    });
}
