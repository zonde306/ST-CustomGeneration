import { eventSource, event_types } from '@st/scripts/events.js';
import { Context } from '@/features/context';
import { z } from 'zod';
import { TOOL_DEFINITION, Tool } from '@/features/tool-manager';
import { settings } from '@/settings';
import { WorldInfoEntry, WorldInfoLoaded } from '@/utils/defines';
import { classifyEntry } from '@/functions/worldinfo';

function onWorldInfoLoaded(data: WorldInfoLoaded) {
    // Shared classifier: `/skills` and this filter must agree on what a skill is.
    const filterFn = (entry: WorldInfoEntry) => classifyEntry(entry) === 'skill';

    for (let i = data.globalLore.length - 1; i >= 0; --i) {
        if (filterFn(data.globalLore[i])) {
            console.debug(`Skill Loader: remove global lore ${data.globalLore[i].world}/${data.globalLore[i].uid}-${data.globalLore[i].comment}`);
            data.globalLore.splice(i, 1);
        }
    }
    for (let i = data.personaLore.length - 1; i >= 0; --i) {
        if (filterFn(data.personaLore[i])) {
            console.debug(`Skill Loader: remove persona lore ${data.personaLore[i].world}/${data.personaLore[i].uid}-${data.personaLore[i].comment}`);
            data.personaLore.splice(i, 1);
        }
    }
    for (let i = data.characterLore.length - 1; i >= 0; --i) {
        if (filterFn(data.characterLore[i])) {
            console.debug(`Skill Loader: remove character lore ${data.characterLore[i].world}/${data.characterLore[i].uid}-${data.characterLore[i].comment}`);
            data.characterLore.splice(i, 1);
        }
    }
    for (let i = data.chatLore.length - 1; i >= 0; --i) {
        if (filterFn(data.chatLore[i])) {
            console.debug(`Skill Loader: remove chat lore ${data.chatLore[i].world}/${data.chatLore[i].uid}-${data.chatLore[i].comment}`);
            data.chatLore.splice(i, 1);
        }
    }
}

/** Accept both a bare skill name and the `/skills/<name>.md` path form. */
function normalizeSkillRef(value: string): string {
    return String(value ?? '')
        .replace(/^\/?skills\//i, '')
        .replace(/\.md$/i, '');
}

export async function setup() {
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded);

    const tool: Tool = {
        name: 'add_skill',
        description: 'Add a skill to the activated skills list by name, UID or "skills/<name>.md" path. Reading a skill file does not activate it; this tool does.',
        parameters: z.object({
            skill: z.string().describe('Name, UID or "skills/<name>.md" path of the skill to add'),
        }),
        function: async (params: any) => {
            const globalCtx = (params.context ?? Context.global()) as Context;
            const skill = normalizeSkillRef(params.skill);
            const result = globalCtx.skillScanner.addSkill(skill);
            if (result.added) {
                const activatedSkills = globalCtx.skillScanner.getActivatedSkills();
                return `Successfully added skill "${result.skill?.name}". Current activated skills: ${activatedSkills.map(s => s.name).join(', ')}`;
            } else if (result.skill) {
                return `Skill "${result.skill.name}" is already activated.`;
            } else {
                return `Skill "${skill}" not found.`;
            }
        },
    };
    
    TOOL_DEFINITION.set(tool.name, tool);

    const preset = settings.presets[settings.currentPreset];
    if (preset && !preset.tools[tool.name]) {
        preset.tools[tool.name] = {
            enabled: true,
            triggers: ['normal', 'regenerate', 'swipe'],
            parameters: {},
            description: tool.description,
        };
    }

    console.log('Skill Loader: registered add_skill tool');
}
