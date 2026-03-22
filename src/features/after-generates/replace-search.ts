import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";

const WI_DECORATOR = '@@replace_search';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const original = data.override.getOverride(data.entry.world, data.entry.uid)?.content ?? data.decorator.cleanContent;
    let final = gitConflictStyle(data.content, original);
    if(final === false)
        final = jsonStyle(data.content, original);

    if(final)
        data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, final);

    console.debug(`WI replace ${data.entry.world}/${data.entry.uid}-${data.entry.comment} to ${final}`);
    return true;
}

function gitConflictStyle(search: string, target: string): string | false {
    const pattern = /<<<<<<< SEARCH\r?\n([\S\s]+?)\r?\n=======\r?\n([\S\s]+?)\r?\n>>>>>>> REPLACE/gi;
    let match = undefined;
    while((match = pattern.exec(search)) !== null) {
        const [, search, replace] = match;
        target = target.replace(search, replace);
    }

    if(match === undefined)
        return false;

    return target;
}

function jsonStyle(search: string, target: string): string | false {
    const edits = JSON.parse(search);
    if(!Array.isArray(edits)) {
        if(edits.search && edits.replace)
            return target.replace(edits.search, edits.replace);

        return false;
    }

    let changed = false;
    for(const edit of edits) {
        if(edit.search && edit.replace) {
            target = target.replace(edit.search, edit.replace);
            changed = true;
        }
    }

    if(!changed)
        return false;

    return target;
}
