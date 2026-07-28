import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { classifyEntry, getWorldInfoEntry } from '@/functions/worldinfo';
import { Context } from '@/features/context';
import { DATA_NAMESPACES, MessageDataStore, worldInfoKey } from '@/functions/chat-data-store';
import { escapeAt } from '@/functions/fs-worldinfo';

/**
 * @deprecated Superseded by `write_file` on `lorebooks/<book>/<entry>.md`.
 *
 * Still registered so presets keyed by this tool name keep working.
 */
const TOOL_NAME = 'set_worldinfo';
const SCHEMA = z.object({
    world: z.string().describe('The name of the World/Lorebook containing the entry to override.'),
    uid: z.union([z.string(), z.number()]).describe('The unique identifier (UID) of the World Info entry to override.'),
    content: z.string().describe('The new content to set for this entry. Replaces the current content (including any prior overrides) within this chat session.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: '[Deprecated: use write_file with "lorebooks/<book>/<entry>-<uid>.md"] Temporarily override the content of a World Info entry for the current chat session.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();

    const entry = await getWorldInfoEntry(args.world, args.uid);
    if (!entry) {
        return JSON.stringify({
            ok: false,
            error: `entry not found: ${args.world}/${args.uid}`,
        });
    }

    if (classifyEntry(entry) !== 'plain') {
        return JSON.stringify({
            ok: false,
            error: `entry is code-controlled and cannot be overridden: ${args.world}/${args.uid}`,
        });
    }

    const store = new MessageDataStore(context, DATA_NAMESPACES.WORLDINFO, 'tool_call');
    await store.set(worldInfoKey(entry.world, entry.uid), escapeAt(args.content));

    return JSON.stringify({
        ok: true,
    });
}
