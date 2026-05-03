import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/agent-manager";
import { evaluate, isEjsAvailable } from "@/utils/ejs";

/**
 * The generated results are processed using EJS, and then the output is discarded.
 */
const WI_DECORATOR = '@@evaluate_ejs';

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
    });

    console.debug(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} evaluated to ${result}`);
    return true;
}
