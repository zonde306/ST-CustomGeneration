import { eventSource, event_types } from '../../../../../events.js';
import { oai_settings, sendOpenAIRequest, chat_completion_sources } from '../../../../../openai.js';
import { TokenLogprobs } from '../../../../../logprobs.js';
import { uuidv4 } from '../../../../../utils.js';

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
    abortController: AbortController,
    taskId: string = '',
    api?: ApiConfig,
    customOptions?: Record<string, any>,
): Promise<string | string[]> {
    if(!taskId)
        taskId = uuidv4();

    let eventHandler: Function | null = null;
    const originalStream = oai_settings.stream_openai;
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
            const handler = new StreamHandler(taskId, abortController);
            handler.generator = await sendOpenAIRequest(api?.type || 'quiet', messages, abortController.signal) as typeof handler.generator;
            result = await handler.generate();
        } else {
            oai_settings.stream_openai = false;
            const response = await sendOpenAIRequest(api?.type || 'quiet', messages, abortController.signal);
            result = await responseHandler(response, taskId);
        }
    } catch(err) {
        console.error(`Error generating`, err);
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
    public abortController: AbortController;
    private buffer: string[];
    private taskId: string;

    constructor(taskId: string, abortController?: AbortController) {
        this.taskId = taskId;
        this.abortController = abortController ?? new AbortController();
        this.buffer = [];
    }

    async generate() : Promise<string | string[]> {
        if(!this.generator)
            throw new Error('Generator is not set');

        let lastError = null;
        try {
            for await (const chunk of this.generator()) {
                const { swipe, text } = this.parseChunk(chunk);
                if(!text)
                    continue;

                await eventSource.emit("ltm_generate_chunk", {
                    taskId: this.taskId,
                    swipe,
                    text,
                    buffer: this.buffer,
                });
            }
        } catch (err) {
            lastError = err;
        }

        await eventSource.emit("ltm_generate_done", {
            taskId: this.taskId,
            error: lastError,
            response: this.buffer,
        });

        return this.buffer.length === 1 ? this.buffer[0] : this.buffer;
    }

    parseChunk(chunk: StreamChunk): { swipe: number, text: string } {
        if(chunk.text) {
            const lastLength = this.buffer[0]?.length ?? 0;
            this.buffer[0] = chunk.text;
            return { swipe: 0, text: chunk.text.substring(lastLength) };
        } else if(chunk.swipes?.length > 0) {
            for(const i in chunk.swipes) {
                const lastLength = this.buffer[i]?.length ?? 0;
                this.buffer[i] = chunk.swipes[i];
                return { swipe: Number(i), text: chunk.swipes[i].substring(lastLength) };
            }
        }

        return { swipe: 0, text: '' };
    }
}

async function responseHandler(response: any, taskId: string): Promise<string[] | string> {
    const result = extractText(response);

    await eventSource.emit("ltm_generate_done", {
        taskId,
        error: response.error ?? null,
        response: result,
    });

    return result.length === 1 ? result[0] : result;
}

function extractText(data: any): string[] {
    if(typeof data === 'string')
        return [ data ];

    let result : string[] = [];
    if(data?.choices?.length > 0) {
        for(const i in data.choices) {
            result[Number(i)] = data.choices[i].message?.content ?? data.choices[i].text ?? '';
        }
    } else if(data?.message?.content?.length > 0) {
        for(const i in data.message.content) {
            result[Number(i)] = data.message.content[i].text ?? '';
        }
    } else {
        result[0] = data.text ?? data?.message?.tool_plan ?? '';
    }

    return result;
}
