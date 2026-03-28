import { Context, GenerateOptionsLite } from "../features/context";

type Validator = (s: string | string[]) => (boolean | Promise<boolean>);

export async function generate(
    ctx: Context,
    type: string = 'normal',
    options: GenerateOptionsLite & { validator?: Validator } = {},
    dryRun: boolean = false,
    retries: number = 3,
    interval: number = 100,
): Promise<string | string[] | AsyncGenerator<{ swipe: number, text: string } | string>> {
    let result: string | string[] | AsyncGenerator<{ swipe: number, text: string } | string> | null = null;
    let lastError: Error | null = null;

    for(let i = 0; i < retries; i++) {
        try {
            result = await ctx.generate(type, options, dryRun);
        } catch (e) {
            if(e instanceof Error)
                e.cause = lastError ?? undefined;
            lastError = e as Error;
            console.error(`Failed to generate content, retrying...`, e);
            continue;
        }

        // AsyncGenerator cannot be validated.
        if(result.toString() === '[object AsyncGenerator]')
            break;

        try {
            // @ts-expect-error: 2345
            if(await options.validator?.call(null, result) || result)
                break;
        } catch(e) {
            if(e instanceof Error)
                e.cause = lastError ?? undefined;
            lastError = e as Error;
            console.error(`Failed to validate content, retrying...`, e);
            continue;
        }

        if(!ctx.macroOverride.macros)
            ctx.macroOverride.macros = {};

        ctx.macroOverride.macros.lastError = lastError?.message ?? '';

        await new Promise(resolve => setTimeout(resolve, interval));
    }

    if(!result) {
        if(lastError)
            throw lastError;

        throw new Error("Failed to generate content for unknown reason");
    }
    
    return result;
}