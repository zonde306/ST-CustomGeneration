import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";
import { evaluate, isEjsAvailable } from "@/utils/ejs";

const WI_DECORATOR = '@@replace_ejs';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return isEjsAvailable();
}

async function processor(data: DecoratorProcessData) {
    const result = await evaluate(data.content, {
        ...data.args,
    });
    data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, result, data.messageId, data.swipeId);
    console.debug(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} evaluated to ${data.messageId}#${data.swipeId}, and result: ${result}`);
    return true;
}
