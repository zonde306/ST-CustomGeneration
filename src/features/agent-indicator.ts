import { templatePath } from "@/utils/default-settings";
import { renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { eventSource } from "@st/scripts/events.js";
import { eventTypes } from "@/utils/events";
import { WorldInfoEntry } from "@/utils/defines";
import { TemplateHandler } from "@/functions/template";
import { DecoratorParser } from "@/functions/worldinfo";
import { Context } from "@/features/context";
import { WorldInfoEntryWithDecorator } from "@/features/agent-manager";

interface AgnetData {
    entry: WorldInfoEntry;
    template: TemplateHandler;
    decorator: DecoratorParser;
    context: Context;
    messageId: number;
    swipeId: number;
    current: string;
}

interface AgentsData {
    abortController: AbortController;
    entries: WorldInfoEntryWithDecorator[][];
    context: Context;
    messageId: number;
    swipeId: number;
    type: 'before' | 'after';
}

export async function setup() {
    eventSource.makeLast(eventTypes.AGENT_START, onAgentStart);
    eventSource.makeLast(eventTypes.AGENT_END, onAgentEnd);
    eventSource.makeLast(eventTypes.AGENTS_START, onAgentsStart);
    eventSource.makeLast(eventTypes.AGENTS_END, onAgentsEnd);
}

const AGENT_COLORS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c',
    '#e67e22', '#e91e63', '#00bcd4', '#ff9800', '#4caf50', '#9c27b0',
    '#d35400', '#16a085', '#2980b9', '#8e44ad', '#27ae60', '#f1c40f',
    '#c0392b', '#34495e'
];

function getAgentColor(uid: number): string {
    return AGENT_COLORS[uid % AGENT_COLORS.length];
}

async function onAgentsStart(data: AgentsData) {
    const node = $(`<div agentsindicator="${data.messageId}"></div>`);
    node.append(await renderExtensionTemplateAsync(templatePath, 'agent-indicator'));
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

async function onAgentsEnd(data: AgentsData) {
    $(`[agentsindicator="${data.messageId}"]`).remove();
}

async function onAgentStart(data: AgnetData) {
    const title = data.entry.comment.trim() || data.entry.uid.toString();
    const iconText = getAgentIconText(title);
    const color = getAgentColor(data.entry.uid);
    const icon = $(`<div class="custom_generation_agent_icon" data-agent-world="${data.entry.world}" data-agent-uid="${data.entry.uid}" title="${title}">${iconText}</div>`);
    icon.css('background-color', color);
    $(`[agentsindicator="${data.messageId}"] .custom_generation_agents_list`).append(icon);
    // Add to detail list
    const detailItem = $('<div class="custom_generation_agent_detail_item"></div>')
        .attr('data-agent-world', data.entry.world)
        .attr('data-agent-uid', data.entry.uid)
        .text(title);
    detailItem.css({
        'background-color': color,
        'color': '#ffffff',
        'border-color': color
    });
    $(`[agentsindicator="${data.messageId}"] .custom_generation_agents_detail`).append(detailItem);
    updateStatusText(data.messageId);
}

async function onAgentEnd(data: AgnetData) {
    $(`[agentsindicator="${data.messageId}"] .custom_generation_agent_icon[data-agent-world="${data.entry.world}"][data-agent-uid="${data.entry.uid}"]`).remove();
    $(`[agentsindicator="${data.messageId}"] .custom_generation_agent_detail_item[data-agent-world="${data.entry.world}"][data-agent-uid="${data.entry.uid}"]`).remove();
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
 * Extract a short icon text from the agent comment.
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
