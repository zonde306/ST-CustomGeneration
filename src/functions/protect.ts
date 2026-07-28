import { ChatCompMessage } from "@/utils/defines";

/**
 * Verbatim text protection for the prompt pipeline.
 *
 * Tool results and prompts both run through ST's macro engine and, when
 * ST-Prompt-Template is installed, through EJS. For file content that is wrong
 * twice over:
 *
 * 1. The model never sees the bytes actually stored, so `edit_file` can never
 *    match, and it has no way to diagnose why.
 * 2. Files are written by the model, so a `<% %>` inside one would be executed
 *    at injection time — arbitrary JS from tool output.
 *
 * Escaping is not an option (`{{noop}}` runs before the env macros, zero-width
 * characters break round-tripping), so protected text is replaced by an opaque
 * nonce token and restored at the very end of the pipeline, after every
 * processing step and before the request leaves.
 */

/** Per-session nonce: tokens from an older page load can never be confused. */
const NONCE = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const TOKEN_PREFIX = `[[CGP-${NONCE}-`;
const TOKEN_SUFFIX = ']]';
const TOKEN_PATTERN = new RegExp(`\\[\\[CGP-${NONCE}-(\\d+)\\]\\]`, 'g');

/** Bound the side table so a long session cannot leak unbounded memory. */
const MAX_ENTRIES = 2048;

const table = new Map<number, string>();
let counter = 0;

/**
 * Replace text with an opaque token that survives macro and EJS processing.
 * The token contains neither `{{` nor `<%`, so nothing downstream touches it.
 */
export function protect(raw: string): string {
    if (!raw)
        return raw;

    const id = ++counter;
    table.set(id, raw);

    while (table.size > MAX_ENTRIES) {
        const oldest = table.keys().next();
        if (oldest.done)
            break;
        table.delete(oldest.value);
    }

    return `${TOKEN_PREFIX}${id}${TOKEN_SUFFIX}`;
}

/** Whether a string contains at least one protection token. */
export function hasProtected(text: string): boolean {
    return text.includes(TOKEN_PREFIX);
}

/** Restore every token in a string back to the original text. */
export function restoreProtectedText(text: string): string {
    if (!text || !text.includes(TOKEN_PREFIX))
        return text;

    return text.replace(TOKEN_PATTERN, (match, id: string) => {
        const raw = table.get(Number(id));
        if (raw === undefined) {
            console.warn('[CG] unresolved protected token, dropping', match);
            return '';
        }
        return raw;
    });
}

/**
 * Restore protected content in place across a built prompt.
 *
 * Must run after every transformation (macros, EJS, outlets) and before the
 * request is assembled. Restoring earlier would re-expose the text to the
 * template engines; restoring later than the token budget accounting would make
 * the prompt look shorter than it is.
 */
export function restoreProtected(messages: ChatCompMessage[]): void {
    for (const message of messages ?? []) {
        if (typeof message.content === 'string') {
            message.content = restoreProtectedText(message.content);
        } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (typeof part?.text === 'string')
                    part.text = restoreProtectedText(part.text);
            }
        }

        if (typeof message.reasoning_content === 'string')
            message.reasoning_content = restoreProtectedText(message.reasoning_content);
    }
}
