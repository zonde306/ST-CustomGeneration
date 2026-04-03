
export function isEjsAvailable() {
    // @ts-expect-error: 7017
    return globalThis.EjsTemplate != null;
}

export async function evaluate(content: string, context: Record<string, any>): Promise<string> {
    // @ts-expect-error: 7017
    const ejs = globalThis.EjsTemplate as any;
    if(ejs == null) {
        console.error('EjsTemplate is unavailable');
        return '';
    }

    const ctx = await ejs.prepareContext(context);
    try {
        return await ejs.evalTemplate(content, ctx) as string;
    } catch (err) {
        console.error(`eval ejs template failed: `, err, content);
        throw err;
    }
}
