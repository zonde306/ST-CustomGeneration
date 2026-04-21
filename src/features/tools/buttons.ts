import { z } from 'zod';
import { Popup, POPUP_TYPE, POPUP_RESULT } from "@st/scripts/popup.js";
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { DOMPurify } from '@st/lib.js';

/**
 * Display a list of options for the user to choose from.
 */
const TOOL_NAME = 'buttons';
const SCHEMA = z.object({
    message: z.string().describe('Dialog messages allow the use of HTML and inline CSS code.'),
    buttons: z.array(z.string()).describe('The choices to be presented to the user.'),
    multiple: z.boolean().describe('Whether multiple choices can be selected.').default(false).optional(),
    ok: z.string().describe('If multiple is enabled, close the dialog box button text.').default('OK').optional(),
    cancel: z.string().describe('If multiple is not enabled, close the dialog box button text.').default('Cancel').optional(),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'A selection menu pops up, allowing the user to choose one or more items.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    const buttons = args.buttons.map(btn => typeof btn === 'string' ? { text: btn } : btn);
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
        ok: result === POPUP_RESULT.AFFIRMATIVE,
        selected
    });
}
