import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { evaluate } from "@/utils/ejs";

const WI_DECORATOR = '@@evaluate_ejs';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    await evaluate(data.content, {
        ...data.args,
    });
    return true;
}
