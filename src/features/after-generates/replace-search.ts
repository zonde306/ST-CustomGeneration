import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";
import { substituteParams } from "@st/script";

const WI_DECORATOR = '@@replace_search';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(data: DecoratorProcessData) {
    // Unable to search and replace empty content
    const content = data.override.getOverride(data.entry.world, data.entry.uid, data.messageId, data.swipeId)?.content || data.content;
    if(content.includes('<%')) {
        console.warn(`Content to replace for ${data.entry.world}/${data.entry.uid}-${data.entry.comment} includes EJS code`);
        return false;
    }

    if(content.trim().length)
        return true;

    console.warn(`No content to replace for ${data.entry.world}/${data.entry.uid}-${data.entry.comment}`);
    return false;
}

async function processor(data: DecoratorProcessData) {
    const original = substituteParams(data.override.getOverride(data.entry.world, data.entry.uid, data.messageId, data.swipeId)?.content ?? data.decorator.cleanContent);
    let result = gitConflictStyle(data.content, original);
    if(result === false)
        result = jsonStyle(data.content, original);

    if(result) {
        data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, result, data.messageId, data.swipeId);
        console.debug(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} replace to ${data.messageId}#${data.swipeId}, and result: ${result}`);
    } else {
        console.error(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} replace failed`);
        return false;
    }
    
    return true;
}

function gitConflictStyle(search: string, target: string): string | false {
    const pattern = /<<<<<<< SEARCH\r?\n([\S\s]+?)\r?\n=======\r?\n([\S\s]+?)\r?\n>>>>>>> REPLACE/gi;
    let match = undefined;
    while((match = pattern.exec(search)) !== null) {
        const [, search, replace] = match;
        console.debug(`Search '${search}' and replace '${replace}'`);

        if(!target.includes(search)) {
            throw new Error(`Search '${search}' not found in target '${target}'`);
        }

        target = target.replace(search, replace);
    }

    if(match === undefined)
        return false;

    return target;
}

function jsonStyle(search: string, target: string): string | false {
    const edits = JSON.parse(search);
    if(!Array.isArray(edits)) {
        if(edits.search && edits.replace) {
            console.debug(`Search '${edits.search}' and replace '${edits.replace}'`);

            if(!target.includes(edits.search)) {
                throw new Error(`Search '${edits.search}' not found in target '${target}'`);
            }

            return target.replace(edits.search, edits.replace);
        }

        return false;
    }

    let changed = false;
    for(const edit of edits) {
        if(edit.search && edit.replace) {
            console.debug(`Search '${edit.search}' and replace '${edit.replace}'`);

            if(!target.includes(edit.search)) {
                throw new Error(`Search '${edit.search}' not found in target '${target}'`);
            }
            
            target = target.replace(edit.search, edit.replace);
            changed = true;
        }
    }

    if(!changed)
        return false;

    return target;
}
