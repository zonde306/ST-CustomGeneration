import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { collectEnabledWorldInfos, loadWorldInfoEntries, DecoratorParser } from '@/functions/worldinfo';
import MiniSearch from 'minisearch';

/**
 * Search for World info and output brief information.
 */
const TOOL_NAME = 'search_worldinfo';
const SCHEMA = z.object({
    keyword: z.string().optional().describe('Search only for the specified keywords; leave blank to return all results; separate multiple keywords with spaces.'),
    top_n: z.int().min(1).max(100).optional().default(10).describe('Maximum number of search results to return.'),
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
        fields: ['key', 'keysecondary', 'comment', 'uid'],
        storeFields: ['key', 'keysecondary', 'comment', 'content'],
    });

    for(const lorebook of collectEnabledWorldInfos()) {
        const entries = await loadWorldInfoEntries(lorebook, false);
        await database.addAllAsync(entries);
    }

    const results = database.search(args.keyword);

    return JSON.stringify({
        ok: true,
        entries: results.map(entryMapping).slice(0, args.top_n),
    });
}
