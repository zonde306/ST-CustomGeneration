import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';

/**
 * Search the virtual file system.
 *
 * - `fuzzy`: ranked full-text search (World Info is indexed; unindexed subtrees
 *   silently fall back to grep, so the caller does not need to care).
 * - `grep`: literal, line-oriented matches formatted as `path:line:text`.
 * - `glob`: match file paths against a shell-style pattern.
 */
const TOOL_NAME = 'search_files';
const SCHEMA = z.object({
    query: z.string().describe('Search terms for fuzzy/grep mode, or a glob pattern such as "lorebooks/**/*.md" for glob mode. Leave empty in fuzzy mode to list everything in scope.'),
    mode: z.enum(['fuzzy', 'grep', 'glob']).optional().default('fuzzy').describe('fuzzy = ranked full-text search, grep = literal line matches (path:line:text), glob = match paths against a pattern.'),
    path: z.string().optional().default('.').describe('Restrict fuzzy/grep search to this directory. Ignored in glob mode.'),
    top_n: z.int().min(1).max(100).optional().default(25).describe('Maximum number of results to return (1-100).'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Search the virtual file system: fuzzy full-text search, literal grep (path:line:text), or glob path matching. Use this first to locate files, then read_file for full content.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const context = args.context ?? Context.global();
    const topN = args.top_n ?? 25;

    try {
        switch (args.mode) {
            case 'glob': {
                const results = await context.files.globFiles(args.query || '**');
                return JSON.stringify({ ok: true, mode: 'glob', total: results.length, results: results.slice(0, topN) });
            }
            case 'grep': {
                const results = await context.files.grepSearch(args.query, args.path || '.');
                return JSON.stringify({ ok: true, mode: 'grep', total: results.length, results: results.slice(0, topN) });
            }
            default: {
                const results = await context.files.searchFiles(args.query, topN, args.path || '.');
                return JSON.stringify({ ok: true, mode: 'fuzzy', total: results.length, results });
            }
        }
    } catch (error) {
        return JSON.stringify({ ok: false, error: (error as Error).message });
    }
}
