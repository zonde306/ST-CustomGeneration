import { eventSource, event_types } from '../../../../../events.js';
import { getActivatedEntries, DecoratorParser } from '../functions/worldinfo';
import { chat } from '../../../../../../script.js';
import { world_info_depth } from '../../../../../world-info.js';
import { Context } from './context';
import { WorldInfoEntry } from '../utils/defines.js';
import { eventTypes } from '../utils/events';

async function onGenerateEnded() {
    const triggers = chat.slice(-world_info_depth);
    const activatedEntries = await getActivatedEntries(triggers.map(x => x.mes ?? ''));

    const tasks = [];

    for(const entry of activatedEntries) {
        const parser = new DecoratorParser(entry);
        if(parser.decorators.length < 1 || !parser.decorators.includes("@@record"))
            continue;

        const ctx = new Context(triggers);
        const data = {
            prompt: `\
Based on the above, update the following data documents:

<document>
${getRecord(entry) ?? parser.cleanContent}
</document>

You need to use the \`<document>\` tag to output the updates to the above document.\
`,
            context: ctx,
            decorators: parser,
            entry,
        };

        await eventSource.emit(eventTypes.RECORD_UPDATING, data);

        await ctx.send(data.prompt);

        tasks.push({
            context: ctx,
            awaitee: ctx.generate(),
            world: entry.world,
            uid: entry.uid,
        });
        console.log(`update record ${entry.world}/${entry.uid}`);
    }

    const results = await Promise.allSettled(tasks.map(x => x.awaitee));
    for(const [i, result] of results.entries()) {
        if(result.status === 'fulfilled') {
            const { world, uid } = tasks[i];
            let content = result.value;
            content = Array.isArray(content) ? content[0] : content;
            const match = content.match(/<document>([\s\S]+?)<\/document>/);
            if(match) {
                const data = {
                    world,
                    uid,
                    content: match[1],
                };
                await eventSource.emit(eventTypes.RECORD_UPDATED, data);
                updateRecord(data.world, data.uid, data.content);
                
                console.log(`update record ${world}/${uid} done`);
            } else {
                console.error(`update record ${world}/${uid} failed: no response `, content);
            }
        } else {
            console.error(`update record ${tasks[i].world}/${tasks[i].uid} error `, result.reason);
        }
    }
}

function getRecord(entry: WorldInfoEntry) {
    // @ts-expect-error: 2339
    const message = chat.findLast(mes => mes.swipe_info?.[mes.swipe_id ?? 0]?.records?.[`${entry.world}`]?.[`${entry.uid}`]);
    // @ts-expect-error: 2339
    return message?.swipe_info?.[mes.swipe_id ?? 0]?.records?.[`${entry.world}`]?.[`${entry.uid}`];
}

function updateRecord(world: string, uid: number, content: string) {
    const last = chat[chat.length - 1];
    _.set(last, ['swipe_info', last.swipe_id ?? 0, 'records', world, uid], content);
}

export async function setup() {
    eventSource.on(event_types.GENERATION_ENDED, onGenerateEnded);
}
