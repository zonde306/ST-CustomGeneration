import { ReasoningType } from "../../../../../reasoning.js";

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
        cooldown: {};
        sticky: {};
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
}
