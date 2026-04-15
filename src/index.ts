import { setupSettings } from "@/settings";
import { Context } from "@/features/context";
import { PromptContext } from "@/functions/prompt-context";
import { MessageBuilder } from "@/functions/message-builder";
import { setup as setupEmbedCard } from "@/embed-card";
import { eventTypes } from "@/utils/events";
import { setup as setupGenerates, runAfterGenerates, isGenerating } from "@/features/generate-processor";
import { setup as setupOverrides, DataOverride } from "@/features/override";
import { setup as setupLogger } from "@/features/generate-logger";
import { setup as setupTools } from "@/features/tool-manager";

// jQuery
$(async () => {
    await setupSettings();
    await setupEmbedCard();
    await setupGenerates();
    await setupOverrides();
    await setupLogger();
    await setupTools();

    // @ts-expect-error: 7017
    globalThis.CustomGeneration = {
        Context,
        DataOverride,
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
        isWorldInfoGenerating: isGenerating,
    };
    
    console.log('Custom generation initialized');
});
