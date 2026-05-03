import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/agent-manager";
import { applyJsonPatch } from "@/utils/json-patch";
import { SCHEMA } from "@/features/schema";
import { jsonrepair } from 'jsonrepair';
import { z } from "zod";

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
    const patched = applyJsonPatch(last.variables[data.swipeId], patchs);
    const validated = SCHEMA.safeParse(patched);
    if(!validated.success) {
        throw new Error(`failed to validate schema: ${JSON.stringify(z.treeifyError(validated.error))}`);
    }

    console.debug(`update ${data.messageId}#${data.swipeId} variables: `, last.variables[data.swipeId], validated.data);

    last.variables[data.swipeId] = validated.data;
    return true;
}
