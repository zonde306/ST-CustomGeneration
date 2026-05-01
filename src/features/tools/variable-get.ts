import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';
import { SCHEMA as VAR_SCHEMA } from '@/features/schema';

/**
 * Retrieve the current value of stored variables.
 *
 * You can optionally specify a `path` to access a nested property using lodash-style dot notation
 * (e.g., "character.name" or ["character", "name"]). If `path` is omitted, all variables are returned.
 *
 * Returns a JSON object: { ok: true, variables: any, json_schema?: object }
 * - `variables` contains the requested value(s), or the `default` value if the path doesn't exist.
 * - `json_schema` is included only when `schema` is true.
 *
 * Use this to inspect the current state of stored data before making decisions or modifications.
 */
const TOOL_NAME = 'get_variable';
const SCHEMA = z.object({
    path: z.union([z.string(), z.array(z.string())]).optional().describe('Lodash-style path to a nested variable (e.g., "character.name" or ["character", "name"]). Omit to retrieve all variables.'),
    schema: z.coerce.boolean().optional().default(false).describe('Set to true to also return the JSON schema definition of the variables structure.'),
    default: z.any().optional().default({}).describe('Default value returned if the specified `path` does not exist in variables.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Retrieve stored variables, optionally at a specific lodash-style path. Returns the variable value(s) with optional JSON schema.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA> & { context: Context };
    const variables = args.context.variables;
    return JSON.stringify({
        ok: true,
        variables: args.path ? _.get(variables, args.path, args.default) : variables,
        json_schema: args.schema ? VAR_SCHEMA.toJSONSchema() : undefined,
    });
}
