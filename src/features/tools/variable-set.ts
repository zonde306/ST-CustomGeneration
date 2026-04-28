import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';
import { SCHEMA as VAR_SCHEMA } from '@/features/schema';
import { applyMergePatch, applyJsonPatch } from '@/utils/json-patch';

/**
 * Set variables
 */
const TOOL_NAME = 'set_variable';
const SCHEMA = z.object({
    json_merge: z.record(z.string(), z.any()).optional().describe('Set variables using RFC 7396 JSON Merge Patch.'),
    json_patch: z.array(z.any()).optional().describe('Set variables using RFC 6902 JSON Patch.'),
}).refine(d => d.json_merge == null && d.json_patch == null, { message: 'Provide at least one of `json_merge` or `json_patch`.' });

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Set variables.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    let variables = args.context.variables;

    if(args.json_merge) {
        variables = applyMergePatch(variables, args.json_merge);
    }
    if(args.json_patch) {
        variables = applyJsonPatch(variables, args.json_patch);
    }

    const validated = VAR_SCHEMA.safeParse(variables);
    if(!validated.success) {
        return JSON.stringify({
            ok: false,
            error: `failed to validate schema: ${JSON.stringify(z.treeifyError(validated.error))}`,
        });
    }

    const original = args.context.variables;
    Object.assign(original, validated.data);

    for(const key in original) {
        if(!Object.hasOwnProperty.call(validated.data, key))
            delete original[key];
    }

    return JSON.stringify({
        ok: true,
        variables: original,
    });
}
