import { eventSource, event_types } from '../../../../../events.js';
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
} from '../../../../../../script.js';
import { settings, Preset, defaultPreset } from '../settings';
import { generate as runGenerate, ApiConfig } from '../functions/generate';
import { MessageBuilder, PromptFilter, MacroOverride } from '../functions/message-builder';
import { ContextRole } from '../utils/defines'
import { runRegexScript, substitute_find_regex } from "../../../../regex/engine.js";
import { eventTypes } from '../utils/events';

type VariableData = Record<string, any>;
type ChatMessageEx = ChatMessage & { variables?: VariableData[] };
type ChatMetadataEx = ChatMetadata & { variables?: VariableData };

export interface GenerateOptionsLite {
    signal?: AbortSignal;
    quietName?: string;
    dontCreate?: boolean;
    allResponses?: boolean;
    apiConfig?: Partial<ApiConfig>;
    preset?: string;
    streaming?: boolean;
    context?: Context;
};



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

    static global(): Context {
        const ctx = new Context();
        ctx.chat = chat;
        ctx.chat_metadata = chat_metadata;
        ctx.isGlobal = true;
        return ctx;
    }

    static fromObject(value: Context): Context {
        const context = new Context();
        context.chat = value.chat ?? [];
        context.chat_metadata = value.chat_metadata ?? {};
        context.presetOverride = value.presetOverride;
        context.apiOverride = value.apiOverride ?? {};
        context.macroOverride = value.macroOverride ?? {};
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
        };
    }

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

    async #recv(contents: string[], role: ContextRole = 'assistant', name: string = name2): Promise<string[]> {
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

        await eventSource.emit(eventTypes.MESSAGE_RECEIVED, { messageId: this.chat.length - 1, message: this.chat[this.chat.length - 1], context: this });
        return swipes;
    }

    get lastMessage(): ChatMessageEx | undefined {
        return this.chat[this.chat.length - 1];
    }

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

    get localVariables(): VariableData {
        if(this.chat_metadata.variables == null)
            this.chat_metadata.variables = {};
        return this.chat_metadata.variables ?? {};
    }

    get currentPreset(): Preset {
        let preset = settings.presets[settings.currentPreset] ?? defaultPreset;
        if(typeof this.presetOverride === 'string')
            preset = settings.presets[this.presetOverride] ?? preset;
        return preset;
    }

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

        if (type === 'regenerate' &&
            !dryRun &&
            this.chat.length > 0 &&
            !this.chat[this.chat.length - 1]?.is_user &&
            !this.chat[this.chat.length - 1]?.is_system
        ) {
            if(this.isGlobal) {
                await deleteLastMessage();
            } else {
                this.chat.length = this.chat.length - 1;
                await eventSource.emit(eventTypes.MESSAGE_DELETED, {  messageId: this.chat.length, context: this });
            }
        }

        if(type === 'continue' && !dryRun && this.chat.length > 0) {
            this.send('Continue');
        }

        let preset : Preset | undefined = this.currentPreset;
        if(options.preset)
            preset = settings.presets[options.preset];

        const builder = new MessageBuilder(this.chat, preset);
        builder.filters = this.filters;
        builder.macroOverride = this.macroOverride;

        const messages = await builder.build(type, dryRun);

        for(const message of messages) {
            message.content = substituteParams(message.content, {
                name1Override: this.macroOverride.user,
                name2Override: this.macroOverride.char,
                original: this.macroOverride.original,
                groupOverride: this.macroOverride.group,
                dynamicMacros: {
                    lastUserMessage: () => this.chat.findLast(m => m.is_user)?.mes ?? '',
                    lastCharMessage: () => this.chat.findLast(m => !m.is_user && !m.is_system)?.mes ?? '',
                    ...(this.macroOverride.macros ?? {}),
                },
            });
        }

        await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, { prompt: '', dryRun, context: this });

        await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: messages, dryRun, context: this });

        await eventSource.emit(event_types.GENERATE_AFTER_DATA, { prompt: messages, context: this }, dryRun);

        if(dryRun)
            return '';

        const abortController = this.#createAbortController(options.signal);
        const taskId = typeof this.variables?.taskId === 'string' ? this.variables.taskId : '';
        let apiConfig: Partial<ApiConfig> | undefined = this.#buildApiConfig(type);

        if(options.apiConfig) {
            if(apiConfig)
                Object.assign(apiConfig, options.apiConfig);
            else
                apiConfig = options.apiConfig;
        }

        let result = await runGenerate(messages, abortController, taskId, apiConfig as ApiConfig, { context: this }, options.streaming);

        if(type === 'continue') {
            // remove the temporary message
            this.chat.length = this.chat.length - 1;
        }

        if(Object.prototype.toString.call(result) === '[object AsyncGenerator]') {
            const self = this;
            async function * stream() {
                let buffers : string[] = [];
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

                if(!options.dontCreate) {
                    buffers = await self.#recv(buffers);
                }

                await eventSource.emit(eventTypes.GENERATE_ENDED, { taskId, response: buffers, context: self, streaming: true });
            }

            return stream();
        }

        result = (Array.isArray(result) ? result : [ result ]) as string[];
        if(result.length < 1) {
            toastr.error('Generate failed, empty responses');
            return '';
        }

        if(!options.dontCreate) {
            result = await this.#recv(result);
        } else {
            const self = this;
            result = result.map(mes => self.#applyRegex(mes, { user: false, assistant: true, request: false, response: true }));
        }

        const data = { taskId, response: result, context: self, streaming: false };
        await eventSource.emit(eventTypes.GENERATE_ENDED, data);

        if(options.allResponses) {
            return data.response;
        }

        return data.response.find(mes => !!mes.trim()) ?? '';
    }

    #buildApiConfig(type: string): ApiConfig | undefined {
        const hasCustomApi = Boolean(settings.baseUrl || settings.apiKey || settings.model);
        if (!hasCustomApi) {
            return undefined;
        }

        return {
            url: this.apiOverride.url ?? settings.baseUrl ?? '',
            key: this.apiOverride.key ?? settings.apiKey ?? '',
            model: this.apiOverride.model ?? settings.model ?? '',
            type,
            stream: this.apiOverride.stream ?? settings.stream ?? false,
            max_context: this.apiOverride.max_context ?? settings.contextSize,
            max_tokens: this.apiOverride.max_tokens ?? settings.maxTokens,
            temperature: this.apiOverride.temperature ?? settings.temperature,
            top_k: this.apiOverride.top_k ?? settings.topK,
            top_p: this.apiOverride.top_p ?? settings.topP,
            frequency_penalty: this.apiOverride.frequency_penalty ?? settings.frequencyPenalty,
            presence_penalty: this.apiOverride.presence_penalty ?? settings.presencePenalty,
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

    async sendTemplate(content: string, macros: Record<string, DynamicMacroValue>, role: ContextRole = 'user', name: string = name1) {
        if(!this.macroOverride.macros)
            this.macroOverride.macros = {};
        Object.assign(this.macroOverride.macros, macros);

        await this.send(content, role, name);
    }

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
