import { eventSource } from "@st/scripts/events.js";
import { ProfileStore, TemplateResult } from "@/functions/template";
import { Context } from "@/features/context";
import { generate } from "@/utils/retries";
import { eventTypes, RunBatchData, RunTaskData } from "@/utils/events";
import { execute as batchExecute } from "@/utils/concurrency-limiter";

export interface BuildContextOptions {
    /** Caller-injected macros, e.g. the trigger adapter's `{{current}}`. */
    macros?: Record<string, any>;
    /** Value of the `{{original}}` macro. */
    original?: string;
    /** Generate with the specified preset. */
    presetOverride?: string;
}

export interface RunOptions {
    /** Unique task key, e.g. 'wi:World/3'. Used for events/DOM addressing. */
    runId: string;
    /** Profile kind, e.g. 'trigger' | 'agent'. */
    kind: string;
    /** Display name, e.g. WI entry comment or profile name. */
    label: string;
    messageId: number;
    swipeId: number;
    /**
     * Generation type override; defaults to `profile.typeValue`.
     * E.g. the agent adapter passes 'agent:<name>' even when the matched
     * profile is the default (empty-binding) agent profile.
     */
    type?: string;
    abortController?: AbortController;
    /**
     * Caller persistence callback, invoked with the regex-extracted result.
     * Returning false triggers a retry (same semantics as before the refactor).
     */
    validator: (result: TemplateResult) => Promise<boolean> | boolean;
    /** Optional hooks so adapters can emit legacy events with old payloads. */
    onStart?: () => Promise<void> | void;
    onEnd?: () => Promise<void> | void;
}

/**
 * Generic sub-generation executor: lifecycle (events, retries, interruption,
 * concurrency) and output extraction. Results are returned to the caller via
 * `validator`; the runner itself never persists anything.
 */
export class GenerationRunner {
    /**
     * Build a sub-generation Context from a profile and a caller environment.
     * The chat is shallow-copied so the sub-generation cannot append messages
     * to the real chat.
     */
    static buildContext(profile: ProfileStore, env: Context, options: BuildContextOptions = {}): Context {
        const ctx = new Context({ chat: env.chat.slice(), chat_metadata: env.chat_metadata });
        ctx.historyPrompts = profile.prompts;
        ctx.historyPromptsType = profile.typeValue;
        ctx.filters = profile.filters;
        if (options.original !== undefined)
            ctx.macroOverride.original = options.original;
        if (options.macros)
            ctx.macroOverride.macros = { ...options.macros };
        if (options.presetOverride)
            ctx.presetOverride = options.presetOverride;
        return ctx;
    }

    /**
     * Run one profile generation with retry and output extraction.
     * Emits RUN_START / RUN_END with a source-agnostic payload.
     */
    static async run(profile: ProfileStore, ctx: Context, options: RunOptions): Promise<any> {
        const taskData: RunTaskData = {
            runId: options.runId,
            kind: options.kind,
            label: options.label,
            messageId: options.messageId,
            swipeId: options.swipeId,
        };

        await eventSource.emit(eventTypes.RUN_START, taskData);
        await options.onStart?.();

        try {
            return await generate(
                ctx,
                options.type ?? profile.typeValue,
                {
                    validator: async (response) => {
                        response = Array.isArray(response) ? response : [response];

                        // Multiple responses
                        for (const content of response) {
                            const processed = profile.process(content);
                            if (processed.success) {
                                if (await options.validator({
                                    success: true,
                                    content: processed.content ?? content,
                                    arguments: processed.arguments ?? {},
                                })) {
                                    return true;
                                }
                            }
                        }

                        // retry
                        return false;
                    },
                    dontCreate: true,
                    abortController: options.abortController,
                },
                false,
                profile.retries,
                profile.interval,
            );
        } finally {
            await options.onEnd?.();
            await eventSource.emit(eventTypes.RUN_END, taskData);
        }
    }

    /** Execute tasks with a concurrency limit. */
    static async runTasks<T>(tasks: (() => Promise<T>)[], maxConcurrency: number): Promise<PromiseSettledResult<T>[]> {
        return await batchExecute(tasks, maxConcurrency);
    }

    /** Wrap a batch of runs in RUN_BATCH_START / RUN_BATCH_END events. */
    static async withBatch<T>(data: RunBatchData, fn: () => Promise<T>): Promise<T> {
        await eventSource.emit(eventTypes.RUN_BATCH_START, data);
        try {
            return await fn();
        } finally {
            await eventSource.emit(eventTypes.RUN_BATCH_END, data);
        }
    }

    /** Emit a batch-end event out of band (e.g. on cancellation). */
    static async emitBatchEnd(data: Partial<RunBatchData> & { reason: string }): Promise<void> {
        await eventSource.emit(eventTypes.RUN_BATCH_END, data);
    }
}
