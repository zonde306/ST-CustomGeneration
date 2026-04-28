import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { eventSource, event_types } from "@st/scripts/events.js";
import { eventTypes } from "@/utils/events";
import { Context, GenerateOptionsLite } from "@/features/context";
import { ApiConfig } from "@/functions/generate";
import { getTokenCountAsync } from '@st/scripts/tokenizers.js';
import { copyText } from '@st/scripts/utils.js';
import { Response } from '@/functions/generate';
import { ToolCalls, ToolMessage } from '@/utils/defines';
import { t } from '@st/scripts/i18n.js'

interface GenerateBefore {
    type: string;
    options: GenerateOptionsLite;
    messages: ChatCompletionMessage[];
    taskId: string;
    context: Context;
    apiConfig: ApiConfig;
    streaming: boolean;
}

interface GenerateAfter {
    taskId: string;
    response: Response | null;
    context: Context;
    streaming: boolean;
    error: Error | null;
}

interface ToolCalling {
    taskId: string;
    options: GenerateOptionsLite;
    context: Context;
    type: string;
    toolCalls: ToolCalls;
}

interface GenerateLogEntry {
    taskId: string;
    messages: ChatCompletionMessage[];
    options: GenerateOptionsLite;
    model: string;
    streaming: boolean;
    responses: string[];
    error: Error | null;
    done: boolean;
    type: string;
    toolMessages: ToolMessage[];
}

const MAX_LOG_COUNT = 100;
export const loggers: GenerateLogEntry[] = [];

let isLoggerEventsBound = false;

export async function setup() {
    eventSource.makeLast(event_types.APP_READY, onAppReady);
    eventSource.makeLast(eventTypes.GENERATE_BEFORE, onGenerateBefore);
    eventSource.makeLast(eventTypes.GENERATE_AFTER, onGenerateAfter);
    eventSource.makeLast(eventTypes.TOOL_CALLING, onToolCalling);
}

function getDialog(selector: string): HTMLDialogElement | null {
    const element = document.querySelector(selector);
    return element instanceof HTMLDialogElement ? element : null;
}

function openDialog(selector: string): void {
    const dialog = getDialog(selector);
    if (!dialog || dialog.open) {
        return;
    }

    try {
        dialog.showModal();
    } catch {
        dialog.setAttribute('open', 'open');
    }
}

function closeDialog(selector: string): void {
    const dialog = getDialog(selector);
    if (!dialog) {
        return;
    }

    if (dialog.open) {
        dialog.close();
    } else {
        dialog.removeAttribute('open');
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value ?? null, null, 2);
    } catch {
        return String(value ?? '');
    }
}

function formatMessageContent(content: any): string {
    if (typeof content === 'string') {
        return content;
    }

    // Chat completion message
    if(typeof content.content === 'string') {
        if(typeof content.reasoning_content === 'string') {
            return `<think>\n${content.reasoning_content}\n</think>\n\n${content.content}`;
        }
        return content.content;
    }
    
    return safeStringify(content);
}

async function buildLoggerMessageTitle(message: ChatCompletionMessage, index: number): Promise<string> {
    const role = String(message.role ?? 'unknown');
    const name = message.name ? ` (${message.name})` : '';
    const markup = message.role === 'system' ? '⚙️' : message.role === 'user' ? '👤' : message.role === 'assistant' ? '🤖' : '⁉';
    const tokens = await getTokenCountAsync(message.content ?? '');
    const base = `Message #${index + 1} · ${markup}${role}${name} · 🧠${tokens} tokens`;
    return base;
}

async function buildLoggerResponseTitle(response: string, index: number): Promise<string> {
    const tokens = await getTokenCountAsync(response ?? '');
    const base = `Response #${index + 1} · 🧠${tokens} tokens`;
    return base;
}

function buildLoggerSection(title: string, blocks: JQuery<HTMLElement>[]): JQuery<HTMLElement> {
    const section = $('<div class="custom_generation_logger_section"></div>');
    const titleEl = $('<div class="custom_generation_logger_section_title"></div>').text(title);
    const body = $('<div class="custom_generation_logger_section_body"></div>');
    section.append(titleEl, body);

    if (!blocks.length) {
        const empty = $('<div class="custom_generation_logger_empty text_muted"></div>').text(t`(empty)`);
        body.append(empty);
        return section;
    }

    blocks.forEach(block => body.append(block));
    return section;
}

function buildLoggerAccordionBlock(title: string, content: string, blockClass?: string): JQuery<HTMLElement>[] {
    const header = $('<div class="custom_generation_logger_block_header"></div>');
    const titleEl = $('<div class="custom_generation_logger_block_title"><i class="fa-solid fa-chevron-right custom_generation_logger_block_caret"></i></div>').append(document.createTextNode(title));
    const copyButton = createCopyButton(content);
    titleEl.append(copyButton);
    header.append(titleEl);

    const panel = $('<div class="custom_generation_logger_block_panel"></div>');
    const pre = $('<pre class="custom_generation_logger_pre"></pre>').text(content);
    panel.append(pre);

    if (blockClass) {
        header.addClass(`${blockClass}_header`);
        panel.addClass(`${blockClass}_panel`);
    }

    return [header, panel];
}

async function buildLoggerMessageBlocks(messages: ChatCompletionMessage[]): Promise<JQuery<HTMLElement>[]> {
    if (!messages.length) {
        return [];
    }

    const blocks: JQuery<HTMLElement>[] = [];
    for (const [index, message] of messages.entries()) {
        const title = await buildLoggerMessageTitle(message, index);
        const content = message.content ? formatMessageContent(message) : formatToolMessageContent(message);
        blocks.push(...buildLoggerAccordionBlock(title, content, 'custom_generation_logger_message'));
    }
    return blocks;
}

async function buildLoggerResponseBlocks(responses: string[]): Promise<JQuery<HTMLElement>[]> {
    if (!responses.length) {
        return [];
    }

    const blocks: JQuery<HTMLElement>[] = [];
    for(const [index, response] of responses.entries()) {
        const title = await buildLoggerResponseTitle(response, index);
        const content = String(response ?? '');
        blocks.push(...buildLoggerAccordionBlock(title, content, 'custom_generation_logger_response'));
    }
    return blocks;
}

async function buildLoggerToolMessageTitle(message: ToolMessage, index: number): Promise<string> {
    const role = String(message.role ?? 'unknown');
    const markup = message.role === 'assistant' ? '🤖' : '🔧';
    const id = message.tool_call_id ? ` (id: ${message.tool_call_id})` : '';
    const tokens = await getTokenCountAsync(message.content ?? '');
    const base = `Tool Message #${index + 1} · ${markup}${role}${id} · 🧠${tokens} tokens`;
    return base;
}

function formatToolMessageContent(message: ToolMessage): string {
    const parts: string[] = [];
    
    if (message.reasoning_content) {
        // Reasoning for tool calls
        parts.push(`<think>\n${message.reasoning_content}\n</think>\n`);
    }
    
    if (message.content) {
        // Tool call response
        parts.push(`${message.content}`);
    }
    
    if (message.tool_calls && message.tool_calls.length > 0) {
        // Tool calls parameters
        parts.push(`${safeStringify(message.tool_calls)}`);
    }
    
    if (parts.length === 0) {
        return t`(empty)`;
    }
    
    return parts.join('\n');
}

async function buildLoggerToolMessageBlocks(toolMessages: GenerateLogEntry['toolMessages']): Promise<JQuery<HTMLElement>[]> {
    if (!toolMessages?.length) {
        return [];
    }

    const blocks: JQuery<HTMLElement>[] = [];
    for (const [index, message] of toolMessages.entries()) {
        const title = await buildLoggerToolMessageTitle(message, index);
        const content = formatToolMessageContent(message);
        blocks.push(...buildLoggerAccordionBlock(title, content, 'custom_generation_logger_tool_message'));
    }
    return blocks;
}

function buildLoggerStatus(entry: GenerateLogEntry): string {
    if (entry.error) {
        return '❌Error';
    }
    return entry.done ? '✅Done' : '🔄Running';
}

async function buildLoggerTitle(entry: GenerateLogEntry, index: number): Promise<string> {
    const fallback = entry.taskId ? `Task ${entry.taskId}` : `Log ${index + 1}`;
    const tokens = await Promise.all(entry.messages.map(msg => getTokenCountAsync(msg.content ?? '')));
    return `${fallback}: ${entry.type} · 🧠${_.sum(tokens)} tokens`;
}

function buildLoggerMeta(entry: GenerateLogEntry): string {
    const mode = entry.streaming ? 'Streaming' : entry.options?.streaming ? 'Half-streaming' : 'Non-streaming';
    return `Messages: ${entry.messages.length} · Responses: ${entry.responses?.length} · ${mode}`;
}

function buildLoggerInfoItem(label: string, value: string): JQuery<HTMLElement> {
    const item = $('<div class="custom_generation_logger_info_item"></div>');
    const labelEl = $('<span class="custom_generation_logger_info_label"></span>').text(label);
    const valueEl = $('<span class="custom_generation_logger_info_value"></span>').text(value);
    item.append(labelEl, valueEl);
    return item;
}

function createCopyButton(content: string): JQuery<HTMLElement> {
    const button = $('<i class="menu_button fa-solid fa-copy custom_generation_copy_button" type="button" title="Copy" data-i18n="[title]Copy"></i>');
    button.on('click', async (event: JQuery.ClickEvent) => {
        event.preventDefault();
        event.stopPropagation();

        try {
            await copyText(content);
            toastr.success('Copied to clipboard', 'Copy');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Copy failed');
            toastr.error(message, 'Copy');
        }
    });
    return button;
}

function buildErrorLoggerBlock(title: string, content: string, blockClass?: string): JQuery<HTMLElement> {
    const block = $('<div></div>');
    if (blockClass) {
        block.addClass(blockClass);
    }
    const header = $('<div class="custom_generation_logger_block_header_row"></div>');
    const titleEl = $('<div class="custom_generation_logger_block_title"></div>').text(title);
    const copyButton = createCopyButton(content);
    const pre = $('<pre class="custom_generation_logger_pre"></pre>').text(content);
    header.append(titleEl, copyButton);
    block.append(header, pre);
    return block;
}

async function buildLoggerEntry(entry: GenerateLogEntry, index: number): Promise<JQuery<HTMLElement>> {
    const container = $('<div class="custom_generation_logger_entry"></div>');
    const summary = $('<div class="custom_generation_logger_summary"></div>');

    const left = $('<div class="custom_generation_logger_summary_left"></div>');
    const title = $('<div class="custom_generation_logger_title"><i class="fa-solid fa-chevron-right custom_generation_logger_caret">&nbsp;</i></div>').append(document.createTextNode(await buildLoggerTitle(entry, index)));
    const meta = $('<div class="custom_generation_logger_meta"></div>').text(buildLoggerMeta(entry));
    left.append(title, meta);

    const right = $('<div class="custom_generation_logger_summary_right"></div>');
    const modelBadge = $('<span class="custom_generation_logger_badge"></span>').text(entry.model || 'Unknown model');
    const status = $('<span class="custom_generation_logger_status"></span>').text(buildLoggerStatus(entry));
    right.append(modelBadge, status);

    summary.append(left, right);

    const body = $('<div class="custom_generation_logger_body"></div>');
    const info = $('<div class="custom_generation_logger_info"></div>');
    info.append(
        buildLoggerInfoItem('Task', entry.taskId || '-'),
        buildLoggerInfoItem('Streaming', entry.streaming ? 'Yes' : 'No'),
        buildLoggerInfoItem('Completed', entry.done ? 'Yes' : 'No'),
    );

    body.append(info);

    const messageBlocks = await buildLoggerMessageBlocks(entry.messages);
    const toolMessageBlocks = await buildLoggerToolMessageBlocks(entry.toolMessages);
    const responseBlocks = await buildLoggerResponseBlocks(entry.responses);
    body.append(buildLoggerSection('Messages', messageBlocks));
    body.append(buildLoggerSection('Tool Messages', toolMessageBlocks));
    body.append(buildLoggerSection('Responses', responseBlocks));

    if (entry.error) {
        const errorText = entry.error.stack || entry.error.message || String(entry.error);
        body.append(buildErrorLoggerBlock('Error', errorText, 'custom_generation_logger_error'));
    }

    container.append(summary, body);

    container.accordion({
        header: '> .custom_generation_logger_summary',
        heightStyle: 'content',
        collapsible: true,
        active: false,
        icons: false,
    });

    body.find('.custom_generation_logger_section_body').each((_index, section) => {
        const sectionEl = $(section);
        sectionEl.accordion({
            header: '> .custom_generation_logger_block_header',
            heightStyle: 'content',
            collapsible: true,
            active: false,
            icons: false,
        });
    });

    return container;
}

async function updateLoggerList(): Promise<void> {
    const list = $('#custom_generation_logger_list');
    if (!list.length) {
        return;
    }

    const nodes : JQuery<HTMLElement>[] = [];

    if (loggers.length === 0) {
        const emptyText = String(list.attr('no-items-text') ?? t`No logs`);
        const empty = $('<div class="custom_generation_logger_empty text_muted"></div>').text(emptyText);
        nodes.push(empty);
        return;
    }

    const entries = [...loggers].reverse();
    for (const [index, entry] of entries.entries()) {
        const logIndex = loggers.length - 1 - index;
        const block = await buildLoggerEntry(entry, logIndex);
        nodes.push(block);
    }

    list.empty().append(...nodes);
}

async function refreshLoggerListIfVisible(): Promise<void> {
    const dialog = getDialog('#custom_generation_logger_dialog');
    if (!dialog) {
        return;
    }

    if (dialog.open || dialog.hasAttribute('open')) {
        await updateLoggerList();
    }
}

function bindLoggerEvents(): void {
    if (isLoggerEventsBound) {
        return;
    }

    isLoggerEventsBound = true;

    $('#custom_generation_logger_close').on('click', () => {
        closeDialog('#custom_generation_logger_dialog');
    });
}

async function onGenerateBefore(data: GenerateBefore) {
    const entry = loggers.findLast(e => e.taskId === data.taskId);
    if(entry) {
        entry.done = false;
        entry.messages = data.messages ?? entry.messages ?? [];
        entry.options = data.options ?? entry.options ?? [];
        entry.toolMessages = data.options.toolMessages ?? [];
        return;
    }

    loggers.push({
        taskId: data.taskId ?? 'Unknown',
        messages: data.messages ?? [],
        options: data.options ?? [],
        model: data.apiConfig.model ?? 'Auto',
        streaming: data.streaming ?? false,
        responses: [],
        error: null,
        done: false,
        type: data.type,
        toolMessages: [],
    });

    while (loggers.length > MAX_LOG_COUNT) {
        loggers.shift();
    }

    await refreshLoggerListIfVisible();
}

async function onGenerateAfter(data: GenerateAfter) {
    const entry = loggers.findLast(e => e.taskId === data.taskId);
    if (!entry) {
        console.error(`Failed to find log entry for task ${data.taskId}`);
        return;
    }

    if(data.response) {
        if(data.response.reasoning.length) {
            entry.responses = [];
            for(let i = 0; i < data.response.swipes.length; ++i) {
                entry.responses.push(`<think>\n${data.response.reasoning[i]}\n</think>\n${data.response.swipes[i]}`);
            }
        } else {
            entry.responses = data.response.swipes;
        }
    } else {
        entry.responses = [];
    }

    entry.error = data.error ?? null;
    entry.done = true;

    await refreshLoggerListIfVisible();
}

async function onToolCalling(data: ToolCalling) {
    const entry = loggers.findLast(e => e.taskId === data.taskId);
    if (!entry) {
        console.error(`Failed to find log entry for task ${data.taskId}`);
        return;
    }

    if(data.options.toolMessages?.length) {
        entry.toolMessages = data.options.toolMessages;
    }

    entry.done = true;

    await refreshLoggerListIfVisible();
}

async function onAppReady() {
    if (!$('#custom_generation_logger_dialog').length) {
        const host = document.body ?? document.documentElement;
        $(host).append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'logger-modal'));
    }

    bindLoggerEvents();

    if (!$('#extensionsMenu')?.find('custom_generation_logger_button')?.length) {
        $('#extensionsMenu').append(`
            <div id="custom_generation_logger_button" class="extension_container interactable" tabindex="0">
                <div id="customGenerateLogger" class="list-group-item flex-container flexGap5 interactable" title="View generate log." tabindex="0" role="listitem">
                    <div class="fa-fw fa-solid fa-cloud extensionsMenuExtensionButton"></div>
                    <span data-i18n="View Generate Log">View Generate Log</span>
                </div>
            </div>
        `);

        $('#customGenerateLogger').on('click', async () => {
            await updateLoggerList();
            openDialog('#custom_generation_logger_dialog');
        });
    }
}
