import { settings } from "@/settings";
import { PromptFilter } from "@/functions/message-builder";
import { GenerationProfile, PresetPrompt, profileTypeValue } from "@/utils/defines";
import { parseRegexString } from "@/utils/stringutl";

export interface TemplateResult {
    success: boolean;
    content?: string;
    arguments?: Record<string, any>;
}

/**
 * Handler for a generation profile (formerly "template").
 * Lookup identity is the triple `kind + binding + tag`.
 */
export class ProfileStore {
    public template: GenerationProfile;

    constructor(template: GenerationProfile) {
        this.template = template;
    }

    /**
     * Find a matching profile, falling back to the empty tag profile.
     * Fallback order: exact key → scan by fields → empty tag key → scan empty tag.
     * @param kind Profile kind, e.g. 'trigger' | 'agent'
     * @param binding Binding key within the kind (decorator or agent name)
     * @param tag Tag name
     * @returns Profile handler instance or null if not found
     */
    static find(kind: string, binding: string, tag: string): ProfileStore | null {
        const preset = settings.presets[settings.currentPreset];
        if (!preset) {
            return null;
        }

        const primaryKey = `${kind}:${binding}:${tag ?? ''}`;
        const fallbackKey = `${kind}:${binding}:`;
        const direct = preset.templates?.[primaryKey] ?? null;
        if (direct) {
            return new ProfileStore(direct);
        }

        const matches = (template: GenerationProfile | undefined, wantTag: string) => {
            return template?.kind === kind
                && String(template?.binding ?? '') === String(binding ?? '')
                && String(template?.tag ?? '') === wantTag;
        };

        const matchedEntry = Object.values(preset.templates ?? {}).find(template => matches(template, String(tag ?? '')));
        if (matchedEntry) {
            return new ProfileStore(matchedEntry);
        }

        const fallback = preset.templates?.[fallbackKey] ?? null;
        if (fallback) {
            return new ProfileStore(fallback);
        }

        const fallbackEntry = Object.values(preset.templates ?? {}).find(template => matches(template, ''));
        if (fallbackEntry) {
            return new ProfileStore(fallbackEntry);
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
            toastr.error(`Invalid findRegex for ${this.template.binding}:${this.template.tag}`, e as any);
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
            toastr.error(`Invalid regex for ${this.template.binding}:${this.template.tag}`, e as any);
            return { success: false };
        }

        const matchs = regexp.exec(content);
        if(!matchs) {
            console.error(`Failed to match regex for ${this.template.binding}:${this.template.tag}`);
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

    get prompts(): PresetPrompt[] {
        return this.template.prompts;
    }

    /** Namespaced generation-type value, e.g. 'trigger:@@replace' or 'agent:router'. */
    get typeValue(): string {
        return profileTypeValue(this.template);
    }

    get binding(): string {
        return this.template.binding;
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

/** @deprecated Use {@link ProfileStore}. */
export const TemplateHandler = ProfileStore;
/** @deprecated Use {@link ProfileStore}. */
export type TemplateHandler = ProfileStore;
