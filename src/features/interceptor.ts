import { eventSource, event_types } from '@st/scripts/events.js';
import { deactivateSendButtons, activateSendButtons } from '@st/script.js';
import { selected_group } from '@st/scripts/group-chats.js';
import { t } from '@st/scripts/i18n.js';
import { Context } from '@/features/context';
import { settings } from '@/settings';

/**
 * Takes over ST's native Generate() pipeline via the `generate_interceptor`
 * extension hook (see manifest.json).
 *
 * When the interceptor runs, ST has already:
 * - emitted GENERATION_STARTED / GENERATION_AFTER_COMMANDS
 * - pushed + rendered the user's message (sendMessageAsUser)
 * - deleted the last AI message for `regenerate`
 * - created the swipe placeholder for `swipe`
 *
 * So the takeover generation must skip those steps (`skipStartEvents`,
 * `noTempMessage`) and only produce + render the response.
 */

// `quiet` (and unknown types) stay on the native pipeline: /gen, summarize, etc.
const HANDLED_TYPES = [undefined, null, '', 'normal', 'regenerate', 'swipe', 'continue'];

let takeoverController: AbortController | null = null;

function onGenerationStopped() {
    if(takeoverController && !takeoverController.signal.aborted) {
        takeoverController.abort('Clicked stop button');
    }
}

async function runTakeover(type: string) {
    takeoverController = new AbortController();
    deactivateSendButtons();

    try {
        const ctx = Context.global();
        await ctx.generate(type, {
            skipStartEvents: true,
            noTempMessage: true,
            abortController: takeoverController,
        });
    } catch (err) {
        console.error('Custom generation takeover failed', err);
        if(takeoverController.signal.aborted === false) {
            const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
            toastr.error(message, t`Custom generate`);
        }
    } finally {
        takeoverController = null;
        // GlobalContext.onGenerationEnded already restores buttons on success;
        // this covers the error/abort paths.
        activateSendButtons();
    }
}

export async function interceptor(
    _chat: ChatMessage[],
    _contextSize: number,
    abort: (immediately: boolean) => void,
    type: string,
): Promise<void> {
    if(!settings.interceptGenerate)
        return;

    if(!HANDLED_TYPES.includes(type))
        return;

    // Group chats use generateGroupWrapper with per-member avatar/state handling
    // that we don't replicate; leave them on the native pipeline.
    if(selected_group)
        return;

    // Stop ST's native pipeline immediately; it will call unblockGeneration()
    // and resolve right after this interceptor returns.
    abort(true);

    // Run after ST's Generate() has fully unwound (unblockGeneration included),
    // so our deactivateSendButtons is not immediately reverted.
    setTimeout(() => { void runTakeover(type || 'normal'); }, 0);
}

export async function setup() {
    // @ts-expect-error: registered for ST's generate_interceptor manifest hook
    globalThis.CustomGeneration_interceptor = interceptor;

    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);
}
