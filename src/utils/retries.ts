import { Context, GenerateOptionsLite } from "../features/context";

type Validator = (s: string | string[]) => (boolean | Promise<boolean>);

export async function generate(
    ctx: Context,
    type: string = 'normal',
    options: GenerateOptionsLite & { validator?: Validator } = {},
    dryRun: boolean = false,
    retries: number = 3,
    interval: number = 100,
): Promise<Awaited<ReturnType<Context['generate']>>> {
    let response: Awaited<ReturnType<Context['generate']>> | null = null;
    let lastError: Error | null = null;

    for(let i = 0; i < retries; i++) {
        try {
            response = await ctx.generate(type, options, dryRun);
        } catch (e) {
            if(e instanceof Error)
                e.cause = lastError ?? undefined;
            lastError = e as Error;
            console.error(`Failed to generate content, retrying...`, e);
            continue;
        }

        // AsyncGenerator cannot be validated.
        if(response.toString() === '[object AsyncGenerator]')
            break;

        try {
            // @ts-expect-error: 2345
            if(await options.validator?.call(null, response.swipes ?? response) || response)
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

    if(!response) {
        if(lastError)
            throw lastError;

        throw new Error("Failed to generate content for unknown reason");
    }
    
    return response;
}