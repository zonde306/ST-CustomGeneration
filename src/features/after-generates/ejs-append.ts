import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { evaluate } from "@/utils/ejs";

const WI_DECORATOR = '@@append_output_ejs';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const content = await evaluate(data.content, {
        ...data.args,
    });
    if(data.env.chat[data.messageId]?.mes) {
        data.env.chat[data.messageId].mes += content;
    }
    return true;
}
