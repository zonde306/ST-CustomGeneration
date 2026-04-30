import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { getWorldInfoEntry, DecoratorParser } from '@/functions/worldinfo';
import { evaluate } from '@/utils/ejs';
import { substituteParams } from '@st/script.js';
import { WorldInfoEntry } from '@/utils/defines';
import { Context } from '@/features/context';
import { DataOverride } from '@/features/override';

/**
 * Get the complete content of the corresponding World Info
 */
const TOOL_NAME = 'get_worldinfo';
const SCHEMA = z.object({
    entries: z.array(z.object({
        world: z.string().describe('World/Lorebook name'),
        uid: z.union([z.string(), z.number()]).describe('Unique identifier for the world info entry'),
    })).min(1).describe('World Info entries to get'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Get the complete content of the corresponding World Info',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };

    async function mapping(entry: WorldInfoEntry) {
        const parsed = new DecoratorParser(entry);
        const override = new DataOverride(args.context.chat, args.context.chat_metadata);
        const content = override.getOverride(entry.world, entry.uid)?.content ?? parsed.cleanContent;
        return {
            world: entry.world,
            uid: entry.uid,
            key: entry.key,
            keysecondary: entry.keysecondary,
            comment: entry.comment,
            content: await evaluate(substituteParams(content)),
        };
    }

    const entries = await Promise.allSettled(args.entries.map(({ world, uid }) => getWorldInfoEntry(world, uid)));
    // @ts-expect-error: 2339
    const results = entries.filter(t => t.status === 'fulfilled' && t.value != null).map(t => mapping(t.value));

    return JSON.stringify({
        ok: true,
        entries: await Promise.all(results),
    });
}
