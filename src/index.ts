import { setupSettings } from "./settings";
import { Context } from "./features/context";
import { PromptContext } from "./functions/prompt-context";
import { MessageBuilder } from "./functions/message-builder";

// jQuery
$(async () => {
    await setupSettings();

    // @ts-expect-error: 7017
    globalThis.CustomGeneration = {
        Context,
        PromptContext,
        MessageBuilder,
        get globalContext() {
            return Context.global();
        },
    };
    
    console.log('Custom generation initialized');
});
