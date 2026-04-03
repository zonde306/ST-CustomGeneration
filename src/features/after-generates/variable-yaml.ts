import { WI_DECORATOR_MAPPING, WI_DECORATOR_BEFORE_MAPPING, DecoratorProcessData } from "@/features/generate-processor";
import { yaml } from "@st/lib.js";

const WI_DECORATOR = '@@variables_yaml';

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

    const patched = _.merge(last.variables[data.swipeId], yaml.parse(data.content));
    
    console.debug(`update variables: `, last.variables[data.swipeId], patched);

    last.variables[data.swipeId] = patched;
    return true;
}
