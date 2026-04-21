import { eventSource, event_types } from "@st/scripts/events.js";
import { collectEnabledWorldInfos, loadWorldInfoEntries, getWorldInfoSorter, filterWIByDecorator, DecoratorParser } from "@/functions/worldinfo";
import { WorldInfoEntry } from "@/utils/defines";
import { deepMergeZod } from "@/utils/zodutl";
import { FunctionSandbox } from "@/utils/vm-browserify";
import {  WorldInfoLoaded } from "@/utils/defines";
import { z } from "zod";

export let SCHEMA: z.ZodObject = z.looseObject({});
let delayLoadTimer: number | null = null;

const NOT_ALLOWED_DECORATORS = [
    '@@json_schema', '@@zod_schema'
];

export async function setup() {
    eventSource.makeLast(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.makeLast(event_types.WORLDINFO_UPDATED, onWorldInfoUpdated);
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded);
}

async function onChatChanged(fielname: string) {
    SCHEMA = z.looseObject({});

    if(!fielname)
        return;

    SCHEMA = await loadSchema();
    console.log(`Variable Schema loaded `, SCHEMA.shape);
}

async function onWorldInfoUpdated() {
    if(delayLoadTimer != null)
        window.clearTimeout(delayLoadTimer);

    delayLoadTimer = window.setTimeout(async () => {
        SCHEMA = await loadSchema();
        delayLoadTimer = null;
        console.log(`Variable Schema reloaded `, SCHEMA.shape);
    }, 1000);
}

async function loadSchema(): Promise<z.ZodObject> {
    let entrites: WorldInfoEntry[] = [];
    const lorebooks = collectEnabledWorldInfos();
    for(const lorebook of lorebooks) {
        entrites = entrites.concat(await loadWorldInfoEntries(lorebook, false));
    }

    entrites = entrites.filter(entry => !entry.disable);
    entrites = filterWIByDecorator(entrites, ['@@json_schema', '@@zod_schema']);
    if(entrites.length < 1) {
        return z.looseObject({});
    }

    using sandbox = new FunctionSandbox();
    let result: z.ZodType<any> = z.looseObject({});
    for(const entry of entrites.sort(getWorldInfoSorter(entrites))) {
        try {
            if(entry.decorators.includes('@@json_schema')) {
                const zod = z.fromJSONSchema(JSON.parse(entry.content));
                if(zod.type !== 'object') {
                    console.warn(`json schema is not an object: ${entry.world}/${entry.comment} #${entry.uid}`);
                    continue;
                }

                result = deepMergeZod(result, zod);
            } else if(entry.decorators.includes('@@zod_schema')) {
                const zod = (await sandbox.eval(entry.content, { _, z, registerSchema })) as z.ZodType<any>;

                if(zod?.type !== 'object') {
                    console.warn(`zod schema is not an object: ${entry.world}/${entry.comment} #${entry.uid}`);
                    continue;
                }

                result = deepMergeZod(result, zod);
            }
        } catch (e) {
            console.error(`failed to parse schema: ${entry.world}/${entry.comment} #${entry.uid}`, e);
        }
    }

    return result as z.ZodObject;
}

function registerSchema(schema: z.ZodType<any>) {
    if(schema.type !== 'object') {
        throw new Error(`schema is not an object`);
    }

    SCHEMA = deepMergeZod(SCHEMA, schema) as z.ZodObject;
    console.log(`Variable Schema registered `, SCHEMA.shape);
    return SCHEMA;
}

async function onWorldInfoLoaded(data: WorldInfoLoaded) {
    for(let i = data.globalLore.length - 1; i  >= 0; --i) {
            const entry = data.globalLore[i];
            const parsed = new DecoratorParser(entry);
            if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
                data.globalLore.splice(i, 1);
                console.debug(`remove global lore ${entry.world}/${entry.uid}-${entry.comment} used for schema`);
            }
        }
        for(let i = 0; i < data.personaLore.length; ++i) {
            const entry = data.personaLore[i];
            const parsed = new DecoratorParser(entry);
            if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
                data.personaLore.splice(i, 1);
                console.debug(`remove persona lore ${entry.world}/${entry.uid}-${entry.comment} used for schema`);
            }
        }
        for(let i = 0; i < data.characterLore.length; ++i) {
            const entry = data.characterLore[i];
            const parsed = new DecoratorParser(entry);
            if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
                data.characterLore.splice(i, 1);
                console.debug(`remove character lore ${entry.world}/${entry.uid}-${entry.comment} used for schema`);
            }
        }
        for(let i = 0; i < data.chatLore.length; ++i) {
            const entry = data.chatLore[i];
            const parsed = new DecoratorParser(entry);
            if(parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d))) {
                data.chatLore.splice(i, 1);
                console.debug(`remove chat lore ${entry.world}/${entry.uid}-${entry.comment} used for schema`);
            }
        }
}
