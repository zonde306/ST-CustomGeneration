import { z } from 'zod';
import { eventSource, event_types } from '@st/scripts/events.js';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { collectEnabledWorldInfos, loadWorldInfoEntries, DecoratorParser } from '@/functions/worldinfo';
import MiniSearch from 'minisearch';

/**
 * Search for World Info / Lorebook entries using full-text search.
 *
 * Searches across all enabled World Info entries by their key, secondary key, comment, UID, and content.
 * Supports fuzzy matching with multiple keywords separated by spaces (combined with OR logic).
 *
 * If `keyword` is omitted or empty, returns a preview of ALL enabled entries (limited to `top_n`).
 *
 * Each returned entry is a brief preview: { world, uid, comment, key, keysecondary, content_preview }
 * The content_preview is truncated to the first 50 characters. Use `get_worldinfo` to fetch the full content.
 *
 * Returns a JSON object: { ok: true, entries: Array<{ world, uid, comment, key, keysecondary, content_preview }> }
 *
 * Use this as the FIRST step when looking for World Info entries — search to find relevant entries,
 * then use `get_worldinfo` to read their full content.
 */
const TOOL_NAME = 'search_worldinfo';
const SCHEMA = z.object({
    keyword: z.string().optional().describe('Search keywords separated by spaces. Uses fuzzy OR matching across entry keys, secondary keys, comments, UIDs, and content. Omit or leave empty to list all entries.'),
    top_n: z.int().min(1).max(100).optional().default(10).describe('Maximum number of results to return (1-100).'),
});
let database : MiniSearch | null = null;

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Full-text search across all enabled World Info entries. Returns brief previews (first 50 chars of content). Use this first to find relevant entries, then use get_worldinfo to read full content.',
        parameters: SCHEMA,
        function: call,
    });

    eventSource.on(event_types.CHAT_CHANGED, () => database = null);
    eventSource.on(event_types.WORLDINFO_UPDATED, () => database = null);
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    if(!args.keyword) {
        // Parallel processing acceleration
        const entries = await Promise.allSettled(collectEnabledWorldInfos().map(lorebook => loadWorldInfoEntries(lorebook, false)));
        const results = entries.filter(t => t.status === 'fulfilled').map(t => t.value.map(entryMapping)).flat();

        return JSON.stringify({
            ok: true,
            entries: results,
        });
    }

    if(database == null)
        await buildDatabase();

    const results = database!.search(args.keyword, { combineWith: 'OR', fuzzy: true, boost: { 'key': 2, 'uid': 2, 'keysecondary': 1.5 } });
    return JSON.stringify({
        ok: true,
        entries: results.map(entryMapping).slice(0, args.top_n),
    });
}

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

async function buildDatabase() {
    database = new MiniSearch({
        fields: ['key', 'keysecondary', 'comment', 'uid', 'content'],
        storeFields: ['key', 'keysecondary', 'comment', 'content'],
    });

    let id = 1;
    for(const lorebook of collectEnabledWorldInfos()) {
        const entries = await loadWorldInfoEntries(lorebook, false);
        await database.addAllAsync(entries.map(e => ({ ...e, id: id++ })));
    }
}

export async function search(keyword: string) {
    return await call({ keyword, top_n: 100 });
}
