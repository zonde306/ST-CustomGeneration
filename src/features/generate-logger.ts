import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { eventSource, event_types } from "@st/scripts/events.js";
import { eventTypes } from "@/utils/events";
import { Context, GenerateOptionsLite } from "@/features/context";
import { ApiConfig } from "@/functions/generate";

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

function formatMessages(messages: ChatCompletionMessage[]): string {
    if (!messages.length) {
        return '(empty)';
    }

    return messages
        .map((message, index) => {
            const role = String(message.role ?? 'unknown');
            const name = message.name ? ` (${message.name})` : '';
            const header = `[${index + 1}] ${role}${name}`;
            const body = formatMessageContent(message.content ?? '');
            return `${header}\n${body}`;
        })
        .join('\n\n');
}

function formatResponses(responses: string[]): string {
    if (!responses.length) {
        return '(empty)';
    }

    return responses
        .map((response, index) => `[${index + 1}]\n${String(response ?? '')}`)
        .join('\n\n');
}

function buildLoggerStatus(entry: GenerateLogEntry): string {
    if (entry.error) {
        return 'Error';
    }
    return entry.done ? 'Done' : 'Running';
}

function buildLoggerTitle(entry: GenerateLogEntry, index: number): string {
    const fallback = entry.taskId ? `Task ${entry.taskId}` : `Log ${index + 1}`;
    const previewSource = entry.messages.find(message => String(message.content ?? '').trim())?.content ?? '';
    const preview = getPreviewText(formatMessageContent(previewSource));
    return preview ? `${fallback}: ${preview}` : fallback;
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

function buildLoggerBlock(title: string, content: string): JQuery<HTMLElement> {
    const block = $('<div></div>');
    const titleEl = $('<div class="custom_generation_logger_block_title"></div>').text(title);
    const pre = $('<pre class="custom_generation_logger_pre"></pre>').text(content);
    block.append(titleEl, pre);
    return block;
}

function buildLoggerEntry(entry: GenerateLogEntry, index: number): JQuery<HTMLElement> {
    const details = $('<details class="custom_generation_logger_entry"></details>');
    const summary = $('<summary class="custom_generation_logger_summary"></summary>');
    const caret = $('<i class="fa-solid fa-chevron-right custom_generation_logger_caret"></i>');

    const left = $('<div class="custom_generation_logger_summary_left"></div>');
    const title = $('<div class="custom_generation_logger_title"></div>').text(buildLoggerTitle(entry, index));
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
    body.append(buildLoggerBlock('Options', safeStringify(entry.options)));
    body.append(buildLoggerBlock('Messages', formatMessages(entry.messages)));
    body.append(buildLoggerBlock('Responses', formatResponses(entry.response)));

    if (entry.error) {
        const errorText = entry.error.stack || entry.error.message || String(entry.error);
        body.append(buildLoggerBlock('Error', errorText));
    }

    details.append(summary, body);
    return details;
}

function updateLoggerList(): void {
    const list = $('#custom_generation_logger_list');
    if (!list.length) {
        return;
    }

    list.empty();

    if (loggers.length === 0) {
        list.text(String(list.attr('no-items-text') ?? 'No logs'));
        return;
    }

    const entries = [...loggers].reverse();
    entries.forEach((entry, index) => {
        list.append(buildLoggerEntry(entry, loggers.length - 1 - index));
    });
}

function refreshLoggerListIfVisible(): void {
    const dialog = getDialog('#custom_generation_logger_dialog');
    if (!dialog) {
        return;
    }

    if (dialog.open || dialog.hasAttribute('open')) {
        updateLoggerList();
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
    });

    while (loggers.length > MAX_LOG_COUNT) {
        loggers.shift();
    }

    refreshLoggerListIfVisible();
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

    refreshLoggerListIfVisible();
}

async function onAppReady() {
    if (!$('#custom_generation_logger_dialog').length) {
        $('#custom_generation_settings').append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'logger-modal'));
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

        $('#customGenerateLogger').on('click', () => {
            updateLoggerList();
            openDialog('#custom_generation_logger_dialog');
        });
    }
}
