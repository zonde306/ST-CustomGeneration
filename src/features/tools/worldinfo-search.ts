import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { collectEnabledWorldInfos, loadWorldInfoEntries, DecoratorParser } from '@/functions/worldinfo';
import MiniSearch from 'minisearch';

/**
 * Search for World info and output brief information.
 */
const TOOL_NAME = 'search_worldinfo';
const SCHEMA = z.object({
    keyword: z.string().optional().describe('Search only for the specified keyword; leave blank to remove filtering; separate multiple keywords with space.'),
    min_score: z.float32().min(0.01).max(1).optional().default(0.4).describe('Minimum score threshold for search results.'),
    max_results: z.int().min(1).max(100).optional().default(10).describe('Maximum number of search results to return.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Search for World info and output brief information.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    function entryMapping(entry: any) {
        const parsed = new DecoratorParser(entry);
        return {
            world: entry.world,
            uid: entry.uid,
            comment: entry.comment,
            key: entry.key,
            keysecondary: entry.keysecondary,
            content_preview: parsed.cleanContent.substring(0, 50),
        };
    }

    if(!args.keyword) {
        // Parallel processing acceleration
        const entries = await Promise.allSettled(collectEnabledWorldInfos().map(lorebook => loadWorldInfoEntries(lorebook, false)));
        const results = entries.filter(t => t.status === 'fulfilled').map(t => t.value.map(entryMapping)).flat();

        return JSON.stringify({
            ok: true,
            entries: results,
        });
    }

    const database = new MiniSearch({
        fields: ['key', 'keysecondary', 'comment', 'content'],
        storeFields: ['key', 'keysecondary', 'comment', 'content'],
    });

    // Parallel processing acceleration
    await Promise.allSettled(collectEnabledWorldInfos().map(async(lorebook) => {
        const entries = await loadWorldInfoEntries(lorebook, false);
        await database.addAllAsync(entries);
    }));

    const results = database.search(
        args.keyword,
        {
            boost: { key: 3, keysecondary: 2.5, comment: 2, content: 1 },
            filter: r => r.score >= args.min_score,
        }
    );

    return JSON.stringify({
        ok: true,
        entries: results.map(entryMapping).slice(0, args.max_results),
    });
}
