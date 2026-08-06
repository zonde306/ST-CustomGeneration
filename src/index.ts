import { setupSettings } from "@/settings";
import { Context } from "@/features/context";
import { PromptContext } from "@/functions/prompt-context";
import { MessageBuilder } from "@/functions/message-builder";
import { setup as setupEmbedCard } from "@/embed-card";
import { eventTypes } from "@/utils/events";
import { setup as setupTriggers, runAfterTriggers, isGenerating } from "@/features/trigger-manager";
import { setup as setupOverrides } from "@/features/worldinfo-rewrite";
import { setup as setupFileSystem } from "@/features/filesystem-manager";
import { ChatDataStore } from "@/functions/chat-data-store";
import { setup as setupGlobalContext, GlobalContext } from "@/features/global-context";
import { setup as setupInterceptor } from "@/features/interceptor";
import { setup as setupLogger } from "@/features/generate-logger";
import { setup as setupTools } from "@/features/tool-manager";
import { setup as setupSchema } from "@/features/schema";
import { setup as setupWorkIndicator } from "@/features/work-indicator";

// jQuery
$(async () => {
    await setupSettings();
    setupGlobalContext();
    await setupInterceptor();
    await setupEmbedCard();
    await setupTriggers();
    await setupOverrides();
    await setupFileSystem();
    await setupLogger();
    await setupTools();
    await setupSchema();
    await setupWorkIndicator();

    // @ts-expect-error: Expose global APIs
    globalThis.CustomGeneration = {
        Context,
        GlobalContext,
        ChatDataStore,
        PromptContext,
        MessageBuilder,
        get globalContext() {
            return Context.global();
        },
        async buildMessages(chat: ChatMessage[], type: string = 'normal', dryRun: boolean = false) {
            return await new MessageBuilder(chat).buildFully(type, {}, dryRun);
        },
        eventTypes,
        runAfterTriggers,
        isTriggerGenerating: isGenerating,
    };
    
    console.log('Custom generation initialized');
});
