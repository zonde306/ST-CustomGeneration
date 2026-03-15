import { Context, GenerateOptionsLite } from "../features/context";

export async function generate(ctx: Context, retries: number = 3, type: string = 'normal', options: GenerateOptionsLite = {}, dryRun: boolean = false): Promise<string | string[] | AsyncGenerator<{ swipe: number, text: string } | string>> {
    let result: string | string[] | AsyncGenerator<{ swipe: number, text: string } | string> | null = null;
    let lastError = null;

    for(let i = 0; i < retries; i++) {
        try {
            result = await ctx.generate(type, options, dryRun);
        } catch (e) {
            lastError = e;
            continue;
        }

        if(result)
            break;
    }

    if(!result) {
        if(lastError)
            throw lastError;

        throw new Error("Failed to generate content for unknown reason");
    }
    
    return result;
}