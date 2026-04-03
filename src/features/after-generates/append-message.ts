import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";

const WI_DECORATOR = '@@append_output';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return true;
}

async function processor(data: DecoratorProcessData) {
    if(data.env.chat[data.messageId]?.mes) {
        data.env.chat[data.messageId].mes += data.content;
        if(data.env.chat[data.messageId].swipes?.[data.swipeId]) {
            // @ts-expect-error: 2339
            data.env.chat[data.messageId].swipes[data.swipeId] += data.content;
        }
    }
    return true;
}
