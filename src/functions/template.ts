import { settings } from "@/settings";
import { MessageBuilder } from "@/functions/message-builder";
import { PromptFilter } from "@/functions/message-builder";
import { Template, PresetPrompt } from "@/utils/defines";
import { parseRegexString } from "@/utils/stringutl";

interface TemplateResult {
    success: boolean;
    content?: string;
    arguments?: Record<string, any>;
}

export class TemplateHandler {
    public template: Template;

    constructor(template: Template) {
        this.template = template;
    }

    /**
     * Find a matching template, or the default template.
     * @param decorator Decorator type
     * @param tag Tag name
     * @returns Template handler instance or null if not found
     */
    static find(decorator: string, tag: string): TemplateHandler | null {
        const preset = settings.presets[settings.currentPreset];
        if (!preset) {
            return null;
        }

        const primaryKey = `${decorator}:${tag ?? ''}`;
        const fallbackKey = `${decorator}:`;
        const direct = preset.templates?.[primaryKey] ?? null;
        if (direct) {
            return new TemplateHandler(direct);
        }

        const matchedEntry = Object.entries(preset.templates ?? {}).find(([, template]) => {
            return template?.decorator === decorator && String(template?.tag ?? '') === String(tag ?? '');
        });
        if (matchedEntry?.[1]) {
            return new TemplateHandler(matchedEntry[1]);
        }

        const fallback = preset.templates?.[fallbackKey] ?? null;
        if (fallback) {
            return new TemplateHandler(fallback);
        }

        const fallbackEntry = Object.entries(preset.templates ?? {}).find(([, template]) => {
            return template?.decorator === decorator && String(template?.tag ?? '') === '';
        });
        if (fallbackEntry?.[1]) {
            return new TemplateHandler(fallbackEntry[1]);
        }

        return null;
    }

    /**
     * Check if the message content meets the requirements and return the normalized message content.
     * @param content message content
     * @returns Check results
     */
    test(content: string): TemplateResult {
        if(!this.template.findRegex)
            return { success: true, content };
        
        let regexp: RegExp;
        try {
            regexp = parseRegexString(this.template.findRegex);
        } catch (e) {
            toastr.error(`Invalid findRegex for ${this.template.decorator}:${this.template.tag}`);
            return { success: false };
        }

        const matchs = regexp.exec(content);
        if(!matchs)
            return { success: false };

        return {
            success: true,
            content: matchs.groups?.content ?? matchs[1] ?? matchs[0] ?? content,
            arguments: matchs.groups ?? {},
        };
    }

    /**
     * Process the final generated result and return the processing result.
     * @param content generated content
     * @param raise Should an exception be thrown if the specification is not met?
     * @returns Processing results
     */
    process(content: string, raise: boolean = false): TemplateResult {
        if(!this.template.regex)
            return { success: true, content };

        let regexp: RegExp;
        try {
            regexp = parseRegexString(this.template.regex);
        } catch (e) {
            toastr.error(`Invalid regex for ${this.template.decorator}:${this.template.tag}`);
            return { success: false };
        }

        const matchs = regexp.exec(content);
        if(!matchs) {
            console.error(`Failed to match regex for ${this.template.decorator}:${this.template.tag}`);
            if(raise)
                throw new Error(`Failed to match regex for ${this.template.regex}`);
            return { success: false };
        }

        return {
            success: true,
            content: matchs.groups?.content ?? matchs[1] ?? matchs[0] ?? content,
            arguments: matchs.groups ?? {},
        };
    }

    /**
     * The `Chat History` prompt content is constructed without macro processing.
     * @param chat The current chat history may need to be filtered first.
     * @param type The generation type defaults to using the current decorator.
     * @returns Chat History List
     */
    async buildChatHistory(chat: ChatMessage[] = [], type: string = ''): Promise<ChatMessage[]> {
        const builder = new MessageBuilder(chat);
        builder.regexs = [];
        builder.evaluateMacro = false;
        builder.prompts = this.template.prompts;
        const messages = await builder.build(type || this.template.decorator, false);
        return messages.map(msg => ({ is_user: msg.role === 'user', is_system: msg.role === 'system', mes: msg.content }));
    }

    get prompts(): PresetPrompt[] {
        return this.template.prompts;
    }

    get filters(): PromptFilter {
        const filters = {} as PromptFilter;
        for(const filter of this.template.filters) {
            filters[filter as keyof PromptFilter] = false;
        }
        return filters;
    }

    get retries() {
        return this.template.retryCount;
    }

    get interval() {
        return this.template.retryInterval;
    }
}

