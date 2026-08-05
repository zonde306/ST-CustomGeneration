import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData, getEntryOverride, setEntryOverride } from "@/features/trigger-manager";

/**
 * The generated result will directly replace the original WorldInfo content.
 */
const WI_DECORATOR = '@@replace';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(data: DecoratorProcessData) {
    // Unable to search and replace empty content
    const content = getEntryOverride(data) || data.content;
    if(content.trim().length)
        return true;

    console.warn(`No content to replace for ${data.entry.world}/${data.entry.uid}-${data.entry.comment}`);
    return false;
}

async function processor(data: DecoratorProcessData) {
    if(data.content.trim().length < 1)
        return true;

    setEntryOverride(data, WI_DECORATOR, data.content);
    console.debug(`WI replace ${data.entry.world}/${data.entry.uid}-${data.entry.comment} to ${data.messageId}#${data.swipeId}, and result: ${data.content}`);
    return true;
}
