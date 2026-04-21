import { eventSource, event_types } from '@st/scripts/events.js';
import { oai_settings, sendOpenAIRequest, chat_completion_sources } from '@st/scripts/openai.js';
import { TokenLogprobs } from '@st/scripts/logprobs.js';
import { uuidv4 } from '@st/scripts/utils.js';
import { eventTypes } from '@/utils/events'
import { ToolCalls, ToolSignatures, PartialToolCall, ToolDefinition } from '@/utils/defines';

export interface ApiConfig {
    url: string;
    key: string;
    model: string;
    type?: string;

    // `openai` is generally used.
    source?: string;

    stream?: boolean | null;
    max_context?: number | null;
    max_tokens?: number | null;
    temperature?: number | null;
    top_p?: number | null;
    top_k?: number | null;
    frequency_penalty?: number | null;
    presence_penalty?: number | null;
    
    custom_exclude_body?: string; // yaml string
    custom_include_body?: string; // yaml string
    custom_include_headers?: string; // yaml string
}

export interface Response {
    swipes: string[];
    toolCalls: ToolCalls;
    reasoning: string[]; // Streaming multi-swipe only provides the first one
}

// When making a tool call, only need to retrieve the last `toolCalls` response, which is complete.
export interface StreamResponse {
    toolCalls: PartialToolCall[]; // All chunk combinations
    swipe: number;
    reasoning: string; // chunk only
    text: string; // chunk only
}

interface StreamChunk {
    text: string, // The content of the current chunk
    swipes: string[], // Aggregate the contents of all historical chunks.
    logprobs: TokenLogprobs[],
    toolCalls: ToolCalls, // Aggregate the tool calls of all historical chunks.
    state: {
        reasoning: string, // Aggregate the contents of all historical chunks.
        images: never[], // unsupported for openai
        signature: string,
        toolSignatures: ToolSignatures
    }
}

export async function generate(
    messages: ChatCompletionMessage[],
    {
        signal,
        taskId,
        api,
        hiddenOptions: customOptions,
        streaming,
        tools,
        tool_choice,
    } : {
        signal?: AbortSignal,
        taskId?: string,
        api?: ApiConfig,
        hiddenOptions?: Record<string, any>,
        streaming?: boolean,
        tools?: ToolDefinition[],
        tool_choice?: 'none' | 'auto' | 'required',
    } = {}
): Promise<Response | AsyncGenerator<StreamResponse>> {
    if(!taskId)
        taskId = uuidv4();

    let eventHandler: ((data: any) => void) | null = null;
    const originalStream = oai_settings.stream_openai;
    const originalFunctionCalling = oai_settings.function_calling;

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

            if(tools?.length)
                data.tools = tools;
            if(tools?.length && tool_choice?.length)
                data.tool_choice = tool_choice;

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
            oai_settings.function_calling = originalFunctionCalling;
        };

        // compatibility with other extensions and API parameter passing
        eventSource.makeFirst(event_types.CHAT_COMPLETION_SETTINGS_READY, eventHandler);
    }

    let result = null;
    signal = signal ?? new AbortController().signal;
    taskId = taskId || uuidv4();
    try {
        // Disabling injection of built-in tools
        oai_settings.function_calling = false;
        if(api?.stream) {
            oai_settings.stream_openai = true;
            const handler = new StreamHandler(taskId, signal);
            handler.generator = await sendOpenAIRequest(api?.type || 'quiet', messages, signal) as typeof handler.generator;
            if(streaming)
                result = handler.streaming();
            else
                result = await handler.generate();
        } else {
            oai_settings.stream_openai = false;
            const response = await sendOpenAIRequest(api?.type || 'quiet', messages, signal);
            result = await responseHandler(response, taskId);
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
        oai_settings.function_calling = originalFunctionCalling;
    }

    return result;
}

class StreamHandler {
    public generator?: () => AsyncGenerator<StreamChunk>;
    public singal: AbortSignal;
    private buffer: string[];
    private taskId: string;
    public toolCalls: ToolCalls;
    private reasoning: string;

    constructor(taskId: string, singal?: AbortSignal) {
        this.taskId = taskId;
        this.singal = singal ?? new AbortController().signal;
        this.buffer = [];
        this.toolCalls = [];
        this.reasoning = '';
    }

    async generate() : Promise<Response> {
        if(!this.generator)
            throw new Error('Generator is not set');

        let lastError = null;
        try {
            for await (const chunk of this.generator()) {
                if(this.singal.aborted)
                    break;

                this.toolCalls = chunk.toolCalls ?? [];

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

        return { swipes: this.buffer, toolCalls: this.toolCalls, reasoning: [ this.reasoning ] };
    }

    async *streaming(): AsyncGenerator<StreamResponse> {
        if(!this.generator)
            throw new Error('Generator is not set');

        let lastError = null;
        try {
            for await (const chunk of this.generator()) {
                const { swipe, text, reasoning } = this.parseChunk(chunk);
                if(!text && !reasoning)
                    continue;

                await eventSource.emit(eventTypes.GENERATION_STREAM_CHUNK, {
                    taskId: this.taskId,
                    swipe,
                    text,
                    buffer: this.buffer,
                });

                yield { swipe, text, reasoning, toolCalls: chunk.toolCalls[swipe] ?? [] };
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

    parseChunk(chunk: StreamChunk): Omit<StreamResponse, 'toolCalls'> {
        if(chunk.state.reasoning.length > this.reasoning.length) {
            const chunked = chunk.state.reasoning.substring(this.reasoning.length);
            this.reasoning = chunk.state.reasoning;

            // Currently, only the first reasoning can be obtained.
            return { swipe: 0, text: '', reasoning: chunked };
        }

        if(chunk.text) {
            const lastLength = this.buffer[0]?.length ?? 0;
            this.buffer[0] = chunk.text;
            return { swipe: 0, text: chunk.text.substring(lastLength), reasoning: '' };
        } else if(chunk.swipes?.length > 0) {
            for(const [ i, text ] of Object.entries(chunk.swipes)) {
                const idx = Number(i);
                const lastLength = this.buffer[idx]?.length ?? 0;
                this.buffer[idx] = text;
                return { swipe: Number(idx), text: text.substring(lastLength), reasoning: '' };
            }
        }

        return { swipe: 0, text: '', reasoning: '' };
    }
}

async function responseHandler(response: any, taskId: string): Promise<Response> {
    const { swipes, reasoning } = extractText(response);

    await eventSource.emit(eventTypes.GENERATION_END, {
        taskId,
        error: response.error ?? null,
        swipes,
        reasoning,
    });

    return { swipes, reasoning, toolCalls: convertNonStreamingToolCalls(response) };
}

function extractText(data: any): { swipes: string[], reasoning: string[] } {
    if(typeof data === 'string') {
        return { swipes: [data], reasoning: [] };
    }

    const texts : string[] = [];
    const reasoning : string[] = [];
    if(data?.choices?.length > 0) {
        for(const [ i, candidate ] of Object.entries(data.choices)) {
            // @ts-expect-error: 18046
            texts[Number(i)] = candidate.message?.content ?? candidate.text ?? '';
            // @ts-expect-error: 18046
            reasoning[Number(i)] = candidate.message?.thinking ?? candidate.message?.reasoning ?? candidate.message?.reasoning_content ?? '';
        }
    } else if(data?.message?.content?.length > 0) {
        for(const [i, candidate] of Object.entries(data.message.content)) {
            // @ts-expect-error: 18046
            texts[Number(i)] = candidate.text ?? '';
            // @ts-expect-error: 18046
            reasoning[Number(i)] = candidate.message?.thinking ?? candidate.message?.reasoning ?? candidate.message?.reasoning_content ?? '';
        }
    } else {
        texts[0] = data.text ?? data?.message?.tool_plan ?? '';
    }

    return {  swipes: texts, reasoning };
}

function convertNonStreamingToolCalls(responseData: any): ToolCalls {
    const toolCalls: ToolCalls = [];
    const choices = responseData?.choices;
    if (!Array.isArray(choices)) {
        return toolCalls;
    }

    for (let choiceIdx = 0; choiceIdx < choices.length; choiceIdx++) {
        const choice = choices[choiceIdx];
        const message = choice?.message;
        const rawToolCalls = message?.tool_calls;

        if (Array.isArray(rawToolCalls)) {
            toolCalls[choiceIdx] = [...rawToolCalls];
        } else {
            toolCalls[choiceIdx] = [];
        }
    }

    return toolCalls;
}
