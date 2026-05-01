import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { eventSource, event_types } from '@st/scripts/events.js';

/**
 * Force-activate specific World Info / Lorebook entries for the NEXT generation.
 *
 * The activation takes effect only once — for the immediately following generation request.
 * After that generation completes, the activation is consumed and does not persist.
 *
 * Provide one or more entries identified by their `world` (lorebook name) and `uid` (entry unique ID).
 * Use this after you've confirmed with the user which entries should influence the next response.
 *
 * Returns a JSON object: { ok: true }
 */
const TOOL_NAME = 'activate_worldinfo';
const SCHEMA = z.object({
    entries: z.array(z.object({
        world: z.string().describe('The name of the World/Lorebook containing the entry.'),
        uid: z.union([z.string(), z.number()]).describe('The unique identifier (UID) of the World Info entry to activate.'),
    })).min(1).describe('Array of { world, uid } objects identifying which entries to force-activate for the next generation.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Force-activate specified World Info entries for the next generation only. The activation is consumed after one generation and does not persist.',
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
