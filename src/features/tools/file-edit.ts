import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';

/**
 * Replace the first exact occurrence of `search` inside a file.
 *
 * `search` must match the file byte for byte, which is why `read_file` returns
 * unexpanded content. Rendered output (`read_file` with `render: true`) can never
 * be used here.
 */
const TOOL_NAME = 'edit_file';
const SCHEMA = z.object({
    path: z.string().min(1).describe('File to edit.'),
    search: z.string().min(1).describe('Exact text to find, copied verbatim from read_file output (not the rendered form). Must appear in the file.'),
    replace: z.string().describe('Replacement text. Use an empty string to delete the matched text.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Replace the first exact occurrence of a text snippet in a file. The search text must match the file verbatim, so copy it from read_file output. Prefer this over write_file for small changes.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();

    try {
        const ok = await context.files.editFilePatch(args.path, args.search, args.replace);
        if (!ok) {
            return JSON.stringify({
                ok: false,
                error: `search text not found in ${args.path}, or the location is read-only. Re-read the file and copy the anchor verbatim.`,
            });
        }

        return JSON.stringify({ ok: true, path: args.path });
    } catch (error) {
        return JSON.stringify({ ok: false, error: (error as Error).message });
    }
}
