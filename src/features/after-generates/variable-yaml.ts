import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { yaml } from "@st/lib.js";

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

    const patched = _.merge(last.variables[last.swipe_id ?? 0], yaml.parse(data.content));
    
    console.debug(`update variables: `, last.variables[last.swipe_id ?? 0], patched);

    last.variables[last.swipe_id ?? 0] = patched;
    return true;
}
