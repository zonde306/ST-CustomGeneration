import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";
import { jsonPatch } from "@/utils/json-patch";
import { jsonrepair } from 'jsonrepair';

/**
 * The generated result is parsed into a JSON patch to update the current chat message variable.
 */
const WI_DECORATOR = '@@variables_jsonpatch';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return true;
}

async function processor(data: DecoratorProcessData) {
    if(data.content.trim().length < 1)
        return true;

    const last = data.env.chat[data.messageId];
    if(!last.variables)
        last.variables = [];
    if(!last.variables[data.swipeId])
        last.variables[data.swipeId] = {};

    const patchs = JSON.parse(jsonrepair(data.content));
    const patched = jsonPatch(last.variables[data.swipeId], patchs);

    console.debug(`update ${data.messageId}#${data.swipeId} variables: `, last.variables[data.swipeId], patched);

    last.variables[data.swipeId] = patched;
    return true;
}
