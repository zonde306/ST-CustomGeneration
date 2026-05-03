import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { getWorldInfoEntry } from '@/functions/worldinfo';
import { Context } from '@/features/context';
import { DataOverride } from '@/features/override';

/**
 * Temporarily override the content of a specific World Info / Lorebook entry for the current chat.
 *
 * This creates an override that persists only within the current chat session. The original World Info
 * entry content is NOT permanently modified. The override is tied to the tool call that created it.
 *
 * Provide the `world` (lorebook name), `uid` (entry unique ID), and the new `content` string.
 *
 * Returns a JSON object: { ok: true } on success, or { ok: false, error: "..." } if the entry is not found.
 *
 * Use this to update World Info content based on the current conversation context without permanently
 * changing the original entry data.
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
        description: 'Temporarily override the content of a World Info entry for the current chat session. The original entry data is not permanently modified. Returns ok or error if entry not found.',
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

    const override = new DataOverride(args.context);
    override.setOverride(args.world, entry.uid, 'tool_call', args.content);

    return JSON.stringify({
        ok: true,
    });
}
