import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";
import { evaluate, isEjsAvailable } from "@/utils/ejs";

const WI_DECORATOR = '@@append_output_ejs';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return isEjsAvailable();
}

async function processor(data: DecoratorProcessData) {
    const content = await evaluate(data.content, {
        ...data.args,
    });
    if(data.env.chat[data.messageId]?.mes) {
        data.env.chat[data.messageId].mes += content;
        if(data.env.chat[data.messageId].swipes?.[data.swipeId]) {
            // @ts-expect-error: 2339
            data.env.chat[data.messageId].swipes[data.swipeId] += content;
        }

        console.debug(`append to message ${data.messageId}#${data.swipeId}: ${content}`);
    }
    return true;
}
