import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';

/**
 * List the contents of a directory in the virtual file system.
 *
 * The root is the current chat workspace. Mounted scopes:
 * `global/`, `persona/`, `character/`, `skills/`, `lorebooks/<book>/`.
 */
const TOOL_NAME = 'list_dir';
const SCHEMA = z.object({
    path: z.string().optional().default('.').describe('Directory to list. "." is the chat workspace root. Mounted scopes: global/, persona/, character/, skills/, preset/, lorebooks/<book>/.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'List entries of a directory in the virtual file system. The root is the current chat workspace; mounted scopes are global/ (cross-chat), persona/, character/, skills/, preset/ and lorebooks/<book>/. Use this to discover what is readable before calling read_file.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();
    const path = args.path || '.';

    try {
        return JSON.stringify({
            ok: true,
            path,
            entries: await context.files.listDir(path),
        });
    } catch (error) {
        return JSON.stringify({ ok: false, error: (error as Error).message });
    }
}
