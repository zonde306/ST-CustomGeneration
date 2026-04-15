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
export function getAvailableTools(type: string): Tool[] {
    return Array.from(TOOL_DEFINITION.values().filter(t => settings.tools[t.name]?.enabled && (
        !settings.tools[t.name].triggers.length ||
        settings.tools[t.name].triggers.includes(type)
    )));
}

export function getTool(name: string): Tool | null {
    return TOOL_DEFINITION.get(name) ?? null;
}
