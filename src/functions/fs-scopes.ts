import { characters, this_chid } from "@st/script.js";
import { power_user } from "@st/scripts/power-user.js";
import { user_avatar } from "@st/scripts/personas.js";
import { settings } from "@/ui/state";
import { VirtualTree } from "@/functions/filesystem";
import { SkillScanner } from "@/features/skill-scanner";
import { DecoratorParser, classifyEntry } from "@/functions/worldinfo";
import { loadEnabledBooks } from "@/functions/fs-worldinfo";
import { Skill } from "@/utils/defines";

export const PERSONA_MOUNT = 'persona';
export const CHARACTER_MOUNT = 'character';
export const SKILLS_MOUNT = 'skills';
export const PRESET_MOUNT = 'preset';

/**
 * The first non-blank value, as text.
 *
 * Character cards carry the same field twice: the v2 `data.*` block and the
 * flat v1 field. v2 wins unless it is blank, which is how ST itself resolves
 * them, so a card saved by an older editor still reads correctly.
 */
function pick(...values: unknown[]): string {
    for (const value of values) {
        const text = String(value ?? '');
        if (text.trim())
            return text;
    }

    return '';
}

/**
 * `/persona/*` — the active persona, read-only.
 *
 * Only the description is exposed. The persona name is already in the system
 * prompt, and the bound lorebook *name* is a string the model cannot act on: it
 * would only invite guesses at `/lorebooks/<that name>`, which may not even be
 * enabled.
 */
export async function personaSnapshot(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const description = String(power_user.persona_description ?? '');

    if (description.trim())
        files.set('description.md', description);

    return files;
}

/**
 * `/character/*` — the active character card, read-only.
 *
 * `first_mes` is deliberately absent: the first message is already the first
 * entry of the chat, so a file for it would only duplicate context.
 */
export async function characterSnapshot(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    // @ts-expect-error: this_chid is a string index in ST.
    const character = characters?.[this_chid];
    if (!character)
        return files;

    const put = (name: string, value: string) => {
        if (value.trim())
            files.set(name, value);
    };

    const v2 = character.data ?? ({} as NonNullable<typeof character.data>);
    const ext = v2.extensions ?? ({} as NonNullable<typeof v2.extensions>);

    put('description.md', pick(v2.description, character.description));
    put('personality.md', pick(v2.personality, character.personality));
    put('scenario.md', pick(v2.scenario, character.scenario));
    put('example_dialogue.md', pick(v2.mes_example, character.mes_example));
    put('creator_notes.md', pick(v2.creator_notes, (character as { creatorcomment?: string }).creatorcomment));
    put('system_prompt.md', pick(v2.system_prompt));
    put('post_history_instructions.md', pick(v2.post_history_instructions));
    put('depth_prompt.md', pick(ext.depth_prompt?.prompt));
    put('sd_character_prompt.md', sdCharacterPrompt(ext.sd_character_prompt));

    return files;
}

/**
 * The image-generation prompt, which is a `{positive, negative}` pair rather
 * than a string. Labelling both halves keeps the negative prompt from reading as
 * a description of the character.
 */
function sdCharacterPrompt(prompt: { positive?: string; negative?: string } | undefined): string {
    const positive = pick(prompt?.positive);
    const negative = pick(prompt?.negative);
    const parts: string[] = [];

    if (positive)
        parts.push(`positive: ${positive}`);
    if (negative)
        parts.push(`negative: ${negative}`);

    return parts.join('\n');
}

/**
 * Identity of the active character, used to scope its overlay files.
 *
 * The avatar file name is ST's stable per-character key; the name is not unique
 * and can be renamed. Empty when no character is active.
 */
export function activeCharacterScope(): string {
    // @ts-expect-error: this_chid is a string index in ST.
    return String(characters?.[this_chid]?.avatar ?? '');
}

/** Identity of the active persona: its avatar file, for the same reason. */
export function activePersonaScope(): string {
    return String(user_avatar ?? '');
}

/**
 * `/skills/<name>.md` — skills declared by `@@skill` World Info entries.
 *
 * Reads have no side effects and never activate anything: making a read activate
 * a skill would let the model pin one permanently just by looking at it, and it
 * contradicts what reading a file means. Activation stays with `add_skill`.
 */
export class SkillTree extends VirtualTree {
    constructor(private env: { skillScanner?: SkillScanner }) {
        super();
    }

    /** Skills known to the scanner, falling back to a direct lorebook scan. */
    private async skills(): Promise<Array<{ name: string; description: string; body: string }>> {
        const scanned = this.env.skillScanner?.getAllSkills() ?? [];
        if (scanned.length)
            return scanned.map((skill: Skill) => ({ name: skill.name, description: skill.description, body: skill.body }));

        // The scanner is only populated during generation; reading outside of one
        // should still work.
        const results: Array<{ name: string; description: string; body: string }> = [];
        for (const entries of (await loadEnabledBooks()).values()) {
            for (const entry of entries) {
                if (classifyEntry(entry) !== 'skill')
                    continue;

                const content = new DecoratorParser(entry).cleanContent;
                const lines = content.split('\n');
                if (lines.length <= 1)
                    continue;

                results.push({
                    name: entry.comment,
                    description: lines[0].trim(),
                    body: lines.slice(1).join('\n').trim(),
                });
            }
        }

        return results;
    }

    protected async snapshot(): Promise<Map<string, string>> {
        const files = new Map<string, string>();

        for (const skill of await this.skills()) {
            const name = (skill.name ?? '').trim();
            if (!name)
                continue;

            files.set(`${sanitizeFileName(name)}.md`, [
                '---',
                `skill: ${name}`,
                `activation: call add_skill("${name}") to keep this skill in context`,
                '---',
                '',
                skill.description,
                '',
                skill.body,
            ].join('\n'));
        }

        return files;
    }
}

/** Keep skill names usable as a single path segment. */
export function sanitizeFileName(name: string): string {
    return name.replace(/[/\\%#?]+/g, '-').replace(/^\.+/, '');
}

/**
 * `/preset/*` — files shipped with the active preset, read-only.
 *
 * Read-only because a preset is a configuration artifact: a model write would be
 * lost without warning the moment the preset is switched. Editing goes through
 * the Preset Files UI, which persists to settings.
 *
 * Not cached: the snapshot reads `settings` on every call, so switching presets
 * takes effect immediately.
 */
export class PresetTree extends VirtualTree {
    protected async snapshot(): Promise<Map<string, string>> {
        const preset = settings.presets?.[settings.currentPreset];
        return new Map(Object.entries(preset?.files ?? {}));
    }
}
