import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { evaluate } from "@/utils/ejs";

const WI_DECORATOR = '@@replace_ejs';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const result = await evaluate(data.content, {
        ...data.args,
    });
    data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, result);
    return true;
}
