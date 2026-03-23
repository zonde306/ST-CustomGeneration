import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { evaluate } from "@/utils/ejs";

const WI_DECORATOR = '@@evaluate_ejs';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const result = await evaluate(data.content, {
        ...data.args,
    });

    console.debug(`WI ${data.entry.world}/${data.entry.uid}-${data.entry.comment} evaulate result: ${result}`);
    return true;
}
