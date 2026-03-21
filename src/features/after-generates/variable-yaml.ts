import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import * as YAML from 'yaml';

const WI_DECORATOR = '@@variables_yaml';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const last = data.env.chat[data.env.chat.length - 1];
    if(!last.variables)
        last.variables = [];
    if(!last.variables[last.swipe_id ?? 0])
        last.variables[last.swipe_id ?? 0] = {};
    last.variables[last.swipe_id ?? 0] = _.merge(last.variables[last.swipe_id ?? 0], YAML.parse(data.content));
    return true;
}
