import { WI_DECORATOR_MAPPING, DecoratorProcessData } from "@/features/after-generated";
import { applyPatch } from "diff";

const WI_DECORATOR = '@@replace_diff';

export async function setup() {
    WI_DECORATOR_MAPPING.set(WI_DECORATOR, processor);
}

async function processor(data: DecoratorProcessData) {
    const oldContent = data.override.getOverride(data.entry.world, data.entry.uid)?.content ?? '';
    const diff = applyPatch(oldContent, data.content, { fuzzFactor: 99 });
    if(diff) {
        data.override.setOverride(data.entry.world, data.entry.uid, WI_DECORATOR, diff, data.messageId);
        console.debug(`WI replace with diff ${data.entry.world}/${data.entry.uid}-${data.entry.comment} to ${diff}`);
    } else {
        console.error(`WI replace with diff ${data.entry.world}/${data.entry.uid}-${data.entry.comment} failed`);
        return false;
    }
    return true;
}
