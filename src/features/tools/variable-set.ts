import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';
import { SCHEMA as VAR_SCHEMA } from '@/features/schema';
import { applyMergePatch, applyJsonPatch } from '@/utils/json-patch';

/**
 * Modify stored variables using JSON Merge Patch (RFC 7396) and/or JSON Patch (RFC 6902).
 *
 * You must provide at least one of `json_merge` or `json_patch` (or both).
 * - `json_merge` performs a shallow merge (keys omitted remain unchanged; null values delete keys).
 * - `json_patch` applies an array of operations (add, remove, replace, copy, move, test).
 *
 * After patching, the result is validated against the variable schema. If validation fails,
 * the changes are discarded and an error is returned.
 *
 * Returns a JSON object:
 *   On success: { ok: true, variables: object }
 *   On failure: { ok: false, error: string }
 *
 * Use this to create, update, or delete stored data in a structured way.
 */
const TOOL_NAME = 'set_variable';
const SCHEMA = z.object({
    json_merge: z.record(z.string(), z.any()).optional().describe('Patch variables using JSON Merge Patch (RFC 7396). An object where top-level keys are set to new values; null values delete the key. Keys not included remain unchanged.'),
    json_patch: z.array(z.any()).optional().describe('Patch variables using JSON Patch (RFC 6902). An array of operations: { op: "add"|"remove"|"replace"|"copy"|"move"|"test", path: "/...", value?: ... }.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Modify stored variables using JSON Merge Patch and/or JSON Patch. Provide at least one of `json_merge` or `json_patch`. Returns the updated variables or an error.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };

    if(!args.json_merge && !args.json_patch) {
        return JSON.stringify({
            ok: false,
            error: 'Provide at least one of `json_merge` or `json_patch`.',
        });
    }

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
