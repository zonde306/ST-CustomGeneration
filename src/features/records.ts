import { eventSource, event_types } from '../../../../../events.js';
import { getActivatedEntries, DecoratorParser, getWorldInfoEntry } from '../functions/worldinfo';
import { chat } from '../../../../../../script.js';
import { world_info_depth } from '../../../../../world-info.js';
import { Context } from './context';
import { WorldInfoEntry, WorldInfoLoaded } from '../utils/defines.js';
import { eventTypes } from '../utils/events';
import { findTemplate, evaluateTemplate, processTemplate } from '../functions/template';

async function onGenerateEnded() {
    const triggers = chat.slice(-world_info_depth);
    const activatedEntries = await getActivatedEntries(triggers.map(x => x.mes ?? ''));

    for(const ent of activatedEntries) {
        const entry = await getWorldInfoEntry(ent.world, ent.uid);
        if(entry == null)
            continue;

        const parser = new DecoratorParser(entry);
        const idx = parser.decorators.indexOf("@@record");
        if(idx < 0 && !entry.comment.includes("@@record"))
            continue;

        const template = findTemplate("@@record", parser.arguments[idx] ?? '');
        if(!template) {
            console.warn(`record ${entry.world}/${entry.uid}-${entry.comment} cannot find template`);
            continue;
        }

        const ctx = new Context(triggers);

        // Avoid being distracted by other prompts
        ctx.filters = {
            worldInfoDepth: false,
            authorsNoteDepth: false,
            presetDepth: false,
            charDepth: false,
        };

        const recorded = getRecorded(entry) || parser.cleanContent;
        if(!recorded.trim()) {
            console.warn(`record ${entry.world}/${entry.uid}-${entry.comment} cannot be empty`);
            continue;
        }

        const data = {
            prompt: evaluateTemplate(template, {
                entry,
                original: parser.cleanContent,
                current: recorded,
                lastCharMessage: chat.find(m => !m.is_system && !m.is_user),
                lastUserMessage: chat.find(m => m.is_user),
            }),
            context: ctx,
            parsed: parser,
            entry,
        };

        await eventSource.emit(eventTypes.RECORD_UPDATING, data);
        await ctx.send(data.prompt);

        ctx.generate().then(async(response) => {
            const content = (Array.isArray(response) ? response[0] : response) as string;
            const data = {
                current: await processTemplate(template, content),
                last: recorded,
                original: parser.cleanContent,
            };

            if (data.current) {
                await eventSource.emit(eventTypes.RECORD_UPDATED, data);
                setRecord(entry.world, entry.uid, data.current);
                console.debug(`updated record: ${entry.world}/${entry.uid}-${entry.comment} `, data);
            }
        });

        console.debug(`updating record: ${entry.world}/${entry.uid}-${entry.comment} `, recorded);
    }
}

async function onWorldinfoLoaded(data: WorldInfoLoaded) {
    function updateContent(entry: WorldInfoEntry): WorldInfoEntry | null {
        const record = getRecorded(entry);
        if(record) {
            return { ...entry, content: record } as WorldInfoEntry;
        }
        return null;
    }

    for(const idx in data.characterLore) {
        const entry = updateContent(data.characterLore[idx]);
        if (entry) {
            data.characterLore[idx] = entry;
            console.debug(`update character lore ${entry.world}/${entry.uid}-${entry.comment} to `, entry.content);
        }
    }
    for(const idx in data.chatLore) {
        const entry = updateContent(data.chatLore[idx]);
        if (entry) {
            data.chatLore[idx] = entry;
            console.debug(`update chat lore ${entry.world}/${entry.uid}-${entry.comment} to `, entry.content);
        }
    }
    for(const idx in data.globalLore) {
        const entry = updateContent(data.globalLore[idx]);
        if (entry) {
            data.globalLore[idx] = entry;
            console.debug(`update global lore ${entry.world}/${entry.uid}-${entry.comment} to `, entry.content);
        }
    }
    for(const idx in data.personaLore) {
        const entry = updateContent(data.personaLore[idx]);
        if (entry) {
            data.personaLore[idx] = entry;
            console.debug(`update persona lore ${entry.world}/${entry.uid}-${entry.comment} to `, entry.content);
        }
    }
}

function getRecorded(entry: WorldInfoEntry): string | undefined {
    // @ts-expect-error: 2339
    const message = chat.findLast(mes => mes.swipe_info?.[mes.swipe_id ?? 0]?.records?.[`${entry.world}`]?.[`${entry.uid}`]);
    // @ts-expect-error: 2339
    return message?.swipe_info?.[message.swipe_id ?? 0]?.records?.[`${entry.world}`]?.[`${entry.uid}`];
}

function setRecord(world: string, uid: number, content: string) {
    const last = chat[chat.length - 1];
    _.set(last, ['swipe_info', last.swipe_id ?? 0, 'records', world, uid], content);
}

export async function setup() {
    eventSource.on(event_types.GENERATION_ENDED, onGenerateEnded);
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldinfoLoaded);
}
