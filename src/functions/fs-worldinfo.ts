import { yaml } from "@st/lib.js";
import { WorldInfoEntry } from "@/utils/defines";
import {
    FSTree,
    SearchHit,
    globToRegex,
    isSubPath,
    sliceLines,
    splitPath,
} from "@/functions/filesystem";
import {
    ChatMessageEx,
    DATA_NAMESPACES,
    MessageDataStore,
    worldInfoKey,
} from "@/functions/chat-data-store";
import {
    DecoratorParser,
    EntryClass,
    classifyEntry,
    collectEnabledWorldInfos,
    loadWorldInfoEntries,
} from "@/functions/worldinfo";
import { fuzzySearch } from "@/functions/fuzzy-search";

/**
 * `/lorebooks/<book>/<slug>-<uid>.md`
 *
 * The lorebook text itself is read-only; writes land in the layered `worldinfo`
 * namespace, which is exactly the override mechanism `set_worldinfo` has always
 * used. Deleting a file drops the override and falls back to the book text.
 */
export const LOREBOOK_MOUNT = 'lorebooks';

/**
 * Characters that must not reach the path router verbatim.
 *
 * `%` would be decoded a second time, `#` and `?` truncate the URL the router
 * parses, and `\` is normalized to `/` for file URLs. Everything else survives
 * the round trip. `/` is deliberately *not* escaped: percent-escapes are decoded
 * before the path is split, so a book name containing a slash is recovered by
 * longest-prefix matching instead.
 */
const UNSAFE_SEGMENT = /[%#?\\]/g;

/** Make a book or file name safe to hand back as part of a path. */
export function encodeSegment(name: string): string {
    return name.replace(UNSAFE_SEGMENT, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** Cosmetic file name part; the `-<uid>` suffix is the authoritative id. */
export function slugify(comment: string): string {
    const slug = (comment ?? '')
        .trim()
        .replace(/[\s/\\]+/g, '-')
        .replace(/[^\p{L}\p{N}_.-]+/gu, '')
        .replace(/^[.-]+/, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 60)
        .replace(/-+$/, '');

    return slug || 'entry';
}

/** File name of a lorebook entry. */
export function entryFileName(entry: WorldInfoEntry): string {
    return `${slugify(entry.comment)}-${entry.uid}.md`;
}

// ---------------------------------------------------------------------------
// Book cache
// ---------------------------------------------------------------------------

let bookCache: Map<string, WorldInfoEntry[]> | null = null;
let bookPromise: Promise<Map<string, WorldInfoEntry[]>> | null = null;

/** Drop the cached lorebook contents (chat switch, WI edit, ...). */
export function invalidateLorebookCache(): void {
    bookCache = null;
    bookPromise = null;
}

/**
 * All entries of every enabled lorebook, keyed by book name.
 * Cached because both the file views and the search index walk it repeatedly.
 */
export async function loadEnabledBooks(): Promise<Map<string, WorldInfoEntry[]>> {
    if (bookCache)
        return bookCache;
    if (bookPromise)
        return await bookPromise;

    bookPromise = (async () => {
        const books = new Map<string, WorldInfoEntry[]>();
        const names = Array.from(new Set(collectEnabledWorldInfos()));
        const loaded = await Promise.allSettled(names.map(name => loadWorldInfoEntries(name, false)));

        for (let i = 0; i < names.length; ++i) {
            const result = loaded[i];
            if (result.status !== 'fulfilled')
                continue;

            // A book named '.' or '..' cannot be addressed as a path segment.
            if (names[i] === '.' || names[i] === '..') {
                console.warn(`[CG] lorebook "${names[i]}" cannot be exposed as a directory`);
                continue;
            }

            books.set(names[i], result.value);
        }

        bookCache = books;
        bookPromise = null;
        return books;
    })();

    return await bookPromise;
}

/** Entries of one book that are visible in the file system. */
export function plainEntries(entries: WorldInfoEntry[]): WorldInfoEntry[] {
    return entries.filter(entry => classifyEntry(entry) === 'plain');
}

/** Entries of one book with a given classification. */
export function entriesOfClass(entries: WorldInfoEntry[], kind: EntryClass): WorldInfoEntry[] {
    return entries.filter(entry => classifyEntry(entry) === kind);
}

// ---------------------------------------------------------------------------
// Decorator safety
// ---------------------------------------------------------------------------

/**
 * Escape a leading run of `@@` lines so model-written content can never become a
 * decorator. Without this, writing `@@replace` into an entry would promote it to
 * a code-controlled trigger — a privilege escalation through plain file content.
 */
export function escapeAt(content: string): string {
    return mapLeadingRun(content, /^@@/, line => '@' + line);
}

/** Undo {@link escapeAt} so the model sees exactly what it wrote. */
export function unescapeAt(content: string): string {
    return mapLeadingRun(content, /^@@@/, line => line.slice(1));
}

/**
 * Apply `fn` to the leading run of lines matching `test`, mirroring how
 * `parseDecorators` only looks at consecutive `@@` lines from position 0.
 */
function mapLeadingRun(content: string, test: RegExp, fn: (line: string) => string): string {
    if (!content || !test.test(content))
        return content;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; ++i) {
        if (!test.test(lines[i]))
            break;
        lines[i] = fn(lines[i]);
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

const FRONTMATTER_FENCE = '---';

/**
 * Read-only metadata header. It makes the entry identity explicit and, as a nice
 * side effect, lets `grep` match on keys. Making it writable would mean "move a
 * file by editing its frontmatter", which needs a separate metadata namespace.
 */
export function withFrontmatter(entry: WorldInfoEntry, body: string): string {
    const meta = yaml.stringify({
        world: entry.world,
        uid: entry.uid,
        comment: entry.comment ?? '',
        keys: entry.key ?? [],
        keysecondary: entry.keysecondary ?? [],
    });

    return `${FRONTMATTER_FENCE}\n${meta}${FRONTMATTER_FENCE}\n\n${body}`;
}

/**
 * Drop the frontmatter, rejecting a header that points at a different entry.
 * @throws when the header contradicts the path being written.
 */
export function stripFrontmatter(content: string, entry: WorldInfoEntry): string {
    if (!content.startsWith(FRONTMATTER_FENCE + '\n'))
        return content;

    const end = content.indexOf(`\n${FRONTMATTER_FENCE}`, FRONTMATTER_FENCE.length);
    if (end < 0)
        return content;

    const header = content.slice(FRONTMATTER_FENCE.length + 1, end + 1);
    const rest = content.slice(end + FRONTMATTER_FENCE.length + 1).replace(/^\r?\n/, '');

    let parsed: Record<string, any> = {};
    try {
        parsed = yaml.parse(header) ?? {};
    } catch (error) {
        throw new Error(`Invalid frontmatter: ${(error as Error).message}`);
    }

    if (parsed.world != null && String(parsed.world) !== String(entry.world))
        throw new Error(`Frontmatter "world" (${parsed.world}) does not match this file (${entry.world}). Metadata is read-only.`);
    if (parsed.uid != null && String(parsed.uid) !== String(entry.uid))
        throw new Error(`Frontmatter "uid" (${parsed.uid}) does not match this file (${entry.uid}). Metadata is read-only.`);

    return rest;
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

interface ResolvedPath {
    book: string;
    entries: WorldInfoEntry[];
    /** Remaining path below the book, `''` for the book directory itself. */
    rest: string;
}

export class WorldInfoTree implements FSTree {
    private overrides: MessageDataStore;

    constructor(env: { chat: ChatMessageEx[]; chat_metadata: ChatMetadata }) {
        this.overrides = new MessageDataStore(env, DATA_NAMESPACES.WORLDINFO, 'tool_call');
    }

    /**
     * Split a decoded path into book and remainder.
     *
     * Longest-prefix matching against the known books is what makes book names
     * containing `/` work: the router already split them apart, so the only way
     * back is to consult the real list of books.
     */
    private async resolve(path: string): Promise<ResolvedPath | null> {
        const books = await loadEnabledBooks();
        const parts = splitPath(path);

        for (let take = parts.length; take > 0; --take) {
            const name = parts.slice(0, take).join('/');
            const entries = books.get(name);
            if (entries)
                return { book: name, entries, rest: parts.slice(take).join('/') };
        }

        return null;
    }

    /** Locate the entry addressed by a file name, `-<uid>.md` being decisive. */
    private findEntry(entries: WorldInfoEntry[], fileName: string): WorldInfoEntry | null {
        const name = fileName.replace(/\.md$/i, '');
        const uidMatch = name.match(/-(\d+)$/);

        if (uidMatch) {
            const uid = Number(uidMatch[1]);
            const byUid = entries.find(entry => entry.uid === uid);
            if (byUid)
                return byUid;
        }

        return entries.find(entry => entry.comment === name || slugify(entry.comment) === name) ?? null;
    }

    /** Resolve a path all the way to a writable entry. */
    private async resolveEntry(path: string): Promise<WorldInfoEntry | null> {
        const resolved = await this.resolve(path);
        if (!resolved || !resolved.rest || resolved.rest.includes('/'))
            return null;

        const entry = this.findEntry(resolved.entries, resolved.rest);
        if (!entry || classifyEntry(entry) !== 'plain')
            return null;

        return entry;
    }

    /** Current content of an entry: override if any, otherwise the book text. */
    private async entryBody(entry: WorldInfoEntry): Promise<string> {
        const override = await this.overrides.get(worldInfoKey(entry.world, entry.uid));
        return unescapeAt(override ?? new DecoratorParser(entry).cleanContent);
    }

    private async entryFile(entry: WorldInfoEntry): Promise<string> {
        return withFrontmatter(entry, await this.entryBody(entry));
    }

    async listDir(path: string | string[] = '.'): Promise<string[]> {
        const books = await loadEnabledBooks();
        const raw = Array.isArray(path) ? path.join('/') : path;
        const parts = splitPath(raw);

        if (!parts.length)
            return Array.from(books.keys()).map(encodeSegment);

        const resolved = await this.resolve(raw);
        if (!resolved)
            return [];

        if (!resolved.rest)
            return plainEntries(resolved.entries).map(entry => encodeSegment(entryFileName(entry)));

        // Books are flat, so a deeper path can only name a file.
        return [];
    }

    async globFiles(pattern: string): Promise<string[]> {
        const regex = globToRegex(pattern);
        const results: string[] = [];

        for (const [book, entries] of await loadEnabledBooks()) {
            for (const entry of plainEntries(entries)) {
                const path = `${encodeSegment(book)}/${encodeSegment(entryFileName(entry))}`;
                if (regex.test(path))
                    results.push(path);
            }
        }

        return results;
    }

    async grepSearch(query: string, path: string = '.'): Promise<string[]> {
        const scope = splitPath(path);
        const results: string[] = [];

        for (const [book, entries] of await loadEnabledBooks()) {
            for (const entry of plainEntries(entries)) {
                const displayed = `${encodeSegment(book)}/${encodeSegment(entryFileName(entry))}`;
                if (!isSubPath(scope, splitPath(`${book}/${entryFileName(entry)}`)))
                    continue;

                (await this.entryFile(entry)).split('\n').forEach((line, idx) => {
                    if (line.includes(query))
                        results.push(`${displayed}:${idx + 1}:${line}`);
                });
            }
        }

        return results;
    }

    async searchFiles(query: string, topN: number = 25, path: string = '.'): Promise<SearchHit[]> {
        const scope = splitPath(path);
        const docs: Array<Record<string, any>> = [];

        for (const [book, entries] of await loadEnabledBooks()) {
            for (const entry of plainEntries(entries)) {
                if (!isSubPath(scope, splitPath(`${book}/${entryFileName(entry)}`)))
                    continue;

                docs.push({
                    path: `${encodeSegment(book)}/${encodeSegment(entryFileName(entry))}`,
                    world: book,
                    uid: String(entry.uid),
                    comment: entry.comment ?? '',
                    key: (entry.key ?? []).join(' '),
                    keysecondary: (entry.keysecondary ?? []).join(' '),
                    content: await this.entryBody(entry),
                });
            }
        }

        return fuzzySearch(docs, query, topN, {
            fields: ['path', 'comment', 'key', 'keysecondary', 'uid', 'content', 'world'],
            boost: { key: 2, uid: 2, comment: 1.5, keysecondary: 1.5, world: 0.25 },
        });
    }

    async readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
        const entry = await this.resolveEntry(path);
        if (!entry)
            throw new Error(`File not found: ${LOREBOOK_MOUNT}/${path}`);

        return sliceLines(await this.entryFile(entry), startLine, endLine);
    }

    async writeFile(path: string, content: string): Promise<boolean> {
        const entry = await this.resolveEntry(path);
        if (!entry)
            throw new Error(`File not found: ${LOREBOOK_MOUNT}/${path}`);

        const body = escapeAt(stripFrontmatter(content, entry));
        await this.overrides.set(worldInfoKey(entry.world, entry.uid), body);
        return true;
    }

    async editFilePatch(path: string, search: string, replace: string): Promise<boolean> {
        const entry = await this.resolveEntry(path);
        if (!entry)
            throw new Error(`File not found: ${LOREBOOK_MOUNT}/${path}`);

        const body = await this.entryBody(entry);
        if (!body.includes(search))
            return false;

        await this.overrides.set(worldInfoKey(entry.world, entry.uid), escapeAt(body.replace(search, replace)));
        return true;
    }

    /** Deleting a lorebook file drops the override, restoring the book text. */
    async deleteFile(path: string): Promise<boolean> {
        const entry = await this.resolveEntry(path);
        if (!entry)
            return false;

        return await this.overrides.delete(worldInfoKey(entry.world, entry.uid));
    }
}
