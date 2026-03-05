import { setupSettings } from "./settings";
import { Context } from "./features/context";
import { PromptBuilder } from "./functions/prompts";

// jQuery
$(async () => {
    await setupSettings();

    // @ts-expect-error: 7017
    globalThis.CustomGeneration = {
        Context,
        PromptBuilder,
    };
    
    console.log('Custom generation initialized');
});
