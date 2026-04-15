import { Tool } from './context';
import { setup as setupButtons } from '@/features/tools/buttons';
import { setup as setupInput } from '@/features/tools/input';
import { setup as setupConfirm } from '@/features/tools/confirmation';

export const TOOL_DEFINITION = new Map<string, Tool>();

export async function setup() {
    await setupButtons();
    await setupInput();
    await setupConfirm();
}

export function getTools(type: string, preset?: string): Map<string, Tool> {
    return TOOL_DEFINITION;
}
