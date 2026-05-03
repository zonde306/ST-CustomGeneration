
export const eventTypes = {
    GENERATION_START: 'cg_generate_start',
    GENERATION_STREAM_CHUNK: 'cg_generate_chunk',
    GENERATION_END: 'cg_generate_done',
    MESSAGE_SEND: 'cg_message_send',
    MESSAGE_DELETED: 'cg_message_deleted',
    MESSAGE_RECEIVED: 'cg_message_received',
    GENERATE_BEFORE: 'cg_generate_before',
    GENERATE_AFTER: 'cg_generate_after',
    AGENTS_START: 'cg_agents_start',
    AGENTS_END: 'cg_agents_end',
    TOOL_CALLING: 'cg_tool_calling',
    AGENT_START: 'cg_agent_start',
    AGENT_END: 'cg_agent_end',
}
