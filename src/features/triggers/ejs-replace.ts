import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData, setEntryOverride } from "@/features/trigger-manager";
import { evaluate, isEjsAvailable } from "@/utils/ejs";
import { ejsFileHelpers } from "@/functions/fs-mounts";

/**
 * The generated result is processed using EJS, and then the original WorldInfo content is overwritten.
 */
const WI_DECORATOR = '@@replace_ejs';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return isEjsAvailable();
}

async function processor(data: DecoratorProcessData) {
    if(data.content.trim().length < 1)
        return true;

    const result = await evaluate(data.content, {
        ...data.args,
        ...ejsFileHelpers(data.env.files),
    });
    setEntryOverride(data, WI_DECORATOR, result);
    console.debug(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} evaluated to ${data.messageId}#${data.swipeId}, and result: ${result}`);
    return true;
}
