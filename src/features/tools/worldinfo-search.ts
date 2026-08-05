import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';
import { LOREBOOK_MOUNT } from '@/functions/fs-worldinfo';

/**
 * @deprecated Superseded by `search_files` over `lorebooks/`.
 *
 * Reimplemented on top of the file system so both tools return the same ranking,
 * but kept registered because tool settings are keyed by tool name.
 */
const TOOL_NAME = 'search_worldinfo';
const SCHEMA = z.object({
    keyword: z.string().optional().describe('Search keywords separated by spaces. Uses fuzzy OR matching across entry keys, secondary keys, comments, UIDs, and content. Omit or leave empty to list all entries.'),
    top_n: z.int().min(1).max(100).optional().default(25).describe('Maximum number of results to return (1-100).'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: '[Deprecated: use search_files with path "lorebooks"] Full-text search across all enabled World Info entries. Returns brief previews; use read_file to fetch full content.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();
    const results = await context.files.searchFiles(args.keyword ?? '', args.top_n ?? 25, LOREBOOK_MOUNT);

    return JSON.stringify({
        ok: true,
        entries: results.map(hit => ({
            path: hit.path,
            score: hit.score,
            content_preview: hit.preview,
        })),
        total: results.length,
    });
}

/** Debug helper exposed on `globalThis.CustomGeneration`. */
export async function search(keyword: string) {
    return await call({ keyword, top_n: 100 });
}
