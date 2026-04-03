import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";

const WI_DECORATOR = '@@replace';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(data: DecoratorProcessData) {
    // Unable to search and replace empty content
    const content = data.override.getOverride(data.entry.world, data.entry.uid, data.messageId, data.swipeId)?.content || data.content;
    if(content.trim().length)
        return true;

    console.warn(`No content to replace for ${data.entry.world}/${data.entry.uid}-${data.entry.comment}`);
    return false;
}

async function processor(data: DecoratorProcessData) {
    data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, data.content, data.messageId, data.swipeId);
    console.debug(`WI replace ${data.entry.world}/${data.entry.uid}-${data.entry.comment} to ${data.messageId}#${data.swipeId}, and result: ${data.content}`);
    return true;
}
