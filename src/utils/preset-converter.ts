import { ApiSettings, Preset, TEMPLATE_FILTER_OPTIONS } from "@/utils/defines";
import { defaultPreset } from "@/utils/default-settings";
import { yaml } from "@st/lib.js";
import { regex_placement } from "@st/scripts/extensions/regex/engine.js";
import { INJECTION_POSITION } from "@st/scripts/PromptManager.js";

export function convertFromVanilla(data: Record<string, any>): { api: ApiSettings, preset: Preset } {
    const source = data.chat_completion_source;
    const api: ApiSettings = {
        baseUrl: data[`${source}_url`] ?? '',
        apiKey: '',
        model: data[`${source}_model`] ?? '',
        contextSize: data.openai_max_context,
        maxTokens: data.openai_max_tokens,
        temperature: data.temperature,
        topK: data.top_k,
        topP: data.top_p,
        frequencyPenalty: data.frequency_penalty,
        presencePenalty: data.presence_penalty,
        stream: data.stream_openai,
        includeHeaders: source === 'custom' ? (yaml.parse(data.custom_include_headers ?? '') ?? {}) : {},
        includeBody: source === 'custom' ? (yaml.parse(data.custom_include_body ?? '') ?? {}) : {},
        excludeBody: source === 'custom' ? (yaml.parse(data.custom_exclude_body ?? '') ?? {}) : {},
        promptPostProcessing: (data.custom_prompt_post_processing ?? 'none').replace('_tools', ''),
        linkedPreset: '',
        maxConcurrency: 1,
    };

    const preset: Preset = {
        name: 'Unnamed Preset',
        prompts: [],
        regexs: [],
        templates: defaultPreset.templates,
        tools: defaultPreset.tools,
    };

    const ordered = data.prompt_order[1] ?? data.prompt_order[0];
    if (ordered?.order?.length) {
        const identifierMap: Record<string, string> = {
            dialogueExamples: 'chatExamples',
        };
        for (const { identifier, enabled } of ordered.order) {
            const prompt = data.prompts.find((x: any) => x.identifier === identifier);
            if (prompt) {
                const mapped = identifierMap[identifier] ?? identifier;
                preset.prompts.push({
                    name: prompt.name,
                    role: prompt.role,
                    triggers: prompt.injection_trigger ?? [],
                    prompt: prompt.content,
                    injectionPosition: prompt.injection_position === INJECTION_POSITION.ABSOLUTE ? 'inChat' : 'relative',
                    enabled,
                    internal: (identifier.includes('-') || !TEMPLATE_FILTER_OPTIONS.includes(mapped)) ? null : mapped,
                    injectionDepth: prompt.injection_depth,
                    injectionOrder: prompt.injection_order,
                    maxDepth: 999,
                });
            }
        }
    }

    if (data.extensions.regex_scripts?.length) {
        for (const regex of data.extensions.regex_scripts) {
            preset.regexs.push({
                name: regex.scriptName,
                regex: regex.findRegex,
                enabled: !regex.disabled,
                replace: regex.replaceString,
                userInput: regex.placement.includes(regex_placement.USER_INPUT),
                aiOutput: regex.placement.includes(regex_placement.AI_OUTPUT),
                worldInfo: regex.placement.includes(regex_placement.WORLD_INFO),
                minDepth: regex.minDepth,
                maxDepth: regex.maxDepth,
                ephemerality: !regex.markdownOnly && !regex.promptOnly,
                request: regex.promptOnly || (!regex.markdownOnly && !regex.promptOnly),
                response: regex.markdownOnly || (!regex.markdownOnly && !regex.promptOnly),
            });
        }
    } else if (data.extensions.SPreset?.RegexBinding?.regexes?.length) {
        for (const regex of data.extensions.SPreset.RegexBinding.regexes) {
            preset.regexs.push({
                name: regex.scriptName,
                regex: regex.findRegex,
                enabled: !regex.disabled,
                replace: regex.replaceString,
                userInput: regex.placement.includes(regex_placement.USER_INPUT),
                aiOutput: regex.placement.includes(regex_placement.AI_OUTPUT),
                worldInfo: regex.placement.includes(regex_placement.WORLD_INFO),
                minDepth: regex.minDepth,
                maxDepth: regex.maxDepth,
                ephemerality: !regex.markdownOnly && !regex.promptOnly,
                request: regex.promptOnly || (!regex.markdownOnly && !regex.promptOnly),
                response: regex.markdownOnly || (!regex.markdownOnly && !regex.promptOnly),
            });
        }
    }

    return { api, preset };
}
