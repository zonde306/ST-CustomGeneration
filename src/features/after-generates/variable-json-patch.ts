import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { jsonPatch } from "@/utils/json-patch";
import { jsonrepair } from 'jsonrepair';

const WI_DECORATOR = '@@variables_jsonpatch';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const last = data.env.chat[data.env.chat.length - 1];
    if(!last.variables)
        last.variables = [];
    if(!last.variables[last.swipe_id ?? 0])
        last.variables[last.swipe_id ?? 0] = {};

    const patchs = JSON.parse(jsonrepair(data.content));
    last.variables[last.swipe_id ?? 0] = jsonPatch(last.variables[last.swipe_id ?? 0], patchs);
    return true;
}
