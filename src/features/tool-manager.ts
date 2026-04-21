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

/**
 * Get the list of built-in tools
 * @param type Generate type
 * @param presetName Specify preset
 * @returns Tool definitions
 */
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
                // Replace describe from preset
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

/**
 * Get the definition of built-in tool
 * @param name Tool Name
 * @returns Tool definition
 */
export function getTool(name: string): Tool | null {
    return TOOL_DEFINITION.get(name) ?? null;
}
