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
} from '@st/script.js';
import { settings } from '@/settings';
import { generate as runGenerate, ApiConfig } from '@/functions/generate';
import { MessageBuilder, PromptFilter, MacroOverride } from '@/functions/message-builder';
import { ContextRole } from '@/utils/defines'
import { runRegexScript, substitute_find_regex } from "@/../../../regex/engine.js";
import { eventTypes } from '@/utils/events';
import { Preset } from '@/utils/defines';
import { defaultPreset } from '@/utils/default-settings';
import { AsyncMutex } from '@/utils/mutex';

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

    /**
     * Placeholders have no function; do not modify them.
     */
    context?: Context;
};

let taskIdCounter = 0;

export class Context {
    public chat: ChatMessageEx[];
    public chat_metadata: ChatMetadataEx;
    public isGlobal: boolean;
    public presetOverride?: string;
    public apiOverride: Partial<ApiConfig>;
    public macroOverride: MacroOverride;
    public filters: PromptFilter;

    constructor(_chat: ChatMessageEx[] = [], _metadata: ChatMetadataEx = {}) {
        this.chat = _chat;
        this.chat_metadata = _metadata;
        this.isGlobal = false;
        this.presetOverride = undefined;
        this.apiOverride = {};
        this.macroOverride = {};
        this.filters = {};
    }

    /**
     * Get the context of the current chat file
     * @returns Context
     */
    static global(): Context {
        const ctx = new Context();
        ctx.chat = chat;
        ctx.chat_metadata = chat_metadata;
        ctx.isGlobal = true;
        return ctx;
    }

    static fromObject(value: any): Context {
        const context = new Context();
        context.chat = value.chat ?? [];
        context.chat_metadata = value.chat_metadata ?? {};
        context.presetOverride = value.presetOverride;
        context.apiOverride = value.apiOverride ?? {};
        context.macroOverride = value.macroOverride ?? {};
        context.filters = value.filters ?? {};
        return context;
    }

    toObject(): Object {
        if(this.isGlobal)
            console.warn('toObject called on global context');

        return {
            chat: this.chat,
            chat_metadata: this.chat_metadata,
            presetOverride: this.presetOverride,
            apiOverride: this.apiOverride,
            macroOverride: this.macroOverride,
            filters: this.filters,
        };
    }

    /**
     * Creating a message is generally used by user to send messages.
     * @param content Message content
     * @param role User or assistant
     * @param name Character Name
     */
    async send(content: string, role: ContextRole = 'user', name: string = name1) {
        const mes = this.#applyRegex(content, {
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

    async #recv(contents: string[], swipe: boolean = false, role: ContextRole = 'assistant', name: string = name2): Promise<string[]> {
        if(contents.length < 1)
            return [];

        const swipes : string[] = [];
        const swipe_info: SwipeInfo[] = [];
        const variables: VariableData[] = [];

        for(const idx in contents) {
            const mes = this.#applyRegex(contents[idx], {
                user: role === 'user',
                assistant: role === 'assistant',
                request: false,
                response: true,
            });

            swipes.push(mes);
            swipe_info.push({ send_date: new Date(), extra: {}, });
            variables.push({});
        }

        if(swipe && this.lastMessage) {
            if(this.lastMessage.swipes)
                this.lastMessage.swipes = this.lastMessage.swipes.concat(swipes);
            else
                this.lastMessage.swipes = [ this.lastMessage.mes ?? '' ].concat(swipes);
            this.lastMessage.mes = swipes[0];

            if(this.lastMessage.swipe_info)
                this.lastMessage.swipe_info = this.lastMessage.swipe_info.concat(swipe_info);
            else
                this.lastMessage.swipe_info = ([ { send_date: new Date(), extra: {}, } ] as SwipeInfo[]).concat(swipe_info);

            if(this.lastMessage.variables)
                this.lastMessage.variables = this.lastMessage.variables.concat(variables);
            else
                this.lastMessage.variables = [ {} ].concat(variables);
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

        await eventSource.emit(eventTypes.MESSAGE_RECEIVED, { messageId: this.chat.length - 1, message: this.chat[this.chat.length - 1], context: this });
        return swipes;
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

    /**
     * Start generating
     * @param type Generation type, used for triggers
     * @param options Generate options
     * @param dryRun Is it a fake generation?
     * @returns 
     */
    async generate(type: string = 'normal', options: GenerateOptionsLite = {}, dryRun: boolean = false): Promise<string | string[] | AsyncGenerator<{ swipe: number, text: string } | string>> {
        console.log('Generate entered');

        // Prevent generation from shallow characters
        await unshallowCharacter(this_chid);

        // for event handlers
        options.context = this;

        // Occurs every time, even if the generation is aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_STARTED, type, options, dryRun);

        // Occurs only if the generation is not aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, type, options, dryRun);

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
        if(options.preset)
            preset = settings.presets[options.preset];

        const builder = new MessageBuilder(this.chat, preset);
        builder.filters = this.filters;
        builder.macroOverride = this.macroOverride;

        // To avoid conflicts caused by concurrent read and write operations of chat_metadata in worldinfo.
        const self = this;
        const messages = await locker.invoke(async() => {
            const handler = (data: any) => {
                data.context = self; // Inject context information to provide it for use by other extensions.
                console.debug('inject context to ', data);
                // Because the handler is used by multiple events, it cannot be uninstalled here.
            };

            // TODO: event_types.WORLD_INFO_ACTIVATED
            eventSource.makeFirst(event_types.WORLDINFO_ENTRIES_LOADED, handler);
            eventSource.makeFirst(event_types.WORLDINFO_SCAN_DONE, handler);

            // backup timedWorldInfo
            const timedWorldInfo = chat_metadata.timedWorldInfo;
            chat_metadata.timedWorldInfo = this.chat_metadata.timedWorldInfo;

            try {
                return await builder.build(type, dryRun);
            } finally {
                eventSource.removeListener(event_types.WORLDINFO_ENTRIES_LOADED, handler);
                eventSource.removeListener(event_types.WORLDINFO_SCAN_DONE, handler);
                this.chat_metadata.timedWorldInfo = chat_metadata.timedWorldInfo;
                chat_metadata.timedWorldInfo = timedWorldInfo; // restore timedWorldInfo
            }
        });

        for(const message of messages) {
            message.content = substituteParams(message.content, {
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
        }

        await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, { prompt: '', dryRun, context: this });

        await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: messages, dryRun, context: this });

        await eventSource.emit(event_types.GENERATE_AFTER_DATA, { prompt: messages, context: this }, dryRun);

        if(dryRun)
            return '';

        const abortController = options.abortController ?? this.#createAbortController(options.signal);
        const taskId = String(this.variables?.taskId || ++taskIdCounter);
        let apiConfig: Partial<ApiConfig> | undefined = this.#buildApiConfig(type, preset.name);

        if(options.apiConfig) {
            if(apiConfig)
                Object.assign(apiConfig, options.apiConfig);
            else
                apiConfig = options.apiConfig;
        }

        await eventSource.emit(eventTypes.GENERATE_BEFORE, { type, options, messages, abortController, taskId, context: this, streaming: !!options.streaming, apiConfig });

        let result : string | string[] | AsyncGenerator<{
            swipe: number;
            text: string;
        }, any, any>;

        try {
            result = await runGenerate(messages, abortController.signal, taskId, apiConfig as ApiConfig, { context: this }, options.streaming);
        } catch(error) {
            await eventSource.emit(eventTypes.GENERATE_AFTER, { type, options, taskId, error, responses: [], context: self, streaming: !!options.streaming, apiConfig });
            throw error;
        }

        if(type === 'continue') {
            // remove the temporary message
            this.chat.length = this.chat.length - 1;
        }

        if(Object.prototype.toString.call(result) === '[object AsyncGenerator]') {
            const self = this;
            async function * stream() {
                let buffers : string[] = [];
                let error = null;
                try {
                    for await (const chunk of result) {
                        yield chunk;
                        
                        if(typeof chunk === 'string') {
                            if(buffers[0] == null) buffers[0] = '';
                            buffers[0] += chunk;
                        } else if(chunk.swipe) {
                            if(buffers[chunk.swipe] == null) buffers[chunk.swipe] = '';
                            buffers[chunk.swipe] += chunk.text;
                        }
                    }
                } catch(err) {
                    error = err;
                }

                if(!options.dontCreate) {
                    if(type === 'continue') {
                        buffers = buffers.map(mes => self.#applyRegex(mes, { user: false, assistant: true, request: false, response: true }));
                        if(self.lastMessage?.mes) {
                            self.lastMessage.mes += buffers[0];
                        }
                        if(self.lastMessage?.swipes?.[self.lastMessage.swipe_id ?? 0]) {
                            self.lastMessage.swipes[self.lastMessage.swipe_id ?? 0] += buffers[0];
                        }
                    } else {
                        buffers = await self.#recv(buffers, type === 'swipe');
                    }
                }

                await eventSource.emit(eventTypes.GENERATE_AFTER, { type, options, taskId, error, responses: buffers, context: self, streaming: true, apiConfig });

                if(self.isGlobal) {
                    // Since there's no need to manage the generate button, just send it directly.
                    await eventSource.emit(event_types.GENERATION_ENDED, self.chat.length, type);
                }
            }

            return stream();
        }

        result = (Array.isArray(result) ? result : [ result ]) as string[];
        if(result.length < 1) {
            console.error('Generate failed, empty responses');
            return '';
        }

        if(!options.dontCreate) {
            if(type === 'continue') {
                const self = this;
                result = result.map(mes => self.#applyRegex(mes, { user: false, assistant: true, request: false, response: true }));
                if(self.lastMessage?.mes) {
                    self.lastMessage.mes += result[0];
                }
                if(self.lastMessage?.swipes?.[self.lastMessage.swipe_id ?? 0]) {
                    self.lastMessage.swipes[self.lastMessage.swipe_id ?? 0] += result[0];
                }
            } else {
                result = await this.#recv(result, type === 'swipe');
            }
        } else {
            const self = this;
            result = result.map(mes => self.#applyRegex(mes, { user: false, assistant: true, request: false, response: true }));
        }

        const data = { type, options, taskId, error: null, responses: result, context: self, streaming: false, apiConfig };
        await eventSource.emit(eventTypes.GENERATE_AFTER, data);

        if(this.isGlobal) {
            // Since there's no need to manage the generate button, just send it directly.
            await eventSource.emit(event_types.GENERATION_ENDED, this.chat.length, type);
        }

        if(options.allResponses) {
            return data.responses;
        }

        return data.responses.findLast(mes => !!mes.trim()) ?? '';
    }

    #buildApiConfig(type: string, preset: string): ApiConfig | undefined {
        const api = Object.values(settings.apis).find(x => x.linkedPreset === preset) ?? settings.apis[settings.currentApi] ?? {};
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
        };
    }

    
    #createAbortController(signal?: AbortSignal): AbortController {
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

    #applyRegex(content: string, { user, assistant, request, response, preset } = {} as { user?: boolean, assistant?: boolean, request?: boolean, response?: boolean, preset?: Preset }): string {
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
}
