import { settings, Template } from "../settings";

export function findTemplate(decorator: string, tag: string): null | Template {
    const preset = settings.presets[settings.currentPreset];
    if (!preset) {
        return null;
    }

    const primaryKey = `${decorator}:${tag ?? ''}`;
    const fallbackKey = `${decorator}:`;
    const direct = preset.templates?.[primaryKey] ?? null;
    if (direct) {
        return direct;
    }

    const fallback = preset.templates?.[fallbackKey] ?? null;
    return fallback ?? null;
}

export function evaluateTemplate(template: Template, context: Record<string, any>): string {
    const promptText = template.prompts.map(prompt => prompt.prompt).join('\n\n');
    return promptText.replace(/\{\{(.+?)\}\}/gi, (original: string, match: string) => {
        return _.get(context, match.replace(/:+/g, '.')) ?? original;
    });
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
