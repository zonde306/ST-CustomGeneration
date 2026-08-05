import { eventSource, event_types } from '@st/scripts/events.js';
import {
    name1,
    unshallowCharacter,
    this_chid,
    chat_metadata,
    chat,
    deleteLastMessage,
    name2,
    substituteParams,
    refreshSwipeButtons,
    saveChatDebounced,
} from '@st/script.js';
import { settings } from '@/settings';
import { generate as runGenerate, ApiConfig, Response as GenResponse, StreamResponse as GenStreamResponse } from '@/functions/generate';
import { MessageBuilder, PromptFilter, MacroOverride } from '@/functions/message-builder';
import { ContextRole, PresetPrompt, ToolCalls, ToolDefinition } from '@/utils/defines'
import { runRegexScript, substitute_find_regex } from "@st/scripts/extensions/regex/engine.js";
import { eventTypes } from '@/utils/events';
import { Preset, ChatCompMessage } from '@/utils/defines';
import { defaultPreset } from '@/utils/default-settings';
import { AsyncMutex } from '@/utils/mutex';
import { getAvailableTools, getTool, Tool } from '@/features/tool-manager';
import { z } from 'zod';
import { yaml } from "@st/lib.js";
import { SkillScanner } from '@/features/skill-scanner';
import { getActivatedEntries, loadWorldInfoEntries } from '@/functions/worldinfo';
import { FileSystem } from '@/functions/filesystem';
import { createFileSystem } from '@/functions/fs-mounts';
import { clearStagedData, flushStagedData } from '@/functions/chat-data-store';
import { protect, restoreProtected } from '@/functions/protect';

const locker = new AsyncMutex();

type VariableData = Record<string, any>;
type ChatMessageEx = ChatMessage & { variables?: VariableData[], id?: number };
type ChatMetadataEx = ChatMetadata & { variables?: VariableData };

export interface GenerateOptionsLite {
    /**
     * Used to actively stop generation
     */
    abortController?: AbortController;

    /**
     * Used to actively stop generation
     */
    signal?: AbortSignal;

    /**
     * Do not create char messages after generation.
     */
    dontCreate?: boolean;

    /**
     * Return all responses, not just the first one.
     * When enabled, the return value is of type `string[]`.
     */
    allResponses?: boolean;

    /**
     * Override API connection configuration
     * otherwise, use the current preset values.
     */
    apiConfig?: Partial<ApiConfig>;

    /**
     * Generate using the specified preset;
     * otherwise, use the currently selected preset.
     */
    preset?: string;

    /**
     * When using streaming output, the return value will become an AsyncGenerator.
     */
    streaming?: boolean;

    toolChoice?: 'none' | 'auto' | 'required';

    /**
     * Placeholders have no function; do not modify them.
     */
    context?: Context;

    /**
     * Tool messages
     */
    toolMessages?: ChatCompMessage[];

    /**
     * Use the specified task ID, otherwise generate a random one.
     */
    taskId?: number | string;

    /**
     * Skip emitting GENERATION_STARTED / GENERATION_AFTER_COMMANDS.
     * Used when ST's native Generate() has already emitted them (interceptor takeover).
     */
    skipStartEvents?: boolean;

    /**
     * For `continue`: the last chat message is a real message, not a temporary
     * instruction appended by the caller, so don't remove it after generation.
     */
    noTempMessage?: boolean;
}

let taskIdCounter = 0;

/**
 * Factory used by `Context.global()`.
 * `GlobalContext` registers itself here so global contexts get full
 * ST rendering/persistence without `Context` depending on it.
 */
let globalContextFactory: (() => Context) | null = null;

export function registerGlobalContextFactory(factory: () => Context): void {
    globalContextFactory = factory;
}

export class Context {
    public chat: ChatMessageEx[];
    public chat_metadata: ChatMetadataEx;
    public isGlobal: boolean;
    public presetOverride?: string;
    public apiOverride: Partial<ApiConfig>;
    public macroOverride: MacroOverride;
    public filters: PromptFilter;
    public tools: Map<string, Tool>;
    public skillScanner: SkillScanner;
    /**
     * Trigger template prompts. When set, the builder expands them in place of
     * the preset's `chatHistory` slot instead of using the real chat history.
     */
    public historyPrompts: PresetPrompt[] | null;
    /** Trigger type used to match `historyPrompts` triggers, e.g. the template decorator. */
    public historyPromptsType: string | null;
    public files: FileSystem;

    constructor({ chat, chat_metadata }: { chat: ChatMessageEx[], chat_metadata: ChatMetadataEx }) {
        this.chat = chat;
        this.chat_metadata = chat_metadata;
        this.isGlobal = false;
        this.presetOverride = undefined;
        this.apiOverride = {};
        this.macroOverride = {};
        this.filters = {};
        this.tools = new Map();
        this.skillScanner = new SkillScanner();
        this.historyPrompts = null;
        this.historyPromptsType = null;

        // Mounts read `this` lazily, so the trees stay correct even though
        // `Context.global()` / `fromObject()` reassign `chat` afterwards.
        this.files = createFileSystem(this);
    }

    /**
     * Get the context of the current chat file
     * @returns Context
     */
    static global(): Context {
        if(globalContextFactory)
            return globalContextFactory();

        const ctx = new Context({ chat, chat_metadata });
        ctx.chat = chat;
        ctx.chat_metadata = chat_metadata;
        ctx.isGlobal = true;
        return ctx;
    }

    static fromObject(value: any): Context {
        const context = new Context({ chat: [], chat_metadata: {} });
        context.chat = value.chat ?? [];
        context.chat_metadata = value.chat_metadata ?? {};
        context.presetOverride = value.presetOverride;
        context.apiOverride = value.apiOverride ?? {};
        context.macroOverride = value.macroOverride ?? {};
        context.filters = value.filters ?? {};
        context.historyPrompts = value.historyPrompts ?? null;
        context.historyPromptsType = value.historyPromptsType ?? null;
        return context;
    }

    toObject(): any {
        if(this.isGlobal)
            console.warn('toObject called on global context');

        return {
            chat: this.chat,
            chat_metadata: this.chat_metadata,
            presetOverride: this.presetOverride,
            apiOverride: this.apiOverride,
            macroOverride: this.macroOverride,
            filters: this.filters,
            historyPrompts: this.historyPrompts,
            historyPromptsType: this.historyPromptsType,
        };
    }

    /**
     * Creating a message is generally used by user to send messages.
     * @param content Message content
     * @param role User or assistant
     * @param name Character Name
     */
    async send(content: string, role: ContextRole = 'user', name: string = name1) {
        const mes = this.applyRegex(content, {
            user: role === 'user',
            assistant: role === 'assistant',
            request: true,
            response: false,
        });

        this.chat.push({
            is_user: role === 'user',
            is_system: role === 'system',
            mes,
            send_date: new Date(),
            name,
            swipe_id: 0,
            swipes: [ mes ],
            swipe_info: [ { send_date: new Date(), extra: {}, } ],
            extra: {},
            variables: [{}]
        });

        await eventSource.emit(eventTypes.MESSAGE_SEND, { messageId: this.chat.length - 1, message: this.chat[this.chat.length - 1], context: this });
    }

    /**
     * Accept LLM responses to create a message
     * @param contents The response content can include multiple swipes.
     * @param swipe Attach via swipe, otherwise create a new message.
     * @param role The role is usually assistant.
     * @param name Names are generally character names.
     * @returns 
     */
    protected async recv(
        contents: string[],
        swipe: boolean = false,
        role: ContextRole = 'assistant',
        name: string = name2
    ): Promise<string[]> {
        if(contents.length < 1)
            return [];

        const swipes : string[] = [];
        const swipe_info: SwipeInfo[] = [];
        const variables: VariableData[] = [];

        for(const idx in contents) {
            const mes = this.applyRegex(contents[idx], {
                user: role === 'user',
                assistant: role === 'assistant',
                request: false,
                response: true,
            });

            swipes.push(mes);
            swipe_info.push({ send_date: new Date(), extra: {}, });
            variables.push({});
        }

        // Operate on the real chat entry; `this.lastMessage` returns a copy.
        const last = this.chat[this.chat.length - 1];
        if(swipe && last) {
            // First index of the newly appended swipes
            const newSwipeId = last.swipes?.length ?? 1;

            if(last.swipes)
                last.swipes = last.swipes.concat(swipes);
            else
                last.swipes = [ last.mes ?? '' ].concat(swipes);
            last.mes = swipes[0];
            last.swipe_id = newSwipeId;

            if(last.swipe_info)
                last.swipe_info = last.swipe_info.concat(swipe_info);
            else
                last.swipe_info = ([ { send_date: new Date(), extra: {}, } ] as SwipeInfo[]).concat(swipe_info);

            if(last.variables)
                last.variables = last.variables.concat(variables);
            else
                last.variables = [ {} ].concat(variables);
        } else {
            this.chat.push({
                is_user: role === 'user',
                is_system: role === 'system',
                mes: swipes[0],
                send_date: new Date(),
                name,
                swipes,
                swipe_info,
                variables,
                extra: {},
            });
        }

        // The message this turn wrote its files "into" now exists: move the
        // staged layer onto it so rerolling the message also rolls the files back.
        this.commitStagedData();

        await eventSource.emit(eventTypes.MESSAGE_RECEIVED, { messageId: this.chat.length - 1, message: this.chat[this.chat.length - 1], context: this });
        return swipes;
    }

    /**
     * Move data staged during generation onto the message/swipe that was just
     * created. Writes cannot target that layer directly because it does not
     * exist yet while the tools run.
     */
    protected commitStagedData(): void {
        const messageId = this.chat.length - 1;
        const swipeId = this.chat[messageId]?.swipe_id ?? 0;
        const flushed = flushStagedData(this, messageId, swipeId);
        if (!flushed)
            return;

        console.debug(`[CG] flushed ${flushed} staged entries to ${messageId}#${swipeId}`);
        if (this.isGlobal)
            saveChatDebounced();
    }

    /**
     * Append a continuation to the last message.
     * `GlobalContext` overrides this to also update the DOM and persist.
     */
    protected async applyContinuation(swipes: string[]): Promise<void> {
        const last = this.chat[this.chat.length - 1];
        if(!last || !swipes[0])
            return;

        if(last.mes)
            last.mes += swipes[0];

        const swipeId = last.swipe_id ?? 0;
        if(last.swipes && last.swipes[swipeId] != null)
            last.swipes[swipeId] += swipes[0];

        this.commitStagedData();
    }

    /**
     * Post-generation hook. `GlobalContext` overrides this to restore
     * ST UI state in addition to emitting GENERATION_ENDED.
     */
    protected async onGenerationEnded(type: string): Promise<void> {
        if(this.isGlobal) {
            // Since there's no need to manage the generate button, just send it directly.
            await eventSource.emit(event_types.GENERATION_ENDED, this.chat.length, type);
        }
    }

    /**
     * Latest message
     */
    get lastMessage(): ChatMessageEx & { id: number } | undefined {
        const id = this.chat.length - 1;
        return Object.assign({}, this.chat[id], { id });
    }

    /**
     * Latest user message
     */
    get lastUserMessage(): ChatMessageEx & { id: number } | undefined {
        const id = this.chat.findLastIndex(mes => mes.is_user);
        return Object.assign({}, this.chat[id], { id });
    }

    /**
     * Latest character message
     */
    get lastCharMessage(): ChatMessageEx & { id: number } | undefined {
        const id = this.chat.findLastIndex(mes => !mes.is_user);
        return Object.assign({}, this.chat[id], { id });
    }

    /**
     * message variables
     */
    get variables(): VariableData {
        const last = this.lastMessage;
        if(last == null)
            return {};

        if(last.variables == null)
            last.variables = [];
        if(!((last.swipe_id ?? 0) in last.variables))
            last.variables[last.swipe_id ?? 0] = {};

        return last?.variables?.[last.swipe_id ?? 0] ?? {};
    }

    /**
     * chat file variables (local variables)
     */
    get localVariables(): VariableData {
        if(this.chat_metadata.variables == null)
            this.chat_metadata.variables = {};
        return this.chat_metadata.variables ?? {};
    }

    /**
     * Current preset data
     */
    get currentPreset(): Preset {
        let preset = settings.presets[settings.currentPreset] ?? defaultPreset;
        if(typeof this.presetOverride === 'string')
            preset = settings.presets[this.presetOverride] ?? preset;
        return preset;
    }

    getCurrentApi(presetName?: string) {
        // @ts-expect-error: If `presetName` is `undefined`, then `this.currentPreset` is selected.
        const preset = settings.presets[presetName] ?? this.currentPreset;
        return Object.values(settings.apis).find(x => x.linkedPreset === preset.name) ?? settings.apis[settings.currentApi];
    }

    /**
     * Start generating
     * @param type Generation type, used for triggers
     * @param options Generate options
     * @param dryRun Is it a fake generation?
     * @returns 
     */
    async generate(
        type: string = 'normal',
        options: GenerateOptionsLite = {},
        dryRun: boolean = false
    ): Promise<string | GenResponse | AsyncGenerator<GenStreamResponse | string>> {
        console.log('Generate entered');

        // A fresh turn: drop anything staged by an aborted previous turn. Nested
        // tool-call rounds carry `toolMessages` and belong to the same turn.
        if(!options.toolMessages?.length)
            clearStagedData(this);

        // Prevent generation from shallow characters
        await unshallowCharacter(this_chid);

        // for event handlers
        options.context = this;

        if(!options.skipStartEvents) {
            // Occurs every time, even if the generation is aborted due to slash commands execution
            await eventSource.emit(event_types.GENERATION_STARTED, type, options, dryRun);

            // Occurs only if the generation is not aborted due to slash commands execution
            await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, type, options, dryRun);
        }

        if (type === 'regenerate' && !dryRun && this.chat.length > 0 &&
            !this.lastMessage?.is_user && !this.lastMessage?.is_system
        ) {
            if(this.isGlobal) {
                await deleteLastMessage();
            } else {
                this.chat.length = this.chat.length - 1;
                await eventSource.emit(eventTypes.MESSAGE_DELETED, {  messageId: this.chat.length, context: this });
            }
        }

        let preset : Preset | undefined = this.currentPreset;
        if(options.preset) {
            preset = settings.presets[options.preset];
            if(preset == null) {
                throw new Error(`Preset not found: ${options.preset}`);
            }
        }

        const api = this.getCurrentApi(preset.name);
        // For swipe, the last message is the one being replaced; exclude it
        // from the prompt like ST's native pipeline does (coreChat.pop()).
        const promptChat = type === 'swipe' && !this.chat[this.chat.length - 1]?.is_user
            ? this.chat.slice(0, -1)
            : this.chat;
        const builder = new MessageBuilder(promptChat, preset, api.promptPostProcessing);
        builder.filters = this.filters;
        builder.macroOverride = this.macroOverride;
        builder.toolMessages = options.toolMessages ?? [];
        builder.historyPrompts = this.historyPrompts;
        builder.historyPromptsType = this.historyPromptsType;
        
        const worldinfoTrigger: string[] = promptChat.map(x => x.mes ?? '');

        // To avoid conflicts caused by concurrent read and write operations of chat_metadata in worldinfo.
        const messages = await locker.invoke(async() => {
            const handler = (data: any) => {
                // Inject context information to provide it for use by other extensions.
                data.context = this;
                data.type = type;
                console.debug('inject context to ', data);
                // Because the handler is used by multiple events, it cannot be uninstalled here.
            };

            eventSource.makeFirst(event_types.WORLDINFO_ENTRIES_LOADED, handler);   // data is a object
            eventSource.makeFirst(event_types.WORLDINFO_SCAN_DONE, handler);   // data is a object
            eventSource.makeFirst(event_types.WORLD_INFO_ACTIVATED, handler);   // data is a array

            // backup timedWorldInfo
            const timedWorldInfo = chat_metadata.timedWorldInfo;
            chat_metadata.timedWorldInfo = this.chat_metadata.timedWorldInfo;

            try {
                // Load all world info entries and initial activated ones for skills
                const allEntries = await loadWorldInfoEntries();
                const initialActivatedEntries = await getActivatedEntries(worldinfoTrigger, type, true);
                
                // Initialize the skill scanner
                this.skillScanner.initialize(allEntries, initialActivatedEntries);
                builder.skillScanner = this.skillScanner;
                
                return await builder.build(type, dryRun);
            } finally {
                eventSource.removeListener(event_types.WORLDINFO_ENTRIES_LOADED, handler);
                eventSource.removeListener(event_types.WORLDINFO_SCAN_DONE, handler);
                eventSource.removeListener(event_types.WORLD_INFO_ACTIVATED, handler);

                // restore timedWorldInfo
                this.chat_metadata.timedWorldInfo = timedWorldInfo;
                chat_metadata.timedWorldInfo = timedWorldInfo;
            }
        });

        const substitute = _.partial(substituteParams, _, {
            name1Override: this.macroOverride.user,
            name2Override: this.macroOverride.char,
            original: this.macroOverride.original,
            groupOverride: this.macroOverride.group,
            dynamicMacros: {
                lastUserMessage: () => this.lastMessage?.mes ?? '',
                lastCharMessage: () => this.lastCharMessage?.mes ?? '',
                ...(this.macroOverride.macros ?? {}),
            },
        });
        // Outlets must be resolved against the builder's own injections, ST's outlet
        // macro would read the global extension_prompts instead.
        const evalMacro = (content: string) => substitute(builder.resolveOutlets(content));

        // `{{file::path}}` must be expanded before the macro engine runs, and its
        // result protected, so file content reaches the model byte for byte.
        await this.expandFileMacros(messages);

        for(const message of messages) {
            // Tool results are data, not templates. Running macros or EJS over them
            // would both corrupt `edit_file` anchors and execute whatever the model
            // just wrote into a file.
            if(message.role === 'tool') {
                if(typeof message.content === 'string') {
                    message.content = protect(message.content);
                } else if(message.content) {
                    for(const part of message.content) {
                        if(part.type === 'text' && part.text)
                            part.text = protect(part.text);
                    }
                }
                continue;
            }

            if(typeof message.content === 'string') {
                message.content = evalMacro(message.content);
            } else if(message.content) {
                for(const part of message.content) {
                    if(part.type === 'text' && part.text) {
                        part.text = evalMacro(part.text);
                    }
                }
            }
        }

        await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, { prompt: '', dryRun, context: this, type });

        await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: messages, dryRun, context: this, type });

        await eventSource.emit(event_types.GENERATE_AFTER_DATA, { prompt: messages, context: this, type }, dryRun);

        // Every transformation is done and the request has not been assembled yet:
        // the only window where restoring is both safe and still counted in the
        // token budget.
        restoreProtected(messages);

        if(dryRun)
            return '';

        const abortController = options.abortController ?? this.createAbortController(options.signal);
        const taskId = String(options.taskId || this.variables?.taskId || ++taskIdCounter);
        let apiConfig: Partial<ApiConfig> | undefined = this.buildApiConfig(type, preset.name);

        if(options.apiConfig) {
            if(apiConfig)
                Object.assign(apiConfig, options.apiConfig);
            else
                apiConfig = options.apiConfig;
        }

        await eventSource.emit(eventTypes.GENERATE_BEFORE, { type, options, messages, abortController, taskId, context: this, streaming: !!options.streaming, apiConfig });

        let genResult : GenResponse | AsyncGenerator<GenStreamResponse>;
        const tools = this.createToolDefinitions(type, preset);

        try {
            genResult = await runGenerate(messages, {
                signal: abortController.signal,
                taskId,
                api: apiConfig as ApiConfig,
                hiddenOptions: { context: this, type, taskId, options },
                streaming: options.streaming,
                tools,
                tool_choice: options.toolChoice,
            });
        } catch(error) {
            await eventSource.emit(eventTypes.GENERATE_AFTER, { type, options, taskId, error, response: null, context: this, streaming: !!options.streaming, apiConfig });
            throw error;
        }

        if(type === 'continue' && !options.noTempMessage) {
            // remove the temporary message
            this.chat.length = this.chat.length - 1;
        }

        // True streaming processing
        if(Object.prototype.toString.call(genResult) === '[object AsyncGenerator]') {
            const stream = async function *(this: Context, response: AsyncGenerator<GenStreamResponse>) {
                let swipes : string[] = [];
                let reasoning = '';
                const toolCalls: ToolCalls = [];
                let error = null;
                try {
                    for await (const chunk of response) {
                        if(options.allResponses) {
                            yield chunk;
                        } else if(chunk.swipe === 0) {
                            yield chunk.text;
                        }
                        
                        if(chunk.swipe) {
                            if(swipes[chunk.swipe] == null)
                                swipes[chunk.swipe] = chunk.text;
                            else
                                swipes[chunk.swipe] += chunk.text;
                        }
                        if(chunk.reasoning) {
                            reasoning += chunk.reasoning;
                        }
                        if(chunk.toolCalls?.length) {
                            // The tool call of the last chunk is always complete.
                            toolCalls[chunk.swipe] = chunk.toolCalls;
                        }
                    }
                } catch(err) {
                    error = err;
                }

                if(toolCalls?.length) {
                    const toolMessages = await this.handleToolCalls(toolCalls, { type, taskId, options, apiConfig });
                    if(toolMessages.length) {
                        if(!options.toolMessages)
                            options.toolMessages = [];

                        options.toolMessages.push({ role: 'assistant', reasoning_content: reasoning ?? undefined, tool_calls: toolCalls[0] });
                        options.toolMessages.push(...toolMessages);
                        options.taskId = taskId;

                        await eventSource.emit(eventTypes.TOOL_CALLING, { taskId, type, options, toolCalls, context: this, apiConfig });
                        const nextResponse = await this.generate(type, options, dryRun);

                        // Since `yield from` is not supported, this is the only option.
                        for await (const chunk of nextResponse as AsyncGenerator<GenStreamResponse | string>) {
                            yield chunk;
                        }

                        // Continuous requests are not considered complete, therefore no subsequent events need to be triggered.
                        return;
                    }
                }

                if(!options.dontCreate) {
                    if(type === 'continue') {
                        swipes = swipes.map(mes => this.applyRegex(mes, { user: false, assistant: true, request: false, response: true }));
                        await this.applyContinuation(swipes);
                    } else {
                        swipes = await this.recv(swipes, type === 'swipe');
                    }
                }

                await eventSource.emit(eventTypes.GENERATE_AFTER, { type, options, taskId, error, response: { swipes, reasoning: [reasoning], toolCalls }, context: this, streaming: true, apiConfig });

                // `dontCreate` turns never call recv(): land the staged layer on
                // whatever the last message is rather than losing it.
                this.commitStagedData();
                await this.onGenerationEnded(type);
            }

            return stream.call(this, genResult as AsyncGenerator<GenStreamResponse>);
        }

        // Non-streaming and half streaming processing
        const response: GenResponse = genResult as GenResponse;
        const toolCalls = response.toolCalls as ToolCalls;
        
        if(toolCalls?.length) {
            const toolMessages = await this.handleToolCalls(toolCalls, { type, taskId, options, apiConfig });
            if(toolMessages.length) {
                if(!options.toolMessages)
                    options.toolMessages = [];
                
                options.taskId = taskId;
                options.toolMessages.push({ role: 'assistant', reasoning_content: response.reasoning[0] ?? undefined, tool_calls: toolCalls[0] });
                options.toolMessages.push(...toolMessages);

                await eventSource.emit(eventTypes.TOOL_CALLING, { taskId, type, options, toolCalls, context: this, apiConfig });
                return await this.generate(type, options, dryRun);
            }
        }

        let swipes : string[] = response.swipes ?? [];

        if(swipes.length > 0) {
            if(!options.dontCreate) {
                if(type === 'continue') {
                    swipes = swipes.map(mes => this.applyRegex(mes, { user: false, assistant: true, request: false, response: true, preset }));
                    await this.applyContinuation(swipes);
                } else {
                    swipes = await this.recv(swipes, type === 'swipe');
                }
            } else {
                swipes = swipes.map(mes => this.applyRegex(mes, { user: false, assistant: true, request: false, response: true, preset }));
            }
        } else {
            console.error('Generate failed, empty responses');
        }

        response.swipes = swipes;
        const data = { type, options, taskId, error: null, response, context: this, streaming: false, apiConfig };
        await eventSource.emit(eventTypes.GENERATE_AFTER, data);

        // See the streaming branch: covers `dontCreate` turns.
        this.commitStagedData();
        await this.onGenerationEnded(type);

        if(options.allResponses) {
            return data.response;
        }

        return data.response.swipes.find(mes => !!mes.trim()) ?? '';
    }

    /**
     * Expand `{{file::path}}` across a built prompt.
     *
     * This is the recommended injection path: it works in presets and in World
     * Info, needs no round trip, and does not depend on ST-Prompt-Template being
     * installed. Missing files expand to nothing so a preset can reference
     * `memory.md` before the model has ever written it.
     */
    private async expandFileMacros(messages: ChatCompMessage[]): Promise<void> {
        const pattern = /{{file::([^{}]+?)}}/gi;
        const paths = new Set<string>();

        const collect = (text: string) => {
            for (const match of text.matchAll(pattern))
                paths.add(match[1].trim());
        };

        for(const message of messages) {
            if(message.role === 'tool')
                continue;
            if(typeof message.content === 'string')
                collect(message.content);
            else if(message.content)
                for(const part of message.content)
                    if(part.type === 'text' && part.text) collect(part.text);
        }

        if(!paths.size)
            return;

        const resolved = new Map<string, string>();
        await Promise.all(Array.from(paths).map(async (path) => {
            try {
                resolved.set(path, protect(await this.files.readFile(path)));
            } catch (error) {
                console.debug(`[CG] {{file::${path}}} is unavailable`, error);
                resolved.set(path, '');
            }
        }));

        const replace = (text: string) => text.replace(pattern, (_, path: string) => resolved.get(String(path).trim()) ?? '');

        for(const message of messages) {
            if(message.role === 'tool')
                continue;
            if(typeof message.content === 'string')
                message.content = replace(message.content);
            else if(message.content)
                for(const part of message.content)
                    if(part.type === 'text' && part.text) part.text = replace(part.text);
        }
    }

    /**
     * Convert the preset apiConfig to the general apiConfig format.
     * @param type Generate type
     * @param preset Preset name
     * @returns 
     */
    private buildApiConfig(type: string, preset: string): ApiConfig | undefined {        const api = Object.values(settings.apis).find(x => x.linkedPreset === preset) ?? settings.apis[settings.currentApi] ?? {};
        const hasCustomApi = Boolean(api.baseUrl || api.apiKey || api.model);
        if (!hasCustomApi) {
            console.error(`No custom API configured. Using default API.`);
            return undefined;
        }

        return {
            url: this.apiOverride.url ?? api.baseUrl ?? '',
            key: this.apiOverride.key ?? api.apiKey ?? '',
            model: this.apiOverride.model ?? api.model ?? '',
            type,
            stream: this.apiOverride.stream ?? api.stream ?? false,
            max_context: this.apiOverride.max_context ?? api.contextSize,
            max_tokens: this.apiOverride.max_tokens ?? api.maxTokens,
            temperature: this.apiOverride.temperature ?? api.temperature,
            top_k: this.apiOverride.top_k ?? api.topK,
            top_p: this.apiOverride.top_p ?? api.topP,
            frequency_penalty: this.apiOverride.frequency_penalty ?? api.frequencyPenalty,
            presence_penalty: this.apiOverride.presence_penalty ?? api.presencePenalty,
            custom_exclude_body: this.apiOverride.custom_exclude_body ?? yaml.stringify(api.excludeBody),
            custom_include_body: this.apiOverride.custom_include_body ?? yaml.stringify(api.includeBody),
            custom_include_headers: this.apiOverride.custom_include_headers ?? yaml.stringify(api.includeHeaders),
        };
    }

    
    private createAbortController(signal?: AbortSignal): AbortController {
        const controller = new AbortController();

        if (!signal) {
            return controller;
        }

        if (signal.aborted) {
            controller.abort((signal as any).reason);
            return controller;
        }

        const onAbort = () => controller.abort((signal as any).reason);
        signal.addEventListener('abort', onAbort, { once: true });

        controller.signal.addEventListener('abort', () => {
            signal.removeEventListener('abort', onAbort);
        }, { once: true });

        return controller;
    }

    protected applyRegex(content: string, { user, assistant, request, response, preset } = {} as { user?: boolean, assistant?: boolean, request?: boolean, response?: boolean, preset?: Preset }): string {
        for(const regex of preset?.regexs ?? this.currentPreset.regexs) {
            if(!regex.enabled || !regex.ephemerality)
                continue;

            if(((regex.userInput && user) ||
                (regex.aiOutput && assistant)) &&
                ((regex.request && request) ||
                (regex.response && response))
            ) {
                content = runRegexScript({
                    id: '',
                    scriptName: '',
                    findRegex: regex.regex,
                    replaceString: regex.replace,
                    trimStrings: [],
                    placement: [],
                    disabled: false,
                    markdownOnly: false,
                    promptOnly: false,
                    runOnEdit: false,
                    substituteRegex: substitute_find_regex.NONE,
                    minDepth: 0,
                    maxDepth: 0,
                }, content);
            }
        }

        return content;
    }

    /**
     * Disable messages within the specified access range so that they do not participate in the generation process.
     * @param start Start range
     * @param end End range
     * @param unhide Unhide or Hide
     * @param nameFitler Disable messages with only the specified name
     */
    hideMessages(start: number, end: number, unhide: boolean = false, nameFitler: string | null = null) {
        if(isNaN(start)) return;
        if(!end) end = start;
        const hide = !unhide;

        for(let msgId = start; msgId <= end; msgId++) {
            const message = this.chat[msgId];
            if(!message) continue;
            if(nameFitler && message.name !== nameFitler) continue;

            message.is_system = hide;

            if(this.isGlobal) {
                const messageBlock = $(`.mes[mesid="${msgId}"]`);
                if(!messageBlock.length) continue;
                messageBlock.attr('is_system', String(hide));
            }
        }

        if(this.isGlobal) {
            // Reload swipes. Useful when a last message is hidden.
            refreshSwipeButtons();
        }
    }

    private createToolDefinitions(type: string, preset?: Preset): ToolDefinition[] {
        const tools: ToolDefinition[] = [];
        const exists: Set<string> = new Set();
        preset = preset ?? this.currentPreset;

        for(const tool of this.tools.values()) {
            const toolSettings = preset.tools?.[tool.name];
            const description = toolSettings?.description || tool.description;
            let parameters = tool.parameters.toJSONSchema() as Record<string, any>;

            // Apply custom parameter descriptions if available
            if (toolSettings?.parameters && Object.keys(toolSettings.parameters).length > 0) {
                if (parameters?.properties && typeof parameters.properties === 'object') {
                    const updatedProperties: Record<string, any> = {};
                    for (const [key, value] of Object.entries(parameters.properties as Record<string, any>)) {
                        const customDesc = toolSettings.parameters[key];
                        if (typeof value === 'object' && value !== null) {
                            updatedProperties[key] = {
                                ...value,
                                ...(customDesc ? { description: customDesc } : {}),
                            };
                        } else {
                            updatedProperties[key] = value;
                        }
                    }
                    parameters = {
                        ...parameters,
                        properties: updatedProperties,
                    };
                }
            }

            tools.push({
                type: 'function',
                function: {
                    name: tool.name,
                    description,
                    parameters,
                }
            });
            exists.add(tool.name);
        }

        for(const tool of getAvailableTools(type, preset.name)) {
            if(exists.has(tool.name))
                continue;

            const toolSettings = preset.tools?.[tool.name];
            const description = toolSettings?.description || tool.description;
            let parameters = tool.parameters.toJSONSchema() as Record<string, any>;

            // Apply custom parameter descriptions if available
            if (toolSettings?.parameters && Object.keys(toolSettings.parameters).length > 0) {
                if (parameters?.properties && typeof parameters.properties === 'object') {
                    const updatedProperties: Record<string, any> = {};
                    for (const [key, value] of Object.entries(parameters.properties as Record<string, any>)) {
                        const customDesc = toolSettings.parameters[key];
                        if (typeof value === 'object' && value !== null) {
                            updatedProperties[key] = {
                                ...value,
                                ...(customDesc ? { description: customDesc } : {}),
                            };
                        } else {
                            updatedProperties[key] = value;
                        }
                    }
                    parameters = {
                        ...parameters,
                        properties: updatedProperties,
                    };
                }
            }

            tools.push({
                type: 'function',
                function: {
                    name: tool.name,
                    description,
                    parameters,
                }
            });
        }

        return tools;
    }

    private async handleToolCalls(calls: ToolCalls, args: Record<string, any> = {}): Promise<ChatCompMessage[]> {
        if(!calls?.length)
            return [];

        if(calls.length > 1) {
            // Multiple choices can only be responded to via fork.
            console.error('Multiple choice tool calls are not supported yet');
        }

        return await Promise.all(calls[0].map(async(call) => {
            const name = call.name ?? call?.function?.name ?? '';
            const tool = this.tools.get(name) ?? getTool(name);
            if(!tool) {
                console.error(`Tool ${name} not found`);
                return {
                    role: 'tool',
                    tool_call_id: call.id ?? '',
                    content: `Tool ${name} not found`,
                };
            }

            try {
                const parameters = call.args ?? JSON.parse(call.function?.arguments ?? '{}') ?? {};
                const validated = tool.parameters.safeParse(parameters);
                if(!validated.success) {
                    return {
                        role: 'tool',
                        tool_call_id: call.id ?? '',
                        content: `Tool ${name} parameters error: ${JSON.stringify(z.treeifyError(validated.error))}\nSchema: ${JSON.stringify(tool.parameters.toJSONSchema())}`,
                    };
                }

                return {
                    role: 'tool',
                    tool_call_id: call.id ?? '',
                    content: await tool.function({ context: this, ...args, ...validated.data }),
                }
            } catch (e) {
                console.error(`Tool ${name} failed`, e);
                return {
                    role: 'tool',
                    tool_call_id: call.id ?? '',
                    // @ts-expect-error: `e` always has a `message` property.
                    content: `Tool ${name} error: ${e.message ?? e}`,
                };
            }
        }));
    }
}
