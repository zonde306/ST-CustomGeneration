import { ReasoningType } from "@st/scripts/reasoning.js";
import { PromptFilter } from '@/functions/message-builder';
import { KNOWN_DECORATORS } from "@/functions/worldinfo";
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

export type ContextRole = 'user' | 'system' | 'assistant' | 'tool';

export interface WorldInfoLoaded {
    globalLore: WorldInfoEntry[];
    characterLore: WorldInfoEntry[];
    chatLore: WorldInfoEntry[];
    personaLore: WorldInfoEntry[];
    type?: string;
    context?: Context;
}

export interface PartialToolCall {
    id?: string;                     // OpenAI / Anthropic tool call ID
    type?: 'function';               // OpenAI fixed value 'function'
    function?: {                     // OpenAI format
        name?: string;
        arguments?: string;          // JSON string
    };
    signature?: string;              // thought signature from toolSignatures
    thoughtSignature?: string;       // Gemini specific
    name?: string;                   // Anthropic / Cohere / Gemini function name
    input?: any;                     // Anthropic input object
    args?: any;                      // Gemini args object
    [key: string]: any;              // other provider extension fields
}

/**
 * The first index represents multiple choices, which we cannot handle.
 * The second index is used for a list of tools that can be invoked concurrently.
 */
export type ToolCalls = PartialToolCall[][];

// Optional thought signature mapping, keyed by tool call id
export type ToolSignatures = Record<string, string>;

export interface ChatCompMessage {
    name?: string;
    role: string;
    content?: string | ChatCompPart[];
    reasoning_content?: string;
    tool_calls?: PartialToolCall[]; // for role=assistant
    tool_call_id?: string; // for role=tool
}

export interface ChatCompPart {
    type: string;
    text?: string;
    image_url?: { url: string; };
    file?: { file_data: string; filename?: string; }
}

type SetElementType<T> = T extends Set<infer U> ? U : never;

export interface PresetPrompt {
    // A name for this prompt. (displayed in the UI)
    name: string;

    // To whom this message will be attributed.
    role: 'user' | 'assistant' | 'system';

    // Filter to specific generation types. empty means all.
    triggers: (SetElementType<typeof KNOWN_DECORATORS> | string)[];

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

    // Include this prompt's content in the World Info activation scan.
    // Only resolvable-before-scan prompts are supported, see SCANNABLE_INTERNALS.
    scan?: boolean;
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

/**
 * Generic sub-generation configuration package (formerly `Template`).
 * Identity is the triple `kind + binding + tag`.
 */
export interface GenerationProfile {
    // Stable unique id (auto-generated on normalize).
    id: string;

    // Caller domain: 'trigger' | 'agent' | future 'memory' | 'summary' ...
    kind: string;

    // Binding key within the kind:
    // - kind 'trigger': decorator name (must be in KNOWN_DECORATORS), e.g. '@@replace'
    // - kind 'agent': agent name (empty = default for all agents)
    binding: SetElementType<typeof KNOWN_DECORATORS> | string;

    // can be empty, used by (@@<decorator> <tag>)
    tag: string;

    // profile prompts
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

/** @deprecated Use {@link GenerationProfile}. */
export type Template = GenerationProfile;

/** Well-known profile kinds. Callers may define new ones (e.g. 'memory', 'summary'). */
export const PROFILE_KINDS = {
    TRIGGER: 'trigger',
    AGENT: 'agent',
} as const;

/**
 * The namespaced generation-type value of a profile, used to match
 * `PresetPrompt.triggers` / `ToolSettings.triggers`, e.g. 'trigger:@@replace'.
 */
export function profileTypeValue(profile: Pick<GenerationProfile, 'kind' | 'binding'>): string {
    return `${profile.kind}:${profile.binding}`;
}

/**
 * Match a prompt/tool trigger list against a generation type.
 * Exact match, or kind-level match for namespaced types
 * (a bare 'agent' entry matches 'agent:router').
 */
export function matchesTriggerType(triggers: string[], type: string): boolean {
    if (triggers.includes(type))
        return true;

    const colon = type.indexOf(':');
    return colon > 0 && triggers.includes(type.slice(0, colon));
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

export interface StorageSettings {
    /** Automatically flatten cold layers when the stored data grows too large. */
    autoCompact: boolean;

    /** Keep this many trailing messages un-compacted. Must exceed the hot window. */
    keepDepth: number;

    /** Estimated `cg_data` bytes above which auto compaction kicks in. */
    sizeThreshold: number;

    /** Migrate and drop the legacy `wi_overrides` / `mes_override` fields. */
    pruneLegacy: boolean;

    /** Include the chat workspace (root files) in the fuzzy search index. */
    fuzzyIndexFiles: boolean;
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

    // Take over ST's native Generate() via generate_interceptor
    interceptGenerate: boolean;

    // layered data storage / virtual file system
    storage: StorageSettings;

    // one-off migrations already applied, keyed by migration id
    migrations: Record<string, boolean>;
}

export interface ToolSettings {
    // Enable or disable?
    enabled: boolean;

    // Filter to specific generation types. empty means all.
    triggers: (SetElementType<typeof KNOWN_DECORATORS> | string)[];

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

export interface Skill {
    name: string;
    description: string;
    body: string;
    entry: WorldInfoEntry;
}

export const TEMPLATE_FILTER_OPTIONS = [
    'main',
    'personaDescription',
    'charDescription',
    'charPersonality',
    'scenario',
    'chatExamples',
    'worldInfoBefore',
    'worldInfoAfter',
    'chatHistory',
    'worldInfoDepth',
    'authorsNoteDepth',
    'presetDepth',
    'charDepth',
    'worldInfoOutlet',
    'charNote',
    'authorsNote',
    'lastCharMessage',
    'lastUserMessage',
    'worldInfoDepth0',
    'worldInfoDepth1',
    'worldInfoDepth2',
    'worldInfoDepth3',
    'worldInfoDepth4',
    'presetDepth0',
    'presetDepth1',
    'presetDepth2',
    'presetDepth3',
    'presetDepth4',
    'chatDepth0',
    'chatDepth1',
    'chatDepth2',
    'chatDepth3',
    'chatDepth4',
    'toolCalls',
    'skillDefinitions',
    'skillBodies',
];

/**
 * Internal prompts whose content can be resolved before the World Info scan runs,
 * so they may be used as extra activation text. All other internals are derived
 * from the scan result and would create a circular dependency.
 */
export const SCANNABLE_INTERNALS: readonly (typeof TEMPLATE_FILTER_OPTIONS[number])[] = [
    'lastCharMessage',
    'lastUserMessage',
    'chatDepth0',
    'chatDepth1',
    'chatDepth2',
    'chatDepth3',
    'chatDepth4',
];
