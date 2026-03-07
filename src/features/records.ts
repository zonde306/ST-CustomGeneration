import { eventSource, event_types } from '../../../../../events.js';
import { getActivatedEntries, DecoratorParser } from '../functions/worldinfo';
import { chat } from '../../../../../../script.js';
import { world_info_depth } from '../../../../../world-info.js';
import { Context } from './context';
import { WorldInfoEntry, WorldInfoLoaded } from '../utils/defines.js';
import { eventTypes } from '../utils/events';
import { applyPatch } from 'diff';

async function onGenerateEnded() {
    const triggers = chat.slice(-world_info_depth);
    const activatedEntries = await getActivatedEntries(triggers.map(x => x.mes ?? ''));

    const tasks = [];

    for(const entry of activatedEntries) {
        const parser = new DecoratorParser(entry);
        if(parser.decorators.length < 1 || !parser.decorators.includes("@@record"))
            continue;

        const ctx = new Context(triggers);
        const record = getRecord(entry) || parser.cleanContent;
        if(!record.trim()) {
            console.warn(`record ${entry.world}/${entry.uid}-${entry.comment} cannot be empty`);
            continue;
        }

        const data = {
            prompt: `\
Based on the above, update the following data documents:

<document file="${entry.world}/${entry.uid}-${entry.comment}.txt">
${record}
</document>

You need to use the \`<patch>\` tag to output the updates to the above document.
Please strictly use the **unified diff** format (git diff -U3 style) to output your changes.
It must contain at least 2-3 lines of context.
Use relative paths for file paths, for example:

<patch>
--- ${entry.world}/${entry.uid}-${entry.comment}.txt
+++ ${entry.world}/${entry.uid}-${entry.comment}.txt
@@ -10,6 +10,7 @@
 function hello() {
   console.log("old");
+  console.log("LLM added this line");
 }
</patch>

Do not add any markdown code block descriptions or extra text; only output the pure patch content.\
`,
            context: ctx,
            parsed: parser,
            entry,
        };

        await eventSource.emit(eventTypes.RECORD_UPDATING, data);
        await ctx.send(data.prompt);

        tasks.push({
            context: ctx,
            awaitee: ctx.generate(),
            entry,
            record,
        });

        console.debug(`updating record: ${entry.world}/${entry.uid}-${entry.comment} `, record);
    }

    const results = await Promise.allSettled(tasks.map(x => x.awaitee));
    for(const [i, result] of results.entries()) {
        if(result.status === 'fulfilled') {
            const { entry, record } = tasks[i];
            let content = result.value;
            content = Array.isArray(content) ? content[0] : content;
            // @ts-expect-error: always string
            const match = content.match(/<patch>([\s\S]+?)<\/patch>/);
            if(match) {
                const data = {
                    world: entry.world,
                    uid: entry.uid,
                    comment: entry.comment,
                    content: match[1],
                    original: record,
                };
                await eventSource.emit(eventTypes.RECORD_UPDATED, data);
                const patched = applyPatch(data.original, data.content);

                if(patched) {
                    updateRecord(data.world, data.uid, patched);
                    console.log(`record ${entry.world}/${entry.uid}-${entry.comment} updated `, patched);
                } else {
                    console.error(`update record ${entry.world}/${entry.uid}-${entry.comment} failed: invalid patch `, data.content);
                }
            } else {
                console.error(`update record ${entry.world}/${entry.uid}-${entry.comment} failed: no response found `, content);
            }
        } else {
            console.error(`update record ${tasks[i].entry.world}/${tasks[i].entry.uid}-${tasks[i].entry.comment} error `, result.reason);
        }
    }
}

async function onWorldinfoLoaded(data: WorldInfoLoaded) {
    function updateContent(entry: WorldInfoEntry): WorldInfoEntry | null {
        const record = getRecord(entry);
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

function getRecord(entry: WorldInfoEntry): string | undefined {
    // @ts-expect-error: 2339
    const message = chat.findLast(mes => mes.swipe_info?.[mes.swipe_id ?? 0]?.records?.[`${entry.world}`]?.[`${entry.uid}`]);
    // @ts-expect-error: 2339
    return message?.swipe_info?.[message.swipe_id ?? 0]?.records?.[`${entry.world}`]?.[`${entry.uid}`];
}

function updateRecord(world: string, uid: number, content: string) {
    const last = chat[chat.length - 1];
    _.set(last, ['swipe_info', last.swipe_id ?? 0, 'records', world, uid], content);
}

export async function setup() {
    eventSource.on(event_types.GENERATION_ENDED, onGenerateEnded);
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldinfoLoaded);
}
