import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";

const WI_DECORATOR = '@@append_output';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    if(data.env.lastAssistantMessage?.mes) {
        data.env.lastAssistantMessage.mes += data.content;
    }
    return true;
}
