import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { getWorldInfoEntry, DecoratorParser, classifyEntry } from '@/functions/worldinfo';
import { evaluate } from '@/utils/ejs';
import { substituteParams } from '@st/script.js';
import { WorldInfoEntry } from '@/utils/defines';
import { Context } from '@/features/context';
import { ChatDataStore, DATA_NAMESPACES, worldInfoKey } from '@/functions/chat-data-store';

/**
 * @deprecated Superseded by `read_file` on `lorebooks/<book>/<entry>.md`.
 *
 * Kept registered because tool settings are stored per tool name: deleting the
 * name would silently disable it in every existing preset. The implementation is
 * unchanged so old presets keep behaving exactly as before.
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
        description: '[Deprecated: use read_file with "lorebooks/<book>/<entry>-<uid>.md"] Retrieve the full content of specific World Info entries by their world name and UID.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();

    async function mapping(entry: WorldInfoEntry) {
        const parsed = new DecoratorParser(entry);
        const store = new ChatDataStore(context);
        const content = store.getPending(DATA_NAMESPACES.WORLDINFO, worldInfoKey(entry.world, entry.uid))?.content ?? parsed.cleanContent;
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
    const resolved = entries
        .filter((t): t is PromiseFulfilledResult<WorldInfoEntry | null> => t.status === 'fulfilled')
        .map(t => t.value)
        // Code-controlled entries are never exposed to the model.
        .filter((entry): entry is WorldInfoEntry => entry != null && classifyEntry(entry) === 'plain');

    return JSON.stringify({
        ok: true,
        entries: await Promise.all(resolved.map(mapping)),
    });
}
