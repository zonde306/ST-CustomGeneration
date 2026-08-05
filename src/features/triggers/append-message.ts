import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/trigger-manager";
import { evaluate, isEjsAvailable } from "@/utils/ejs";
import { ejsFileHelpers } from "@/functions/fs-mounts";

/**
 * Add the generated result to the end of the message.
 */
const WI_DECORATOR = '@@append_output';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_MAPPING.set(`${WI_DECORATOR}_ejs`, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_ejs_before`, { processor, checker });
}

async function checker(data: DecoratorProcessData) {
    if (data.decorator.has(`${WI_DECORATOR}_ejs`) || data.decorator.has(`${WI_DECORATOR}_ejs_before`)) {
        return isEjsAvailable();
    }

    return true;
}

async function processor(data: DecoratorProcessData) {
    let content = '\n' + data.content;
    if(content.trim().length < 1)
        return true;
    
    if(data.env.chat[data.messageId]?.mes) {
        if (data.decorator.has(`${WI_DECORATOR}_ejs`) || data.decorator.has(`${WI_DECORATOR}_ejs_before`)) {
            content = await evaluate(content, {
                ...data.args,
                ...ejsFileHelpers(data.env.files),
            });
        }

        data.env.chat[data.messageId].mes += content;
        if(data.env.chat[data.messageId].swipes?.[data.swipeId]) {
            // @ts-expect-error: 2339
            data.env.chat[data.messageId].swipes[data.swipeId] += content;
        }

        console.debug(`append to message ${data.messageId}#${data.swipeId}: ${content}`);
    }
    return true;
}
