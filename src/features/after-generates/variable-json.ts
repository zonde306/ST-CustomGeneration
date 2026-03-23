import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { jsonrepair } from 'jsonrepair';

const WI_DECORATOR = '@@variables_json';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const last = data.env.chat[data.env.chat.length - 1];
    if(!last.variables)
        last.variables = [];
    if(!last.variables[last.swipe_id ?? 0])
        last.variables[last.swipe_id ?? 0] = {};

    const merge = JSON.parse(jsonrepair(data.content));
    const merged = _.merge(last.variables[last.swipe_id ?? 0], merge);

    console.debug(`update variables: `, last.variables[last.swipe_id ?? 0], merged);

    last.variables[last.swipe_id ?? 0] = merged;
    return true;
}
