import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/after-generated";

const WI_DECORATOR = '@@replace';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return true;
}

async function processor(data: DecoratorProcessData) {
    data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, data.content, data.messageId);
    console.debug(`WI replace ${data.entry.world}/${data.entry.uid}-${data.entry.comment} to ${data.content}`);
    return true;
}
