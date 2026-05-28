import { eventSource, event_types } from '@st/scripts/events.js';
import { substituteParams } from '@st/script.js';
import { collectEnabledWorldInfos, loadWorldInfoEntries, getWorldInfoSorter, filterWIByDecorator, DecoratorParser } from '@/functions/worldinfo';
import { WorldInfoEntry, WorldInfoLoaded } from '@/utils/defines';
import { TOOL_DEFINITION, Tool } from '@/features/tool-manager';
import { Context } from '@/features/context';
import { TemplateHandler } from '@/functions/template';
import { settings } from '@/settings';
import { generate } from "@/utils/retries";
import { z } from 'zod';

interface AgentEntry {
    name: string;           // agent name, from @@agent <name>
    description: string;    // tool description, from WI comment
    content: string;        // agent instructions, from WI content (after decorator stripping)
    paramNames: string[];   // custom parameter name list, from params after @@agent <name>
    entry: WorldInfoEntry;  // original WI entry reference
    preset?: string;        // preset override, from @@preset
}

const NOT_ALLOWED_DECORATORS = ['@@agent'];

let delayLoadTimer: number | null = null;

/** Global Agent registry: toolName -> AgentEntry */
const AGENT_REGISTRY = new Map<string, AgentEntry>();

export async function setup() {
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.WORLDINFO_UPDATED, onWorldInfoUpdated);
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoLoaded);
}

async function onChatChanged(_filename: string) {
    unregisterAllAgents();

    if (!_filename)
        return;

    await loadAgents();
    console.log(`Agent Router: agents loaded for chat changed`);
}

async function onWorldInfoUpdated() {
    if (delayLoadTimer != null)
        window.clearTimeout(delayLoadTimer);

    delayLoadTimer = window.setTimeout(async () => {
        unregisterAllAgents();
        await loadAgents();
        delayLoadTimer = null;
        console.log(`Agent Router: agents reloaded for WI updated`);
    }, 1000);
}

/**
 * Filter out @@agent entries when WI entries are loaded into the prompt.
 * These entries should not appear in the prompt as regular WI content.
 *
 * Follows the onWorldInfoLoaded pattern from schema.ts.
 */
function onWorldInfoLoaded(data: WorldInfoLoaded) {
    const filterFn = (entry: WorldInfoEntry) => {
        const parsed = new DecoratorParser(entry);
        return parsed.decorators.some(d => NOT_ALLOWED_DECORATORS.includes(d));
    };

    for (let i = data.globalLore.length - 1; i >= 0; --i) {
        if (filterFn(data.globalLore[i])) {
            console.debug(`Agent Router: remove global lore ${data.globalLore[i].world}/${data.globalLore[i].uid}-${data.globalLore[i].comment}`);
            data.globalLore.splice(i, 1);
        }
    }
    for (let i = data.personaLore.length - 1; i >= 0; --i) {
        if (filterFn(data.personaLore[i])) {
            console.debug(`Agent Router: remove persona lore ${data.personaLore[i].world}/${data.personaLore[i].uid}-${data.personaLore[i].comment}`);
            data.personaLore.splice(i, 1);
        }
    }
    for (let i = data.characterLore.length - 1; i >= 0; --i) {
        if (filterFn(data.characterLore[i])) {
            console.debug(`Agent Router: remove character lore ${data.characterLore[i].world}/${data.characterLore[i].uid}-${data.characterLore[i].comment}`);
            data.characterLore.splice(i, 1);
        }
    }
    for (let i = data.chatLore.length - 1; i >= 0; --i) {
        if (filterFn(data.chatLore[i])) {
            console.debug(`Agent Router: remove chat lore ${data.chatLore[i].world}/${data.chatLore[i].uid}-${data.chatLore[i].comment}`);
            data.chatLore.splice(i, 1);
        }
    }
}

/**
 * Actively scan all enabled lorebooks, collect all @@agent entries,
 * register them in TOOL_DEFINITION and sync preset.tools config.
 */
async function loadAgents() {
    const preset = settings.presets[settings.currentPreset];
    if (!preset) {
        console.warn('Agent Router: no active preset, skipping agent loading');
        return;
    }

    let entries: WorldInfoEntry[] = [];
    const lorebooks = collectEnabledWorldInfos();
    for (const lorebook of lorebooks) {
        entries = entries.concat(await loadWorldInfoEntries(lorebook, false));
    }

    entries = entries.filter(entry => !entry.disable);
    entries = filterWIByDecorator(entries, ['@@agent']);
    entries = entries.sort(getWorldInfoSorter(entries));

    if (entries.length === 0) {
        console.log('Agent Router: no @@agent entries found');
        return;
    }

    for (const entry of entries) {
        try {
            const agentEntry = parseAgentEntry(entry);
            if (!agentEntry) continue;

            const toolName = `agent_${agentEntry.name}`;

            // Check for agent name conflict
            if (AGENT_REGISTRY.has(toolName)) {
                console.warn(`Agent Router: agent "${agentEntry.name}" is already registered, skipping entry ${entry.world}/${entry.uid}`);
                continue;
            }

            // Build parameter schema
            const schema = buildParameterSchema(agentEntry.paramNames);

            // Build Tool definition
            const tool: Tool = {
                name: toolName,
                description: agentEntry.description,
                parameters: schema,
                function: async (params: any) => {
                    return await callAgent(agentEntry, params);
                },
            };

            // Register in TOOL_DEFINITION
            TOOL_DEFINITION.set(toolName, tool);
            AGENT_REGISTRY.set(toolName, agentEntry);

            // Sync preset.tools config (Plan A)
            // Does not include 'agent' trigger to prevent recursive calls during sub-generations
            if (!preset.tools[toolName]) {
                preset.tools[toolName] = {
                    enabled: true,
                    triggers: ['normal', 'regenerate', 'swipe'],
                    parameters: {},
                    description: agentEntry.description,
                };
            } else {
                // Update existing config description (but preserve user settings)
                // Ensure triggers do not include 'agent'
                const existing = preset.tools[toolName];
                if (!existing.triggers || existing.triggers.length === 0) {
                    existing.triggers = ['normal', 'regenerate', 'swipe'];
                } else {
                    // Remove 'agent' trigger (if present)
                    existing.triggers = existing.triggers.filter(t => t !== 'agent');
                    if (existing.triggers.length === 0) {
                        existing.triggers = ['normal', 'regenerate', 'swipe'];
                    }
                }
                if (!existing.description) {
                    existing.description = agentEntry.description;
                }
            }

            console.log(`Agent Router: registered agent "${agentEntry.name}" as tool "${toolName}" with params [${agentEntry.paramNames.join(', ')}]`);
        } catch (e) {
            console.error(`Agent Router: failed to register agent from entry ${entry.world}/${entry.uid}-${entry.comment}`, e);
        }
    }

    console.log(`Agent Router: ${AGENT_REGISTRY.size} agent(s) registered`);
}

/**
 * Parse a WI entry into an AgentEntry.
 * Extracts information from the @@agent <name> [param1] [param2]... decorator.
 */
function parseAgentEntry(entry: WorldInfoEntry): AgentEntry | null {
    const parsed = new DecoratorParser(entry);
    const agentParams = parsed.parameters['@@agent'];
    if (!agentParams || agentParams.length === 0) {
        console.warn(`Agent Router: entry ${entry.world}/${entry.uid} has @@agent but no name`);
        return null;
    }

    const name = agentParams[0];
    const paramNames = agentParams.slice(1);
    const description = entry.comment || name;
    const content = entry.content || '';

    // Look up @@preset decorator
    let preset: string | undefined;
    if (parsed.parameters['@@preset'] && parsed.parameters['@@preset'].length > 0) {
        preset = parsed.parameters['@@preset'][0];
    }

    return {
        name: name.trim(),
        description: description.trim(),
        content: content.trim(),
        paramNames: paramNames.map(p => p.trim()).filter(p => p.length > 0),
        entry,
        preset,
    };
}

/**
 * Dynamically build Zod schema based on parameter name list.
 * With custom parameters, each is z.string();
 * without custom parameters, use the default task parameter.
 */
function buildParameterSchema(paramNames: string[]): z.ZodObject<any> {
    if (paramNames.length > 0) {
        const shape: Record<string, z.ZodString> = {};
        for (const name of paramNames) {
            shape[name] = z.string().describe(name);
        }
        return z.object(shape);
    } else {
        return z.object({
            task: z.string().describe('The task for the agent to perform'),
        });
    }
}

/**
 * Unregister all registered agent tools.
 */
function unregisterAllAgents() {
    for (const [toolName] of AGENT_REGISTRY) {
        TOOL_DEFINITION.delete(toolName);
    }
    AGENT_REGISTRY.clear();
}

/**
 * Execute a sub-generation.
 * LLM-provided parameter values are injected as macros into the sub-Context,
 * WI content is available as the {{original}} macro.
 *
 * Uses a custom generate type 'agent':
 * - Recursion prevention: agent tools' triggers do not include 'agent'
 * - Prompt control: users can control via preset triggers
 */
async function callAgent(agentEntry: AgentEntry, validatedData: Record<string, any>): Promise<string> {
    console.log(`Agent Router: calling agent "${agentEntry.name}" with params`, validatedData);

    // Read-only global context to access chat and chat_metadata, do not mutate global context directly
    const globalCtx = (validatedData.context ?? Context.global()) as Context;

    // Build macro mapping
    const macros: Record<string, any> = {
        'lastUserMessage': () => substituteParams(globalCtx.chat.findLast(msg => msg.is_user && !msg.is_system)?.mes ?? ''),
        'lastCharMessage': () => substituteParams(globalCtx.chat.findLast(msg => !msg.is_user && !msg.is_system)?.mes ?? ''),
        'original': substituteParams(agentEntry.content),
    };
    if (agentEntry.paramNames.length > 0) {
        for (const name of agentEntry.paramNames) {
            macros[name] = validatedData[name];
        }
    } else {
        macros['task'] = validatedData.task;
    }

    // Use TemplateHandler to find matching template
    const template = TemplateHandler.find('@@agent', agentEntry.name);

    // Create an independent sub-Context to avoid polluting the global Context
    // Follows the pattern from agent-manager.ts:505-506
    const chatHistory = template
        ? await template.buildChatHistory(globalCtx.chat)
        : [ { mes: agentEntry.content } ];
    const ctx = new Context({ chat: chatHistory, chat_metadata: globalCtx.chat_metadata });

    // Set macroOverride
    ctx.macroOverride = {
        original: agentEntry.content,
        macros,
    };

    // Apply template filters (disable unwanted prompt sections)
    if (template) {
        ctx.filters = template.filters;
    } else {
        // Default filters: sub-generation does not need full context
        ctx.filters = {
            chatHistory: false,
            worldInfoBefore: false,
            worldInfoAfter: false,
            worldInfoDepth: false,
        };
    }

    // Support @@preset override
    if (agentEntry.preset) {
        ctx.presetOverride = agentEntry.preset;
    }

    try {
        // Use 'agent' type for sub-generation, dontCreate prevents message creation
        const result = await generate(
            ctx,
            'agent',
            { dontCreate: true },
            false,
            template?.retries,
            template?.interval,
        );
        const output = typeof result === 'string' ? result : String(result);
        console.log(`Agent Router: agent "${agentEntry.name}" completed`);
        return output;
    } catch (e: any) {
        console.error(`Agent Router: agent "${agentEntry.name}" failed`, e);
        return `Agent "${agentEntry.name}" error: ${e.message ?? e}`;
    }
}
