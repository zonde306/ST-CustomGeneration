import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/after-generated";

const WI_DECORATOR = '@@append_output';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, processor);
}

async function processor(data: DecoratorProcessData) {
    if(data.env.chat[data.messageId]?.mes) {
        data.env.chat[data.messageId].mes += data.content;
    }
    return true;
}
