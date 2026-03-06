import { eventSource, event_types } from '../../../../../events.js';
import {
    name1,
    unshallowCharacter,
    this_chid,
    chat_metadata,
    chat,
    deleteLastMessage
} from '../../../../../../script.js';
import { settings } from '../settings';
import { generate as runGenerate, ApiConfig } from '../functions/generate';
import { MessageBuilder } from '../functions/message-builder';
import { ContextRole } from '../utils/defines'

type VariableData = Record<string, any>;
type ChatMessageEx = ChatMessage & { variables?: VariableData[] };
type ChatMetadataEx = ChatMetadata & { variables?: VariableData };

type GenerateOptionsLite = {
    signal?: AbortSignal,
    quietName?: string,
};

export class Context {
    public chat: ChatMessageEx[];
    public chat_metadata: ChatMetadataEx;
    public isGlobal: boolean;

    constructor() {
        this.chat = [];
        this.chat_metadata = {};
        this.isGlobal = false;
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

    send(content: string, role: ContextRole = 'user', name: string = name1) {
        this.chat.push({
            is_user: role === 'user',
            is_system: role === 'system',
            mes: content,
            send_date: new Date(),
            name,
        });
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

    async generate(type: string = 'normal', options: GenerateOptionsLite = {}, dryRun: boolean = false): Promise<string> {
        console.log('Generate entered');

        // Prevent generation from shallow characters
        await unshallowCharacter(this_chid);

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
                await eventSource.emit('ag_message_deleted', this.chat.length);
            }
        }

        const builder = new MessageBuilder(this.chat);
        const messages = await builder.build(type, dryRun);

        if (dryRun) {
            await eventSource.emit('ag_generate_dry_run', { type, options, messages });
            return '';
        }

        const abortController = this.#createAbortController(options.signal);
        const taskId = typeof this.variables?.taskId === 'string' ? this.variables.taskId : '';
        const apiConfig = this.#buildApiConfig(type);

        await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, { prompt: '', dryRun });

        await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: messages, dryRun });

        await eventSource.emit(event_types.GENERATE_AFTER_DATA, { prompt: messages }, dryRun);

        const result = await runGenerate(messages, abortController, taskId, apiConfig);
        const text = Array.isArray(result) ? (result[0] ?? '') : result;

        return typeof text === 'string' ? text : String(text ?? '');
    }

    #buildApiConfig(type: string): ApiConfig | undefined {
        const hasCustomApi = Boolean(settings.baseUrl || settings.apiKey || settings.model);
        if (!hasCustomApi) {
            return undefined;
        }

        return {
            url: String(settings.baseUrl ?? ''),
            key: String(settings.apiKey ?? ''),
            model: String(settings.model ?? ''),
            type,
            stream: !!settings.stream,
            max_context: settings.contextSize,
            max_tokens: settings.maxTokens,
            temperature: settings.temperature,
            top_k: settings.topK,
            top_p: settings.topP,
            frequency_penalty: settings.frequencyPenalty,
            presence_penalty: settings.presencePenalty,
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

}
