import { settings, Template, PresetPrompt } from "@/settings";
import { MessageBuilder } from "@/functions/message-builder";

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

        const fallback = preset.templates?.[fallbackKey] ?? null;
        if(fallback)
            return new TemplateHandler(fallback);

        return null;
    }

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
            content: matchs[1] ?? content,
            arguments: matchs.groups ?? {},
        };
    }

    process(content: string): TemplateResult {
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
        if(!matchs)
            return { success: false };

        return {
            success: true,
            content: matchs[1] ?? content,
            arguments: matchs.groups ?? {},
        };
    }

    async buildChatHistory(type: string = 'normal'): Promise<ChatMessage[]> {
        const builder = new MessageBuilder([]);
        builder.regexs = [];
        builder.evaluateMacro = false;
        builder.prompts = this.template.prompts;
        const messages = await builder.build(type, false);
        return messages.map(msg => ({ is_user: msg.role === 'user', is_system: msg.role === 'system', mes: msg.content }));
    }

    get prompts(): PresetPrompt[] {
        return this.template.prompts;
    }
}

function parseRegexString(str: string) {
    if (typeof str !== 'string' || str[0] !== '/') {
        throw new Error('invalid regex string');
    }

    let i = 1;
    const n = str.length;
    let endSlashPos = -1;

    while (i < n) {
        if (str[i] === '/') {
            let backslashCount = 0;
            let j = i - 1;
            while (j >= 0 && str[j] === '\\') {
                backslashCount++;
                j--;
            }
            if (backslashCount % 2 === 0) {
                endSlashPos = i;
                break;
            }
        }
        i++;
    }

    if (endSlashPos === -1) {
        throw new Error('invalid regex string');
    }

    const pattern = str.substring(1, endSlashPos);
    const flags = str.substring(endSlashPos + 1);

    const validFlags = /^[gimsuyd]*$/;
    if (!validFlags.test(flags)) {
        throw new Error(`unknown flags: ${flags}`);
    }

    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        // @ts-expect-error: 18046
        throw new Error(`invalid regex string: ${e.message}`);
    }
}
