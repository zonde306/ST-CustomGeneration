import { eventSource, event_types } from '../../../../../events.js';
import {
    name1,
    unshallowCharacter,
    this_chid,
    chat_metadata,
    extension_prompt_roles,
    extension_prompt_types,
    characters,
    depth_prompt_depth_default,
    depth_prompt_role_default,
} from '../../../../../../script.js';
import { metadata_keys } from '../../../../../authors-note.js';
import { world_info_depth } from '../../../../../world-info.js';
import { inject_ids } from '../../../../../constants.js';
import { settings } from '../settings';
import { PromptBuilder } from '../functions/prompts';
import { generate as runGenerate } from '../functions/generate';

type ContextRole = 'user' | 'system' | 'assistant';

type ExtensionPrompts = {
    value: string,
    position: number,
    depth: number,
    scan: boolean,
    role: number,
    filter: (() => Promise<boolean> | boolean) | null,
};

type GenerateOptionsLite = {
    signal?: AbortSignal,
    quietName?: string,
};

type MainApiConfig = {
    url: string,
    key: string,
    model: string,
    type: string,
    stream?: boolean,
    max_tokens?: number | null,
    temperature?: number | null,
    top_p?: number | null,
    frequency_penalty?: number | null,
    presence_penalty?: number | null,
};

export class Context {
    public chat: ChatMessage[];
    public variables: Record<string, any>;
    public extension_prompts: Record<string, ExtensionPrompts>;

    constructor() {
        this.chat = [];
        this.variables = {};
        this.extension_prompts = {};
    }

    static fromObject(value: Context): Context {
        const context = new Context();
        context.chat = value.chat ?? [];
        context.variables = value.variables ?? {};
        context.extension_prompts = value.extension_prompts ?? {};
        return context;
    }

    toObject(): Object {
        return {
            chat: this.chat,
            variables: this.variables,
            extension_prompts: this.extension_prompts,
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

    async generate(type: string = 'normal', options: GenerateOptionsLite = {}, dryRun: boolean = false): Promise<string> {
        console.log('Generate entered');

        // Prevent generation from shallow characters
        await unshallowCharacter(this_chid);

        // Occurs every time, even if the generation is aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_STARTED, type, options, dryRun);

        // Occurs only if the generation is not aborted due to slash commands execution
        await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, type, options, dryRun);

        const isImpersonate = type === 'impersonate';
        if (type !== 'quiet' && type !== 'swipe' && !isImpersonate && !dryRun && this.chat.length) {
            this.chat.length = this.chat.length - 1;
            await eventSource.emit('ag_message_deleted', this.chat.length);
        }

        const worldinfoTrigger: string[] = this.chat.slice(-world_info_depth).map(x => x.mes ?? '');
        const prompts = await PromptBuilder.create(worldinfoTrigger, type, dryRun);

        this.#rebuildDepthInjections(prompts);
        const historyMessages = this.#buildChatHistoryWithDepthInjection(type === 'continue');
        const messages = this.#buildMessages(prompts, historyMessages);

        if (dryRun) {
            await eventSource.emit('ag_generate_dry_run', { type, options, messages });
            return '';
        }

        const abortController = this.#createAbortController(options.signal);
        const taskId = typeof this.variables?.taskId === 'string' ? this.variables.taskId : '';
        const apiConfig = this.#buildApiConfig(type);

        const result = await runGenerate(messages, abortController, taskId, apiConfig);
        const text = Array.isArray(result) ? (result[0] ?? '') : result;

        return typeof text === 'string' ? text : String(text ?? '');
    }

    #buildMessages(prompts: PromptBuilder, historyMessages: ChatCompletionMessage[]): ChatCompletionMessage[] {
        const currentGroup = settings.presetGroups[Number(settings.currentPresetGroupId)];
        if (!currentGroup?.items?.length) {
            const messages = [...historyMessages];
            const authorNoteRange = this.#insertAuthorsNoteByMetadata(messages, null);
            this.#insertWorldInfoAroundAuthorsNote(messages, prompts, authorNoteRange);
            return this.#postprocessMessages(messages);
        }

        const messages: ChatCompletionMessage[] = [];
        let mainPromptRange: { start: number, end: number } | null = null;

        for (const preset of currentGroup.items) {
            if (!preset.enabled) {
                continue;
            }

            const insertStart = messages.length;

            if (preset.builtInPresetItemId) {
                let content: string | string[] | ChatCompletionMessage[] = '';
                switch (preset.builtInPresetItemId) {
                    case 'main-prompt':
                        content = prompts.mainPrompt;
                        break;
                    case 'persona-description':
                        content = prompts.personaDescription;
                        break;
                    case 'char-description':
                        content = prompts.charDescription;
                        break;
                    case 'char-personality':
                        content = prompts.charPersonality;
                        break;
                    case 'scenario':
                        content = prompts.scenario;
                        break;
                    case 'chat-examples':
                        content = prompts.chatExampleArray;
                        break;
                    case 'world-info-before':
                        content = prompts.worldInfoCharBefore;
                        break;
                    case 'world-info-after':
                        content = prompts.worldInfoCharAfter;
                        break;
                    case 'chat-history':
                        content = historyMessages;
                        break;
                    case 'last-user-message':
                        content = prompts.lastUserMessage;
                        break;
                    case 'last-assistant-message':
                        content = prompts.lastAssistantMessage;
                        break;
                }

                this.#appendPresetContent(messages, preset.role, content);
            } else {
                this.#appendPresetContent(messages, preset.role, preset.content);
            }

            if (preset.builtInPresetItemId === 'main-prompt' && messages.length > insertStart) {
                mainPromptRange = {
                    start: insertStart,
                    end: messages.length - 1,
                };
            }
        }

        const authorNoteRange = this.#insertAuthorsNoteByMetadata(messages, mainPromptRange);
        this.#insertWorldInfoAroundAuthorsNote(messages, prompts, authorNoteRange);
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
            content: prompt,
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
        prompts: PromptBuilder,
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

        const noteRole = this.#normalizeRole(messages[authorNoteRange.start]?.role ?? chat_metadata[metadata_keys.role]);
        const beforeMessages = beforeEntries.map(content => ({ role: noteRole, content } as ChatCompletionMessage));
        const afterMessages = afterEntries.map(content => ({ role: noteRole, content } as ChatCompletionMessage));

        if (beforeMessages.length) {
            messages.splice(authorNoteRange.start, 0, ...beforeMessages);
        }

        if (afterMessages.length) {
            const afterInsertIndex = authorNoteRange.end + beforeMessages.length + 1;
            messages.splice(afterInsertIndex, 0, ...afterMessages);
        }
    }

    #buildChatHistoryWithDepthInjection(isContinue: boolean): ChatCompletionMessage[] {
        const history: ChatCompletionMessage[] = this.chat.map(msg => ({
            role: msg.is_user ? 'user' : msg.is_system ? 'system' : 'assistant',
            content: String(msg.mes ?? ''),
        }));

        return this.#injectDepthPromptsToHistory(history, isContinue);
    }

    #injectDepthPromptsToHistory(history: ChatCompletionMessage[], isContinue: boolean): ChatCompletionMessage[] {
        const depthBuckets = new Map<number, Map<ContextRole, string[]>>();
        let maxDepth = 0;

        for (const prompt of Object.values(this.extension_prompts)) {
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

                roleMessages.push({ role, content: text });
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

    #rebuildDepthInjections(prompts: PromptBuilder) {
        this.#removeDepthPrompts();
        this.#flushWIInjections();

        this.#injectCharacterDepthPrompt(prompts.charDepthPrompt);
        this.#injectWorldInfoDepth(prompts.worldInfoDepth);
        this.#injectOutletEntries(prompts.worldInfoOutletEntries);
        this.#injectAuthorsNoteDepthPrompt();
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

    #buildApiConfig(type: string): MainApiConfig | undefined {
        const main = settings.api?.main;
        if (!main) {
            return undefined;
        }

        const hasCustomApi = Boolean(main.baseUrl || main.apiKey || main.model);
        if (!hasCustomApi) {
            return undefined;
        }

        const useAdvanced = !!main.advancedParams?.enabled;

        return {
            url: String(main.baseUrl ?? ''),
            key: String(main.apiKey ?? ''),
            model: String(main.model ?? ''),
            type,
            stream: !!main.streaming,
            max_tokens: Number.isFinite(Number(main.maxTokens)) ? Number(main.maxTokens) : null,
            temperature: useAdvanced ? Number(main.advancedParams.temperature) : null,
            top_p: useAdvanced ? Number(main.advancedParams.topP) : null,
            frequency_penalty: useAdvanced ? Number(main.advancedParams.frequencyPenalty) : null,
            presence_penalty: useAdvanced ? Number(main.advancedParams.presencePenalty) : null,
        };
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
        this.extension_prompts[key] = {
            value: String(value),
            position: Number(position),
            depth: Number(depth),
            scan: !!scan,
            role: Number(role ?? extension_prompt_roles.SYSTEM),
            filter,
        };
    }

    #removeDepthPrompts() {
        for (const key of Object.keys(this.extension_prompts)) {
            if (key.startsWith(inject_ids.DEPTH_PROMPT)) {
                delete this.extension_prompts[key];
            }
        }
    }

    #flushWIInjections() {
        const depthPrefix = inject_ids.CUSTOM_WI_DEPTH;
        const outletPrefix = inject_ids.CUSTOM_WI_OUTLET('');

        for (const key of Object.keys(this.extension_prompts)) {
            if (key.startsWith(depthPrefix) || key.startsWith(outletPrefix)) {
                delete this.extension_prompts[key];
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

        switch (settings.api.main.promptPostProcess) {
            case 'none':
                return messages;
            case 'merge':
                // 合并连续相同的 role
                return mergeConsecutive(messages);
            case 'alternate':
                // 在 merge 的基础上强制 user 和 assistant 交替出现
                return toAlternate(messages);
            case 'alternateUserLast': {
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
            default:
                return messages;
        }
    }
}
