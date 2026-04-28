import { z } from 'zod';
import { TOOL_DEFINITION } from "@/features/tool-manager";
import { Context } from '@/features/context';
import { SCHEMA as VAR_SCHEMA } from '@/features/schema';

/**
 * Get variables
 */
const TOOL_NAME = 'get_variable';
const SCHEMA = z.object({
    path: z.union([z.string(), z.array(z.string())]).optional().describe('The variable `path` is in the form of `lodash path`. If not provided, all variables will be retrieved.'),
    schema: z.coerce.boolean().optional().default(false).describe('Whether to return the JSON schema of the variable.'),
    default: z.any().optional().default({}).describe('The default value to return if the variable does not exist.'),
});

export async function setup() {
    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description: 'Get variables.',
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
