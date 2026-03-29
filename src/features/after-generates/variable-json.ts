import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/after-generated";
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
