import { templatePath } from "@/utils/default-settings";
import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { eventSource } from "@st/scripts/events.js";
import { eventTypes, RunBatchData, RunTaskData } from "@/utils/events";

export async function setup() {
    eventSource.makeLast(eventTypes.RUN_START, onRunStart);
    eventSource.makeLast(eventTypes.RUN_END, onRunEnd);
    eventSource.makeLast(eventTypes.RUN_BATCH_START, onBatchStart);
    eventSource.makeLast(eventTypes.RUN_BATCH_END, onBatchEnd);
}

const AGENT_COLORS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c',
    '#e67e22', '#e91e63', '#00bcd4', '#ff9800', '#4caf50', '#9c27b0',
    '#d35400', '#16a085', '#2980b9', '#8e44ad', '#27ae60', '#f1c40f',
    '#c0392b', '#34495e'
];

/** Stable string hash for color selection from a runId. */
function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; ++i) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function getAgentColor(runId: string): string {
    return AGENT_COLORS[hashString(runId) % AGENT_COLORS.length];
}

async function onBatchStart(data: RunBatchData) {
    if (data.messageId == null)
        return;

    const node = $(`<div agentsindicator="${data.messageId}"></div>`);
    node.append(await renderExtensionTemplateAsync(templatePath, 'work-indicator'));
    $(`[mesid=${data.messageId}] > .mes_block`).append(node);
    // Initialize jQuery UI accordion
    const accordion = node.find('.custom_generation_agents_accordion');
    if (accordion.length && (accordion as any).accordion) {
        accordion.accordion({
            header: '.custom_generation_agents_bar',
            collapsible: true,
            active: false,
            heightStyle: 'content',
            animate: 200,
        });
    }
}

async function onBatchEnd(data: RunBatchData) {
    if (data.messageId != null) {
        $(`[agentsindicator="${data.messageId}"]`).remove();
    } else {
        // Cancellation without a message context: clear all indicators.
        $('[agentsindicator]').remove();
    }
}

async function onRunStart(data: RunTaskData) {
    const title = data.label?.trim() || data.runId;
    const iconText = getAgentIconText(title);
    const color = getAgentColor(data.runId);
    const icon = $('<div class="custom_generation_agent_icon"></div>')
        .attr('data-run-id', data.runId)
        .attr('title', title)
        .text(iconText);
    icon.css('background-color', color);
    $(`[agentsindicator="${data.messageId}"] .custom_generation_agents_list`).append(icon);
    // Add to detail list
    const detailItem = $('<div class="custom_generation_agent_detail_item"></div>')
        .attr('data-run-id', data.runId)
        .text(title);
    detailItem.css({
        'background-color': color,
        'color': '#ffffff',
        'border-color': color
    });
    $(`[agentsindicator="${data.messageId}"] .custom_generation_agents_detail`).append(detailItem);
    updateStatusText(data.messageId);
}

async function onRunEnd(data: RunTaskData) {
    const container = $(`[agentsindicator="${data.messageId}"]`);
    container.find('.custom_generation_agent_icon').filter((_i, el) => $(el).attr('data-run-id') === data.runId).remove();
    container.find('.custom_generation_agent_detail_item').filter((_i, el) => $(el).attr('data-run-id') === data.runId).remove();
    updateStatusText(data.messageId);
}

function updateStatusText(messageId: number) {
    const container = $(`[agentsindicator="${messageId}"]`);
    if (!container.length) return;
    const count = container.find('.custom_generation_agent_icon').length;
    const statusEl = container.find('.custom_generation_agents_status');
    if (count > 0) {
        statusEl.text(`Thinking...`);
    } else {
        statusEl.text('Done');
    }
}

/**
 * Extract a short icon text from the run label.
 * Returns: a single emoji, a single Chinese character, or up to 2 ASCII characters.
 */
function getAgentIconText(comment: string): string {
    if (!comment) return '?';
    // Try to match a leading emoji sequence
    const emojiRe = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]+/u;
    const emojiMatch = comment.match(emojiRe);
    if (emojiMatch) return emojiMatch[0];
    // Chinese character
    if (/^[\u{4E00}-\u{9FFF}]/u.test(comment)) return comment[0];
    // Fallback: first 2 ASCII/English chars
    return comment.substring(0, 2);
}
