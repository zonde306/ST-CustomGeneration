import { ReasoningType } from "@st/scripts/reasoning.js";
import { PromptFilter } from '@/functions/message-builder';
import { KNOWN_DECORATORS } from "@/functions/worldinfo";
import { TEMPLATE_FILTER_OPTIONS } from "@/settings";
import { Context } from "@/features/context";

type TextContent = {
    type: "text";
    text: string;
}

type ImageContent = {
    type: "image";
    image_url: {
        url: string // base64 encoded image
    };
}

export interface Chat {
    role: string;
    content: string | (TextContent | ImageContent)[];
}

// event_types.CHAT_COMPLETION_PROMPT_READY
export interface ChatData {
    chat: Chat[];
    dryRun: boolean;
}

// Allow custom fields
export interface MessageExtra extends ChatMessageExtra {
    // public/scripts/reasoning.js
    reasoning?: string;
    reasoning_type?: ReasoningType;

    // public/scripts/extensions/memory/index.js
    memory?: string;    // Summary

    // public/scripts/chats.js
    image?: string;
    inline_image?: boolean;
    file?: { url: string, size: number, name: string, created: number, text?: string };
    fileLength?: number;
    image_swipes?: string[];
    title?: string;

    // public/scripts/bookmarks.js
    bookmark_link?: boolean;

    // public/scripts/group-chats.js
    gen_id?: number;

    // public/scripts/slash-commands.js
    bias?: string;

    // public/scripts/extensions/translate/index.js
    display_text?: string;
    reasoning_display_text?: string;
}

// Allow custom fields
export interface Message extends ChatMessage {
    // created by extensions
    variables?: Record<string, unknown>[];
    is_ejs_processed?: Array<boolean>;
    variables_initialized?: boolean[];
}

export interface ScriptInject {
    depth: number;
    filter: string | null;
    position: number;
    role: number;
    scan: boolean;
    value: string;
}

export interface Metadata extends Record<string, unknown> {
    variables?: Record<string, unknown>;
    chat_id_hash?: number;
    lastInContextMessageId?: number;
    note_depth?: number;
    note_interval?: number;
    note_position?: number;
    note_prompt?: string;
    note_role?: number;
    quickReply?: {
        setList: Array<unknown>,
    };
    script_injects?: Record<number, ScriptInject>;
    tainted?: boolean;
    timedWorldInfo?: {
        cooldown: Record<string, any>;
        sticky: Record<string, any>;
    };
}

// event_types.CHAT_COMPLETION_SETTINGS_READY
export interface ChatCompletionReady {
    messages: Array<Chat>;
    model: string;
    temperature?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    top_p?: number;
    max_tokens?: number;
    stream?: boolean;
    logit_bias?: Record<string, number> | undefined;
    stop?: string[] | undefined;
    chat_completion_source?: string;
    n?: number | undefined;
    user_name?: string;
    char_name?: string;
    group_names?: string[];
    show_thoughts?: boolean;
    reverse_proxy?: string;
    proxy_password?: string;
    logprobs?: number | undefined;
    top_k?: number;
    claude_use_sysprompt?: boolean;
    assistant_prefill?: string;
    min_p?: number;
    repetition_penalty?: number;
    top_a?: number;
    use_fallback?: boolean;
    provider?: string;
    allow_fallbacks?: boolean;
    middleout?: boolean;
    api_url_scale?: string;
    max_completion_tokens?: number;
    seed?: number;
    tools?: any[];
    tool_choice?: string;
    assistant_impersonation?: string;
}

export interface CombinedPromptData {
    prompt: string;
    dryRun: boolean;
}

export interface GenerateAfterData {
    prompt: string | Chat[];
}

export interface WorldInfoLoaded {
    globalLore: WorldInfoEntry[];
    characterLore: WorldInfoEntry[];
    chatLore: WorldInfoEntry[];
    personaLore: WorldInfoEntry[];
}

export interface WorldInfoScan {
    state: {
        current: number;
        next: number;
        loopCount: number;
    };
    new: {
        all: WorldInfoEntry[];
        successful: WorldInfoEntry[];
    };
    activated: {
        entries: WorldInfoEntry[];
        text: string;
    };
    sortedEntries: WorldInfoEntry[];
    recursionDelay: {
        availableLevels: number[];
        currentLevel: number;
    };
    budget: {
        current: number;
        overflowed: boolean;
    };
    /** @type {import('../../../../../world-info.js').WorldInfoTimedEffects} */
    timedEffects: any;
}

interface WorldInfoExtension {
    position: number;
    exclude_recursion: boolean;
    display_index: number;
    probability: number;
    useProbability: boolean;
    depth: number;
    selectiveLogic: number;
    group: string;
    group_override: boolean;
    group_weight: number;
    prevent_recursion: boolean;
    delay_until_recursion: boolean;
    scan_depth: number | null;
    match_whole_words: boolean | null;
    use_group_scoring: boolean | null;
    case_sensitive: boolean | null;
    automation_id: string;
    role: null | number;
    vectorized: boolean;
    sticky: number;
    cooldown: number;
    delay: number;
    match_persona_description: boolean;
    match_character_description: boolean;
    match_character_personality: boolean;
    match_character_depth_prompt: boolean;
    match_scenario: boolean;
    match_creator_notes: boolean;
    ignoreBudget: boolean;
}

export interface WorldInfoEntry {
    uid: number;
    key: string[];
    keysecondary: string[];
    comment: string; // Title/Memo
    content: string;
    constant: boolean; // 🔵 Constant
    vectorized: boolean; // 🔗 Vectorized
    selective: boolean;
    selectiveLogic: number;
    addMemo: boolean;
    order: number;
    position: number;
    disable: boolean;
    excludeRecursion: boolean;
    preventRecursion: boolean;
    delayUntilRecursion: boolean;
    probability: number;
    useProbability: boolean;
    depth: number;
    group: string;
    groupOverride: boolean;
    groupWeight: number;
    scanDepth: number | null;
    caseSensitive: boolean | null;
    matchWholeWords: null | number;
    useGroupScoring: boolean | null;
    automationId: string;
    role: null | number;
    sticky: number;
    cooldown: number;
    delay: number;
    displayIndex: number;
    world: string;
    decorators: string[]; // A list of identifiers starting with @@ extracted from `content`
    extensions: WorldInfoExtension;
    hash: number | undefined; // getStringHash(JSON.stringify(entry))
    triggers: string[];
    outletName: string;

    // Filter to Characters or Tags
    characterFilter: WorldInfoFilter;
    characterFilterNames: string[];
    characterFilterTags: string[];
    characterFilterExclude: boolean;
    
    // Additional Matching Sources
    matchPersonaDescription: boolean;
    matchCharacterDescription: boolean;
    matchCharacterPersonality: boolean;
    matchCharacterDepthPrompt: boolean;
    matchScenario: boolean;
    matchCreatorNotes: boolean;
    ignoreBudget: boolean;
}

interface WorldInfoFilter {
    isExclude: boolean;
    names: string[];
    tags: string[];
}

export interface LoreBook {
    entries: Record<string, WorldInfoEntry>;
}

export type GenerateOptionsLite = {
    signal?: AbortSignal,
    quietName?: string,
};

export type ContextRole = 'user' | 'system' | 'assistant';

export interface WorldInfoLoaded {
    globalLore: WorldInfoEntry[];
    characterLore: WorldInfoEntry[];
    chatLore: WorldInfoEntry[];
    personaLore: WorldInfoEntry[];
    type?: string;
    context?: Context;
}

export interface PartialToolCall {
    id?: string;                     // OpenAI / Anthropic 工具调用 ID
    type?: 'function';               // OpenAI 固定为 'function'
    function?: {                     // OpenAI 格式
        name?: string;
        arguments?: string;          // JSON 字符串
    };
    signature?: string;              // 来自 toolSignatures 的 thought signature
    thoughtSignature?: string;       // Gemini 特有
    name?: string;                   // Anthropic / Cohere / Gemini 函数名
    input?: any;                     // Anthropic 输入对象
    args?: any;                      // Gemini 参数对象
    [key: string]: any;              // 其他供应商扩展字段
}

/**
 * The first index represents multiple choices, which we cannot handle.
 * The second index is used for a list of tools that can be invoked concurrently.
 */
export type ToolCalls = PartialToolCall[][];

// 可选的 thought signature 映射，键为 tool call id
export type ToolSignatures = Record<string, string>;

export interface PresetPrompt {
    // A name for this prompt. (displayed in the UI)
    name: string;

    // To whom this message will be attributed.
    role: 'user' | 'assistant' | 'system';

    // Filter to specific generation types. empty means all.
    triggers: (typeof KNOWN_DECORATORS[number] | string)[];

    // content (User-defined only)
    prompt: string;

    // Relative (to other prompts in prompt manager) or In-chat @ Depth.
    injectionPosition: 'relative' | 'inChat';

    // null will not be displayed in the list.
    enabled: boolean | null;

    // built-in prompts or user-defined
    internal: (typeof TEMPLATE_FILTER_OPTIONS[number]) | null;

    // (for inChat injectionPosition) 0 = after the last message, 1 = before the last message, etc.
    injectionDepth: number;

    // (for inChat injectionPosition) Ordered from low/top to high/bottom, and at same order: Assistant, User, System.
    injectionOrder: number;

    // How many messages to retain (chatHistory only)
    maxDepth: number;
}

export interface RegEx {
    // Script name  (displayed in the UI)
    name: string;

    // Find Regex (/.../ or plain text)
    regex: string;

    // Replace Regex (use $1, $2, ... to refer to the matched groups)
    replace: string;

    // affects for user input
    userInput: boolean;

    // affects for AI output (assistant)
    aiOutput: boolean;

    // affects for world info
    worldInfo: boolean;

    enabled: boolean;

    // Min Depth
    minDepth: number | null;

    // Max Depth
    maxDepth: number | null;

    // The original text will not be modified.
    ephemerality: boolean;

    // affects for generation request
    request: boolean;

    // affects for generation response
    response: boolean;
}

export interface Template {
    // e.g: @@record, must in KNOWN_DECORATORS lists
    decorator: typeof KNOWN_DECORATORS[number];

    // can be empty, used by (@@<decorator> <tag>)
    tag: string;

    // template prompts
    prompts: PresetPrompt[];

    // Generate a result that matches the regex, and pass Capture Group 1.
    // if regex is empty, will not be used.
    regex: string;

    // Processing is triggered only when the regex matches, treating the captured group as {{lastCharMessage}}.
    // if regex is empty, will not be used.
    findRegex: string;

    // Disable specific prompts, see PromptFilter
    filters: (keyof PromptFilter)[];

    // Retry count
    retryCount: number;

    // Retry interval (ms)
    retryInterval: number;
}

export interface Preset {
    // preset group name (displayed in the UI)
    name: string;

    // preset prompts
    prompts: PresetPrompt[];

    // preset regexs
    regexs: RegEx[];

    // templates
    templates: Record<string, Template>;

    // tools
    tools: Record<string, ToolSettings>;
}

export interface ApiSettings {
    // Custom Endpoint (Base URL)
    baseUrl: string;

    // Custom API Key (Optional)
    apiKey: string;

    // Model ID
    model: string;

    // Context Size (tokens)
    contextSize: number;

    // Max Response Length (tokens)
    maxTokens: number;

    // temperature 0.00~2.00
    temperature: number;

    // top-k sampling 0~40
    topK: number;

    // Top P sampling 0.00~1.00
    topP: number;

    // Frequency Penalty -2.00~2.00
    frequencyPenalty: number;

    // Presence Penalty -2.00~2.00
    presencePenalty: number;

    // streaming mode
    stream: boolean;

    // Additional Parameters: request headers
    includeHeaders: Record<string, unknown>;

    // Additional Parameters: body
    includeBody: Record<string, unknown>;

    // Additional Parameters: exclude body
    excludeBody: Record<string, unknown>;

    // Prompt Post-Processing
    // like: https://docs.sillytavern.app/usage/api-connections/openai/#prompt-post-processing
    promptPostProcessing: 'none' | 'merge' | 'semi' | 'strict' | 'single';

    // linked preset
    linkedPreset: string;

    // max concurrency for world info generation
    maxConcurrency: number;
}

export interface Settings {
    // openai api connections
    apis: Record<string, ApiSettings>;

    // default api (current active api)
    currentApi: string;

    // openai presets, cannot be empty
    presets: Record<string, Preset>;

    // default preset (current active preset)
    currentPreset: string;
}

export interface ToolSettings {
    // Enable or disable?
    enabled: boolean;

    // Filter to specific generation types. empty means all.
    triggers: (typeof KNOWN_DECORATORS[number] | string)[];

    // Description of each parameter
    parameters: Record<string, string>;

    // Tool Description
    description: string;
}

export interface ExportPayload {
    version: string;
    presets: Preset[];
    currentPreset: number;
    apiConnection?: {
        baseUrl: string;
        model: string;
        contextSize: number;
        maxTokens: number;
        temperature: number;
        topK: number;
        topP: number;
        frequencyPenalty: number;
        presencePenalty: number;
        promptPostProcessing: ApiSettings['promptPostProcessing'];
        includeHeaders: Record<string, unknown>;
        includeBody: Record<string, unknown>;
        excludeBody: Record<string, unknown>;
        maxConcurrency: number;
        stream: boolean;
    };
}

export type ListExportKind = 'prompt' | 'regex' | 'template' | 'tool';

export type ListExportItem = {
    id: string;
    label: string;
    checked: boolean;
    data: PresetPrompt | RegEx | Template | ToolSettings;
};

export type ListExportDialogState = {
    kind: ListExportKind | null;
    items: ListExportItem[];
};

export interface ListExportPayload {
    version: string;
    kind: ListExportKind;
    items: Array<PresetPrompt | RegEx | Template | ToolSettings>;
}

export interface ImportPayload {
    version?: unknown;
    presets?: unknown;
    currentPreset?: unknown;
    apiConnection?: {
        baseUrl?: unknown;
        model?: unknown;
        contextSize?: unknown;
        maxTokens?: unknown;
        temperature?: unknown;
        topK?: unknown;
        topP?: unknown;
        frequencyPenalty?: unknown;
        presencePenalty?: unknown;
        promptPostProcessing?: unknown;
        includeHeaders?: unknown;
        includeBody?: unknown;
        excludeBody?: unknown;
        apiKey?: unknown;
        maxConcurrency?: number;
        stream?: boolean;
    };
}

// API connection export payload
export interface ApiExportPayload {
    version: string;
    apis: Record<string, ApiSettings>;
    currentApi: string;
}

// API connection import payload (for validation)
export interface ApiImportPayload {
    version?: unknown;
    apis?: unknown;
    currentApi?: unknown;
}

export interface ToolDefinition {
    type?: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
        strict?: boolean;
    }
}

export interface ToolMessage {
    role: "tool";
    tool_call_id: string; // for PartialToolCall.id
    content: string;
}
