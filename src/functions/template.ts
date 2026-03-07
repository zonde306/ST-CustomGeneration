import { settings, Template } from "../settings";
import { PROCESSORS } from "./template-processor";

export function findTemplate(decorator: string, tag: string): null | Template {
    const preset = settings.presets[settings.currentPreset];
    let template = preset.templates.find(t => t.decorator === decorator && t.tag === tag);
    if(!template)
        template = preset.templates.find(t => t.decorator === decorator && t.tag === '');
    if(!template)
        return null;

    return template;
}

export function evaluateTemplate(template: Template, context: Record<string, any>): string {
    return template.content.replace(/\{\{(.+?)\}\}/gi, (original: string, match: string) => {
        return _.get(context, match.replace(/:+/g, '.')) ?? original;
    });
}

export async function processTemplate(template: Template, content: string): Promise<string> {
    const exec = parseRegexString(template.regex).exec(content);
    if(!exec)
        return content;

    const callee = PROCESSORS[template.processor];
    if(!callee)
        return content;

    return await callee(exec, content);
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
