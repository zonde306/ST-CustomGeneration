import { loadWorldInfo, METADATA_KEY, selected_world_info, world_info, DEFAULT_DEPTH, world_info_position, world_names, getWorldInfoPrompt, worldInfoCache } from '@st/scripts/world-info.js';
import { chat_metadata, this_chid, characters, getCharacterCardFieldsLazy, getMaxContextSize } from '@st/script.js';
import { power_user } from '@st/scripts/power-user.js';
import { getCharaFilename } from '@st/scripts/utils.js';
import { getGroupMembers } from '@st/scripts/group-chats.js';
import { WorldInfoEntry, LoreBook } from '@/utils/defines';
import { eventSource, event_types } from '@st/scripts/events.js';
import { GENERATION_TYPE_TRIGGERS } from '@st/scripts/constants.js';


export const KNOWN_DECORATORS = [
    '@@replace',             // Full-Text Replacement Update
    '@@replace_before',             // Full-Text Replacement Update
    '@@replace_diff',        // Unified Diff-based Text Updates
    '@@replace_diff_before',        // Unified Diff-based Text Updates
    '@@replace_search',      // Search & Replace-based Text Updates
    '@@replace_search_before',      // Search & Replace-based Text Updates
    '@@variables_json',      // JSON-based Variables Updates (Merge)
    '@@variables_json_before',      // JSON-based Variables Updates (Merge)
    '@@variables_yaml',      // Yaml-based Variables Updates (Merge)
    '@@variables_yaml_before',      // Yaml-based Variables Updates (Merge)
    '@@variables_jsonpatch', // JSON-Patch-based Variables Updates (Merge)
    '@@variables_jsonpatch_before', // JSON-Patch-based Variables Updates (Merge)
    '@@evaluate_ejs',        // Execute EJS code without replacing the content.
    '@@evaluate_ejs_before',        // Execute EJS code without replacing the content.
    '@@replace_ejs',         // Execute EJS code and replace the content.
    '@@replace_ejs_before',         // Execute EJS code and replace the content.
    '@@append_output',       // Append the result to the output.
    '@@append_output_before',       // Append the result to the output.
    '@@append_output_ejs',   // Process the results using EJS and append them to the output.
    '@@append_output_ejs_before',   // Process the results using EJS and append them to the output.
    '@@batch_order',        // Batch order of entries.
];

/**
 * Gets the WI by name, or selects a suitable WI if name is not provided.
 * @param name WI name
 * @returns WI entries
 */
export async function loadWorldInfoEntries(name?: string): Promise<WorldInfoEntry[]> {
    // @ts-expect-error
    const lore = (name || characters[this_chid]?.data?.extensions?.world || power_user.persona_description_lorebook || chat_metadata[METADATA_KEY] || '') as string;
    const lorebook = await loadWorldInfo(lore) as LoreBook;
    if (!lorebook) {
        console.error(`lorebook not found: ${lore} (${name})`);
        return [];
    }

    const entries = Object.values(lorebook.entries).map(entry => {
        const clone = { ...entry };
        // modify in place
        clone.uid = Number(entry.uid);
        const [decorators, content] = parseDecorators(entry.content);
        clone.decorators = decorators;
        clone.content = content;
        clone.world = lore;
        return clone;
    });

    return entries.sort(getWorldInfoSorter(entries));
}

/**
 * Get a WI entry by name and uid
 * @param name WI name
 * @param uid entry uid
 * @returns WI entry or null if not found
 */
export async function getWorldInfoEntry(name: string, uid: string | number | RegExp): Promise<WorldInfoEntry | null> {
    // @ts-expect-error
    const lore = (name || characters[this_chid]?.data?.extensions?.world || power_user.persona_description_lorebook || chat_metadata[METADATA_KEY] || '') as string;
    const lorebook = await loadWorldInfo(lore) as LoreBook;
    if (!lorebook) {
        console.error(`lorebook not found: ${lore} (${name})`);
        return null;
    }

    // @ts-expect-error: 2769
    const entry = Object.values(lorebook.entries).find(e => e.uid === uid || e.comment === uid || e.comment.match(uid));
    if (!entry)
        return null;

    const clone = { ...entry };
    // modify in place
    clone.uid = Number(entry.uid);
    const [decorators, content] = parseDecorators(entry.content);
    clone.decorators = decorators;
    clone.content = content;
    clone.world = lore;
    return clone;
}

/**
 * Get all enabled WI entries in the current context and sort them
 * @param char includes character Primary Lorebook
 * @param global includes Active World(s) for all chats
 * @param persona includes Persona Lorebook
 * @param charaExtra includes character Additional Lorebooks
 * @param chat includes chat bounded lorebooks
 * @param onlyExisting only include lorebooks that exist in the current world
 * @returns lore books
 */
export function collectEnabledWorldInfos(
    char: boolean = true,
    global: boolean = true,
    persona: boolean = true,
    charaExtra: boolean = true,
    chat: boolean = true,
    onlyExisting: boolean = true
): string[] {
    let results: string[] = [];

    if (char) {
        // @ts-expect-error
        const charaWorld: string = characters[this_chid]?.data?.extensions?.world;
        if (charaWorld && !selected_world_info.includes(charaWorld))
            results.push(charaWorld);

        for (const member of getGroupMembers()) {
            const world = member?.data?.extensions?.world;
            if (world && !selected_world_info.includes(world))
                results.push(world);
        }
    }

    if (global) {
        for (const world of selected_world_info) {
            if (world)
                results.push(world as string);
        }
    }

    if (persona) {
        const chatWorld: string = chat_metadata[METADATA_KEY];
        const personaWorld: string = power_user.persona_description_lorebook;
        if (personaWorld && personaWorld !== chatWorld && !selected_world_info.includes(personaWorld))
            results.push(personaWorld);
    }

    if (charaExtra) {
        const fileName = getCharaFilename(this_chid);
        if (fileName) {
            // @ts-expect-error
            const extraCharLore = world_info.charLore?.find((e) => e.name === fileName);
            if (extraCharLore && Array.isArray(extraCharLore.extraBooks)) {
                // @ts-expect-error
                const primaryBook: string = characters[this_chid]?.data?.extensions?.world;
                for (const book of extraCharLore.extraBooks) {
                    if (book && book !== primaryBook && !selected_world_info.includes(book))
                        results.push(book);
                }
            }
        }

        for (const member of getGroupMembers()) {
            const chid = characters.findIndex(ch => ch.avatar === member.avatar);
            const file = getCharaFilename(chid);
            if (file) {
                // @ts-expect-error
                const extraCharLore = world_info.charLore?.find((e) => e.name === file);
                if (extraCharLore && Array.isArray(extraCharLore.extraBooks)) {
                    const primaryBook: string = member?.data?.extensions?.world;
                    for (const book of extraCharLore.extraBooks) {
                        if (book && book !== primaryBook && !selected_world_info.includes(book))
                            results.push(book);
                    }
                }
            }
        }
    }

    if (chat) {
        const chatWorld: string = chat_metadata[METADATA_KEY];
        if (chatWorld && !selected_world_info.includes(chatWorld))
            results.push(chatWorld);
    }

    if (onlyExisting)
        return results.filter(e => e && world_names.includes(e));

    return results;
}

export class DecoratorParser {
    decorators: string[] = [];
    arguments: string[] = [];
    parameters: Record<string, string[]> = {};
    cleanContent: string = '';
    entry: WorldInfoEntry;

    constructor(entry: WorldInfoEntry, override: boolean = false) {
        this.entry = entry;
        if (entry.decorators?.length) {
            this.decorators = entry.decorators;
            this.cleanContent = entry.content;
        } else {
            const [decorators, cleanContent] = parseDecorators(entry.content);
            this.decorators = decorators;
            this.cleanContent = cleanContent;

            if (override) {
                entry.decorators = this.decorators;
                entry.content = this.cleanContent;
            }
        }

        for (const i in this.decorators) {
            if (this.decorators[i].includes(' ')) {
                const firstSpaceIndex = this.decorators[i].indexOf(' ');
                const name = this.decorators[i].substring(0, firstSpaceIndex);
                const args = this.decorators[i].substring(firstSpaceIndex + 1);
                this.arguments[i] = args;
                this.decorators[i] = name;
                this.parameters[name] = splitWithQuotes(args);
            }
        }
    }
}

/**
 * Parse decorators from worldinfo content
 * @param content The content to parse
 * @returns The decorators found in the content and the content without decorators
 */
export function parseDecorators(content: string): [string[], string] {
    /**
     * Extract the base decorator name from a line (e.g., "@@depth 5" → "@@depth")
     * @param line The decorator line
     * @returns The base decorator name
     */
    const getBaseDecorator = (line: string): string => {
        // Remove possible leading '@@@' (escape)
        let candidate = line.startsWith('@@@') ? line.substring(1) : line;
        // Take the part before the first space as the decorator name
        const firstSpaceIndex = candidate.indexOf(' ');
        if (firstSpaceIndex !== -1) {
            candidate = candidate.substring(0, firstSpaceIndex);
        }
        return candidate;
    };

    /**
     * Check if the decorator is known
     * @param line The full decorator line (e.g., "@@depth 5")
     * @returns true if the base decorator is known
     */
    const isKnownDecorator = (line: string): boolean => {
        const base = getBaseDecorator(line);
        return KNOWN_DECORATORS.includes(base);
    };

    if (!content.trim().startsWith('@@')) {
        return [[], content];
    }

    const lines = content.split('\n');
    const decorators: string[] = [];
    let contentStartIndex = 0;
    let fallbacked = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('@@')) {
            // Handle escapes: @@@xxx is treated as normal content unless fallbacked
            if (line.startsWith('@@@') && !fallbacked) {
                contentStartIndex = i;
                break;
            }

            if (isKnownDecorator(line)) {
                // Keep the original line (including arguments), but remove the escape prefix (if any)
                const normalizedLine = line.startsWith('@@@') ? line.substring(1) : line;
                decorators.push(normalizedLine);
                fallbacked = false;
            } else {
                fallbacked = true;
            }
        } else {
            contentStartIndex = i;
            break;
        }
    }

    const newContent = lines.slice(contentStartIndex).join('\n');
    return [decorators, newContent];
}


// Sorting offset table
const DEPTH_MAPPING = {
    [world_info_position.before]: 4, // Before Char Defs
    [world_info_position.after]: 3, // After Char Defs
    [world_info_position.EMTop]: 2, // Before Example Messages
    [world_info_position.EMBottom]: 1, // After Example Messages
    [world_info_position.ANTop]: 1, // Top of Author's Note
    [world_info_position.ANBottom]: -1, // Bottom of Author's Note
};

function getWorldInfoSorter(entries: WorldInfoEntry[]) {
    return (a: WorldInfoEntry, b: WorldInfoEntry) => worldInfoSorter(a, b, Math.max(...entries.map(x => x.position === world_info_position.atDepth ? x.depth : 0)));
}

function worldInfoSorter(a: WorldInfoEntry, b: WorldInfoEntry, top: number = DEFAULT_DEPTH) {
    function calcDepth(entry: WorldInfoEntry) {
        const offset = DEPTH_MAPPING[entry.position];

        // absolute depth
        if (offset == null)
            return entry.depth ?? DEFAULT_DEPTH;

        // relative to AN
        if (entry.position === world_info_position.ANTop || entry.position === world_info_position.ANBottom) {
            switch (chat_metadata.note_position) {
                case 0:
                case 2:
                    // After Main Prompt / Story String
                    return offset + top + DEPTH_MAPPING[world_info_position.before] + 2;
                case 1:
                    // In-chat @ Depth
                    return (chat_metadata.note_depth ?? DEFAULT_DEPTH) + (entry.depth ?? DEFAULT_DEPTH);
            }

            // note_position may be an unknown value, so ignore it
        }

        // relative to chat history with preset
        return offset + top;
    }

    // Sort by depth (desc), then order (asc), then uid (desc)
    return calcDepth(b) - calcDepth(a) ||
        a.order - b.order ||
        b.uid - a.uid;
}

interface WorldInfoScanResult {
    state: {
        current: number;
        next: number;
        loopCount: number;
    };
    new: {
        all: Map<string, WorldInfoEntry>;
        successful: WorldInfoEntry[];
    };
    activated: {
        entries: Map<string, WorldInfoEntry>;
        text: string;
    };
    sortedEntries: Map<string, WorldInfoEntry>;
    recursionDelay: {
        availableLevels: number[];
        currentLevel: number;
    };
    budget: {
        current: number;
        overflowed: boolean;
    };
    timedEffects: any;
}

export function normalizeWorldInfoEntry(entry: WorldInfoEntry): WorldInfoEntry {
    const lorebook = worldInfoCache.get(entry.world) as LoreBook;
    if (!lorebook) {
        console.error(`Unable to normalize WI entry: `, entry);
        return entry;
    }

    const raw = lorebook.entries[String(entry.uid)];
    if (!raw) {
        console.error(`WI entry does not exist.: `, entry);
        return entry;
    }

    const cloned = { ...raw };
    // modify in place
    cloned.uid = Number(raw.uid);
    const [decorators, content] = parseDecorators(raw.content);
    cloned.decorators = decorators;
    cloned.content = content;
    cloned.world = entry.world;
    return cloned;
}

export async function getActivatedEntries(triggerWords: string[], type: string = 'normal', dryRun: boolean = true): Promise<WorldInfoEntry[]> {
    const fields = getCharacterCardFieldsLazy();
    const globalScanData = {
        personaDescription: fields.persona,
        characterDescription: fields.description,
        characterPersonality: fields.personality,
        characterDepthPrompt: fields.charDepthPrompt,
        scenario: fields.scenario,
        creatorNotes: fields.creatorNotes,
        trigger: GENERATION_TYPE_TRIGGERS.includes(type) ? type : 'normal',
    };

    return new Promise((resolve, reject) => {
        eventSource.once(event_types.WORLDINFO_SCAN_DONE, (data: WorldInfoScanResult) => {
            resolve(Array.from(data.activated.entries.values().map(normalizeWorldInfoEntry)));
        });
        getWorldInfoPrompt(triggerWords, getMaxContextSize(), dryRun, globalScanData)
            .then(resolve.bind(null, []))
            .catch(reject);
    });
}

export function filterWIByDecorator(entries: WorldInfoEntry[], decorator: string): WorldInfoEntry[] {
    return entries.filter(entry => entry.decorators?.some(x => x.startsWith(decorator)) || entry.content.includes(decorator));
}


export function splitWithQuotes(input: string): string[] {
    const result: string[] = [];
    let currentToken = '';

    let inDoubleQuotes = false;
    let inSingleQuotes = false;
    let isEscaped = false;
    let hasToken = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (isEscaped) {
            currentToken += char;
            isEscaped = false;
            hasToken = true;
        } else if (char === '\\') {
            isEscaped = true;
        } else if (char === '"' && !inSingleQuotes) {
            inDoubleQuotes = !inDoubleQuotes;
        } else if (char === "'" && !inDoubleQuotes) {
            inSingleQuotes = !inSingleQuotes;
            hasToken = true;
        } else if (/\s/.test(char) && !inDoubleQuotes && !inSingleQuotes) {
            if (hasToken) {
                result.push(currentToken);
                currentToken = '';
                hasToken = false;
            }
        } else {
            currentToken += char;
            hasToken = true;
        }
    }

    if (isEscaped) {
        currentToken += '\\';
    }

    if (hasToken) {
        result.push(currentToken);
    }

    return result;
}
