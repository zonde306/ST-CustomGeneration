import { extension_settings } from "@st/scripts/extensions.js";
import { saveSettingsDebounced } from "@st/script.js";
import { settings } from "@/ui/state";
import {
    FileSystem,
    GlobalDataStore,
} from "@/functions/filesystem";
import { ChatMessageEx, DATA_NAMESPACES, MessageDataStore } from "@/functions/chat-data-store";
import { fuzzySearch } from "@/functions/fuzzy-search";
import { LOREBOOK_MOUNT, WorldInfoTree } from "@/functions/fs-worldinfo";
import {
    CHARACTER_MOUNT,
    CharacterTree,
    PERSONA_MOUNT,
    PersonaTree,
    SKILLS_MOUNT,
    SkillTree,
} from "@/functions/fs-scopes";
import { SkillScanner } from "@/features/skill-scanner";

/** Scope where `/global` files live inside ST's shared variable storage. */
export const GLOBAL_FILES_SCOPE = 'cg_files';

export const GLOBAL_MOUNT = 'global';

/** Everything the mounted trees need from a `Context`. */
export interface FileSystemEnv {
    chat: ChatMessageEx[];
    chat_metadata: ChatMetadata;
    skillScanner?: SkillScanner;
}

/**
 * Build the per-context file system.
 *
 * ```
 * /                     message-layered workspace   rw   rolls back with swipes
 * /global/              account-wide store          rw   survives every chat
 * /persona/             active persona              ro
 * /character/           active character card       ro
 * /skills/              @@skill entries             ro
 * /lorebooks/<book>/    World Info                  book text ro, override rw
 * ```
 *
 * The root *is* the chat workspace, so there is no `/chat`. Location carries
 * meaning: `memory.md` at the root is discarded when the turn that wrote it is
 * rerolled, `/global/preferences.md` is not.
 *
 * The env object is captured by reference, never its `chat` array: `Context`
 * reassigns `chat` after construction.
 */
export function createFileSystem(env: FileSystemEnv): FileSystem {
    const workspace = new MessageDataStore(env, DATA_NAMESPACES.FILES, 'filesystem');
    const files = new FileSystem(workspace);

    // Indexing costs memory and time, while the workspace holds few files with
    // known paths, so grep/glob is enough by default.
    if (settings.storage?.fuzzyIndexFiles) {
        files.localSearch = (query, topN, local) => fuzzySearch(
            Array.from(local.entries()).map(([path, content]) => ({ path, content })),
            query,
            topN,
            { fields: ['path', 'content'], boost: { path: 2 }, previewLength: 120 },
        );
    }

    ensureGlobalScope();
    files.mount(GLOBAL_MOUNT, new FileSystem(new PersistentGlobalStore(GLOBAL_FILES_SCOPE)));
    files.mount(PERSONA_MOUNT, new PersonaTree());
    files.mount(CHARACTER_MOUNT, new CharacterTree());
    files.mount(SKILLS_MOUNT, new SkillTree(env));
    files.mount(LOREBOOK_MOUNT, new WorldInfoTree(env));

    return files;
}

/**
 * `/global` backend. Unlike the chat workspace, nothing else persists this
 * storage, so every mutation has to schedule a settings save itself.
 */
class PersistentGlobalStore extends GlobalDataStore {
    override async set(key: string, value: string): Promise<this> {
        await super.set(key, value);
        saveSettingsDebounced();
        return this;
    }

    override async delete(key: string): Promise<boolean> {
        const deleted = await super.delete(key);
        if (deleted)
            saveSettingsDebounced();
        return deleted;
    }
}

function ensureGlobalScope(): void {
    const store = extension_settings as unknown as Record<string, unknown>;
    if (typeof store.variables !== 'object' || store.variables === null)
        store.variables = {};
}

/**
 * File helpers injected into EJS trigger contexts.
 *
 * Deliberately *not* protected: trigger output is persisted as World Info
 * override content, and a protection token must never reach storage. Prompt-side
 * injection uses `{{file::path}}`, which is protected.
 */
export function ejsFileHelpers(files: FileSystem): Record<string, unknown> {
    return {
        files,
        /** `readFile` throws on a missing file, which is rarely what a template wants. */
        readFileOr: async (path: string, fallback: string = '') => {
            try {
                return await files.readFile(path);
            } catch {
                return fallback;
            }
        },
    };
}
