import { TemplateHandler } from "@/functions/template";
import { chat, chat_metadata } from "@st/script.js";
import { eventSource, event_types } from "@st/scripts/events.js";
import { world_info_depth } from "@st/scripts/world-info.js";
import { getActivatedEntries, DecoratorParser } from "@/functions/worldinfo";
import { DataOverride } from "@/utils/override";
import { Context } from "@/features/context";
import { generate } from "@/utils/retries"
import { WorldInfoEntry } from "@/utils/defines";


export interface DecoratorProcessData {
    entry: WorldInfoEntry;
    content: string;
    args: Record<string, any>;
    override: DataOverride;
    decorator: DecoratorParser;
}

type DecoratorProcessor = (e: DecoratorProcessData) => (boolean | Promise<boolean>);

export const WI_DECORATOR_MAPPING = new Map<string, DecoratorProcessor>();

export async function setup() {
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
}

async function onGenerationEnded() {
    const messages = chat.slice(-world_info_depth);
    const override = new DataOverride(chat, chat_metadata);
    await processMessage(messages, override);
}

async function processMessage(messages: ChatMessage[], override: DataOverride) {
    const entries = await getActivatedEntries(messages.map(msg => msg.mes ?? ''));
    if(entries.length < 1)
        return;

    const cache = new Map<string, TemplateHandler>();
    for(const entry of entries) {
        const parsed = new DecoratorParser(entry);
        for(const [idx, decorator] of Object.entries(parsed.decorators)) {
            const processor = WI_DECORATOR_MAPPING.get(decorator);
            if(!processor)
                continue;

            const tag = parsed.arguments[Number(idx)] ?? '';
            const cacheKey = `${decorator}:${tag}`;
            let template: TemplateHandler = cache.get(cacheKey)!;
            if(template === undefined) {
                template = TemplateHandler.find(decorator, tag)!;
                cache.set(cacheKey, template);
            }
            if(template === null)
                continue;

            const messageContent = messages.findLast(msg => !msg.is_system && !msg.is_user)?.mes ?? messages[messages.length - 1]?.mes ?? '';
            const testing = template.test(messageContent);
            if(!testing.success)
                continue;

            const ctx = new Context(await template.buildChatHistory('normal'), chat_metadata);
            ctx.macroOverride.original = parsed.cleanContent;
            ctx.macroOverride.macros = {
                '{{lastUserMessage}}': () => messages.findLast(msg => msg.is_user)?.mes ?? '',
                '{{lastCharMessage}}': () => messages.findLast(msg => !msg.is_user && !msg.is_system)?.mes ?? '',
                '{{message}}': testing.content ?? '',
                '{{original}}': parsed.cleanContent,
                '{{current}}': () => override.getOverride(entry.world, entry.uid)?.content ?? parsed.cleanContent,
            };
            
            generate(ctx, 3, decorator, { validator: async(response) => {
                response = Array.isArray(response) ? response : [ response ];

                for(const content of response) {
                    const processed = template.process(content);
                    if(processed.success) {
                        if (await processor({
                            entry,
                            content: processed.content ?? content,
                            args: processed.arguments ?? {},
                            override,
                            decorator: parsed,
                        })) {
                            return true;
                        }
                    }
                }

                console.error(`Failed to process: `, response, template, entry);
                return false;
            }, dontCreate: true });
        }
    }
}
