import { eventSource, event_types } from '@st/scripts/events.js';
import { oai_settings, sendOpenAIRequest, chat_completion_sources } from '@st/scripts/openai.js';
import { TokenLogprobs } from '@st/scripts/logprobs.js';
import { uuidv4 } from '@st/scripts/utils.js';
import { eventTypes } from '@/utils/events'

export interface ApiConfig {
    url: string;
    key: string;
    model: string;
    type?: string;
    source?: string;

    stream?: boolean | null;
    max_context?: number | null;
    max_tokens?: number | null;
    temperature?: number | null;
    top_p?: number | null;
    top_k?: number | null;
    frequency_penalty?: number | null;
    presence_penalty?: number | null;
    
    custom_exclude_body?: string; // yaml
    custom_include_body?: string; // yaml
    custom_include_headers?: string; // yaml

    /**
     * When enabled, the return value is [reasoning_content, message_content, other message_content...].
     */
    include_reasoning?: boolean;
};

interface StreamChunk {
    text: string,
    swipes: string[],
    logprobs: TokenLogprobs[],
    toolCalls: any[],
    state: { reasoning: string, images: any[] }
};

export async function generate(
    messages: ChatCompletionMessage[],
    singal: AbortSignal,
    taskId: string = '',
    api?: ApiConfig,
    customOptions?: Record<string, any>,
    streaming: boolean = false,
): Promise<string | string[] | AsyncGenerator<{ swipe: number, text: string }>> {
    if(!taskId)
        taskId = uuidv4();

    let eventHandler: Function | null = null;
    const originalStream = oai_settings.stream_openai;

    await eventSource.emit(eventTypes.GENERATION_START, {
        messages,
        taskId,
        api,
        customOptions,
        streaming
    });

    if(api) {
        eventHandler = (data: any) => {
            function assign(key: keyof ApiConfig) {
                if(api?.[key] === null)
                    _.unset(data, key);
                else if(api?.[key] != null)
                    _.set(api, key, api[key]);
            }

            data.reverse_proxy = api.url;
            data.chat_completion_source = api.source || chat_completion_sources.OPENAI;
            data.proxy_password = api.key || '';
            data.model = api.model;

            assign('max_context');
            assign('max_tokens');
            assign('temperature');
            assign('top_p');
            assign('top_k');
            assign('frequency_penalty');
            assign('presence_penalty');
            assign('custom_exclude_body');
            assign('custom_include_body');
            assign('custom_include_headers');

            for(const [key, val] of Object.entries(customOptions ?? {})) {
                Object.defineProperty(data, key, {
                    value: val,
                    writable: true,
                    enumerable: false,
                    configurable: true,
                });
            }

            // @ts-expect-error: 2345
            eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, eventHandler);
            oai_settings.stream_openai = originalStream;
        };
        eventSource.makeFirst(event_types.CHAT_COMPLETION_SETTINGS_READY, eventHandler);
    }

    let result = null;
    try {
        if(api?.stream) {
            oai_settings.stream_openai = true;
            const handler = new StreamHandler(taskId, singal, api?.include_reasoning ?? false);
            handler.generator = await sendOpenAIRequest(api?.type || 'quiet', messages, singal) as typeof handler.generator;
            if(streaming)
                result = handler.streaming();
            else
                result = await handler.generate();
        } else {
            oai_settings.stream_openai = false;
            const response = await sendOpenAIRequest(api?.type || 'quiet', messages, singal);
            result = await responseHandler(response, taskId, api?.include_reasoning ?? false);
        }
    } catch(err) {
        console.error(`Error on generating`, err);

        await eventSource.emit(eventTypes.GENERATION_END, {
            taskId: taskId,
            error: err,
            responses: [],
        });

        throw err;
    } finally {
        if(eventHandler)
            eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, eventHandler);
        oai_settings.stream_openai = originalStream;
    }

    return result;
}

class StreamHandler {
    public generator?: () => AsyncGenerator<StreamChunk, void, void>;
    public singal: AbortSignal;
    private buffer: string[];
    private taskId: string;
    private reasoning: boolean;

    constructor(taskId: string, singal?: AbortSignal, reasoning: boolean = false) {
        this.taskId = taskId;
        this.singal = singal ?? new AbortController().signal;
        this.buffer = [];
        this.reasoning = reasoning;
    }

    async generate() : Promise<string | string[]> {
        if(!this.generator)
            throw new Error('Generator is not set');

        let lastError = null;
        try {
            for await (const chunk of this.generator()) {
                if(this.singal.aborted)
                    break;

                const { swipe, text } = this.parseChunk(chunk);
                if(!text)
                    continue;

                await eventSource.emit(eventTypes.GENERATION_STREAM_CHUNK, {
                    taskId: this.taskId,
                    swipe,
                    text,
                    buffer: this.buffer,
                });
            }
        } catch (err) {
            lastError = err;
        }

        await eventSource.emit(eventTypes.GENERATION_END, {
            taskId: this.taskId,
            error: lastError,
            responses: this.buffer,
        });

        return this.buffer.length === 1 ? this.buffer[0] : this.buffer;
    }

    async *streaming(): AsyncGenerator<{ swipe: number, text: string }> {
        if(!this.generator)
            throw new Error('Generator is not set');

        let lastError = null;
        try {
            for await (const chunk of this.generator()) {
                const { swipe, text } = this.parseChunk(chunk);
                if(!text)
                    continue;

                await eventSource.emit(eventTypes.GENERATION_STREAM_CHUNK, {
                    taskId: this.taskId,
                    swipe,
                    text,
                    buffer: this.buffer,
                });

                yield { swipe, text };
            }
        } catch (err) {
            lastError = err;
        }

        await eventSource.emit(eventTypes.GENERATION_END, {
            taskId: this.taskId,
            error: lastError,
            responses: this.buffer,
        });
    }

    parseChunk(chunk: StreamChunk): { swipe: number, text: string } {
        if(this.reasoning && chunk.state.reasoning) {
            const lastLength = this.buffer[0]?.length ?? 0;
            this.buffer[0] = chunk.text;
            return { swipe: 0, text: chunk.text.substring(lastLength) };
        } else if(chunk.text) {
            // If reasoning is captured, then [0] is reasoning and [1] is text; otherwise, [0] is text.
            const lastLength = this.buffer[Number(this.reasoning)]?.length ?? 0;
            this.buffer[Number(this.reasoning)] = chunk.text;
            return { swipe: Number(this.reasoning), text: chunk.text.substring(lastLength) };
        } else if(chunk.swipes?.length > 0) {
            for(const [ i, text ] of Object.entries(chunk.swipes)) {
                // If reasoning is captured, then [0] is reasoning and [1...n] is text; otherwise, [0...n] is text.
                const idx = Number(i) + Number(this.reasoning);
                const lastLength = this.buffer[idx]?.length ?? 0;
                this.buffer[idx] = text;
                return { swipe: Number(idx), text: text.substring(lastLength) };
            }
        }

        return { swipe: 0, text: '' };
    }
}

async function responseHandler(response: any, taskId: string, reasoning: boolean = false): Promise<string[] | string> {
    const result = extractText(response, reasoning);

    await eventSource.emit(eventTypes.GENERATION_END, {
        taskId,
        error: response.error ?? null,
        responses: result,
    });

    return result.length === 1 ? result[0] : result;
}

function extractText(data: any, reasoning: boolean = false): string[] {
    if(typeof data === 'string') {
        if(reasoning)
            return [ '', data ];
        return [ data ];
    }

    let result : string[] = [];
    if(data?.choices?.length > 0) {
        for(const [ i, candidate ] of Object.entries(data.choices)) {
            if(reasoning) // @ts-expect-error: 18046
                result[0] = candidate.message?.reasoning_content ?? candidate.reasoning_content ?? '';
            
            // @ts-expect-error: 18046
            result[Number(i) + Number(reasoning)] = candidate.message?.content ?? candidate.text ?? '';
        }
    } else if(data?.message?.content?.length > 0) {
        for(const [i, candidate] of Object.entries(data.message.content)) {
            if(reasoning) // @ts-expect-error: 18046
                result[0] = candidate.reasoning_content ?? '';

            // @ts-expect-error: 18046
            result[Number(i) + Number(reasoning)] = candidate.text ?? '';
        }
    } else {
        if(reasoning)
            result[0] = data.reasoning_content ?? '';

        result[Number(reasoning)] = data.text ?? data?.message?.tool_plan ?? '';
    }

    return result;
}
