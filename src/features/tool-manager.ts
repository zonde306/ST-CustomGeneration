import { Tool } from './context';
import { settings } from '@/settings';
import { setup as setupButtons } from '@/features/tools/buttons';
import { setup as setupInput } from '@/features/tools/input';
import { setup as setupConfirm } from '@/features/tools/confirmation';

export const TOOL_DEFINITION = new Map<string, Tool>();

export async function setup() {
    await setupButtons();
    await setupInput();
    await setupConfirm();
}

export function getAvailableTools(type: string, presetName?: string): Tool[] {
    const preset = settings.presets[presetName ?? settings.currentPreset];
    if (!preset?.tools) {
        return [];
    }

    return Array.from(TOOL_DEFINITION.values().filter(t => preset.tools[t.name]?.enabled && (
        !preset.tools[t.name].triggers.length ||
        preset.tools[t.name].triggers.includes(type)
    )).map(t => {
        const overrides = Object.entries(preset.tools[t.name].parameters).map(([key, value]) => {
            const def = t.parameters.shape[key];
            return {
                [key]: def.describe(value),
            }
        });

        return {
            ...t,
            description: preset.tools[t.name].description,
            parameters: t.parameters.extend(overrides.reduce((acc, curr) => _.merge(acc, curr), {})),
        }
    }));
}

export function getTool(name: string): Tool | null {
    return TOOL_DEFINITION.get(name) ?? null;
}
