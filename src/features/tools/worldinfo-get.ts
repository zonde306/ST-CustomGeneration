import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { getWorldInfoEntry, DecoratorParser } from '@/functions/worldinfo';
import { evaluate } from '@/utils/ejs';
import { substituteParams } from '@st/script.js';
import { WorldInfoEntry } from '@/utils/defines';
import { Context } from '@/features/context';
import { DataOverride } from '@/features/override';

/**
 * Retrieve the full content of specific World Info / Lorebook entries.
 *
 * Provide one or more entries identified by their `world` (lorebook name) and `uid` (entry unique ID).
 * Each returned entry includes: world, uid, key, keysecondary, comment, and the resolved content.
 *
 * Returns a JSON object: { ok: true, entries: Array<{ world, uid, key, keysecondary, comment, content }> }
 *
 * Use this after `search_worldinfo` to fetch the complete content of entries you want to examine in detail.
 */
const TOOL_NAME = 'get_worldinfo';
const SCHEMA = z.object({
    entries: z.array(z.object({
        world: z.string().describe('The name of the World/Lorebook containing the entry.'),
        uid: z.union([z.string(), z.number()]).describe('The unique identifier (UID) of the World Info entry to retrieve.'),
    })).min(1).describe('Array of { world, uid } objects identifying which World Info entries to fetch.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Retrieve the full content of specific World Info entries by their world name and UID. Returns key, comment, and resolved content for each entry.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };

    async function mapping(entry: WorldInfoEntry) {
        const parsed = new DecoratorParser(entry);
        const override = new DataOverride(args.context);
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
