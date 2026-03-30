import { setupSettings } from "@/settings";
import { Context } from "@/features/context";
import { PromptContext } from "@/functions/prompt-context";
import { MessageBuilder } from "@/functions/message-builder";
import { setup as setupEmbedCard } from "@/embed-card";
import { eventTypes } from "@/utils/events";
import { setup as setupAfterGenerate } from "@/features/generate-processor";
import { setup as setupReplace } from "@/features/after-generates/replace";
import { setup as setupOverrides } from "@/features/override";
import { setup as setupLogger } from "@/features/generate-logger";
import { runAfterGenerates } from "@/features/generate-processor";

// jQuery
$(async () => {
    await setupSettings();
    await setupEmbedCard();
    await setupAfterGenerate();
    await setupReplace();
    await setupOverrides();
    await setupLogger();

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
        runAfterGenerates,
    };
    
    console.log('Custom generation initialized');
});
