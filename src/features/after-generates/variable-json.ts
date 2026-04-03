import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";
import { jsonrepair } from 'jsonrepair';

const WI_DECORATOR = '@@variables_json';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, { processor, checker });
    WI_DECORATOR_BEFORE_MAPPING.set(`${WI_DECORATOR}_before`, { processor, checker });
}

async function checker(_: DecoratorProcessData) {
    return true;
}

async function processor(data: DecoratorProcessData) {
    const last = data.env.chat[data.messageId];
    if(!last.variables)
        last.variables = [];
    if(!last.variables[data.swipeId])
        last.variables[data.swipeId] = {};

    const merge = JSON.parse(jsonrepair(data.content));
    const merged = _.mergeWith(last.variables[data.swipeId], merge, (_dst: unknown, src: unknown) => _.isArray(src) ? src : undefined);

    console.debug(`update ${data.messageId}#${data.swipeId} variables: `, last.variables[data.swipeId], merged);

    last.variables[data.swipeId] = merged;
    return true;
}
