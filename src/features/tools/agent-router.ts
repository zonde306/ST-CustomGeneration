import { eventSource, event_types } from '@st/scripts/events.js';
import { substituteParams } from '@st/script.js';
import { collectEnabledWorldInfos, loadWorldInfoEntries, getWorldInfoSorter, filterWIByDecorator, DecoratorParser } from '@/functions/worldinfo';
import { WorldInfoEntry, WorldInfoLoaded } from '@/utils/defines';
import { TOOL_DEFINITION } from '@/features/tool-manager';
import { Tool, Context } from '@/features/context';
import { TemplateHandler } from '@/functions/template';
import { settings } from '@/settings';
import { generate } from "@/utils/retries";
import { z } from 'zod';

interface AgentEntry {
    name: string;           // agent 名称，来自 @@agent <name>
    description: string;    // tool 描述，来自 WI comment
    content: string;        // agent 指令，来自 WI content（装饰器剥离后）
    paramNames: string[];   // 自定义参数名列表，来自 @@agent <name> 后的参数
    entry: WorldInfoEntry;  // 原始 WI 条目引用
    preset?: string;        // 预设覆盖，来自 @@preset
}

const NOT_ALLOWED_DECORATORS = ['@@agent'];

let delayLoadTimer: number | null = null;

/** 全局 Agent 注册表：toolName -> AgentEntry */
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
 * 在 WI 条目被加载到 prompt 中时，过滤掉 @@agent 条目。
 * 这些条目不应该作为普通 WI 内容出现在 prompt 里。
 *
 * 参考 schema.ts 的 onWorldInfoLoaded 模式。
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
 * 主动扫描所有启用的 lorebook，收集所有 @@agent 条目，
 * 注册到 TOOL_DEFINITION 并同步 preset.tools 配置。
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

            // 检查 agent 名称冲突
            if (AGENT_REGISTRY.has(toolName)) {
                console.warn(`Agent Router: agent "${agentEntry.name}" is already registered, skipping entry ${entry.world}/${entry.uid}`);
                continue;
            }

            // 构建参数 schema
            const schema = buildParameterSchema(agentEntry.paramNames);

            // 构建 Tool 定义
            const tool: Tool = {
                name: toolName,
                description: agentEntry.description,
                parameters: schema,
                function: async (params: any) => {
                    return await callAgent(agentEntry, params);
                },
            };

            // 注册到 TOOL_DEFINITION
            TOOL_DEFINITION.set(toolName, tool);
            AGENT_REGISTRY.set(toolName, agentEntry);

            // 同步 preset.tools 配置（方案 A）
            // 不包含 'agent' trigger，防止子生成时递归调用
            if (!preset.tools[toolName]) {
                preset.tools[toolName] = {
                    enabled: true,
                    triggers: ['normal', 'regenerate', 'swipe'],
                    parameters: {},
                    description: agentEntry.description,
                };
            } else {
                // 更新现有配置的 description（但保留用户设置）
                // 确保 triggers 不包含 'agent'
                const existing = preset.tools[toolName];
                if (!existing.triggers || existing.triggers.length === 0) {
                    existing.triggers = ['normal', 'regenerate', 'swipe'];
                } else {
                    // 移除 'agent' trigger（如果存在）
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
 * 解析 WI 条目为 AgentEntry。
 * 从 @@agent <name> [param1] [param2]... 装饰器中提取信息。
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

    // 查找 @@preset 装饰器
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
 * 根据参数名列表动态构建 Zod schema。
 * 有自定义参数时，每个参数为 z.string()；
 * 无自定义参数时，使用默认 task 参数。
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
 * 注销所有已注册的 agent tools。
 */
function unregisterAllAgents() {
    for (const [toolName] of AGENT_REGISTRY) {
        TOOL_DEFINITION.delete(toolName);
    }
    AGENT_REGISTRY.clear();
}

/**
 * 执行子生成。
 * LLM 传入的参数值作为 macro 注入到子 Context，
 * WI content 作为 {{original}} macro。
 *
 * 使用自定义 generate type 'agent'：
 * - 防递归：agent tools 的 triggers 不包含 'agent'
 * - 控制提示词：用户可通过 preset 的 triggers 控制
 */
async function callAgent(agentEntry: AgentEntry, validatedData: Record<string, any>): Promise<string> {
    console.log(`Agent Router: calling agent "${agentEntry.name}" with params`, validatedData);

    // 只读全局 context 获取 chat 和 chat_metadata，不直接修改全局 context
    const globalCtx = (validatedData.context ?? Context.global()) as Context;

    // 构建 macro 映射
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

    // 使用 TemplateHandler 查找匹配的模板
    const template = TemplateHandler.find('@@agent', agentEntry.name);

    // 创建独立的子 Context，避免污染全局 Context
    // 参考 agent-manager.ts:505-506 的模式
    const chatHistory = template
        ? await template.buildChatHistory(globalCtx.chat)
        : [ { mes: agentEntry.content } ];
    const ctx = new Context({ chat: chatHistory, chat_metadata: globalCtx.chat_metadata });

    // 设置 macroOverride
    ctx.macroOverride = {
        original: agentEntry.content,
        macros,
    };

    // 应用模板的 filters（禁用不需要的 prompt 部分）
    if (template) {
        ctx.filters = template.filters;
    } else {
        // 默认 filters：子生成不需要完整上下文
        ctx.filters = {
            chatHistory: false,
            worldInfoBefore: false,
            worldInfoAfter: false,
            worldInfoDepth: false,
        };
    }

    // 支持 @@preset 覆盖
    if (agentEntry.preset) {
        ctx.presetOverride = agentEntry.preset;
    }

    try {
        // 使用 'agent' type 执行子生成，dontCreate 防止创建消息
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
