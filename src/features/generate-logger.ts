import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { eventSource, event_types } from "@st/scripts/events.js";
import { eventTypes } from "@/utils/events";
import { Context, GenerateOptionsLite } from "@/features/context";
import { ApiConfig } from "@/functions/generate";
import { getTokenCountAsync } from '@st/scripts/tokenizers.js';

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
    responses: string[];
    context: Context;
    streaming: boolean;
    error: Error | null;
}

interface GenerateLogEntry {
    taskId: string;
    messages: ChatCompletionMessage[];
    options: GenerateOptionsLite;
    model: string;
    streaming: boolean;
    response: string[];
    error: Error | null;
    done: boolean;
    type: string;
}

const MAX_LOG_COUNT = 100;
export const loggers: GenerateLogEntry[] = [];

const PREVIEW_LIMIT = 120;
let isLoggerEventsBound = false;

export async function setup() {
    eventSource.makeLast(event_types.APP_READY, onAppReady);
    eventSource.makeLast(eventTypes.GENERATE_BEFORE, onGenerateBefore);
    eventSource.makeLast(eventTypes.GENERATE_AFTER, onGenerateAfter);
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

function getPreviewText(text: string): string {
    return String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, PREVIEW_LIMIT);
}

function formatMessageContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
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
        const empty = $('<div class="custom_generation_logger_empty text_muted"></div>').text('(empty)');
        body.append(empty);
        return section;
    }

    blocks.forEach(block => body.append(block));
    return section;
}

function buildLoggerAccordionBlock(title: string, content: string, blockClass?: string): JQuery<HTMLElement>[] {
    const header = $('<div class="custom_generation_logger_block_header"></div>');
    const caret = $('<i class="fa-solid fa-chevron-right custom_generation_logger_block_caret"></i>');
    const titleEl = $('<div class="custom_generation_logger_block_title"></div>').text(title);
    header.append(caret, titleEl);

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
        const content = formatMessageContent(message.content ?? '');
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

function buildLoggerStatus(entry: GenerateLogEntry): string {
    if (entry.error) {
        return 'Error';
    }
    return entry.done ? 'Done' : 'Running';
}

async function buildLoggerTitle(entry: GenerateLogEntry, index: number): Promise<string> {
    const fallback = entry.taskId ? `Task ${entry.taskId}` : `Log ${index + 1}`;
    const tokens = await Promise.all(entry.messages.map(msg => getTokenCountAsync(msg.content ?? '')));
    return `${fallback}: ${entry.type} · 🧠${_.sum(tokens)} tokens`;
}

function buildLoggerMeta(entry: GenerateLogEntry): string {
    const mode = entry.streaming ? 'Streaming' : 'Non-streaming';
    return `Messages: ${entry.messages.length} · Responses: ${entry.response.length} · ${mode}`;
}

function buildLoggerInfoItem(label: string, value: string): JQuery<HTMLElement> {
    const item = $('<div class="custom_generation_logger_info_item"></div>');
    const labelEl = $('<span class="custom_generation_logger_info_label"></span>').text(label);
    const valueEl = $('<span class="custom_generation_logger_info_value"></span>').text(value);
    item.append(labelEl, valueEl);
    return item;
}

function buildLoggerBlock(title: string, content: string, blockClass?: string): JQuery<HTMLElement> {
    const block = $('<div></div>');
    if (blockClass) {
        block.addClass(blockClass);
    }
    const titleEl = $('<div class="custom_generation_logger_block_title"></div>').text(title);
    const pre = $('<pre class="custom_generation_logger_pre"></pre>').text(content);
    block.append(titleEl, pre);
    return block;
}

async function buildLoggerEntry(entry: GenerateLogEntry, index: number): Promise<JQuery<HTMLElement>> {
    const container = $('<div class="custom_generation_logger_entry"></div>');
    const summary = $('<div class="custom_generation_logger_summary"></div>');
    const caret = $('<i class="fa-solid fa-chevron-right custom_generation_logger_caret"></i>');

    const left = $('<div class="custom_generation_logger_summary_left"></div>');
    const title = $('<div class="custom_generation_logger_title"></div>').text(await buildLoggerTitle(entry, index));
    const meta = $('<div class="custom_generation_logger_meta"></div>').text(buildLoggerMeta(entry));
    left.append(title, meta);

    const right = $('<div class="custom_generation_logger_summary_right"></div>');
    const modelBadge = $('<span class="custom_generation_logger_badge"></span>').text(entry.model || 'Unknown model');
    const status = $('<span class="custom_generation_logger_status"></span>').text(buildLoggerStatus(entry));
    right.append(modelBadge, status);

    summary.append(caret, left, right);

    const body = $('<div class="custom_generation_logger_body"></div>');
    const info = $('<div class="custom_generation_logger_info"></div>');
    info.append(
        buildLoggerInfoItem('Task', entry.taskId || '-'),
        buildLoggerInfoItem('Streaming', entry.streaming ? 'Yes' : 'No'),
        buildLoggerInfoItem('Completed', entry.done ? 'Yes' : 'No'),
    );

    body.append(info);

    const messageBlocks = await buildLoggerMessageBlocks(entry.messages);
    const responseBlocks = await buildLoggerResponseBlocks(entry.response);
    body.append(buildLoggerSection('Messages', messageBlocks));
    body.append(buildLoggerSection('Responses', responseBlocks));

    if (entry.error) {
        const errorText = entry.error.stack || entry.error.message || String(entry.error);
        body.append(buildLoggerBlock('Error', errorText, 'custom_generation_logger_error'));
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

    list.empty();

    if (loggers.length === 0) {
        const emptyText = String(list.attr('no-items-text') ?? 'No logs');
        const empty = $('<div class="custom_generation_logger_empty text_muted"></div>').text(emptyText);
        list.append(empty);
        return;
    }

    const entries = [...loggers].reverse();
    for (const [index, entry] of entries.entries()) {
        const logIndex = loggers.length - 1 - index;
        const block = await buildLoggerEntry(entry, logIndex);
        list.append(block);
    }
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
    loggers.push({
        taskId: data.taskId,
        messages: data.messages,
        options: data.options,
        model: data.apiConfig.model,
        streaming: data.streaming,
        response: [],
        error: null,
        done: false,
        type: data.type,
    });

    while (loggers.length > MAX_LOG_COUNT) {
        loggers.shift();
    }

    await refreshLoggerListIfVisible();
}

async function onGenerateAfter(data: GenerateAfter) {
    const entry = loggers.find(e => e.taskId === data.taskId);
    if (!entry) {
        console.error(`Failed to find log entry for task ${data.taskId}`);
        return;
    }

    entry.response = data.responses;
    entry.error = data.error;
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
