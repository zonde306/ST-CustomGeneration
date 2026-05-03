import { setupSettings } from "@/settings";
import { Context } from "@/features/context";
import { PromptContext } from "@/functions/prompt-context";
import { MessageBuilder } from "@/functions/message-builder";
import { setup as setupEmbedCard } from "@/embed-card";
import { eventTypes } from "@/utils/events";
import { setup as setupAgents, runAfterAgents, isGenerating } from "@/features/agent-manager";
import { setup as setupOverrides, DataOverride } from "@/features/override";
import { setup as setupLogger } from "@/features/generate-logger";
import { setup as setupTools } from "@/features/tool-manager";
import { setup as setupSchema } from "@/features/schema";
import { setup as setupAgentIndicator } from "@/features/agent-indicator";
import { search as testSearch } from "@/features/tools/worldinfo-search";

// jQuery
$(async () => {
    await setupSettings();
    await setupEmbedCard();
    await setupAgents();
    await setupOverrides();
    await setupLogger();
    await setupTools();
    await setupSchema();
    await setupAgentIndicator();

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
        runAfterAgents,
        isAgentGenerating: isGenerating,
        testSearch,
    };
    
    console.log('Custom generation initialized');
});
