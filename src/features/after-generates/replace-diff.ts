import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";
import { substituteParams } from "@st/script.js";
import { applyPatch } from "diff";

/**
 * The generated result is parsed into a git diff format, and then the original WorldInfo content is replaced.
 */
const WI_DECORATOR = '@@replace_diff';

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

    console.warn(`Blank content to replace for ${data.entry.world}/${data.entry.uid}-${data.entry.comment}`);
    return false;
}

async function processor(data: DecoratorProcessData) {
    const oldContent = substituteParams(data.override.getOverride(data.entry.world, data.entry.uid, data.messageId, data.swipeId)?.content ?? '');
    const diff = applyPatch(oldContent, data.content, { fuzzFactor: 99 });
    if(diff) {
        data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, diff, data.messageId, data.swipeId);
        console.debug(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} replace with diff to ${data.messageId}#${data.swipeId}, and result: ${diff}`);
    } else {
        console.error(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} replace with diff failed`);
        return false;
    }
    return true;
}
