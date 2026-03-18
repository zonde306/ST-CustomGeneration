import { TemplateHandler } from "@/functions/template";
import { chat, chat_metadata } from "@st/script.js";
import { eventSource, event_types } from "@st/scripts/events.js";
import { world_info_depth } from "@st/scripts/world-info.js";
import { getActivatedEntries, DecoratorParser } from "@/functions/worldinfo";
import { DataOverride } from "@/features/override";
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
    eventSource.makeLast(event_types.APP_READY, onAppReady);
    eventSource.on(event_types.GENERATION_ENDED, runAfterGenerates);
}

async function runAfterGenerates() {
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

async function onAppReady() {
    if (!$('#extensionsMenu')?.find('custom_generation_after_generate_button')?.length) {
        $('#extensionsMenu').append(`
            <div id="custom_generation_after_generate_button" class="extension_container interactable" tabindex="0"><div id="manageAttachments" class="list-group-item flex-container flexGap5 interactable" title="Run After Generate" tabindex="0" role="listitem">
                <div class="fa-fw fa-solid fa-exchange extensionsMenuExtensionButton"></div>
                    <span data-i18n="Run After Generate">Run After Generate</span>
                </div>
            </div>
        `);

        $('#custom_generation_after_generate_button').on('click', () => {
            runAfterGenerates();
            toastr.info('After Generate Starting');
        });
    }
}
