
export const eventTypes = {
    GENERATION_START: 'cg_generate_start',
    GENERATION_STREAM_CHUNK: 'cg_generate_chunk',
    GENERATION_END: 'cg_generate_done',
    MESSAGE_SEND: 'cg_message_send',
    MESSAGE_DELETED: 'cg_message_deleted',
    MESSAGE_RECEIVED: 'cg_message_received',
    GENERATE_BEFORE: 'cg_generate_before',
    GENERATE_AFTER: 'cg_generate_after',
    /** @deprecated legacy WI-payload event, use RUN_BATCH_START */
    AGENTS_START: 'cg_agents_start',
    /** @deprecated legacy WI-payload event, use RUN_BATCH_END */
    AGENTS_END: 'cg_agents_end',
    TOOL_CALLING: 'cg_tool_calling',
    /** @deprecated legacy WI-payload event, use RUN_START */
    AGENT_START: 'cg_agent_start',
    /** @deprecated legacy WI-payload event, use RUN_END */
    AGENT_END: 'cg_agent_end',
    PROMPT_CREATED: 'cg_prompt_created',

    // Generic runner events; payloads are source-agnostic (see RunBatchData / RunTaskData).
    RUN_BATCH_START: 'cg_run_batch_start',
    RUN_BATCH_END: 'cg_run_batch_end',
    RUN_START: 'cg_run_start',
    RUN_END: 'cg_run_end',
}

/** Payload of RUN_BATCH_START / RUN_BATCH_END. */
export interface RunBatchData {
    batchId: string;
    kind: string;
    messageId: number;
    abortController?: AbortController;
    reason?: string;
}

/** Payload of RUN_START / RUN_END. */
export interface RunTaskData {
    /** Unique task key, e.g. 'wi:World/3'. Used for DOM addressing. */
    runId: string;
    kind: string;
    /** Display name, e.g. WI entry comment or profile name. */
    label: string;
    messageId: number;
    swipeId: number;
}