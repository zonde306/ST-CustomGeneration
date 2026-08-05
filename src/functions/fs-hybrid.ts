import { DataStore, VirtualTree } from "@/functions/filesystem";

/**
 * A read-only snapshot with a writable overlay restricted to an allowlist.
 *
 * Snapshot files are owned elsewhere (the character card, the persona) and stay
 * read-only, because there is no upstream mechanism to write them back per chat.
 * Overlay files sit in a layered `DataStore`, so they roll back with swipes
 * exactly like the root workspace.
 *
 * The allowlist is a hard boundary rather than a hint. Allowing arbitrary names
 * would turn `/character` into a general notepad (`notes.md`, `analysis.md`,
 * `temp.md`), and the directory would stop meaning "this character's data".
 * Free-form notes already have the root workspace and `/global`.
 */
export class HybridTree extends VirtualTree {
    /**
     * @param base Read-only files, owned upstream.
     * @param overlay Backing store for the writable files.
     * @param writable The only writable paths; never a snapshot path.
     */
    constructor(
        private base: () => Promise<Map<string, string>>,
        private overlay: DataStore,
        private writable: Set<string>,
    ) {
        super();
    }

    protected async snapshot(): Promise<Map<string, string>> {
        const files = await this.base();

        for await (const [key, value] of this.overlay.entries()) {
            // The snapshot always wins: an overlay entry must never shadow card text.
            if (!files.has(key))
                files.set(key, value);
        }

        return files;
    }

    /** Writable means allowlisted *and* not shadowing a snapshot file. */
    private async canWrite(path: string): Promise<boolean> {
        if (!this.writable.has(path))
            return false;

        return !(await this.base()).has(path);
    }

    /** Message naming the writable paths, so a rejected write is actionable. */
    private rejection(path: string): string {
        return `Cannot write "${path}". Only ${Array.from(this.writable).join(', ')} are writable here; `
            + `everything else in this directory is read-only. Use the chat workspace or global/ for free-form notes.`;
    }

    override async writeFile(path: string, content: string): Promise<boolean> {
        if (!await this.canWrite(path))
            throw new Error(this.rejection(path));

        await this.overlay.set(path, content);
        return true;
    }

    override async editFilePatch(path: string, search: string, replace: string): Promise<boolean> {
        if (!await this.canWrite(path))
            throw new Error(this.rejection(path));

        const current = await this.overlay.get(path);
        if (current === undefined || !current.includes(search))
            return false;

        await this.overlay.set(path, current.replace(search, replace));
        return true;
    }

    override async deleteFile(path: string): Promise<boolean> {
        if (!await this.canWrite(path))
            return false;

        return await this.overlay.delete(path);
    }
}

/**
 * A `DataStore` view of one prefixed slice of another store.
 *
 * The overlay namespaces live in chat data, which makes them "the current chat",
 * not "the current chat *and* character". In a group chat the active character
 * changes without the chat changing, so a shared key would let one character's
 * `CONSTRAINTS.md` bleed into another's. Prefixing with the character avatar (or
 * the persona name) keeps them separate while {@link HybridTree} stays unaware
 * of any of it.
 *
 * The prefix is resolved per call: the active character changes mid-chat.
 */
export class ScopedDataStore implements DataStore {
    constructor(
        private inner: DataStore,
        private scope: () => string,
    ) {}

    /** `<scope>/` with the separator escaped out of the scope itself. */
    private prefix(): string {
        return `${(this.scope() || 'default').replace(/\//g, '_')}/`;
    }

    async get(key: string): Promise<string | undefined> {
        return await this.inner.get(this.prefix() + key);
    }

    async set(key: string, value: string): Promise<this> {
        await this.inner.set(this.prefix() + key, value);
        return this;
    }

    async delete(key: string): Promise<boolean> {
        return await this.inner.delete(this.prefix() + key);
    }

    async *keys(): AsyncIterableIterator<string> {
        for await (const [key] of this.entries()) {
            yield key;
        }
    }

    async *entries(): AsyncIterableIterator<[string, string]> {
        const prefix = this.prefix();

        for await (const [key, value] of this.inner.entries()) {
            if (key.startsWith(prefix))
                yield [key.slice(prefix.length), value];
        }
    }
}
