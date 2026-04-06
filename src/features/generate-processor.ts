import { TemplateHandler } from "@/functions/template";
import { substituteParams, messageFormatting, appendMediaToMessage, addCopyToCodeBlocks, name2, saveChatDebounced, activateSendButtons, deactivateSendButtons } from "@st/script.js";
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
import { eventTypes } from "@/utils/events";
import { execute as batchExecute } from "@/utils/concurrency-limiter";
import { settings } from "@/settings";
import { callGenericPopup, POPUP_TYPE } from "@st/scripts/popup.js";

export interface DecoratorProcessData {
    entry: WorldInfoEntry;
    content: string;
    args: Record<string, any>;
    override: DataOverride;
    decorator: DecoratorParser;
    env: Context;
    messageId: number;
    swipeId: number;
    current: string;
}

interface DecoratorProcessor {
    // Check if processing is allowed.
    checker: (e: DecoratorProcessData) => (boolean | Promise<boolean> | string | Promise<string>);

    // Start processing content
    processor: (e: DecoratorProcessData) => (boolean | Promise<boolean>);
};

export const WI_DECORATOR_MAPPING = new Map<string, DecoratorProcessor>();
export const WI_DECORATOR_BEFORE_MAPPING = new Map<string, DecoratorProcessor>();

// Execute only; do not participate in generation.
export const NOT_ALLOWED_DECORATORS = [
    '@@variables_json',
    '@@variables_json_before',
    '@@variables_yaml',
    '@@variables_yaml_before',
    '@@variables_jsonpatch',
    '@@variables_jsonpatch_before',
    '@@evaluate_ejs',
    '@@evaluate_ejs_before',
    '@@append_output',
    '@@append_output_before',
    '@@append_output_ejs',
    '@@append_output_ejs_before',
];

let isPostGenerating = false;
let abortController: AbortController | null = null;
let isPreventGeenration = false;

export async function setup() {
    eventSource.makeLast(event_types.APP_READY, onAppReady);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, onGenerateStarting);
    eventSource.on(event_types.CHAT_CHANGED, stopActiveTasks);
    eventSource.on(event_types.MESSAGE_SWIPED, stopActiveTasks.bind(null, true));
    eventSource.on(event_types.MESSAGE_SWIPE_DELETED, stopActiveTasks);
    eventSource.on(event_types.MESSAGE_DELETED, stopActiveTasks);
    eventSource.on(eventTypes.GENERATE_AFTER, onGenerateAfter);

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
    if(isPreventGeenration) {
        isPreventGeenration = false;
        return;
    }

    const env = Context.global();
    if(env.chat[env.chat.length - 1]?.is_user) {
        console.log(`Skipping after-generate for generate failed`);
        return;
    }

    const override = new DataOverride(env.chat, env.chat_metadata);

    // Runs in the background, no waiting required.
    processMessage(env, override, false);
}

async function processMessage(env: Context, override: DataOverride, before: boolean = false) {
    if(abortController?.signal?.aborted === false) {
        abortController?.abort();
        toastr.warning(`Aborting previous ${before ? 'before' : 'after'}-generate`);
        await eventSource.emit(eventTypes.GENERATION_WORLDINFO_END, { type: '', reason: 'regenerate' });
    }

    const messageId = before ? env.lastUserMessage?.id : env.lastCharMessage?.id;
    if(messageId == null) {
        console.warn(`Skipping ${before ? 'before' : 'after'}-generate for no message`);
        return;
    }

    const swipeId = env.chat[messageId]?.swipe_id ?? 0;

    // @ts-expect-error: 2339
    if(before && env.chat[messageId].swipe_info?.[swipeId]?.before_generated) {
        console.log(`Skipping before-generate for ${messageId}#${swipeId} because it's already generated`);
        return;
    }

    const messages = env.chat.slice(-world_info_depth);
    const groups = await getSortedEntries(
        messages.map(msg => msg.mes ?? ''),
        before,
        before ? 'cg-before' : 'cg-after',
        false
    );

    if(groups.length < 1)
        return;

    abortController = new AbortController();

    deactivateSendButtons();
    await eventSource.emit(eventTypes.GENERATION_WORLDINFO_START, { abortController, entries: groups });

    const cache = new Map<string, TemplateHandler>();

    for(const [ batch, entrites ] of Object.entries(groups)) {
        const tasks: (() => Promise<any>)[] = [];
        let activeTasks = 0;
        
        // It should be wrapped as a separate function, but that seems a bit difficult.
        for(const ent of entrites) {
            const { entry, decorator, parsed, processor } = ent;

            const tag = parsed.parameters[decorator]?.[0] ?? '';
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

            const messageContent = messages.filter(msg => !msg.is_system && !msg.is_user)?.map(msg => msg.mes ?? '').join('\n\n');
            const testing = template.test(messageContent);
            if(!testing.success) {
                console.warn(`Failed to test message for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`);
                toastr.warning(`Failed to test message for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`, `${before ? 'Before' : 'After'} Generate`);
                continue;
            }

            let current = substituteParams(override.getOverride(entry.world, entry.uid)?.content ?? parsed.cleanContent);
            const ctx = new Context(await template.buildChatHistory(env.chat), env.chat_metadata);
            ctx.macroOverride.original = parsed.cleanContent;
            ctx.macroOverride.macros = {
                'lastUserMessage': () => substituteParams(messages.findLast(msg => msg.is_user)?.mes ?? ''),
                'lastCharMessage': () => substituteParams(messages.findLast(msg => !msg.is_user && !msg.is_system)?.mes ?? ''),
                'message': substituteParams(testing.content ?? ''),
                'original': substituteParams(parsed.cleanContent),
                'current': () => current,
                'lastError': '',
                ...testing.arguments ?? {},
            };

            // Reduce Attention Depletion
            ctx.filters = template.filters;

            try {
                const checked = await processor.checker({
                    entry,
                    content: testing.content || parsed.cleanContent,
                    args: testing.arguments ?? {},
                    override,
                    decorator: parsed,
                    env,
                    messageId,
                    swipeId,
                    current,
                });

                if(!checked) {
                    console.info(`The inspection failed for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`);
                    continue;
                }

                // If the checker returns a string, it means that the checker has changed the current content.
                if(typeof checked === 'string')
                    current = checked;
            } catch (e) {
                console.error(`An error occurred during the check for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`, e);
                toastr.error(`An error occurred during the check for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}`, `${before ? 'Before' : 'After'} Generate`);
                continue;
            }
            
            // A concurrency limiter should be added to it.
            tasks.push(() => {
                console.log(`After Generate: ${entry.world}/${entry.uid}-${entry.comment} - ${decorator}`);
                return generate(
                    ctx,
                    decorator,
                    {
                        validator: async(response) => {
                            response = Array.isArray(response) ? response : [ response ];

                            for(const content of response) {
                                const processed = template.process(content);
                                if(processed.success) {
                                    if (await processor.processor({
                                        entry,
                                        content: processed.content ?? content,
                                        args: processed.arguments ?? {},
                                        override,
                                        decorator: parsed,
                                        env,
                                        messageId,
                                        swipeId,
                                        current,
                                    })) {
                                        return true;
                                    }
                                }
                            }

                            // retry
                            return false;
                        },
                        dontCreate: true,
                        abortController: abortController ?? undefined,
                    },
                    false,
                    template.retries,
                    template.interval,
                ).catch((e: Error) => {
                    if(abortController?.signal.aborted === false) {
                        activeTasks -= 1;
                        if(!e.message.includes('canceled')) {
                            toastr.error(`Failed to generate content for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment} ${e.message}`, `${before ? 'Before' : 'After'} Generate`);
                            console.error(`Failed to generate content for ${decorator} at ${entry.world}/${entry.uid}-${entry.comment} ${e.message}, ${activeTasks} tasks remaining`, e);
                        }
                    }
                }).then(r => {
                    if(abortController?.signal.aborted === false) {
                        activeTasks -= 1;
                        console.log(`Task completed: ${decorator} at ${entry.world}/${entry.uid}-${entry.comment}, ${activeTasks} tasks remaining`);
                    }
                    return r;
                });
            });
        }

        // Waiting for batch completion
        let collected = batchExecute(tasks, settings.maxConcurrency);

        if(tasks.length) {
            collected = collected.then(async(results) => {
                if(abortController?.signal.aborted === false) {
                    toastr.success(`All generate tasks ended`, `${before ? 'Before' : 'After'} Generate`);
                    refreshMessage(messageId);
                }
                abortController = null;
                activeTasks = 0;

                return results;
            });

            toastr.info(`Batch ${Number(batch) + 1}/${_.size(groups)} batch, ${tasks.length} tasks`, `${before ? 'Before' : 'After'} Generate`);
        } else {
            console.log(`No ${before ? 'before' : 'after'} generate tasks found`);
        }

        console.log(`Waiting for the ${Number(batch) + 1} batch of ${before ? 'before' : 'after'} generate tasks to complete`, tasks.length);
        await collected;
        activeTasks = 0;
    }

    await eventSource.emit(eventTypes.GENERATION_WORLDINFO_END, { type: before ? 'before' : 'after', reason: 'done' });

    if(before) {
        if(!env.chat[messageId].swipe_info)
            env.chat[messageId].swipe_info = [];
        if(!env.chat[messageId].swipe_info[swipeId])
            env.chat[messageId].swipe_info[swipeId] = {};

        // @ts-expect-error: This is a hack to prevent the message from regenerated.
        env.chat[messageId].swipe_info[swipeId].before_generated = true;
    }

    // It triggers the `GENERATION_ENDED` event, setting a flag to prevent infinite loops.
    isPreventGeenration = true;
    activateSendButtons();
    isPreventGeenration = false;
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

    $("#mes_stop").off("click", onGenerateCancelled).on("click", onGenerateCancelled);
    
    const viewer = document.evaluate("//div[@id='extensionsMenu']//*[text()='提示词查看器']/..", document)?.iterateNext();
    if(viewer) {
        $(viewer).off("click", onGenerateCancelled).on("click", onGenerateCancelled);
    }
}

async function onWorldInfoLoaded(data: WorldInfoLoaded) {
    if(isPostGenerating) {
        console.debug('Skip WI entry filtering when performing custom WI processing');
        return;
    }

    for(let i = data.globalLore.length - 1; i  >= 0; --i) {
        const entry = data.globalLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
            data.globalLore.splice(i, 1);
            console.debug(`remove global lore ${entry.world}/${entry.uid}-${entry.comment} used for after/before-generate`);
        }
    }
    for(let i = 0; i < data.personaLore.length; ++i) {
        const entry = data.personaLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
            data.personaLore.splice(i, 1);
            console.debug(`remove persona lore ${entry.world}/${entry.uid}-${entry.comment} used for after/before-generate`);
        }
    }
    for(let i = 0; i < data.characterLore.length; ++i) {
        const entry = data.characterLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
            data.characterLore.splice(i, 1);
            console.debug(`remove character lore ${entry.world}/${entry.uid}-${entry.comment} used for after/before-generate`);
        }
    }
    for(let i = 0; i < data.chatLore.length; ++i) {
        const entry = data.chatLore[i];
        const parsed = new DecoratorParser(entry);
        if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
            data.chatLore.splice(i, 1);
            console.debug(`remove chat lore ${entry.world}/${entry.uid}-${entry.comment} used for after/before-generate`);
        }
    }
    
}

async function onGenerateStarting(type: string, options: any, dryRun: boolean) {
    if((type === 'normal' || type === 'regenerate' || type === 'swipe') && !dryRun) {
        await stopActiveTasks(type != 'regenerate');
        abortController = null; // Abandon managing interrupt handlers
        
        const env = options.context ?? Context.global();
        const override = new DataOverride(env.chat, env.chat_metadata);
        await processMessage(env, override, true);
    }
}

async function stopActiveTasks(ask: boolean = false) {
    if(abortController?.signal.aborted === false) {
        if(ask && !(await askForInterruption()))
            return;

        abortController.abort('canceled by new generate');
        toastr.warning('Aborting after/before generate', 'after/before Generate');
        abortController = null;

        await eventSource.emit(eventTypes.GENERATION_WORLDINFO_END, { type: '', reason: 'canceled' });
        activateSendButtons();
    }
}

async function refreshMessage(messageId: number) {
    const div = $(`[mesid=${messageId}]`);
    if(!div?.length || !div?.find(".mes_text")?.length)
        return;

    // If the message is being edited, don't refresh
    if(div?.find("#curEditTextarea")?.length)
        return;

    const message = Context.global().chat[messageId];
    if(!message?.mes)
        return;

    div.find(".mes_text").empty().append(messageFormatting(
        message.mes ?? '',
        message.name ?? name2,
        message.is_system ?? false,
        message.is_user ?? false,
        messageId,
        {},
        false,
    ));
    appendMediaToMessage(message, div);
    addCopyToCodeBlocks(div);

    await eventSource.emit(event_types.MESSAGE_UPDATED, messageId);
    saveChatDebounced();
}

async function onGenerateAfter(data: { type: string, context: Context, error: Error | null }) {
    if((data.type === 'normal' || data.type === 'regenerate' || data.type === 'swipe') && !data.error && !data.context.isGlobal) {
        if(data.context.chat[data.context.chat.length - 1]?.is_user) {
            console.log('Skip after generate for generate failed');
            return;
        }

        const override = new DataOverride(data.context.chat, data.context.chat_metadata);

        // Runs in the background, no waiting required.
        processMessage(data.context, override, false);
    }
}

function onGenerateCancelled() {
    isPreventGeenration = true;
    stopActiveTasks();
}

export function isGenerating(): boolean {
    return abortController?.signal.aborted === false;
}

interface WorldInfoEntryWithDecorator {
    entry: WorldInfoEntry;
    decorator: string;
    parsed: DecoratorParser;
    processor: DecoratorProcessor;
}

async function getSortedEntries(
    triggerWords: string[],
    before: boolean = false,
    type?: string,
    dryRun?: boolean,
): Promise<WorldInfoEntryWithDecorator[][]> {
    // To avoid WI entries being filtered by the WI filter, we need to disable the WI filter.
    isPostGenerating = true;
    const entries = await getActivatedEntries(triggerWords, type, dryRun);
    isPostGenerating = false;

    const grouped = new Map<number, WorldInfoEntryWithDecorator[]>();

    for(const entry of entries) {
        const parsed = new DecoratorParser(entry);
        for(const decorator of parsed.decorators) {
            const processor = before ? WI_DECORATOR_BEFORE_MAPPING.get(decorator) : WI_DECORATOR_MAPPING.get(decorator);
            if(!processor)
                continue;

            let position = 1;
            if(parsed.decorators.includes('@@batch_order')) {
                const order = parsed.parameters['@@batch_order']?.[0] || 'medium';
                switch(order) {
                    case 'top':
                        position = 0;
                        break;
                    case 'medium':
                        position = 1;
                        break;
                    case 'bottom':
                        position = 2;
                        break;
                    default:
                        const num = parseInt(order);
                        position = Number.isNaN(num) ? 1 : num;
                        break;
                }
            }

            const group = grouped.get(position) ?? [];
            group.push({ entry, decorator, parsed, processor });
            grouped.set(position, group);
        }
    }

    const sorted = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
    return sorted.map(g => g[1]);
}

async function askForInterruption() {
    const html = `
        <h3>Currently generating in the background.</h3>
        <h3>Would you want to interrupt it?</h3>
        <div class="m-b-1">If you want to rerun the process, you can use "<i class="fa-solid fa-magic-wand-sparkles"></i>Run After Generate" to perform a background generation.</div>
    `;
    return await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: 'Yes', cancelButton: 'No' });
}

async function onMessageReceived(messageId: number, type: string) {
    if(messageId > 0 && (type === 'normal' || type === 'regenerate' || type === 'swipe')) {
        await runAfterGenerates();
    }
}
