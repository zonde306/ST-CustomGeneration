import { z } from 'zod';
import { TOOL_DEFINITION } from '@/features/tool-manager';
import { create, all } from 'mathjs';

/**
 * Safely evaluate a mathematical expression using the math.js library.
 *
 * math.js `evaluate()` is inherently safe because it uses a dedicated math
 * expression parser, NOT JavaScript's `eval()`. It has no access to the DOM,
 * network, file system, or any other dangerous JavaScript APIs.
 *
 * To further harden security, we create an isolated math.js instance with a
 * restricted scope, preventing any prototype pollution or global leakage.
 *
 * Supported operations include:
 *   - Basic arithmetic: +, -, *, /, ^, mod
 *   - Trigonometry: sin, cos, tan, asin, acos, atan, atan2
 *   - Logarithms & powers: log, log2, log10, sqrt, pow, exp
 *   - Statistics: mean, median, std, min, max, sum, variance
 *   - Linear algebra: matrix, determinant, transpose, inverse, dot, cross
 *   - Unit conversion: "2.5 cm to inch", "100 km/h to m/s"
 *   - Constants: pi, e, i, Infinity
 *   - Combinatorics: factorial, combinations, permutations
 *   - Bitwise: bitAnd, bitOr, bitXor, bitNot, leftShift, rightShift
 */
const TOOL_NAME = 'calculate';
const SCHEMA = z.object({
    expression: z.string().describe(
        'A mathematical expression to evaluate. Examples: "2 + 3 * 4", "sin(45 deg)", ' +
        '"sqrt(144) + log(100, 10)", "3 meters to feet", "mean([1,2,3,4,5])", ' +
        '"det([[-1,2],[3,1]])", "5!"',
    ),
});

// Create an isolated math.js instance with default configuration.
// Using create() with no config object ensures no prototype pollution
// and keeps the evaluation scope completely separate from the host environment.
let math: ReturnType<typeof create>;

export async function setup() {
    math = create(all, {});

    TOOL_DEFINITION.set(TOOL_NAME, {
        name: TOOL_NAME,
        description:
            'Evaluate a mathematical expression using the math.js library. ' +
            'Supports arithmetic, trigonometry, logarithms, statistics, linear algebra, ' +
            'unit conversion, constants, and combinatorics. ' +
            'Use this tool whenever the LLM needs to compute numeric results or perform calculations.',
        parameters: SCHEMA,
        function: call,
    });
}

async function call(params: any): Promise<string> {
    const args = params as z.infer<typeof SCHEMA>;

    try {
        // Evaluate the expression with an empty scope to prevent any
        // unintended variable leakage or prototype access.
        const result = math.evaluate(args.expression);

        // Format with reasonable precision, stripping trailing zeros
        const resultStr = math.format(result, { precision: 14, lowerExp: -7, upperExp: 20 });

        // Determine the type of the result for the caller's awareness
        let resultType: string;
        if (result === null) {
            resultType = 'null';
        } else if (result === undefined) {
            resultType = 'undefined';
        } else if (typeof result === 'object') {
            // math.js returns special types like Unit, Matrix, Complex, etc.
            resultType = result.constructor?.name ?? 'Object';
        } else {
            resultType = typeof result;
        }

        return JSON.stringify({
            result: resultStr,
            type: resultType,
        });
    } catch (error) {
        return JSON.stringify({
            result: null,
            error: error instanceof Error ? error.message : String(error),
            type: 'error',
        });
    }
}