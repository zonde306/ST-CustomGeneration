import { z } from 'zod';
import { settings } from '@/settings';
import { matchesTriggerType } from '@/utils/defines';
import { setup as setupButtons } from '@/features/tools/buttons';
import { setup as setupInput } from '@/features/tools/input';
import { setup as setupConfirm } from '@/features/tools/confirmation';
import { setup as setupVarSet } from '@/features/tools/variable-set';
import { setup as setupVarGet } from '@/features/tools/variable-get';
import { setup as setupAgentRouter } from '@/features/tools/agent-router';
import { setup as setupCalculate } from '@/features/tools/calculate';
import { setup as setupSkillLoader } from '@/features/tools/skill-loader';
import { setup as setupFileList } from '@/features/tools/file-list';
import { setup as setupFileRead } from '@/features/tools/file-read';
import { setup as setupFileSearch } from '@/features/tools/file-search';
import { setup as setupFileWrite } from '@/features/tools/file-write';
import { setup as setupFileEdit } from '@/features/tools/file-edit';

export interface Tool {
    name: string;
    description: string;
    parameters: z.ZodObject;
    'function': (params: any) => Promise<string>;
}

export const TOOL_DEFINITION = new Map<string, Tool>();

export async function setup() {
    await setupButtons();
    await setupInput();
    await setupConfirm();
    await setupFileList();
    await setupFileRead();
    await setupFileSearch();
    await setupFileWrite();
    await setupFileEdit();
    await setupVarSet();
    await setupVarGet();
    await setupAgentRouter();
    await setupCalculate();
    await setupSkillLoader();
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
        matchesTriggerType(preset.tools[t.name].triggers, type)
    )).map(t => {
        const overrides = Object.entries(preset.tools[t.name].parameters).map(([key, value]) => {
            const def = t.parameters.shape[key] as z.ZodType;
            if(!def)
                return {};
            
            return {
                // Replace describe from preset
                [key]: def?.describe?.call(def, value) ?? def,
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
