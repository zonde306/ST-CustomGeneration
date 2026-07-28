import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';

/**
 * Create or overwrite a file.
 *
 * Where a file lives decides how long it lives: the chat workspace root is
 * versioned per message, so a write is discarded when the turn that made it is
 * rerolled, while `global/` persists across every chat. `lorebooks/` writes
 * become chat-local World Info overrides and never modify the book itself.
 */
const TOOL_NAME = 'write_file';
const SCHEMA = z.object({
    path: z.string().min(1).describe('Target path. Root files (e.g. "memory.md") belong to this chat and roll back with swipes; "global/..." persists across chats; "lorebooks/<book>/<entry>.md" writes a chat-local World Info override.'),
    content: z.string().describe('Full new content of the file. Replaces the previous content entirely.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Create or fully overwrite a file. Root paths are chat-scoped and roll back with swipes, global/ persists across chats, lorebooks/ writes a chat-local World Info override. persona/, character/ and skills/ are read-only.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();

    try {
        const ok = await context.files.writeFile(args.path, args.content);
        if (!ok) {
            return JSON.stringify({
                ok: false,
                error: `cannot write: ${args.path} (read-only location or invalid path)`,
            });
        }

        return JSON.stringify({ ok: true, path: args.path, bytes: args.content.length });
    } catch (error) {
        return JSON.stringify({ ok: false, error: (error as Error).message });
    }
}
