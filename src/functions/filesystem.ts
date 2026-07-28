import { chat_metadata } from "@st/script.js";
import { extension_settings } from "@st/scripts/extensions.js";

/**
 * Data operations shared by the root file system and every mounted subtree.
 *
 * Mount management is deliberately *not* part of this interface: mount points
 * are flat (exactly one path segment directly below the owner root), so a
 * subtree never has to forward or re-route a mount request. Any object able to
 * answer these calls (in-memory store, remote FS, virtual view, ...) can be
 * mounted.
 */
export interface FSTree {
    listDir(path?: string | string[]): Promise<string[]>;
    globFiles(pattern: string): Promise<string[]>;
    grepSearch(query: string, path?: string): Promise<string[]>;
    readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
    editFilePatch(path: string, search: string, replace: string): Promise<boolean>;
    writeFile(path: string, content: string): Promise<boolean>;
    deleteFile(path: string): Promise<boolean>;
    /**
     * Optional ranked search. `grepSearch` is a literal, line-oriented contract
     * and must stay that way, so trees that can do better (a full-text index,
     * for instance) expose it here instead. Callers fall back to `grepSearch`
     * when a tree does not implement this.
     */
    searchFiles?(query: string, topN?: number, path?: string): Promise<SearchHit[]>;
}

/** One ranked search result. */
export interface SearchHit {
    path: string;
    score: number;
    preview: string;
}

/** Ranked search over a subtree, degrading to grep when unsupported. */
export async function searchTree(tree: FSTree, query: string, topN: number, path: string = '.'): Promise<SearchHit[]> {
    if (typeof tree.searchFiles === 'function')
        return await tree.searchFiles(query, topN, path);

    return grepToHits(await tree.grepSearch(query, path), topN);
}

/** Fold `path:line:text` grep output into ranked hits, one per file. */
export function grepToHits(lines: string[], topN: number): SearchHit[] {
    const hits = new Map<string, SearchHit>();

    for (const line of lines) {
        const first = line.indexOf(':');
        const second = line.indexOf(':', first + 1);
        if (first < 0 || second < 0)
            continue;

        const path = line.slice(0, first);
        const existing = hits.get(path);
        if (existing) {
            existing.score += 1;
            continue;
        }

        hits.set(path, { path, score: 1, preview: line.slice(second + 1).trim().slice(0, 120) });
    }

    return Array.from(hits.values()).sort((a, b) => b.score - a.score).slice(0, topN);
}

export interface DataStore {
    keys(): AsyncIterableIterator<string>;
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<this>;
    delete(key: string): Promise<boolean>;
    entries(): AsyncIterableIterator<[string, string]>;
}

/** Result of routing a path against the flat mount table. */
interface Route {
    /** Mount name owning the path, or `null` when the path is local. */
    mount: string | null;
    /** Subtree owning the path, or `null` when the path is local. */
    tree: FSTree | null;
    /** Path segments relative to `tree` (or to the local root). */
    parts: string[];
    /** `parts` joined with `/` (empty string means "the directory itself"). */
    path: string;
}

/**
 * Flat virtual file system.
 *
 * - Local files live in a {@link DataStore} keyed by their full slash path;
 *   directories are purely derived from those keys.
 * - Mount points form a **flat** table: a mount name is a single segment right
 *   under the root (`"remote"`, never `"remote/a"`). Nesting is achieved by
 *   mounting a `FileSystem` that owns its own mounts, not by deep paths.
 * - Everything under a mount name is resolved by delegating to the subtree at
 *   call time, so mounted content is always read dynamically and never cached.
 */
export class FileSystem implements FSTree {
    /** Mount table: single path segment -> subtree. */
    private mounts: Map<string, FSTree> = new Map();
    protected backend: DataStore;

    /**
     * Optional ranked search over the local (non-mounted) files. Left unset the
     * root falls back to grep, which is enough while the workspace is small.
     */
    public localSearch?: (query: string, topN: number, files: Map<string, string>) => SearchHit[];

    constructor(backend: DataStore = new MapDataStore()) {
        this.backend = backend;
    }

    /**
     * Normalize a path into segments, dropping empty segments and `.` while
     * resolving `..` (never escaping the root).
     */
    protected normpath(path: string | string[]): string[] {
        const raw = Array.isArray(path) ? path.join('/') : path;
        if (!raw || raw === '.') return [];

        try {
            // The URL parser resolves '.' / '..' and clamps at the root.
            const url = new URL(raw.startsWith('/') ? raw : '/' + raw, 'file:///');
            return decodeURIComponent(url.pathname).split('/').filter(p => p !== '' && p !== '.');
        } catch {
            return raw.split('/').filter(p => p !== '' && p !== '.');
        }
    }

    /**
     * Route a path: only the first segment can name a mount point.
     */
    protected resolve(path: string | string[]): Route {
        const parts = this.normpath(path);
        const name = parts[0];

        if (name !== undefined && this.mounts.has(name)) {
            const rest = parts.slice(1);
            return {
                mount: name,
                tree: this.mounts.get(name)!,
                parts: rest,
                path: rest.join('/'),
            };
        }

        return { mount: null, tree: null, parts, path: parts.join('/') };
    }

    /** Names of every mount point, in insertion order. */
    mountPoints(): string[] {
        return Array.from(this.mounts.keys());
    }

    /**
     * Mount a subtree under a single-segment name.
     *
     * Deep mount paths are rejected: `mount('a/b', tree)` fails. Mount the
     * intermediate `FileSystem` and let it own `b` instead. A name already in
     * use is also rejected, so an existing mount is never shadowed silently.
     */
    mount(path: string, tree: FSTree): boolean {
        const parts = this.normpath(path);
        if (parts.length !== 1) return false; // Root overwrite and deep mounts are not allowed.
        if (tree === (this as unknown as FSTree)) return false; // No self mount.

        const name = parts[0];
        if (this.mounts.has(name)) return false;

        this.mounts.set(name, tree);
        return true;
    }

    /**
     * Unmount a subtree. Only single-segment mount names are accepted; deep
     * paths (`'a/b'`) are rejected instead of being forwarded.
     */
    unmount(path: string): boolean {
        const parts = this.normpath(path);
        if (parts.length !== 1) return false;

        return this.mounts.delete(parts[0]);
    }

    /**
     * List directory contents. Local children come from the backing keys; the
     * root additionally exposes every mount name, and anything below a mount
     * name is listed by the subtree itself.
     */
    async listDir(path: string | string[] = '.'): Promise<string[]> {
        const route = this.resolve(path);

        // Inside a mount point: always ask the subtree (dynamic listing).
        if (route.tree) {
            return await route.tree.listDir(route.path || '.');
        }

        const results = new Set<string>();

        // Direct children among the local files.
        for await (const filePath of this.backend.keys()) {
            const child = this.getImmediateChild(route.parts, this.normpath(filePath));
            if (child && !child.startsWith('.')) results.add(child);
        }

        // Mount points only exist at the root of this tree.
        if (route.parts.length === 0) {
            for (const name of this.mounts.keys()) {
                if (!name.startsWith('.')) results.add(name);
            }
        }

        return Array.from(results);
    }

    /**
     * Read file content, optionally limited to a 1-based line range.
     */
    async readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
        const route = this.resolve(path);
        if (route.tree) {
            if (!route.path) throw new Error(`Is a directory: ${route.mount}`);
            return await route.tree.readFile(route.path, startLine, endLine);
        }
        if (!route.path) throw new Error('Is a directory: .');

        const content = await this.backend.get(route.path);
        if (content === undefined) {
            throw new Error(`File not found: ${route.path}`);
        }

        const lines = content.split('\n');
        const start = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
        const end = endLine !== undefined ? endLine : lines.length;

        return lines.slice(start, end).join('\n');
    }

    /**
     * Write to file
     */
    async writeFile(path: string, content: string): Promise<boolean> {
        const route = this.resolve(path);
        if (route.tree) {
            if (!route.path) return false;
            return await route.tree.writeFile(route.path, content);
        }
        if (!route.path) return false;

        await this.backend.set(route.path, content);
        return true;
    }

    /**
     * Delete file
     */
    async deleteFile(path: string): Promise<boolean> {
        const route = this.resolve(path);
        if (route.tree) {
            if (!route.path) return false;
            return await route.tree.deleteFile(route.path);
        }
        if (!route.path) return false;

        return await this.backend.delete(route.path);
    }

    /**
     * Replace the first occurrence of `search` inside a file.
     */
    async editFilePatch(path: string, search: string, replace: string): Promise<boolean> {
        const route = this.resolve(path);
        if (route.tree) {
            if (!route.path) return false;
            return await route.tree.editFilePatch(route.path, search, replace);
        }
        if (!route.path) return false;

        const content = await this.backend.get(route.path);
        if (content === undefined || !content.includes(search)) {
            return false;
        }

        await this.backend.set(route.path, content.replace(search, replace));
        return true;
    }

    /**
     * Match file paths across the local store and every mount point. Patterns
     * are rewritten per mount (the mount name is consumed) and results are
     * re-checked against the original pattern.
     */
    async globFiles(pattern: string): Promise<string[]> {
        const regex = this.globToRegex(pattern);
        const results = new Set<string>();

        // 1. Local matching
        for await (const filePath of this.backend.keys()) {
            if (regex.test(filePath)) results.add(filePath);
        }

        // 2. Mounted subtrees: strip the mount name from the pattern, then verify.
        for (const [name, tree] of this.mounts.entries()) {
            for (const subPattern of this.subPatterns(pattern, name)) {
                const subFiles = await tree.globFiles(subPattern);
                for (const subFile of subFiles) {
                    const fullPath = name + '/' + subFile;
                    if (regex.test(fullPath)) results.add(fullPath);
                }
            }
        }

        return Array.from(results);
    }

    /**
     * Search text in every file below `path`, formatted as `path:line:text`.
     * Mounted subtrees are searched through delegation and their results are
     * prefixed with the mount name.
     */
    async grepSearch(query: string, path: string = '.'): Promise<string[]> {
        const route = this.resolve(path);
        if (route.tree) {
            const subResults = await route.tree.grepSearch(query, route.path || '.');
            return subResults.map(res => `${route.mount}/${res}`);
        }

        const results: string[] = [];

        // Local files below the target path.
        for await (const [filePath, content] of this.backend.entries()) {
            if (!this.isSubPath(route.parts, this.normpath(filePath))) continue;
            content.split('\n').forEach((line, idx) => {
                if (line.includes(query)) {
                    results.push(`${filePath}:${idx + 1}:${line}`);
                }
            });
        }

        // Mount points live at the root, so they are only in scope for the root.
        if (route.parts.length === 0) {
            for (const [name, tree] of this.mounts.entries()) {
                const subResults = await tree.grepSearch(query, '.');
                for (const subRes of subResults) {
                    results.push(`${name}/${subRes}`);
                }
            }
        }

        return results;
    }

    /**
     * Ranked search across the local store and every mount point. Subtrees that
     * implement {@link FSTree.searchFiles} answer for themselves, the others are
     * grepped, so a caller never has to know which is which.
     */
    async searchFiles(query: string, topN: number = 25, path: string = '.'): Promise<SearchHit[]> {
        const route = this.resolve(path);
        if (route.tree) {
            const hits = await searchTree(route.tree, query, topN, route.path || '.');
            return hits.map(hit => ({ ...hit, path: `${route.mount}/${hit.path}` }));
        }

        const results: SearchHit[] = [];

        const local = new Map<string, string>();
        for await (const [filePath, content] of this.backend.entries()) {
            if (this.isSubPath(route.parts, this.normpath(filePath)))
                local.set(filePath, content);
        }

        if (this.localSearch) {
            results.push(...this.localSearch(query, topN, local));
        } else {
            const lines: string[] = [];
            for (const [filePath, content] of local) {
                content.split('\n').forEach((line, idx) => {
                    if (line.includes(query))
                        lines.push(`${filePath}:${idx + 1}:${line}`);
                });
            }
            results.push(...grepToHits(lines, topN));
        }

        if (route.parts.length === 0) {
            for (const [name, tree] of this.mounts.entries()) {
                const hits = await searchTree(tree, query, topN, '.');
                results.push(...hits.map(hit => ({ ...hit, path: `${name}/${hit.path}` })));
            }
        }

        return results.sort((a, b) => b.score - a.score).slice(0, topN);
    }

    /** Get the name of the direct child of `parentParts` on the `itemParts` path. */
    protected getImmediateChild(parentParts: string[], itemParts: string[]): string | null {        if (itemParts.length <= parentParts.length) return null;
        for (let i = 0; i < parentParts.length; i++) {
            if (parentParts[i] !== itemParts[i]) return null;
        }
        return itemParts[parentParts.length];
    }

    /** Determine whether `child` is located under the `parent` path. */
    protected isSubPath(parentParts: string[], childParts: string[]): boolean {
        if (childParts.length < parentParts.length) return false;
        for (let i = 0; i < parentParts.length; i++) {
            if (parentParts[i] !== childParts[i]) return false;
        }
        return true;
    }

    /**
     * Rewrite a glob pattern for the subtree mounted as `name`, returning the
     * patterns that must be evaluated inside it (empty when the mount cannot
     * match at all).
     */
    protected subPatterns(pattern: string, name: string): string[] {
        const segments = pattern.split('/');
        const first = segments[0];
        const rest = segments.slice(1).join('/');

        // '**' spans zero or more segments: it may consume the mount name or not.
        if (first === '**') {
            return Array.from(new Set([pattern, rest || '**']));
        }

        // A literal or wildcard segment must match the mount name itself.
        if (this.globToRegex(first).test(name)) {
            return [rest || '**'];
        }

        return [];
    }

    /**
     * Compile a glob into a regex. `?` and `*` stay inside one segment, `**`
     * spans segments, and `**\/` also matches zero segments.
     */
    protected globToRegex(glob: string): RegExp {
        return globToRegex(glob);
    }
}

/**
 * DataStore adapter based on Map<string, string>
 */
export class MapDataStore implements DataStore {
    private map: Map<string, string>;

    constructor(map?: Map<string, string>) {
        this.map = map ?? new Map<string, string>();
    }

    async *keys(): AsyncIterableIterator<string> {
        for (const key of this.map.keys()) {
            yield key;
        }
    }

    async get(key: string): Promise<string | undefined> {
        return this.map.get(key);
    }

    async set(key: string, value: string): Promise<this> {
        this.map.set(key, value);
        return this;
    }

    async delete(key: string): Promise<boolean> {
        return this.map.delete(key);
    }

    async *entries(): AsyncIterableIterator<[string, string]> {
        for (const entry of this.map.entries()) {
            yield entry;
        }
    }
}

export class ObjectDataStore implements DataStore {
    private data: Record<string, any>;
    public scope: string;

    constructor(data: Record<string, string>, scope: string = 'DataStore') {
        this.data = data;
        this.scope = scope;

        if (typeof this.data[this.scope] !== 'object') {
            this.data[this.scope] = {};
        }
    }

    async *keys(): AsyncIterableIterator<string> {
        for (const key of Object.keys(this.data[this.scope])) {
            yield key;
        }
    }

    async get(key: string): Promise<string | undefined> {
        return this.data[this.scope][key];
    }

    async set(key: string, value: string): Promise<this> {
        this.data[this.scope][key] = value;
        return this;
    }

    async delete(key: string): Promise<boolean> {
        if (this.data[this.scope][key] === undefined)
            return false;

        delete this.data[this.scope][key];
        return true;
    }

    async *entries(): AsyncIterableIterator<[string, string]> {
        for (const entry of Object.entries(this.data[this.scope])) {
            yield entry as [string, string];
        }
    }
}

export class ChatMetadataStore extends ObjectDataStore {
    constructor(metadata: ChatMetadata = chat_metadata, scope: string = 'DataStore') {
        super(metadata, scope);
    }
}

export class GlobalDataStore extends ObjectDataStore {
    constructor(scope: string = 'DataStore') {
        // @ts-expect-error: It is an object.
        super(extension_settings.variables, scope);
    }
}

/**
 * Base class for read-only, derived subtrees (character card, persona, skills).
 *
 * Subclasses only provide a `path -> content` snapshot; listing, globbing,
 * grepping and line-ranged reads all follow from it. Writes are rejected, which
 * is what read-only means here: the tree is a view of data that is owned
 * elsewhere and has no per-chat override mechanism of its own.
 */
export abstract class VirtualTree implements FSTree {
    /** Full content of every file in this tree, keyed by relative path. */
    protected abstract snapshot(): Promise<Map<string, string>>;

    async listDir(path: string | string[] = '.'): Promise<string[]> {
        const parts = splitPath(path);
        const results = new Set<string>();

        for (const filePath of (await this.snapshot()).keys()) {
            const child = immediateChild(parts, splitPath(filePath));
            if (child)
                results.add(child);
        }

        return Array.from(results);
    }

    async globFiles(pattern: string): Promise<string[]> {
        const regex = globToRegex(pattern);
        return Array.from((await this.snapshot()).keys()).filter(path => regex.test(path));
    }

    async grepSearch(query: string, path: string = '.'): Promise<string[]> {
        const parts = splitPath(path);
        const results: string[] = [];

        for (const [filePath, content] of await this.snapshot()) {
            if (!isSubPath(parts, splitPath(filePath)))
                continue;

            content.split('\n').forEach((line, idx) => {
                if (line.includes(query))
                    results.push(`${filePath}:${idx + 1}:${line}`);
            });
        }

        return results;
    }

    async readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
        const content = (await this.snapshot()).get(path);
        if (content === undefined)
            throw new Error(`File not found: ${path}`);

        return sliceLines(content, startLine, endLine);
    }

    async writeFile(path: string, _content: string): Promise<boolean> {
        console.debug(`[CG] read-only tree, write rejected: ${path}`);
        return false;
    }

    async editFilePatch(path: string, _search: string, _replace: string): Promise<boolean> {
        console.debug(`[CG] read-only tree, edit rejected: ${path}`);
        return false;
    }

    async deleteFile(path: string): Promise<boolean> {
        console.debug(`[CG] read-only tree, delete rejected: ${path}`);
        return false;
    }
}

/** Split a path into segments, without the URL-based normalization. */
export function splitPath(path: string | string[]): string[] {
    const raw = Array.isArray(path) ? path.join('/') : path;
    return raw.split('/').filter(p => p !== '' && p !== '.');
}

/** Name of the direct child of `parentParts` along `itemParts`, if any. */
export function immediateChild(parentParts: string[], itemParts: string[]): string | null {
    if (itemParts.length <= parentParts.length)
        return null;

    for (let i = 0; i < parentParts.length; i++) {
        if (parentParts[i] !== itemParts[i])
            return null;
    }

    return itemParts[parentParts.length];
}

/** Whether `childParts` lies below `parentParts`. */
export function isSubPath(parentParts: string[], childParts: string[]): boolean {
    if (childParts.length < parentParts.length)
        return false;

    for (let i = 0; i < parentParts.length; i++) {
        if (parentParts[i] !== childParts[i])
            return false;
    }

    return true;
}

/** Extract a 1-based, inclusive line range. */
export function sliceLines(content: string, startLine?: number, endLine?: number): string {
    if (startLine === undefined && endLine === undefined)
        return content;

    const lines = content.split('\n');
    const start = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
    const end = endLine !== undefined ? endLine : lines.length;
    return lines.slice(start, end).join('\n');
}

/**
 * Compile a glob into a regex. `?` and `*` stay inside one segment, `**`
 * spans segments, and `**\/` also matches zero segments.
 */
export function globToRegex(glob: string): RegExp {
    let source = '';

    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];

        if (char === '*') {
            if (glob[i + 1] === '*') {
                if (glob[i + 2] === '/') {
                    source += '(?:[^/]+/)*'; // '**/' matches any depth, including none.
                    i += 2;
                } else {
                    source += '.*';
                    i += 1;
                }
            } else {
                source += '[^/]*';
            }
            continue;
        }

        source += char === '?' ? '[^/]' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }

    return new RegExp(`^${source}$`);
}
