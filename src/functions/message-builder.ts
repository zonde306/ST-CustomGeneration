import { PromptContext } from "@/functions/prompt-context";
import { eventSource, event_types } from '@st/scripts/events.js';
import {
    name1,
    name2,
    unshallowCharacter,
    this_chid,
    chat_metadata,
    extension_prompt_roles,
    extension_prompt_types,
    characters,
    depth_prompt_depth_default,
    depth_prompt_role_default,
    baseChatReplace,
    parseMesExamples,
    substituteParams,
} from '@st/script.js';
import { metadata_keys } from '@st/scripts/authors-note.js';
import { world_info_depth } from '@st/scripts/world-info.js';
import { inject_ids } from '@st/scripts/constants.js';
import { settings } from '@/settings';
import { GenerateOptionsLite, ContextRole } from "@/utils/defines";
import { Preset, defaultPreset, RegEx, PresetPrompt } from "@/settings";
import { runRegexScript, substitute_find_regex } from "@st/scripts/extensions/regex/engine.js";
import { wi_anchor_position } from '@st/scripts/world-info.js';
import { DynamicMacroValue } from '@st/scripts/macros/engine/MacroEnv.types.js';

interface ExtensionPrompts {
    value: string,
    position: number,
    depth: number,
    scan: boolean,
    role: number,
    filter: (() => Promise<boolean> | boolean) | null,
};

export interface PromptFilter {
    main?: boolean | string | string[] | ChatCompletionMessage[];
    personaDescription?: boolean | string | string[] | ChatCompletionMessage[];
    charDescription?: boolean | string | string[] | ChatCompletionMessage[];
    charPersonality?: boolean | string | string[] | ChatCompletionMessage[];
    scenario?: boolean | string | string[] | ChatCompletionMessage[];
    chatExamples?: boolean | string | string[] | ChatCompletionMessage[];
    worldInfoBefore?: boolean | string | string[] | ChatCompletionMessage[];
    worldInfoAfter?: boolean | string | string[] | ChatCompletionMessage[];
    chatHistory?: boolean | string | string[] | ChatCompletionMessage[];
    worldInfoDepth?: boolean;
    authorsNoteDepth?: boolean;
    presetDepth?: boolean;
    charDepth?: boolean;
    worldInfoOutlet?: boolean;
}

export interface MacroOverride {
    user?: string;
    char?: string;
    original?: string;
    group?: string;
    macros?: Record<string, DynamicMacroValue>;
};

export class MessageBuilder {
    private chat: ChatMessage[];
    private extensionPrompts: Record<string, ExtensionPrompts>;
    public filters: PromptFilter;
    public macroOverride: MacroOverride;
    public regexs: RegEx[];
    public prompts: PresetPrompt[];

    constructor(chat: ChatMessage[], preset?: Preset) {
        this.chat = chat;
        this.extensionPrompts = {};
        this.filters = {};
        this.macroOverride = {};

        preset = preset ?? settings.presets[Number(settings.currentPreset)] ?? defaultPreset;
        this.regexs = preset.regexs;
        this.prompts = preset.prompts;
    }

    async build(type: string = 'normal', dryRun: boolean = false, wiDepth = world_info_depth): Promise<ChatCompletionMessage[]> {
        const worldinfoTrigger: string[] = this.chat.slice(-wiDepth).map(x => x.mes ?? '');
        const prompt = await PromptContext.create(worldinfoTrigger, type, dryRun, settings.contextSize);
        const historyMessages = this.#buildChatHistory();
        this.#rebuildDepthInjections(prompt, historyMessages);
        const historyInjectedMessages = this.#injectDepthPromptsToHistory(historyMessages, type === 'continue');
        const result = this.#buildMessages(prompt, historyInjectedMessages);
        this.extensionPrompts = {};
        return result;
    }

    async buildFully(type: string = 'normal', options: GenerateOptionsLite = {}, dryRun: boolean = false): Promise<ChatCompletionMessage[]> {
        // Prevent generation from shallow characters
        await unshallowCharacter(this_chid);

        // Occurs every time, even if the generation is aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_STARTED, type, options, dryRun);

        // Occurs only if the generation is not aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, type, options, dryRun);

        const messages = await this.build(type, dryRun);

        await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, { prompt: '', dryRun });
        await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: messages, dryRun });
        await eventSource.emit(event_types.GENERATE_AFTER_DATA, { prompt: messages }, dryRun);
        await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, {
            type: type,
            messages: messages,
            model: 'None',
            temperature: 1.0,
            frequency_penalty: 1.0,
            presence_penalty: 1.0,
            top_p: 1,
            max_tokens: 2048,
            stream: false,
            logit_bias: {},
            stop: [],
            chat_completion_source: 'openai',
            n: 1,
            user_name: name1,
            char_name: name2,
            group_names: [],
            include_reasoning: false,
            reasoning_effort: 'none',
            enable_web_search: false,
            request_images: false,
            request_image_resolution: '',
            request_image_aspect_ratio: '',
            custom_prompt_post_processing: 'none',
            verbosity: '',
        });

        return messages;
    }

    #buildMessages(prompts: PromptContext, historyMessages: ChatCompletionMessage[]): ChatCompletionMessage[] {
        if (!this.prompts.length) {
            const messages = [...historyMessages];
            const authorNoteRange = this.#insertAuthorsNoteByMetadata(messages, null);
            this.#insertWorldInfoAroundAuthorsNote(messages, prompts, authorNoteRange);
            this.#assignOutletMacros(messages);
            return this.#postprocessMessages(messages);
        }

        const messages: ChatCompletionMessage[] = [];
        let mainPromptRange: { start: number, end: number } | null = null;

        for (const preset of this.prompts) {
            if (!preset.enabled || preset.injectionPosition === 'inChat') {
                continue;
            }

            const insertStart = messages.length;

            if (preset.internal) {
                const filting = this.filters[preset.internal];
                if(filting === false)
                    continue;

                let content: string | string[] | ChatCompletionMessage[] = '';
                if(filting === 'string' || Array.isArray(filting)) {
                    content = filting;
                } else {
                    switch (preset.internal) {
                        case 'main':
                            // main prompt 优先使用预设的
                            content = preset.prompt || prompts.mainPrompt;
                            break;
                        case 'personaDescription':
                            content = prompts.personaDescription;
                            break;
                        case 'charDescription':
                            content = prompts.charDescription;
                            break;
                        case 'charPersonality':
                            content = prompts.charPersonality;
                            break;
                        case 'scenario':
                            content = prompts.scenario;
                            break;
                        case 'chatExamples':
                            content = this.#buildExampleMessages(prompts);
                            break;
                        case 'worldInfoBefore':
                            content = this.#applyRegex(prompts.worldInfoCharBefore, { world: true });
                            break;
                        case 'worldInfoAfter':
                            content = this.#applyRegex(prompts.worldInfoCharAfter, { world: true });
                            break;
                        case 'chatHistory':
                            content = historyMessages;
                            break;
                    }
                }

                this.#appendPresetContent(messages, preset.role, content);
            } else {
                this.#appendPresetContent(messages, preset.role, preset.prompt);
            }

            if (preset.internal === 'main' && messages.length > insertStart) {
                mainPromptRange = {
                    start: insertStart,
                    end: messages.length - 1,
                };
            }
        }

        const authorNoteRange = this.#insertAuthorsNoteByMetadata(messages, mainPromptRange);
        this.#insertWorldInfoAroundAuthorsNote(messages, prompts, authorNoteRange);
        this.#assignOutletMacros(messages);
        return this.#postprocessMessages(messages);
    }

    #appendPresetContent(messages: ChatCompletionMessage[], fallbackRole: ContextRole, content: string | string[] | ChatCompletionMessage[]) {
        if (typeof content === 'string') {
            const text = content.trim();
            if (text) {
                messages.push({
                    role: fallbackRole,
                    content: text,
                });
            }
            return;
        }

        if (!Array.isArray(content) || content.length === 0) {
            return;
        }

        if (typeof content[0] === 'string') {
            for (const text of content) {
                const value = String(text ?? '').trim();
                if (!value) {
                    continue;
                }

                messages.push({
                    role: fallbackRole,
                    content: value,
                });
            }
            return;
        }

        for (const item of content as ChatCompletionMessage[]) {
            const role = this.#normalizeRole(item.role);
            const value = String(item.content ?? '').trim();
            if (!value) {
                continue;
            }

            messages.push({
                role,
                content: value,
            });
        }
    }

    #insertAuthorsNoteByMetadata(
        messages: ChatCompletionMessage[],
        mainPromptRange: { start: number, end: number } | null,
    ): { start: number, end: number } | null {
        const prompt = String(chat_metadata[metadata_keys.prompt] ?? '').trim();
        if (!prompt) {
            return null;
        }

        const position = Number(chat_metadata[metadata_keys.position]);
        // In-chat depth position is injected into chat-history to avoid duplicated note.
        if (position === 1) {
            return null;
        }

        const role = this.#normalizeRole(chat_metadata[metadata_keys.role]);
        const noteMessage: ChatCompletionMessage = {
            role,
            content: this.#evaluateMacros(prompt),
        };

        const insertIndex = position === 2
            ? (mainPromptRange ? mainPromptRange.start : 0)
            : (mainPromptRange ? (mainPromptRange.end + 1) : messages.length);

        messages.splice(insertIndex, 0, noteMessage);

        return {
            start: insertIndex,
            end: insertIndex,
        };
    }

    #insertWorldInfoAroundAuthorsNote(
        messages: ChatCompletionMessage[],
        prompts: PromptContext,
        authorNoteRange: { start: number, end: number } | null,
    ) {
        const beforeEntries = prompts.worldInfoAuthorNoteBefore
            .map(entry => String(entry ?? '').trim())
            .filter(Boolean);
        const afterEntries = prompts.worldInfoAuthorNoteAfter
            .map(entry => String(entry ?? '').trim())
            .filter(Boolean);

        if ((!beforeEntries.length && !afterEntries.length) || !authorNoteRange) {
            return;
        }

        const self = this;
        const noteRole = this.#normalizeRole(messages[authorNoteRange.start]?.role ?? chat_metadata[metadata_keys.role]);
        const beforeMessages = beforeEntries.map(content => ({ role: noteRole, content: this.#evaluateMacros(self.#applyRegex(content, { world: true })) } as ChatCompletionMessage));
        const afterMessages = afterEntries.map(content => ({ role: noteRole, content: this.#evaluateMacros(self.#applyRegex(content, { world: true })) } as ChatCompletionMessage));

        if (beforeMessages.length) {
            messages.splice(authorNoteRange.start, 0, ...beforeMessages);
        }

        if (afterMessages.length) {
            const afterInsertIndex = authorNoteRange.end + beforeMessages.length + 1;
            messages.splice(afterInsertIndex, 0, ...afterMessages);
        }
    }

    #buildChatHistory(): ChatCompletionMessage[] {
        const self = this;
        const history: ChatCompletionMessage[] = this.chat.map((msg, idx) => ({
            role: msg.is_user ? 'user' : msg.is_system ? 'system' : 'assistant',
            content: self.#applyRegex(msg.mes ?? '', {
                user: msg.is_user,
                assistant: !msg.is_user && !msg.is_system,
                depth: this.chat.length - idx - 1,
            }),
        }));

        return history;
    }

    #injectDepthPromptsToHistory(history: ChatCompletionMessage[], isContinue: boolean): ChatCompletionMessage[] {
        const depthBuckets = new Map<number, Map<ContextRole, string[]>>();
        let maxDepth = 0;

        for (const prompt of Object.values(this.extensionPrompts)) {
            if (prompt.position !== extension_prompt_types.IN_CHAT) {
                continue;
            }

            const value = String(prompt.value ?? '').trim();
            if (!value) {
                continue;
            }

            const depth = this.#normalizeDepth(prompt.depth, 0);
            const role = this.#normalizeRole(prompt.role);

            if (!depthBuckets.has(depth)) {
                depthBuckets.set(depth, new Map<ContextRole, string[]>());
            }

            const roleMap = depthBuckets.get(depth)!;
            if (!roleMap.has(role)) {
                roleMap.set(role, []);
            }

            roleMap.get(role)!.push(value);
            maxDepth = Math.max(maxDepth, depth);
        }

        if (depthBuckets.size === 0) {
            return history;
        }

        const roleOrder: ContextRole[] = ['system', 'user', 'assistant'];
        const reversedHistory = [...history].reverse();
        let inserted = 0;

        for (let depth = 0; depth <= maxDepth; depth++) {
            const roleMap = depthBuckets.get(depth);
            if (!roleMap) {
                continue;
            }

            const roleMessages: ChatCompletionMessage[] = [];
            for (const role of roleOrder) {
                const lines = roleMap.get(role) ?? [];
                const text = lines.join('\n').trim();
                if (!text) {
                    continue;
                }

                roleMessages.push({ role, content: this.#evaluateMacros(text) });
            }

            if (!roleMessages.length) {
                continue;
            }

            const injectionDepth = isContinue && depth === 0 ? 1 : depth;
            const injectIndex = Math.min(injectionDepth + inserted, reversedHistory.length);
            reversedHistory.splice(injectIndex, 0, ...roleMessages);
            inserted += roleMessages.length;
        }

        return reversedHistory.reverse();
    }

    #rebuildDepthInjections(prompts: PromptContext, historyMessages: ChatCompletionMessage[]) {
        this.#removeDepthPrompts();
        this.#flushWIInjections();

        if(this.filters.presetDepth !== false)
            this.#injectPresetDepthPrompts(prompts, historyMessages);

        if(this.filters.charDepth !== false)
            this.#injectCharacterDepthPrompt(prompts.charDepthPrompt);

        if(this.filters.worldInfoDepth !== false)
            this.#injectWorldInfoDepth(prompts.worldInfoDepth);

        if(this.filters.worldInfoOutlet !== false)
            this.#injectOutletEntries(prompts.worldInfoOutletEntries);

        if(this.filters.authorsNoteDepth !== false)
            this.#injectAuthorsNoteDepthPrompt();
    }

    #injectPresetDepthPrompts(prompts: PromptContext, historyMessages: ChatCompletionMessage[]) {
        if (!this.prompts.length) {
            return;
        }

        const inChatPrompts = this.prompts
            .map((preset, index) => ({ preset, index }))
            .filter(({ preset }) => preset.enabled && preset.injectionPosition === 'inChat')
            .sort((a, b) => {
                const orderA = Number.isFinite(a.preset.injectionOrder) ? Math.trunc(a.preset.injectionOrder) : 0;
                const orderB = Number.isFinite(b.preset.injectionOrder) ? Math.trunc(b.preset.injectionOrder) : 0;
                if (orderA !== orderB) {
                    return orderA - orderB;
                }

                return a.index - b.index;
            });

        if (!inChatPrompts.length) {
            return;
        }

        let sequence = 0;

        const appendValue = (value: string, role: unknown, depth: number) => {
            const text = String(value ?? '').trim();
            if (!text) {
                return;
            }

            const extensionRole = this.#normalizeExtensionRole(role);
            this.#setExtensionPrompt(
                `${inject_ids.DEPTH_PROMPT}_PRESET_${sequence++}`,
                text,
                extension_prompt_types.IN_CHAT,
                depth,
                false,
                extensionRole,
            );
        };

        for (const { preset } of inChatPrompts) {
            const depth = this.#normalizeDepth(preset.injectionDepth, depth_prompt_depth_default);

            let content: string | string[] | ChatCompletionMessage[] = '';
            if (preset.internal) {
                switch (preset.internal) {
                    case 'main':
                        content = preset.prompt || prompts.mainPrompt;
                        break;
                    case 'personaDescription':
                        content = prompts.personaDescription;
                        break;
                    case 'charDescription':
                        content = prompts.charDescription;
                        break;
                    case 'charPersonality':
                        content = prompts.charPersonality;
                        break;
                    case 'scenario':
                        content = prompts.scenario;
                        break;
                    case 'chatExamples':
                        content = this.#buildExampleMessages(prompts);
                        break;
                    case 'worldInfoBefore':
                        content = this.#applyRegex(prompts.worldInfoCharBefore, { world: true });
                        break;
                    case 'worldInfoAfter':
                        content = this.#applyRegex(prompts.worldInfoCharAfter, { world: true });
                        break;
                    case 'chatHistory':
                        content = historyMessages;
                        break;
                }
            } else {
                content = preset.prompt;
            }

            if (typeof content === 'string') {
                appendValue(content, preset.role, depth);
                continue;
            }

            if (!Array.isArray(content) || content.length === 0) {
                continue;
            }

            if (typeof content[0] === 'string') {
                for (const text of content as string[]) {
                    appendValue(text, preset.role, depth);
                }
                continue;
            }

            for (const item of content as ChatCompletionMessage[]) {
                appendValue(String(item.content ?? ''), item.role, depth);
            }
        }
    }

    #injectCharacterDepthPrompt(text: string) {
        const value = String(text ?? '').trim();
        if (!value) {
            return;
        }

        const charIndex = this_chid !== undefined ? Number(this_chid) : NaN;
        const depthPromptConfig = Number.isFinite(charIndex)
            ? characters[charIndex]?.data?.extensions?.depth_prompt
            : undefined;

        const depth = this.#normalizeDepth(
            depthPromptConfig?.depth,
            depth_prompt_depth_default,
        );
        const role = this.#normalizeExtensionRole(
            depthPromptConfig?.role ?? depth_prompt_role_default,
        );

        this.#setExtensionPrompt(
            inject_ids.DEPTH_PROMPT,
            value,
            extension_prompt_types.IN_CHAT,
            depth,
            false,
            role,
        );
    }

    #injectWorldInfoDepth(worldInfoDepth: { depth: number, entries: string[], role: string | number }[]) {
        if (!Array.isArray(worldInfoDepth) || worldInfoDepth.length === 0) {
            return;
        }

        for (const entry of worldInfoDepth) {
            if (!entry || !Array.isArray(entry.entries) || entry.entries.length === 0) {
                continue;
            }

            const value = entry.entries.join('\n').trim();
            if (!value) {
                continue;
            }

            const depth = this.#normalizeDepth(entry.depth, depth_prompt_depth_default);
            const role = this.#normalizeExtensionRole(entry.role);

            this.#setExtensionPrompt(
                inject_ids.CUSTOM_WI_DEPTH_ROLE(depth, role),
                value,
                extension_prompt_types.IN_CHAT,
                depth,
                false,
                role,
            );
        }
    }

    #injectOutletEntries(outletEntries: Record<string, string[]>) {
        if (!outletEntries || typeof outletEntries !== 'object') {
            return;
        }

        for (const [key, values] of Object.entries(outletEntries)) {
            if (!Array.isArray(values) || values.length === 0) {
                continue;
            }

            const value = values.join('\n').trim();
            if (!value) {
                continue;
            }

            this.#setExtensionPrompt(
                inject_ids.CUSTOM_WI_OUTLET(key),
                value,
                extension_prompt_types.NONE,
                0,
            );
        }
    }

    #injectAuthorsNoteDepthPrompt() {
        const prompt = String(chat_metadata[metadata_keys.prompt] ?? '').trim();
        if (!prompt || Number(chat_metadata[metadata_keys.position]) !== 1) {
            return;
        }

        const depth = this.#normalizeDepth(chat_metadata[metadata_keys.depth], depth_prompt_depth_default);
        const role = this.#normalizeExtensionRole(chat_metadata[metadata_keys.role]);

        this.#setExtensionPrompt(
            `${inject_ids.DEPTH_PROMPT}_AUTHOR_NOTE`,
            prompt,
            extension_prompt_types.IN_CHAT,
            depth,
            false,
            role,
        );
    }

    #normalizeDepth(value: unknown, fallback: number): number {
        const depth = Number(value);
        if (!Number.isFinite(depth) || depth < 0) {
            return fallback;
        }

        return Math.floor(depth);
    }

    #normalizeRole(value: unknown): ContextRole {
        if (typeof value === 'number') {
            switch (value) {
                case extension_prompt_roles.USER:
                    return 'user';
                case extension_prompt_roles.ASSISTANT:
                    return 'assistant';
                default:
                    return 'system';
            }
        }

        switch (String(value ?? '').toLowerCase()) {
            case 'user':
                return 'user';
            case 'assistant':
                return 'assistant';
            default:
                return 'system';
        }
    }

    #normalizeExtensionRole(value: unknown): typeof extension_prompt_roles[keyof typeof extension_prompt_roles] {
        if (typeof value === 'number' && Object.values(extension_prompt_roles).includes(value as any)) {
            return value as typeof extension_prompt_roles[keyof typeof extension_prompt_roles];
        }

        switch (String(value ?? '').toLowerCase()) {
            case 'user':
                return extension_prompt_roles.USER;
            case 'assistant':
                return extension_prompt_roles.ASSISTANT;
            default:
                return extension_prompt_roles.SYSTEM;
        }
    }

    /**
     * Sets a prompt injection to insert custom text into any outgoing prompt. For use in UI extensions.
     * @param key Prompt injection id.
     * @param value Prompt injection value.
     * @param position Insertion position. 0 is after story string, 1 is in-chat with custom depth.
     * @param depth Insertion depth. 0 represets the last message in context. Expected values up to MAX_INJECTION_DEPTH.
     * @param role Extension prompt role. Defaults to SYSTEM.
     * @param scan Should the prompt be included in the world info scan.
     * @param filter Filter function to determine if the prompt should be injected.
     */
    #setExtensionPrompt(
        key: string,
        value: string,
        position: number,
        depth: number,
        scan: boolean = false,
        role: typeof extension_prompt_roles[keyof typeof extension_prompt_roles] = extension_prompt_roles.SYSTEM,
        filter: (() => Promise<boolean> | boolean) | null = null,
    ) {
        this.extensionPrompts[key] = {
            value: String(value),
            position: Number(position),
            depth: Number(depth),
            scan: !!scan,
            role: Number(role ?? extension_prompt_roles.SYSTEM),
            filter,
        };
    }

    #removeDepthPrompts() {
        for (const key of Object.keys(this.extensionPrompts)) {
            if (key.startsWith(inject_ids.DEPTH_PROMPT)) {
                delete this.extensionPrompts[key];
            }
        }
    }

    #flushWIInjections() {
        const depthPrefix = inject_ids.CUSTOM_WI_DEPTH;
        const outletPrefix = inject_ids.CUSTOM_WI_OUTLET('');

        for (const key of Object.keys(this.extensionPrompts)) {
            if (key.startsWith(depthPrefix) || key.startsWith(outletPrefix)) {
                delete this.extensionPrompts[key];
            }
        }
    }

    #postprocessMessages(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
        const mergeConsecutive = (input: ChatCompletionMessage[]): ChatCompletionMessage[] => {
            const merged: ChatCompletionMessage[] = [];

            for (const item of input) {
                const role = this.#normalizeRole(item.role);
                const content = String(item.content ?? '').trim();
                if (!content) {
                    continue;
                }

                const prev = merged[merged.length - 1];
                if (prev && prev.role === role) {
                    prev.content = [String(prev.content ?? ''), content].filter(Boolean).join('\n\n');
                } else {
                    merged.push({
                        ...item,
                        role,
                        content,
                    });
                }
            }

            return merged;
        };

        const toAlternate = (input: ChatCompletionMessage[]): ChatCompletionMessage[] => {
            const merged = mergeConsecutive(input);
            const normalized = merged.map((item, index) => {
                let role = this.#normalizeRole(item.role);
                if (index > 0 && role === 'system') {
                    role = 'user';
                }

                return {
                    ...item,
                    role,
                };
            });

            return mergeConsecutive(normalized);
        };

        switch (settings.promptPostProcessing) {
            case 'none':
                return messages;
            case 'merge':
                // 合并连续相同的 role
                return mergeConsecutive(messages);
            case 'semi':
                // 在 merge 的基础上强制 user 和 assistant 交替出现
                return toAlternate(messages);
            case 'strict': {
                // 在 alternate 的基础上要求最后一个 role 必须是 user
                const alternated = toAlternate(messages);
                if (!alternated.length || alternated[alternated.length - 1].role === 'user') {
                    return alternated;
                }

                const lastIndex = alternated.length - 1;
                const adjusted = alternated.map((item, index) => {
                    if (index === lastIndex) {
                        return {
                            ...item,
                            role: 'user',
                        };
                    }

                    return item;
                });

                return mergeConsecutive(adjusted);
            }
            case 'single':
                // 合并为单个 user 消息
                return [{ role: 'user', content: messages.map(item => item.content).join('\n\n') }]
            default:
                return messages;
        }
    }

    #applyRegex(content: string, { user, assistant, depth, world } = {} as { user?: boolean, assistant?: boolean, depth?: number, world?: boolean }): string {
        for(const regex of this.regexs) {
            if(!regex.enabled || regex.ephemerality || !regex.request)
                continue;

            if(regex.worldInfo && world) {
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
            } else if(((regex.userInput && user) ||
                (regex.aiOutput && assistant)) &&
                (regex.minDepth == null || depth == null || depth >= regex.minDepth) &&
                (regex.maxDepth == null || depth == null || depth <= regex.maxDepth)
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

    #buildExampleMessages(prompt: PromptContext): string[] {
        const examples = prompt.chatExampleArray;
        const self = this;

        // Add message example WI
        for (const example of prompt.worldInfoExamples) {
            if (!example.content)
                continue;

            const cleanedExample = parseMesExamples(baseChatReplace(example.content), false).map(s => self.#applyRegex(s, { world: true }));
            // Insert depending on before or after position
            if (example.position === wi_anchor_position.before) {
                examples.unshift(...cleanedExample);
            } else {
                examples.push(...cleanedExample);
            }
        }

        return examples;
    }

    getOutletPrompt(key: string): string {
        const value = this.extensionPrompts[inject_ids.CUSTOM_WI_OUTLET(key)]?.value;
        if(value)
            return this.#evaluateMacros(value);
        return '';
    }

    #assignOutletMacros(history: ChatCompletionMessage[]) {
        const self = this;
        for(const message of history) {
            if(message.content.includes('{{outlet::')) {
                message.content = message.content.replace(/\{\{outlet::(.+?)\}\}/gi, (_, key: string) => self.getOutletPrompt(key));
            }
        }
    }

    #evaluateMacros(content: string): string {
        return substituteParams(
            content,
            {
                name1Override: this.macroOverride.user,
                name2Override: this.macroOverride.char,
                original: this.macroOverride.original,
                groupOverride: this.macroOverride.group,
                dynamicMacros: {
                    lastUserMessage: () => this.chat.findLast(m => m.is_user)?.mes ?? '',
                    lastCharMessage: () => this.chat.findLast(m => !m.is_user && !m.is_system)?.mes ?? '',
                    ...(this.macroOverride.macros ?? {}),
                },
            }
        );
    }
}
