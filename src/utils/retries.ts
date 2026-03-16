import { Context, GenerateOptionsLite } from "../features/context";

type Validator = (s: string | string[]) => (boolean | Promise<boolean>);

export async function generate(
    ctx: Context,
    retries: number = 3,
    type: string = 'normal',
    options: GenerateOptionsLite & { validator?: Validator } = {},
    dryRun: boolean = false,
): Promise<string | string[] | AsyncGenerator<{ swipe: number, text: string } | string>> {
    let result: string | string[] | AsyncGenerator<{ swipe: number, text: string } | string> | null = null;
    let lastError = null;

    for(let i = 0; i < retries; i++) {
        try {
            result = await ctx.generate(type, options, dryRun);
        } catch (e) {
            if(e instanceof Error)
                e.cause = lastError ?? undefined;
            lastError = e;
            continue;
        }

        // AsyncGenerator cannot be validated.
        if(result.toString() === '[object AsyncGenerator]')
            break;

        // @ts-expect-error: 2345
        if(await options.validator?.call(null, result) || result)
            break;
    }

    if(!result) {
        if(lastError)
            throw lastError;

        throw new Error("Failed to generate content for unknown reason");
    }
    
    return result;
}