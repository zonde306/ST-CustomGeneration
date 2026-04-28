import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { eventSource, event_types } from '@st/scripts/events.js';

/**
 * Activate the specified World Info for the next generation.
 */
const TOOL_NAME = 'activate_worldinfo';
const SCHEMA = z.object({
    entries: z.array(z.object({
        world: z.string().describe('World/Lorebook name'),
        uid: z.union([z.string(), z.number()]).describe('Unique identifier for the world info entry'),
    })).min(1).describe('World Info entries to activate'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Activate the specified World Info for the next generation.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;
    await eventSource.emit(event_types.WORLDINFO_FORCE_ACTIVATE, args.entries);
    return JSON.stringify({
        ok: true
    });
}
