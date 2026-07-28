import { z } from 'zod';
import { substituteParams } from '@st/script.js';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';
import { evaluate, isEjsAvailable } from '@/utils/ejs';

/**
 * Read a file from the virtual file system.
 *
 * The content is returned verbatim: macros and template syntax inside it are
 * *not* expanded, which is what makes `edit_file` anchors reliable. Pass
 * `render: true` to see the expanded form instead — that output is for reading
 * only and must never be used as an `edit_file` anchor.
 */
const TOOL_NAME = 'read_file';
const SCHEMA = z.object({
    path: z.string().min(1).describe('File path, e.g. "memory.md", "global/preferences.md" or "lorebooks/MyLore/alice-12.md".'),
    start_line: z.int().min(1).optional().describe('First line to return (1-based, inclusive).'),
    end_line: z.int().min(1).optional().describe('Last line to return (1-based, inclusive).'),
    render: z.boolean().optional().default(false).describe('Return the macro/template-expanded content instead of the raw text. Rendered output must NOT be used as an edit_file search anchor.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Read a file from the virtual file system and return its exact content. Content is returned verbatim (macros and templates are left unexpanded) so it can be used as an edit_file anchor. Use start_line/end_line for large files.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();

    let content: string;
    try {
        content = await context.files.readFile(args.path, args.start_line, args.end_line);
    } catch (error) {
        return JSON.stringify({ ok: false, error: (error as Error).message });
    }

    if (!args.render)
        return content;

    const substituted = substituteParams(content);
    if (!isEjsAvailable())
        return substituted;

    try {
        return await evaluate(substituted);
    } catch (error) {
        return JSON.stringify({ ok: false, error: `render failed: ${(error as Error).message}` });
    }
}
