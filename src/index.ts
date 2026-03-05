import { setupSettings } from "./settings";
import { Context } from "./features/context";

// jQuery
$(async () => {
    await setupSettings();

    // @ts-expect-error: 7017
    globalThis.CustomGeneration = {
        Context,
    };
    
    console.log('Custom generation initialized');
});
