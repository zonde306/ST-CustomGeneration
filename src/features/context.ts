import { eventSource, event_types } from '../../../../../events.js';
import {
    name1,
    unshallowCharacter,
    this_chid,
    chat_metadata,
    chat,
    deleteLastMessage,
    name2,
} from '../../../../../../script.js';
import { settings, Preset, defaultPreset } from '../settings';
import { generate as runGenerate, ApiConfig } from '../functions/generate';
import { MessageBuilder } from '../functions/message-builder';
import { ContextRole } from '../utils/defines'
import { runRegexScript, substitute_find_regex } from "../../../../regex/engine.js";

type VariableData = Record<string, any>;
type ChatMessageEx = ChatMessage & { variables?: VariableData[] };
type ChatMetadataEx = ChatMetadata & { variables?: VariableData };

interface GenerateOptionsLite {
    signal?: AbortSignal;
    quietName?: string;
    dontCreate?: boolean;
    allResponses?: boolean;
    apiConfig?: Partial<ApiConfig>;
    preset?: Preset;
};

export class Context {
    public chat: ChatMessageEx[];
    public chat_metadata: ChatMetadataEx;
    public isGlobal: boolean;
    public preset: Preset;
    public api: Partial<ApiConfig>;

    constructor() {
        this.chat = [];
        this.chat_metadata = {};
        this.isGlobal = false;
        this.preset = settings.presets[settings.currentPreset] ?? defaultPreset;
        this.api = {};
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
        return context;
    }

    toObject(): Object {
        if(this.isGlobal)
            console.warn('toObject called on global context');

        return {
            chat: this.chat,
            chat_metadata: this.chat_metadata,
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

        await eventSource.emit('cg_message_created', this.chat.length, this.chat[this.chat.length - 1]);
    }

    async #recv(contents: string[], role: ContextRole = 'assistant', name: string = name2) {
        if(contents.length < 1)
            return;

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

        await eventSource.emit('cg_message_created', this.chat.length, this.chat[this.chat.length - 1]);
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

    async generate(type: string = 'normal', options: GenerateOptionsLite = {}, dryRun: boolean = false): Promise<string | string[]> {
        console.log('Generate entered');

        // Prevent generation from shallow characters
        await unshallowCharacter(this_chid);

        // Occurs every time, even if the generation is aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_STARTED, type, { ...options, context: this }, dryRun);

        // Occurs only if the generation is not aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, type, { ...options, context: this }, dryRun);

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
                await eventSource.emit('cg_message_deleted', this.chat.length);
            }
        }

        const builder = new MessageBuilder(this.chat, options.preset ?? this.preset);
        const messages = await builder.build(type, dryRun);

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

        const result = await runGenerate(messages, abortController, taskId, apiConfig as ApiConfig);

        if(!options.dontCreate) {
            await this.#recv(Array.isArray(result) ? result : [ result ]);
        }

        if(options.allResponses) {
            return Array.isArray(result) ? result : [ result ];
        }

        const text = Array.isArray(result) ? (result[0] ?? '') : result;
        return typeof text === 'string' ? text : String(text ?? '');
    }

    #buildApiConfig(type: string): ApiConfig | undefined {
        const hasCustomApi = Boolean(settings.baseUrl || settings.apiKey || settings.model);
        if (!hasCustomApi) {
            return undefined;
        }

        return {
            url: this.api.url ?? settings.baseUrl ?? '',
            key: this.api.key ?? settings.apiKey ?? '',
            model: this.api.model ?? settings.model ?? '',
            type,
            stream: this.api.stream ?? settings.stream ?? false,
            max_context: this.api.max_context ?? settings.contextSize,
            max_tokens: this.api.max_tokens ?? settings.maxTokens,
            temperature: this.api.temperature ?? settings.temperature,
            top_k: this.api.top_k ?? settings.topK,
            top_p: this.api.top_p ?? settings.topP,
            frequency_penalty: this.api.frequency_penalty ?? settings.frequencyPenalty,
            presence_penalty: this.api.presence_penalty ?? settings.presencePenalty,
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

    #applyRegex(content: string, { user, assistant, request, response } = {} as { user?: boolean, assistant?: boolean, request?: boolean, response?: boolean }): string {
        for(const regex of this.preset.regexs) {
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
}
