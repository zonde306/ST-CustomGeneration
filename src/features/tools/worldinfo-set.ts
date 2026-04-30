import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { getWorldInfoEntry } from '@/functions/worldinfo';
import { Context } from '@/features/context';
import { DataOverride } from '@/features/override';

/**
 * Set the content of the corresponding World Info
 */
const TOOL_NAME = 'set_worldinfo';
const SCHEMA = z.object({
    world: z.string().describe('World/Lorebook name'),
    uid: z.union([z.string(), z.number()]).describe('Unique identifier for the world info entry'),
    content: z.string().describe('Content to set'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Set the content of the corresponding World Info',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };

    const entry = await getWorldInfoEntry(args.world, args.uid);
    if (!entry) {
        return JSON.stringify({
            ok: false,
            error: `entry not found: ${args.world}/${args.uid}`,
        });
    }

    const override = new DataOverride(args.context.chat, args.context.chat_metadata);
    override.setOverride(args.world, entry.uid, 'tool_call', args.content);

    return JSON.stringify({
        ok: true,
    });
}
