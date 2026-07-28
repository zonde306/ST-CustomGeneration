import { characters, name1, this_chid } from "@st/script.js";
import { power_user } from "@st/scripts/power-user.js";
import { VirtualTree } from "@/functions/filesystem";
import { SkillScanner } from "@/features/skill-scanner";
import { DecoratorParser, classifyEntry } from "@/functions/worldinfo";
import { loadEnabledBooks } from "@/functions/fs-worldinfo";
import { Skill } from "@/utils/defines";

export const PERSONA_MOUNT = 'persona';
export const CHARACTER_MOUNT = 'character';
export const SKILLS_MOUNT = 'skills';

/**
 * `/persona/*` — the active persona, read-only.
 *
 * Read-only on purpose: a persona is a stable identity shared by every chat, so
 * a per-chat override layer would introduce hidden state ("the persona differs
 * depending on which chat you opened"). Notes about the persona belong in the
 * chat workspace or in `/global`.
 */
export class PersonaTree extends VirtualTree {
    protected async snapshot(): Promise<Map<string, string>> {
        const files = new Map<string, string>();
        const description = String(power_user.persona_description ?? '');

        if (description.trim())
            files.set('description.md', description);
        if (name1)
            files.set('name.md', String(name1));

        const lorebook = String(power_user.persona_description_lorebook ?? '');
        if (lorebook)
            files.set('lorebook.md', lorebook);

        return files;
    }
}

/**
 * `/character/*` — the active character card, read-only.
 *
 * Same reasoning as {@link PersonaTree}: unlike `/lorebooks`, character cards
 * have no established per-chat override mechanism, so exposing one here would
 * invent hidden state instead of reusing an existing concept.
 */
export class CharacterTree extends VirtualTree {
    protected async snapshot(): Promise<Map<string, string>> {
        const files = new Map<string, string>();
        // @ts-expect-error: this_chid is a string index in ST.
        const character = characters?.[this_chid];
        if (!character)
            return files;

        const put = (name: string, value: unknown) => {
            const text = String(value ?? '');
            if (text.trim())
                files.set(name, text);
        };

        put('description.md', character.description);
        put('personality.md', character.personality);
        put('scenario.md', character.scenario);
        put('first_message.md', character.first_mes);
        put('example_dialogue.md', character.mes_example);
        put('depth_prompt.md', character.data?.extensions?.depth_prompt?.prompt);
        put('system_prompt.md', character.data?.system_prompt);
        put('creator_notes.md', character.data?.creator_notes);

        return files;
    }
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
