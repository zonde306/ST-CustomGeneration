import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { jsonPatch } from "@/utils/json-patch";
import { jsonrepair } from 'jsonrepair';

const WI_DECORATOR = '@@variables_jsonpatch';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return true;
}

async function processor(data: DecoratorProcessData) {
    const last = data.env.chat[data.env.chat.length - 1];
    if(!last.variables)
        last.variables = [];
    if(!last.variables[last.swipe_id ?? 0])
        last.variables[last.swipe_id ?? 0] = {};

    const patchs = JSON.parse(jsonrepair(data.content));
    const patched = jsonPatch(last.variables[last.swipe_id ?? 0], patchs);

    console.debug(`update variables: `, last.variables[last.swipe_id ?? 0], patched);

    last.variables[last.swipe_id ?? 0] = patched;
    return true;
}
