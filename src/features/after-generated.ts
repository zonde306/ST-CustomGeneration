import { TemplateHandler } from "@/functions/template";
import { substituteParams } from "@st/script.js";
import { eventSource, event_types } from "@st/scripts/events.js";
import { world_info_depth } from "@st/scripts/world-info.js";
import { getActivatedEntries, DecoratorParser } from "@/functions/worldinfo";
import { DataOverride } from "@/features/override";
import { Context } from "@/features/context";
import { generate } from "@/utils/retries"
import { WorldInfoEntry, WorldInfoLoaded } from "@/utils/defines";
import { setup as setupReplace } from "@/features/after-generates/replace"
import { setup as setupReplaceDiff } from "@/features/after-generates/replace-diff";
import { setup as setupVarJson } from "@/features/after-generates/variable-json";
import { setup as setupVarYaml } from "@/features/after-generates/variable-yaml";
import { setup as setupVarJsonPatch } from "@/features/after-generates/variable-json-patch";
import { setup as setupEjsEvaluate } from "@/features/after-generates/ejs-evaluate";
import { setup as setupReplaceEjs } from "@/features/after-generates/ejs-replace";
import { setup as setupReplaceSearch } from "@/features/after-generates/replace-search";
import { setup as setupAppendMessage } from "@/features/after-generates/append-message";
import { setup as setupAppendEjs } from "@/features/after-generates/ejs-append";

export interface DecoratorProcessData {
    entry: WorldInfoEntry;
    content: string;
    args: Record<string, any>;
    override: DataOverride;
    decorator: DecoratorParser;
    env: Context;
}

type DecoratorProcessor = (e: DecoratorProcessData) => (boolean | Promise<boolean>);

export const WI_DECORATOR_MAPPING = new Map<string, DecoratorProcessor>();

let isPostGenerating = false;
let abortController: AbortController | null = null;
let activeTasks = 0;

export async function setup() {
    eventSource.makeLast(event_types.APP_READY, onAppReady);
    eventSource.on(event_types.GENERATION_ENDED, runAfterGenerates);
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onGenerateStarting);

    await setupReplace();
    await setupReplaceDiff();
    await setupVarJson();
    await setupVarYaml();
    await setupVarJsonPatch();
    await setupEjsEvaluate();
    await setupReplaceEjs();
    await setupReplaceSearch();
    await setupAppendMessage();
    await setupAppendEjs();
}

export async function runAfterGenerates() {
    const env = Context.global();
    const override = new DataOverride(env.chat, env.chat_metadata);
    await processMessage(env, override);
}

async function processMessage(env: Context, override: DataOverride) {
    const messages = env.chat.slice(-world_info_depth);

    isPostGenerating = true;
    const entries = await getActivatedEntries(messages.map(msg => msg.mes ?? ''));
    isPostGenerating = false;

    if(entries.length < 1)
        return;

    if(activeTasks > 0 && !abortController?.signal?.aborted) {
        abortController?.abort();
        activeTasks = 0;
        toastr.warning(`Aborting previous after-generate`);
    }

    abortController = new AbortController();
    toastr.info(`Running after-generate`);

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
            if(template === null) {
                console.error(`Failed to find template for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`);
                continue;
            }

            const messageContent = messages.findLast(msg => !msg.is_system && !msg.is_user)?.mes ?? messages[messages.length - 1]?.mes ?? '';
            const testing = template.test(messageContent);
            if(!testing.success) {
                console.warn(`Failed to test message for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`);
                toastr.warning(`Failed to test message for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`, 'After Generate');
                continue;
            }

            const ctx = new Context(await template.buildChatHistory(), env.chat_metadata);
            ctx.macroOverride.original = parsed.cleanContent;
            ctx.macroOverride.macros = {
                'lastUserMessage': () => substituteParams(messages.findLast(msg => msg.is_user)?.mes ?? ''),
                'lastCharMessage': () => substituteParams(messages.findLast(msg => !msg.is_user && !msg.is_system)?.mes ?? ''),
                'message': substituteParams(testing.content ?? ''),
                'original': substituteParams(parsed.cleanContent),
                'current': () => substituteParams(override.getOverride(entry.world, entry.uid)?.content ?? parsed.cleanContent),
            };

            // Reduce Attention Depletion
            ctx.filters = template.filters;
            
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
                            env,
                        })) {
                            return true;
                        }
                    }
                }

                console.warn(`Unknown error: `, response, template, entry);
                return false;
            }, dontCreate: true, abortController }).catch(e => {
                activeTasks -= 1;
                toastr.error(`Failed to generate content for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment} ${e.message}`, 'After Generate');
                if(activeTasks <= 0) {
                    toastr.info('All after generate tasks ended', 'After Generate');
                }
            }).then(() => {
                activeTasks -= 1;
                if(activeTasks <= 0) {
                    toastr.info('All after generate tasks ended', 'After Generate');
                }
            });
            activeTasks += 1;

            console.log(`After Generate: ${entry.world}/${entry.uid}-${entry.comment} - ${decorator}`);
        }
    }
}

async function onAppReady() {
    if (!$('#extensionsMenu')?.find('custom_generation_after_generate_button')?.length) {
        $('#extensionsMenu').append(`
            <div id="custom_generation_after_generate_button" class="extension_container interactable" tabindex="0">
                <div id="customGenerateAfter" class="list-group-item flex-container flexGap5 interactable" title="Run After Generate" tabindex="0" role="listitem">
                    <div class="fa-fw fa-solid fa-exchange extensionsMenuExtensionButton"></div>
                    <span data-i18n="Run After Generate">Run After Generate</span>
                </div>
            </div>
        `);

        $('#customGenerateAfter').on('click', () => {
            runAfterGenerates();
            toastr.info('After Generate Starting');
        });
    }
}

async function onWorldInfoLoaded(data: WorldInfoLoaded) {
    if(isPostGenerating) {
        console.debug('ignore world info filter event during post generate');
        return;
    }

    for(let i = data.globalLore.length - 1; i  >= 0; --i) {
        const entry = data.globalLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => WI_DECORATOR_MAPPING.has(d))) {
            data.globalLore.splice(i, 1);
            console.debug(`remove global lore ${entry.world}/${entry.uid}-${entry.comment} used for after-generate`);
        }
    }
    for(let i = 0; i < data.personaLore.length; ++i) {
        const entry = data.personaLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => WI_DECORATOR_MAPPING.has(d))) {
            data.personaLore.splice(i, 1);
            console.debug(`remove persona lore ${entry.world}/${entry.uid}-${entry.comment} used for after-generate`);
        }
    }
    for(let i = 0; i < data.characterLore.length; ++i) {
        const entry = data.characterLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => WI_DECORATOR_MAPPING.has(d))) {
            data.characterLore.splice(i, 1);
            console.debug(`remove character lore ${entry.world}/${entry.uid}-${entry.comment} used for after-generate`);
        }
    }
    for(let i = 0; i < data.chatLore.length; ++i) {
        const entry = data.chatLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => WI_DECORATOR_MAPPING.has(d))) {
            data.chatLore.splice(i, 1);
            console.debug(`remove chat lore ${entry.world}/${entry.uid}-${entry.comment} used for after-generate`);
        }
    }
    
}

async function onGenerateStarting(type: string, _options: any, dryRun: boolean) {
    if((type === 'normal' || type === 'regenerate' || type === 'swipe') && !dryRun) {
        if(abortController && activeTasks > 0) {
            abortController.abort('generating');
            activeTasks = 0;
            toastr.warning('Aborting after generate', 'After Generate');
        }
    }
}
