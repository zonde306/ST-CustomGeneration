import { setupSettings } from "./settings";
import { Context } from "./features/context";
import { PromptContext } from "./functions/prompt-context";
import { MessageBuilder } from "./functions/message-builder";
import { setup as setupRecords } from "./features/records";
import { setup as setupEmbedCard } from "./embed-card";
import { eventTypes } from "./utils/events";

// jQuery
$(async () => {
    await setupSettings();
    await setupRecords();
    await setupEmbedCard();

    // @ts-expect-error: 7017
    globalThis.CustomGeneration = {
        Context,
        PromptContext,
        MessageBuilder,
        get globalContext() {
            return Context.global();
        },
        async buildMessages(chat: ChatMessage[], type: string = 'normal', dryRun: boolean = false) {
            return await new MessageBuilder(chat).buildFully(type, {}, dryRun);
        },
        eventTypes,
    };
    
    console.log('Custom generation initialized');
});
