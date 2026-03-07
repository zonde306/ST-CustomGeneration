import { eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { DEFAULT_DEPTH, DEFAULT_WEIGHT } from '../../../../world-info.js';
import { generate as runGenerate, ApiConfig } from './functions/generate';
import { KNOWN_DECORATORS } from './functions/worldinfo';
import * as YAML from 'yaml';

// 先假设有，具体实现后续再补
const KNOWN_PROCESSORS = [
    "none",
    "replace",          // 替换原文
    "diff-patch",       // 用 diff patch 修改原文
    "ejs",              // 执行代码
    "var-json",         // 视为 JSON 写入到变量
    "var-yaml",         // 视为 YAML 写入到变量
    "var-json-patch",   // 视为 JSON patch 更新变量
];

export interface PresetPrompt {
    // A name for this prompt. (displayed in the UI)
    name: string;

    // To whom this message will be attributed.
    role: 'user' | 'assistant' | 'system';

    // Filter to specific generation types. empty means all.
    triggers: string[];

    // content (User-defined only)
    prompt: string;

    // Relative (to other prompts in prompt manager) or In-chat @ Depth.
    injectionPosition: 'relative' | 'inChat';

    // null will not be displayed in the list.
    enabled: boolean | null;

    // built-in prompts or user-defined
    internal: 'main' | 'personaDescription' | 'charDescription' | 'charPersonality' | 'scenario' | 'worldInfoBefore' | 'worldInfoAfter' | 'chatExamples' | 'chatHistory' | null;

    // (for inChat injectionPosition) 0 = after the last message, 1 = before the last message, etc.
    injectionDepth: number;

    // (for inChat injectionPosition) Ordered from low/top to high/bottom, and at same order: Assistant, User, System.
    injectionOrder: number;
}

export interface RegEx {
    // Script name  (displayed in the UI)
    name: string;

    // Find Regex (/.../ or plain text)
    regex: string;

    // Replace Regex (use $1, $2, ... to refer to the matched groups)
    replace: string;

    // affects for user input
    userInput: boolean;

    // affects for AI output (assistant)
    aiOutput: boolean;

    // affects for world info
    worldInfo: boolean;

    enabled: boolean;

    // Min Depth
    minDepth: number | null;

    // Max Depth
    maxDepth: number | null;

    // The original text will not be modified.
    ephemerality: boolean;

    // affects for generation request
    request: boolean;

    // affects for generation response
    response: boolean;
}

interface Template {
    // e.g: @@record, must in KNOWN_DECORATORS lists
    decorator: typeof KNOWN_DECORATORS[number];

    // can be empty, used by (@@<decorator> <tag>)
    tag: string;

    // template content
    content: string;

    // match regexp, pass capture group 1 to the processor
    regex: string;

    // processor name, must in KNOWN_PROCESSORS lists
    processor: typeof KNOWN_PROCESSORS[number];
}

export interface Preset {
    // preset group name (displayed in the UI)
    name: string;

    // preset prompts
    prompts: PresetPrompt[];

    // preset regexs
    regexs: RegEx[];

    // templates
    templates: Template[];
}

interface Settings {
    // Custom Endpoint (Base URL)
    baseUrl: string;

    // Custom API Key (Optional)
    apiKey: string;

    // Model ID
    model: string;

    // Context Size (tokens)
    contextSize: number;

    // Max Response Length (tokens)
    maxTokens: number;

    // temperature 0.00~2.00
    temperature: number;

    // top-k sampling 0~40
    topK: number;

    // Top P sampling 0.00~1.00
    topP: number;

    // Frequency Penalty -2.00~2.00
    frequencyPenalty: number;

    // Presence Penalty -2.00~2.00
    presencePenalty: number;

    // streaming mode
    stream: boolean;

    // Additional Parameters: request headers
    includeHeaders: Record<string, unknown>;

    // Additional Parameters: body
    includeBody: Record<string, unknown>;

    // Additional Parameters: exclude body
    excludeBody: Record<string, unknown>;

    // Prompt Post-Processing
    // like: https://docs.sillytavern.app/usage/api-connections/openai/#prompt-post-processing
    promptPostProcessing: 'none' | 'merge' | 'semi' | 'strict' | 'single';

    // openai presets, cannot be empty
    presets: Preset[];

    // default preset (current active preset)
    currentPreset: number;
}

interface ExportPayload {
    version: string;
    presets: Preset[];
    currentPreset: number;
    apiConnection?: {
        baseUrl: string;
        model: string;
        contextSize: number;
        maxTokens: number;
        temperature: number;
        topK: number;
        topP: number;
        frequencyPenalty: number;
        presencePenalty: number;
        promptPostProcessing: Settings['promptPostProcessing'];
        includeHeaders: Record<string, unknown>;
        includeBody: Record<string, unknown>;
        excludeBody: Record<string, unknown>;
    };
}

interface ImportPayload {
    version?: unknown;
    presets?: unknown;
    currentPreset?: unknown;
    apiConnection?: {
        baseUrl?: unknown;
        model?: unknown;
        contextSize?: unknown;
        maxTokens?: unknown;
        temperature?: unknown;
        topK?: unknown;
        topP?: unknown;
        frequencyPenalty?: unknown;
        presencePenalty?: unknown;
        promptPostProcessing?: unknown;
        includeHeaders?: unknown;
        includeBody?: unknown;
        excludeBody?: unknown;
        apiKey?: unknown;
    };
}

export const defaultPreset: Preset = {
    name: 'Default',
    prompts: [
        {
            name: 'Main Prompt',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'main',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'World Info (before)',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'worldInfoBefore',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Persona Description',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'personaDescription',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Char Description',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'charDescription',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Char Personality',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'charPersonality',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Scenario',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'scenario',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Enhance Definitions',
            role: 'system',
            triggers: [],
            prompt: 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.',
            injectionPosition: 'relative',
            enabled: false,
            internal: null,
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Auxiliary Prompt',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: null,
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'World Info (after)',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'worldInfoAfter',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Chat Examples',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'chatExamples',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Chat History',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'chatHistory',
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
        {
            name: 'Post-History Instructions (jailbreak)',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: null,
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
        },
    ],
    regexs: [],
    templates: [
        {
            decorator: '@@record',
            tag: 'full-update',
            content: '{{lastCharMessage}}\nUpdate the following documents based on the above content:\n{{current}}\nThen wrap the updated document with `<content>` to output the document.',
            regex: '/<content>([\\S\\s]+?)<\\/content>/gi',
            processor: 'replace',
        }
    ]
};

const defaultSettings: Settings = {
    baseUrl: 'http://localhost:8080/v1',
    apiKey: '',
    model: 'None',
    contextSize: 8192,
    maxTokens: 4096,
    temperature: 1,
    topK: 1,
    topP: 1,
    presencePenalty: 0,
    frequencyPenalty: 0,
    promptPostProcessing: 'none',
    presets: [defaultPreset],
    currentPreset: 0,
    stream: false,
    includeHeaders: {},
    includeBody: {},
    excludeBody: {},
};

export const settings: Settings = clone(defaultSettings);

let selectedPromptIndex = 0;
let selectedRegexIndex = 0;
let selectedTemplateIndex = 0;
let editingPromptIndex: number | null = null;
let editingRegexIndex: number | null = null;
let editingTemplateIndex: number | null = null;
let draggedPromptIndex: number | null = null;
let draggedRegexIndex: number | null = null;
let draggedTemplateIndex: number | null = null;
let isUpdatingUI = false;
let isEventsBound = false;
let isSettingsLoadedListenerBound = false;
let modelCandidates: string[] = [];
let isConnectionActionInProgress = false;

const exportSchemaVersion = '1.0.0';
type TemplateDecorator = Template['decorator'];
type TemplateProcessor = Template['processor'];
const DEFAULT_TEMPLATE_DECORATOR = (KNOWN_DECORATORS.find(x => x === '@@record') ?? KNOWN_DECORATORS[0] ?? '@@record') as TemplateDecorator;
const DEFAULT_TEMPLATE_PROCESSOR = (KNOWN_PROCESSORS.find(x => x === 'replace') ?? KNOWN_PROCESSORS[0] ?? 'replace') as TemplateProcessor;

function clone<T>(value: T): T {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function sanitizePresetName(name: string, fallback: string): string {
    const normalized = name.trim();
    return normalized.length > 0 ? normalized : fallback;
}

function parseNullableInt(value: unknown, min: number): number | null {
    const text = String(value ?? '').trim();
    if (!text) {
        return null;
    }

    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return Math.max(min, Math.trunc(parsed));
}

function parseNumber(value: unknown, fallback: number, min: number, max: number, integer: boolean = false): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    const clamped = clamp(parsed, min, max);
    return integer ? Math.trunc(clamped) : clamped;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return clone(value as Record<string, unknown>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePromptPostProcessing(value: unknown): Settings['promptPostProcessing'] {
    const text = String(value ?? 'none');
    return ['none', 'merge', 'semi', 'strict', 'single'].includes(text)
        ? text as Settings['promptPostProcessing']
        : 'none';
}

function parseYamlRecord(value: unknown): Record<string, unknown> {
    const text = String(value ?? '').trim();
    if (!text) {
        return {};
    }

    const parsed = YAML.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('YAML must be an object mapping.');
    }

    return clone(parsed as Record<string, unknown>);
}

function stringifyYamlRecord(value: Record<string, unknown>): string {
    if (!value || Object.keys(value).length === 0) {
        return '';
    }

    return YAML.stringify(value).trimEnd();
}

function uniquePresetName(baseName: string): string {
    const base = sanitizePresetName(baseName, 'Preset');
    const existing = new Set(settings.presets.map(x => x.name));
    if (!existing.has(base)) {
        return base;
    }

    let suffix = 2;
    while (existing.has(`${base} ${suffix}`)) {
        suffix++;
    }

    return `${base} ${suffix}`;
}

function normalizePrompt(input: Partial<PresetPrompt>, fallbackName: string): PresetPrompt {
    const role = input.role === 'assistant' || input.role === 'user' ? input.role : 'system';
    const injectionPosition = input.injectionPosition === 'inChat' ? 'inChat' : 'relative';
    const enable = input.enabled === null ? null : Boolean(input.enabled);
    const injectionDepth = parseNumber(input.injectionDepth, DEFAULT_DEPTH, 0, 9999, true);
    const injectionOrder = parseNumber(input.injectionOrder, DEFAULT_WEIGHT, -1_000_000, 1_000_000, true);

    return {
        name: sanitizePresetName(String(input.name ?? ''), fallbackName),
        role,
        triggers: Array.isArray(input.triggers)
            ? input.triggers.map(x => String(x).trim()).filter(Boolean)
            : [],
        prompt: String(input.prompt ?? ''),
        injectionPosition,
        enabled: enable,
        internal: input.internal ?? null,
        injectionDepth,
        injectionOrder,
    };
}

function normalizeRegex(input: Partial<RegEx>, fallbackName: string): RegEx {
    return {
        name: sanitizePresetName(String(input.name ?? ''), fallbackName),
        regex: String(input.regex ?? ''),
        replace: String(input.replace ?? ''),
        userInput: Boolean(input.userInput),
        aiOutput: Boolean(input.aiOutput),
        worldInfo: Boolean(input.worldInfo),
        enabled: Boolean(input.enabled),
        minDepth: Number.isFinite(input.minDepth as number) ? Math.max(-1, Math.trunc(input.minDepth as number)) : null,
        maxDepth: Number.isFinite(input.maxDepth as number) ? Math.max(0, Math.trunc(input.maxDepth as number)) : null,
        ephemerality: Boolean(input.ephemerality),
        request: Boolean(input.request),
        response: Boolean(input.response),
    };
}

function normalizeTemplate(input: Partial<Template>): Template {
    const decoratorRaw = String(input.decorator ?? DEFAULT_TEMPLATE_DECORATOR);
    const decorator = KNOWN_DECORATORS.includes(decoratorRaw as TemplateDecorator)
        ? decoratorRaw as TemplateDecorator
        : DEFAULT_TEMPLATE_DECORATOR;

    const processorRaw = String(input.processor ?? DEFAULT_TEMPLATE_PROCESSOR);
    const processor = KNOWN_PROCESSORS.includes(processorRaw as TemplateProcessor)
        ? processorRaw as TemplateProcessor
        : DEFAULT_TEMPLATE_PROCESSOR;

    return {
        decorator,
        tag: String(input.tag ?? ''),
        content: String(input.content ?? ''),
        regex: String(input.regex ?? ''),
        processor,
    };
}

function normalizePreset(input: Partial<Preset>, fallbackName: string): Preset {
    const prompts = Array.isArray(input.prompts)
        ? input.prompts.map((prompt, index) => normalizePrompt(prompt, `Prompt ${index + 1}`))
        : clone(defaultPreset.prompts);

    const regexs = Array.isArray(input.regexs)
        ? input.regexs.map((regex, index) => normalizeRegex(regex, `Regex ${index + 1}`))
        : [];

    const templates = Array.isArray(input.templates)
        ? input.templates.map(template => normalizeTemplate(template))
        : [];

    return {
        name: sanitizePresetName(String(input.name ?? ''), fallbackName),
        prompts,
        regexs,
        templates,
    };
}

function ensureSettingsIntegrity(resetSelections: boolean = false) {
    settings.baseUrl = String(settings.baseUrl ?? defaultSettings.baseUrl);
    settings.apiKey = String(settings.apiKey ?? '');
    settings.model = String(settings.model ?? 'None');
    settings.contextSize = parseNumber(settings.contextSize, defaultSettings.contextSize, 1, 1_000_000, true);
    settings.maxTokens = parseNumber(settings.maxTokens, defaultSettings.maxTokens, 1, 1_000_000, true);
    settings.temperature = parseNumber(settings.temperature, defaultSettings.temperature, 0, 2, false);
    settings.topK = parseNumber(settings.topK, defaultSettings.topK, 0, 1_000_000, true);
    settings.topP = parseNumber(settings.topP, defaultSettings.topP, 0, 1, false);
    settings.frequencyPenalty = parseNumber(settings.frequencyPenalty, defaultSettings.frequencyPenalty, -2, 2, false);
    settings.presencePenalty = parseNumber(settings.presencePenalty, defaultSettings.presencePenalty, -2, 2, false);
    settings.includeHeaders = normalizeRecord(settings.includeHeaders);
    settings.includeBody = normalizeRecord(settings.includeBody);
    settings.excludeBody = normalizeRecord(settings.excludeBody);
    settings.promptPostProcessing = parsePromptPostProcessing(settings.promptPostProcessing);

    const normalizedPresets = Array.isArray(settings.presets)
        ? settings.presets.map((preset, index) => normalizePreset(preset, `Preset ${index + 1}`))
        : [];

    settings.presets = normalizedPresets.length > 0 ? normalizedPresets : [clone(defaultPreset)];

    const maxPresetIndex = settings.presets.length - 1;
    settings.currentPreset = Number.isFinite(settings.currentPreset)
        ? clamp(Math.trunc(settings.currentPreset), 0, maxPresetIndex)
        : 0;

    if (resetSelections) {
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
    }
}

function getCurrentPreset(): Preset {
    if (!settings.presets.length) {
        settings.presets = [clone(defaultPreset)];
        settings.currentPreset = 0;
    }

    settings.currentPreset = clamp(settings.currentPreset, 0, settings.presets.length - 1);
    return settings.presets[settings.currentPreset];
}

function moveArrayItem<T>(array: T[], fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= array.length || toIndex >= array.length) {
        return;
    }

    const [item] = array.splice(fromIndex, 1);
    array.splice(toIndex, 0, item);
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

function setAdvancedParametersExpanded(expanded: boolean): void {
    const body = $('#custom_generation_advanced_params_body');
    const icon = $('#custom_generation_advanced_params_icon');
    body.toggle(expanded);
    icon.toggleClass('down', expanded);
}

function updateModelSelectOptions(): void {
    const modelSelect = $('#custom_generation_model_select');
    const currentModel = String(settings.model ?? '').trim();
    const candidateSet = new Set(modelCandidates.map(x => x.trim()).filter(Boolean));

    modelSelect.empty();

    if (candidateSet.size === 0) {
        modelSelect.append('<option value="">(No models loaded)</option>');
    } else {
        modelSelect.append('<option value="">(Select a model)</option>');
        for (const candidate of candidateSet) {
            modelSelect.append(`<option value="${candidate}">${candidate}</option>`);
        }
    }

    if (currentModel && !candidateSet.has(currentModel)) {
        modelSelect.append(`<option value="${currentModel}">${currentModel} (custom)</option>`);
        candidateSet.add(currentModel);
    }

    if (currentModel && candidateSet.has(currentModel)) {
        modelSelect.val(currentModel);
    } else {
        modelSelect.val('');
    }
}

function setConnectionControlsBusy(busy: boolean): void {
    isConnectionActionInProgress = busy;

    const connectButton = $('#custom_generation_model_connect');
    connectButton.toggleClass('disabled', busy);
    connectButton.attr('aria-disabled', busy ? 'true' : 'false');
    connectButton.css('pointer-events', busy ? 'none' : '');
    connectButton.css('opacity', busy ? '0.6' : '');

    $('#custom_generation_test_direct').prop('disabled', busy);
    $('#custom_generation_test_generate').prop('disabled', busy);
}

function getConnectionFormValues(): { baseUrl: string; apiKey: string; model: string } {
    return {
        baseUrl: String($('#custom_generation_base_url').val() ?? settings.baseUrl ?? '').trim(),
        apiKey: String($('#custom_generation_api_key').val() ?? settings.apiKey ?? '').trim(),
        model: String($('#custom_generation_model').val() ?? settings.model ?? '').trim(),
    };
}

function buildConnectionUrl(baseUrl: string, path: string): string {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBaseUrl}${normalizedPath}`;
}

function extractErrorMessage(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload.trim();
    }

    if (!isRecord(payload)) {
        return '';
    }

    const nestedError = payload.error;
    if (isRecord(nestedError) && typeof nestedError.message === 'string') {
        return nestedError.message.trim();
    }

    if (typeof payload.message === 'string') {
        return payload.message.trim();
    }

    return '';
}

function extractCompletionText(payload: unknown): string {
    if (!payload) {
        return '';
    }

    if (typeof payload === 'string') {
        return payload;
    }

    if (isRecord(payload) && Array.isArray(payload.choices) && payload.choices.length > 0) {
        const firstChoice = payload.choices[0] as any;
        const content = firstChoice?.message?.content ?? firstChoice?.text;
        if (typeof content === 'string') {
            return content;
        }
    }

    if (isRecord(payload) && typeof payload.output_text === 'string') {
        return payload.output_text;
    }

    return '';
}

function getPreviewText(content: string): string {
    return content.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function getTemplateTagLabel(template: Pick<Template, 'tag'>): string {
    const normalized = String(template.tag ?? '').trim();
    return normalized || 'default';
}

function getTemplateSummary(template: Template): string {
    return `${template.decorator} · ${getTemplateTagLabel(template)}`;
}

function getTemplateRegexPreview(template: Template): string {
    const preview = getPreviewText(String(template.regex ?? ''));
    return preview || '(no regex)';
}

function getTemplateContentPreview(template: Template): string {
    const firstLine = String(template.content ?? '').split(/\r?\n/, 1)[0] ?? '';
    const preview = getPreviewText(firstLine);
    return preview || '(empty content)';
}

function getTemplateDeleteConfirmationText(template: Template): string {
    return `Delete template ${template.decorator} / ${getTemplateTagLabel(template)}?`;
}

function buildRequestHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    for (const [key, value] of Object.entries(settings.includeHeaders ?? {})) {
        const headerName = key.trim();
        if (!headerName) {
            continue;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            headers[headerName] = String(value);
        }
    }

    const hasAuthorizationHeader = Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
    if (apiKey && !hasAuthorizationHeader) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
}

function buildDirectTestBody(model: string): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model,
        messages: [
            {
                role: 'user',
                content: 'This is a connection test. Reply with "OK" only.',
            },
        ],
        stream: false,
        max_tokens: Math.max(1, Math.min(settings.maxTokens, 64)),
        temperature: 0,
    };

    Object.assign(body, clone(settings.includeBody));

    for (const key of Object.keys(settings.excludeBody ?? {})) {
        delete body[key];
    }

    return body;
}

async function testDirectChatCompletionsConnection(): Promise<string> {
    const { baseUrl, apiKey, model } = getConnectionFormValues();
    if (!baseUrl) {
        throw new Error('Base URL is required.');
    }

    if (!model) {
        throw new Error('Model ID is required.');
    }

    const requestUrl = buildConnectionUrl(baseUrl, '/chat/completions');
    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: buildRequestHeaders(apiKey),
        body: JSON.stringify(buildDirectTestBody(model)),
    });

    const rawText = await response.text();
    let payload: unknown = null;
    if (rawText) {
        try {
            payload = JSON.parse(rawText);
        } catch {
            payload = rawText;
        }
    }

    if (!response.ok) {
        const errorMessage = extractErrorMessage(payload);
        throw new Error(errorMessage ? `Request failed (${response.status}): ${errorMessage}` : `Request failed (${response.status}).`);
    }

    return extractCompletionText(payload);
}

async function testGenerateConnection(): Promise<string> {
    const { baseUrl, apiKey, model } = getConnectionFormValues();
    if (!baseUrl) {
        throw new Error('Base URL is required.');
    }

    if (!model) {
        throw new Error('Model ID is required.');
    }

    const apiConfig: ApiConfig = {
        url: baseUrl,
        key: apiKey,
        model,
        type: 'quiet',
        stream: settings.stream,
        max_context: settings.contextSize,
        max_tokens: Math.max(1, Math.min(settings.maxTokens, 64)),
        temperature: settings.temperature,
        top_k: settings.topK,
        top_p: settings.topP,
        frequency_penalty: settings.frequencyPenalty,
        presence_penalty: settings.presencePenalty,
        custom_include_body: YAML.stringify(settings.includeBody),
        custom_exclude_body: YAML.stringify(settings.excludeBody),
        custom_include_headers: YAML.stringify(settings.includeHeaders),
    };

    const messages: ChatCompletionMessage[] = [
        {
            role: 'user',
            content: 'This is a connection test. Reply with "OK" only.',
        },
    ];

    const response = await runGenerate(messages, new AbortController(), 'custom_generation_connection_test', apiConfig, {}, false);
    const responseList = Array.isArray(response) ? response : [response];
    return responseList.map(item => String(item ?? '').trim()).find(Boolean) ?? '';
}

function buildPromptRow(prompt: PresetPrompt, index: number) {
    const row = $('<div class="custom_generation_list_row flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>');
    row.attr('draggable', 'true');
    row.toggleClass('active', index === selectedPromptIndex);

    const left = $('<div class="flex-container alignItemsCenter flex1"></div>');
    const dragHandle = $('<i class="menu_button fa-solid fa-grip-lines" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
    const toggle = $('<input type="checkbox" />').prop('checked', prompt.enabled === true);
    const name = $('<div class="flex1"></div>').text(prompt.name || `Prompt ${index + 1}`);

    left.append(dragHandle, toggle, name);

    const actions = $('<div class="flex-container alignItemsCenter"></div>');
    const editButton = $('<i class="menu_button fa-solid fa-pen-to-square" title="Edit" data-i18n="[title]Edit"></i>');
    const deleteButton = $('<i class="menu_button fa-solid fa-trash" title="Delete" data-i18n="[title]Delete"></i>');
    actions.append(editButton, deleteButton);

    row.on('click', () => {
        selectedPromptIndex = index;
        updateSettingsUI();
    });

    toggle.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
    });

    toggle.on('change', () => {
        const preset = getCurrentPreset();
        const target = preset.prompts[index];
        if (!target) {
            return;
        }

        target.enabled = Boolean(toggle.prop('checked'));
        selectedPromptIndex = index;
        updateSettingsUI();
        saveSettings();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openPromptEditor(index);
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        const target = preset.prompts[index];
        if (!target) {
            return;
        }

        if (!window.confirm(`Delete prompt "${target.name}"?`)) {
            return;
        }

        preset.prompts.splice(index, 1);
        selectedPromptIndex = clamp(index, 0, Math.max(0, preset.prompts.length - 1));
        updateSettingsUI();
        saveSettings();
    });

    row.on('dragstart', (event: JQuery.TriggeredEvent) => {
        draggedPromptIndex = index;
        const nativeEvent = (event as JQuery.TriggeredEvent).originalEvent as DragEvent | undefined;
        if (nativeEvent?.dataTransfer) {
            nativeEvent.dataTransfer.effectAllowed = 'move';
            nativeEvent.dataTransfer.setData('text/plain', String(index));
        }
    });

    row.on('dragover', (event: JQuery.TriggeredEvent) => {
        event.preventDefault();
    });

    row.on('drop', (event: JQuery.TriggeredEvent) => {
        event.preventDefault();

        const nativeEvent = (event as JQuery.TriggeredEvent).originalEvent as DragEvent | undefined;
        const payload = Number(nativeEvent?.dataTransfer?.getData('text/plain'));
        const sourceIndex = Number.isFinite(payload) ? Math.trunc(payload) : draggedPromptIndex;
        if (sourceIndex === null) {
            return;
        }

        const preset = getCurrentPreset();
        if (sourceIndex < 0 || sourceIndex >= preset.prompts.length || index < 0 || index >= preset.prompts.length) {
            return;
        }

        moveArrayItem(preset.prompts, sourceIndex, index);
        selectedPromptIndex = index;
        updateSettingsUI();
        saveSettings();
    });

    row.on('dragend', () => {
        draggedPromptIndex = null;
    });

    row.append(left, actions);
    return row;
}

function buildRegexRow(regex: RegEx, index: number) {
    const row = $('<div class="custom_generation_list_row flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>');
    row.attr('draggable', 'true');
    row.toggleClass('active', index === selectedRegexIndex);

    const left = $('<div class="flex-container alignItemsCenter flex1"></div>');
    const dragHandle = $('<i class="menu_button fa-solid fa-grip-lines" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
    const toggle = $('<input type="checkbox" />').prop('checked', regex.enabled);
    const name = $('<div class="flex1"></div>').text(regex.name || `Regex ${index + 1}`);

    left.append(dragHandle, toggle, name);

    const actions = $('<div class="flex-container alignItemsCenter"></div>');
    const editButton = $('<i class="menu_button fa-solid fa-pen-to-square" title="Edit" data-i18n="[title]Edit"></i>');
    const deleteButton = $('<i class="menu_button fa-solid fa-trash" title="Delete" data-i18n="[title]Delete"></i>');
    actions.append(editButton, deleteButton);

    row.on('click', () => {
        selectedRegexIndex = index;
        updateSettingsUI();
    });

    toggle.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
    });

    toggle.on('change', () => {
        const preset = getCurrentPreset();
        const target = preset.regexs[index];
        if (!target) {
            return;
        }

        target.enabled = Boolean(toggle.prop('checked'));
        selectedRegexIndex = index;
        updateSettingsUI();
        saveSettings();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openRegexEditor(index);
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        const target = preset.regexs[index];
        if (!target) {
            return;
        }

        if (!window.confirm(`Delete regex "${target.name}"?`)) {
            return;
        }

        preset.regexs.splice(index, 1);
        selectedRegexIndex = clamp(index, 0, Math.max(0, preset.regexs.length - 1));
        updateSettingsUI();
        saveSettings();
    });

    row.on('dragstart', (event: JQuery.TriggeredEvent) => {
        draggedRegexIndex = index;
        const nativeEvent = (event as JQuery.TriggeredEvent).originalEvent as DragEvent | undefined;
        if (nativeEvent?.dataTransfer) {
            nativeEvent.dataTransfer.effectAllowed = 'move';
            nativeEvent.dataTransfer.setData('text/plain', String(index));
        }
    });

    row.on('dragover', (event: JQuery.TriggeredEvent) => {
        event.preventDefault();
    });

    row.on('drop', (event: JQuery.TriggeredEvent) => {
        event.preventDefault();

        const nativeEvent = (event as JQuery.TriggeredEvent).originalEvent as DragEvent | undefined;
        const payload = Number(nativeEvent?.dataTransfer?.getData('text/plain'));
        const sourceIndex = Number.isFinite(payload) ? Math.trunc(payload) : draggedRegexIndex;
        if (sourceIndex === null) {
            return;
        }

        const preset = getCurrentPreset();
        if (sourceIndex < 0 || sourceIndex >= preset.regexs.length || index < 0 || index >= preset.regexs.length) {
            return;
        }

        moveArrayItem(preset.regexs, sourceIndex, index);
        selectedRegexIndex = index;
        updateSettingsUI();
        saveSettings();
    });

    row.on('dragend', () => {
        draggedRegexIndex = null;
    });

    row.append(left, actions);
    return row;
}

function buildTemplateRow(template: Template, index: number) {
    const row = $('<div class="custom_generation_list_row custom_generation_template_row flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>');
    row.attr('draggable', 'true');
    row.toggleClass('active', index === selectedTemplateIndex);

    const left = $('<div class="flex-container alignItemsCenter flex1 custom_generation_template_row_body"></div>');
    const dragHandle = $('<i class="menu_button fa-solid fa-grip-lines" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
    const meta = $('<div class="flex-container flexFlowColumn flex1 custom_generation_template_meta"></div>');
    const title = $('<div class="custom_generation_template_title"></div>').text(getTemplateSummary(template));
    const subtitle = $('<div class="custom_generation_template_subtitle"></div>').text(`${template.processor} · ${getTemplateRegexPreview(template)}`);
    const preview = $('<div class="custom_generation_template_preview"></div>').text(getTemplateContentPreview(template));
    meta.append(title, subtitle, preview);
    left.append(dragHandle, meta);

    const actions = $('<div class="flex-container alignItemsCenter"></div>');
    const editButton = $('<i class="menu_button fa-solid fa-pen-to-square" title="Edit" data-i18n="[title]Edit"></i>');
    const deleteButton = $('<i class="menu_button fa-solid fa-trash" title="Delete" data-i18n="[title]Delete"></i>');
    actions.append(editButton, deleteButton);

    row.on('click', () => {
        selectedTemplateIndex = index;
        updateSettingsUI();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openTemplateEditor(index);
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        const target = preset.templates[index];
        if (!target) {
            return;
        }

        if (!window.confirm(getTemplateDeleteConfirmationText(target))) {
            return;
        }

        preset.templates.splice(index, 1);
        selectedTemplateIndex = clamp(index, 0, Math.max(0, preset.templates.length - 1));
        updateSettingsUI();
        saveSettings();
    });

    row.on('dragstart', (event: JQuery.TriggeredEvent) => {
        draggedTemplateIndex = index;
        const nativeEvent = (event as JQuery.TriggeredEvent).originalEvent as DragEvent | undefined;
        if (nativeEvent?.dataTransfer) {
            nativeEvent.dataTransfer.effectAllowed = 'move';
            nativeEvent.dataTransfer.setData('text/plain', String(index));
        }
    });

    row.on('dragover', (event: JQuery.TriggeredEvent) => {
        event.preventDefault();
    });

    row.on('drop', (event: JQuery.TriggeredEvent) => {
        event.preventDefault();

        const nativeEvent = (event as JQuery.TriggeredEvent).originalEvent as DragEvent | undefined;
        const payload = Number(nativeEvent?.dataTransfer?.getData('text/plain'));
        const sourceIndex = Number.isFinite(payload) ? Math.trunc(payload) : draggedTemplateIndex;
        if (sourceIndex === null) {
            return;
        }

        const preset = getCurrentPreset();
        if (sourceIndex < 0 || sourceIndex >= preset.templates.length || index < 0 || index >= preset.templates.length) {
            return;
        }

        moveArrayItem(preset.templates, sourceIndex, index);
        selectedTemplateIndex = index;
        updateSettingsUI();
        saveSettings();
    });

    row.on('dragend', () => {
        draggedTemplateIndex = null;
    });

    row.append(left, actions);
    return row;
}

function updatePresetSummary(preset: Preset) {
    const enabledPromptCount = preset.prompts.filter(x => x.enabled === true).length;
    const enabledRegexCount = preset.regexs.filter(x => x.enabled).length;

    $('#custom_generation_preset_summary').text(
        `Prompts: ${preset.prompts.length} (enabled: ${enabledPromptCount}) · Regex: ${preset.regexs.length} (enabled: ${enabledRegexCount}) · Templates: ${preset.templates.length}`,
    );
}

function setPromptEditorEnabled(enabled: boolean) {
    const selectors = [
        '#custom_generation_prompt_name',
        '#custom_generation_prompt_role',
        '#custom_generation_prompt_injection_position',
        '#custom_generation_prompt_injection_depth',
        '#custom_generation_prompt_injection_order',
        '#custom_generation_prompt_triggers',
        '#custom_generation_prompt_enable',
        '#custom_generation_prompt_content',
        '#custom_generation_prompt_delete',
        '#custom_generation_prompt_save',
    ];

    for (const selector of selectors) {
        $(selector).prop('disabled', !enabled);
    }
}

function updatePromptInjectionControlsVisibility(position: string): void {
    const isInChat = position === 'inChat';
    $('#custom_generation_prompt_inchat_controls').toggle(isInChat);
}

function setRegexEditorEnabled(enabled: boolean) {
    const selectors = [
        '#custom_generation_regex_name',
        '#custom_generation_regex_regex',
        '#custom_generation_regex_replace',
        '#custom_generation_regex_user_input',
        '#custom_generation_regex_ai_output',
        '#custom_generation_regex_world_info',
        '#custom_generation_regex_request',
        '#custom_generation_regex_response',
        '#custom_generation_regex_ephemerality',
        '#custom_generation_regex_enable',
        '#custom_generation_regex_min_depth',
        '#custom_generation_regex_max_depth',
        '#custom_generation_regex_delete',
        '#custom_generation_regex_save',
    ];

    for (const selector of selectors) {
        $(selector).prop('disabled', !enabled);
    }
}

function setTemplateEditorEnabled(enabled: boolean) {
    const selectors = [
        '#custom_generation_template_decorator',
        '#custom_generation_template_tag',
        '#custom_generation_template_processor',
        '#custom_generation_template_regex',
        '#custom_generation_template_content',
        '#custom_generation_template_delete',
        '#custom_generation_template_save',
    ];

    for (const selector of selectors) {
        $(selector).prop('disabled', !enabled);
    }
}

function updatePromptEditor() {
    const preset = getCurrentPreset();
    const prompt = editingPromptIndex === null ? null : preset.prompts[editingPromptIndex];

    isUpdatingUI = true;

    if (!prompt) {
        setPromptEditorEnabled(false);
        $('#custom_generation_prompt_name').val('');
        $('#custom_generation_prompt_role').val('system');
        $('#custom_generation_prompt_injection_position').val('relative');
        $('#custom_generation_prompt_injection_depth').val(DEFAULT_DEPTH);
        $('#custom_generation_prompt_injection_order').val(DEFAULT_WEIGHT);
        updatePromptInjectionControlsVisibility('relative');
        $('#custom_generation_prompt_triggers').val('');
        $('#custom_generation_prompt_enable').prop('checked', false);
        $('#custom_generation_prompt_content').val('');
        isUpdatingUI = false;
        return;
    }

    setPromptEditorEnabled(true);
    $('#custom_generation_prompt_name').val(prompt.name);
    $('#custom_generation_prompt_role').val(prompt.role);
    $('#custom_generation_prompt_injection_position').val(prompt.injectionPosition);
    $('#custom_generation_prompt_injection_depth').val(parseNumber(prompt.injectionDepth, DEFAULT_DEPTH, 0, 9999, true));
    $('#custom_generation_prompt_injection_order').val(parseNumber(prompt.injectionOrder, DEFAULT_WEIGHT, -1_000_000, 1_000_000, true));
    updatePromptInjectionControlsVisibility(prompt.injectionPosition);
    $('#custom_generation_prompt_triggers').val(prompt.triggers.join(', '));
    $('#custom_generation_prompt_enable').prop('checked', prompt.enabled === true);
    $('#custom_generation_prompt_content').val(prompt.prompt);

    isUpdatingUI = false;
}

function updateRegexEditor() {
    const preset = getCurrentPreset();
    const regex = editingRegexIndex === null ? null : preset.regexs[editingRegexIndex];

    isUpdatingUI = true;

    if (!regex) {
        setRegexEditorEnabled(false);
        $('#custom_generation_regex_name').val('');
        $('#custom_generation_regex_regex').val('');
        $('#custom_generation_regex_replace').val('');
        $('#custom_generation_regex_user_input').prop('checked', false);
        $('#custom_generation_regex_ai_output').prop('checked', false);
        $('#custom_generation_regex_world_info').prop('checked', false);
        $('#custom_generation_regex_request').prop('checked', false);
        $('#custom_generation_regex_response').prop('checked', false);
        $('#custom_generation_regex_ephemerality').prop('checked', false);
        $('#custom_generation_regex_enable').prop('checked', false);
        $('#custom_generation_regex_min_depth').val('');
        $('#custom_generation_regex_max_depth').val('');
        isUpdatingUI = false;
        return;
    }

    setRegexEditorEnabled(true);
    $('#custom_generation_regex_name').val(regex.name);
    $('#custom_generation_regex_regex').val(regex.regex);
    $('#custom_generation_regex_replace').val(regex.replace);
    $('#custom_generation_regex_user_input').prop('checked', regex.userInput);
    $('#custom_generation_regex_ai_output').prop('checked', regex.aiOutput);
    $('#custom_generation_regex_world_info').prop('checked', regex.worldInfo);
    $('#custom_generation_regex_request').prop('checked', regex.request);
    $('#custom_generation_regex_response').prop('checked', regex.response);
    $('#custom_generation_regex_ephemerality').prop('checked', regex.ephemerality);
    $('#custom_generation_regex_enable').prop('checked', regex.enabled);
    $('#custom_generation_regex_min_depth').val(regex.minDepth ?? '');
    $('#custom_generation_regex_max_depth').val(regex.maxDepth ?? '');

    isUpdatingUI = false;
}

function updateTemplateEditor() {
    const preset = getCurrentPreset();
    const template = editingTemplateIndex === null ? null : preset.templates[editingTemplateIndex];

    isUpdatingUI = true;

    if (!template) {
        setTemplateEditorEnabled(false);
        $('#custom_generation_template_decorator').val(DEFAULT_TEMPLATE_DECORATOR);
        $('#custom_generation_template_tag').val('');
        $('#custom_generation_template_processor').val(DEFAULT_TEMPLATE_PROCESSOR);
        $('#custom_generation_template_regex').val('');
        $('#custom_generation_template_content').val('');
        isUpdatingUI = false;
        return;
    }

    setTemplateEditorEnabled(true);
    $('#custom_generation_template_decorator').val(template.decorator);
    $('#custom_generation_template_tag').val(template.tag);
    $('#custom_generation_template_processor').val(template.processor);
    $('#custom_generation_template_regex').val(template.regex);
    $('#custom_generation_template_content').val(template.content);

    isUpdatingUI = false;
}

function openPromptEditor(index: number): void {
    const preset = getCurrentPreset();
    if (!preset.prompts[index]) {
        return;
    }

    editingPromptIndex = index;
    selectedPromptIndex = index;
    updatePromptEditor();
    openDialog('#custom_generation_prompt_dialog');
}

function closePromptEditor(): void {
    editingPromptIndex = null;
    closeDialog('#custom_generation_prompt_dialog');
}

function savePromptEditor(): void {
    const preset = getCurrentPreset();
    if (editingPromptIndex === null) {
        return;
    }

    const prompt = preset.prompts[editingPromptIndex];
    if (!prompt) {
        return;
    }

    prompt.name = sanitizePresetName(String($('#custom_generation_prompt_name').val() ?? ''), `Prompt ${editingPromptIndex + 1}`);

    const role = String($('#custom_generation_prompt_role').val() ?? 'system');
    prompt.role = role === 'assistant' || role === 'user' ? role : 'system';

    const position = String($('#custom_generation_prompt_injection_position').val() ?? 'relative');
    prompt.injectionPosition = position === 'inChat' ? 'inChat' : 'relative';
    prompt.injectionDepth = parseNumber($('#custom_generation_prompt_injection_depth').val(), DEFAULT_DEPTH, 0, 9999, true);
    prompt.injectionOrder = parseNumber($('#custom_generation_prompt_injection_order').val(), DEFAULT_WEIGHT, -1_000_000, 1_000_000, true);

    const triggersRaw = String($('#custom_generation_prompt_triggers').val() ?? '');
    prompt.triggers = triggersRaw.split(',').map(x => x.trim()).filter(Boolean);

    prompt.enabled = Boolean($('#custom_generation_prompt_enable').prop('checked'));
    prompt.prompt = String($('#custom_generation_prompt_content').val() ?? '');

    selectedPromptIndex = editingPromptIndex;
    closePromptEditor();
    updateSettingsUI();
    saveSettings();
}

function deletePromptFromEditor(): void {
    const preset = getCurrentPreset();
    if (editingPromptIndex === null) {
        return;
    }

    const prompt = preset.prompts[editingPromptIndex];
    if (!prompt) {
        return;
    }

    if (!window.confirm(`Delete prompt "${prompt.name}"?`)) {
        return;
    }

    const removedIndex = editingPromptIndex;
    preset.prompts.splice(removedIndex, 1);
    closePromptEditor();
    selectedPromptIndex = clamp(removedIndex, 0, Math.max(0, preset.prompts.length - 1));
    updateSettingsUI();
    saveSettings();
}

function openRegexEditor(index: number): void {
    const preset = getCurrentPreset();
    if (!preset.regexs[index]) {
        return;
    }

    editingRegexIndex = index;
    selectedRegexIndex = index;
    updateRegexEditor();
    openDialog('#custom_generation_regex_dialog');
}

function closeRegexEditor(): void {
    editingRegexIndex = null;
    closeDialog('#custom_generation_regex_dialog');
}

function saveRegexEditor(): void {
    const preset = getCurrentPreset();
    if (editingRegexIndex === null) {
        return;
    }

    const regex = preset.regexs[editingRegexIndex];
    if (!regex) {
        return;
    }

    regex.name = sanitizePresetName(String($('#custom_generation_regex_name').val() ?? ''), `Regex ${editingRegexIndex + 1}`);
    regex.regex = String($('#custom_generation_regex_regex').val() ?? '');
    regex.replace = String($('#custom_generation_regex_replace').val() ?? '');
    regex.userInput = Boolean($('#custom_generation_regex_user_input').prop('checked'));
    regex.aiOutput = Boolean($('#custom_generation_regex_ai_output').prop('checked'));
    regex.worldInfo = Boolean($('#custom_generation_regex_world_info').prop('checked'));
    regex.request = Boolean($('#custom_generation_regex_request').prop('checked'));
    regex.response = Boolean($('#custom_generation_regex_response').prop('checked'));
    regex.ephemerality = Boolean($('#custom_generation_regex_ephemerality').prop('checked'));
    regex.enabled = Boolean($('#custom_generation_regex_enable').prop('checked'));
    regex.minDepth = parseNullableInt($('#custom_generation_regex_min_depth').val(), -1);
    regex.maxDepth = parseNullableInt($('#custom_generation_regex_max_depth').val(), 0);

    selectedRegexIndex = editingRegexIndex;
    closeRegexEditor();
    updateSettingsUI();
    saveSettings();
}

function deleteRegexFromEditor(): void {
    const preset = getCurrentPreset();
    if (editingRegexIndex === null) {
        return;
    }

    const regex = preset.regexs[editingRegexIndex];
    if (!regex) {
        return;
    }

    if (!window.confirm(`Delete regex "${regex.name}"?`)) {
        return;
    }

    const removedIndex = editingRegexIndex;
    preset.regexs.splice(removedIndex, 1);
    closeRegexEditor();
    selectedRegexIndex = clamp(removedIndex, 0, Math.max(0, preset.regexs.length - 1));
    updateSettingsUI();
    saveSettings();
}

function openTemplateEditor(index: number): void {
    const preset = getCurrentPreset();
    if (!preset.templates[index]) {
        return;
    }

    editingTemplateIndex = index;
    selectedTemplateIndex = index;
    updateTemplateEditor();
    openDialog('#custom_generation_template_dialog');
}

function closeTemplateEditor(): void {
    editingTemplateIndex = null;
    closeDialog('#custom_generation_template_dialog');
}

function saveTemplateEditor(): void {
    const preset = getCurrentPreset();
    if (editingTemplateIndex === null) {
        return;
    }

    const template = preset.templates[editingTemplateIndex];
    if (!template) {
        return;
    }

    template.decorator = normalizeTemplate({ decorator: $('#custom_generation_template_decorator').val() }).decorator;
    template.tag = String($('#custom_generation_template_tag').val() ?? '');
    template.processor = normalizeTemplate({ processor: $('#custom_generation_template_processor').val() }).processor;
    template.regex = String($('#custom_generation_template_regex').val() ?? '');
    template.content = String($('#custom_generation_template_content').val() ?? '');

    selectedTemplateIndex = editingTemplateIndex;
    closeTemplateEditor();
    updateSettingsUI();
    saveSettings();
}

function deleteTemplateFromEditor(): void {
    const preset = getCurrentPreset();
    if (editingTemplateIndex === null) {
        return;
    }

    const template = preset.templates[editingTemplateIndex];
    if (!template) {
        return;
    }

    if (!window.confirm(getTemplateDeleteConfirmationText(template))) {
        return;
    }

    const removedIndex = editingTemplateIndex;
    preset.templates.splice(removedIndex, 1);
    closeTemplateEditor();
    selectedTemplateIndex = clamp(removedIndex, 0, Math.max(0, preset.templates.length - 1));
    updateSettingsUI();
    saveSettings();
}

function buildExportPayload(includeApiConnection: boolean): ExportPayload {
    const payload: ExportPayload = {
        version: exportSchemaVersion,
        presets: clone(settings.presets),
        currentPreset: settings.currentPreset,
    };

    if (includeApiConnection) {
        payload.apiConnection = {
            baseUrl: settings.baseUrl,
            model: settings.model,
            contextSize: settings.contextSize,
            maxTokens: settings.maxTokens,
            temperature: settings.temperature,
            topK: settings.topK,
            topP: settings.topP,
            frequencyPenalty: settings.frequencyPenalty,
            presencePenalty: settings.presencePenalty,
            promptPostProcessing: settings.promptPostProcessing,
            includeHeaders: clone(settings.includeHeaders),
            includeBody: clone(settings.includeBody),
            excludeBody: clone(settings.excludeBody),
        };
    }

    return payload;
}

function downloadExportPayload(payload: ExportPayload): void {
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `st-custom-generation-presets-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

function openExportDialog(): void {
    $('#custom_generation_export_include_api_connection').prop('checked', false);
    openDialog('#custom_generation_export_dialog');
}

function confirmExport(): void {
    const includeApiConnection = Boolean($('#custom_generation_export_include_api_connection').prop('checked'));
    const payload = buildExportPayload(includeApiConnection);
    closeDialog('#custom_generation_export_dialog');
    downloadExportPayload(payload);
}

function parseImportPayload(raw: unknown): {
    presets: Preset[];
    currentPreset: number;
    apiConnection: ImportPayload['apiConnection'] | null;
} {
    if (!isRecord(raw)) {
        throw new Error('Invalid JSON payload.');
    }

    const payload = raw as ImportPayload;
    if (!Array.isArray(payload.presets)) {
        throw new Error('Invalid import format: presets is required.');
    }

    const presets = payload.presets.map((preset, index) => normalizePreset(
        isRecord(preset) ? preset as Partial<Preset> : {},
        `Preset ${index + 1}`,
    ));

    if (presets.length === 0) {
        throw new Error('Invalid import format: presets cannot be empty.');
    }

    const currentPresetRaw = Number(payload.currentPreset);
    const currentPreset = Number.isFinite(currentPresetRaw)
        ? clamp(Math.trunc(currentPresetRaw), 0, presets.length - 1)
        : 0;

    const apiConnection = isRecord(payload.apiConnection)
        ? payload.apiConnection
        : null;

    return {
        presets,
        currentPreset,
        apiConnection,
    };
}

async function importPresetsFromFile(file: File): Promise<void> {
    const text = await file.text();
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Invalid JSON file.');
    }

    const normalized = parseImportPayload(parsed);

    const previousApiKey = settings.apiKey;

    settings.presets = normalized.presets;
    settings.currentPreset = normalized.currentPreset;
    selectedPromptIndex = 0;
    selectedRegexIndex = 0;
    selectedTemplateIndex = 0;
    editingPromptIndex = null;
    editingRegexIndex = null;
    editingTemplateIndex = null;

    if (normalized.apiConnection) {
        settings.baseUrl = String(normalized.apiConnection.baseUrl ?? settings.baseUrl);
        settings.model = String(normalized.apiConnection.model ?? settings.model);
        settings.contextSize = parseNumber(normalized.apiConnection.contextSize, settings.contextSize, 1, 1_000_000, true);
        settings.maxTokens = parseNumber(normalized.apiConnection.maxTokens, settings.maxTokens, 1, 1_000_000, true);
        settings.temperature = parseNumber(normalized.apiConnection.temperature, settings.temperature, 0, 2, false);
        settings.topK = parseNumber(normalized.apiConnection.topK, settings.topK, 0, 1_000_000, true);
        settings.topP = parseNumber(normalized.apiConnection.topP, settings.topP, 0, 1, false);
        settings.frequencyPenalty = parseNumber(normalized.apiConnection.frequencyPenalty, settings.frequencyPenalty, -2, 2, false);
        settings.presencePenalty = parseNumber(normalized.apiConnection.presencePenalty, settings.presencePenalty, -2, 2, false);
        settings.promptPostProcessing = parsePromptPostProcessing(normalized.apiConnection.promptPostProcessing);
        settings.includeHeaders = normalizeRecord(normalized.apiConnection.includeHeaders);
        settings.includeBody = normalizeRecord(normalized.apiConnection.includeBody);
        settings.excludeBody = normalizeRecord(normalized.apiConnection.excludeBody);
    }

    settings.apiKey = previousApiKey;

    ensureSettingsIntegrity(true);
    updateSettingsUI();
    saveSettings();
}

async function ensureModalTemplatesInjected(): Promise<void> {
    if (!$('#custom_generation_prompt_dialog').length) {
        $('#custom_generation_settings').append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'prompt-modal'));
    }

    if (!$('#custom_generation_regex_dialog').length) {
        $('#custom_generation_settings').append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'regex-modal'));
    }

    if (!$('#custom_generation_template_dialog').length) {
        $('#custom_generation_settings').append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'template-modal'));
    }

    const decoratorSelect = $('#custom_generation_template_decorator');
    if (decoratorSelect.length && decoratorSelect.children().length === 0) {
        for (const decorator of KNOWN_DECORATORS) {
            decoratorSelect.append(`<option value="${decorator}">${decorator}</option>`);
        }
    }

    const processorSelect = $('#custom_generation_template_processor');
    if (processorSelect.length && processorSelect.children().length === 0) {
        for (const processor of KNOWN_PROCESSORS) {
            processorSelect.append(`<option value="${processor}">${processor}</option>`);
        }
    }
}

function bindEvents() {
    if (isEventsBound) {
        return;
    }

    isEventsBound = true;

    $('#custom_generation_base_url').on('input', () => {
        settings.baseUrl = String($('#custom_generation_base_url').val() ?? defaultSettings.baseUrl);
        saveSettings();
    });

    $('#custom_generation_api_key').on('input', () => {
        settings.apiKey = String($('#custom_generation_api_key').val() ?? '');
        saveSettings();
    });

    $('#custom_generation_model').on('input', () => {
        settings.model = String($('#custom_generation_model').val() ?? 'None');
        updateModelSelectOptions();
        saveSettings();
    });

    $('#custom_generation_context_size').on('input', () => {
        settings.contextSize = parseNumber($('#custom_generation_context_size').val(), defaultSettings.contextSize, 1, 1_000_000, true);
        saveSettings();
    });

    $('#custom_generation_max_tokens').on('input', () => {
        settings.maxTokens = parseNumber($('#custom_generation_max_tokens').val(), defaultSettings.maxTokens, 1, 1_000_000, true);
        saveSettings();
    });

    $('#custom_generation_temperature').on('input', () => {
        settings.temperature = parseNumber($('#custom_generation_temperature').val(), defaultSettings.temperature, 0, 2, false);
        saveSettings();
    });

    $('#custom_generation_top_k').on('input', () => {
        settings.topK = parseNumber($('#custom_generation_top_k').val(), defaultSettings.topK, 0, 1_000_000, true);
        saveSettings();
    });

    $('#custom_generation_top_p').on('input', () => {
        settings.topP = parseNumber($('#custom_generation_top_p').val(), defaultSettings.topP, 0, 1, false);
        saveSettings();
    });

    $('#custom_generation_frequency_penalty').on('input', () => {
        settings.frequencyPenalty = parseNumber($('#custom_generation_frequency_penalty').val(), defaultSettings.frequencyPenalty, -2, 2, false);
        saveSettings();
    });

    $('#custom_generation_presence_penalty').on('input', () => {
        settings.presencePenalty = parseNumber($('#custom_generation_presence_penalty').val(), defaultSettings.presencePenalty, -2, 2, false);
        saveSettings();
    });

    $('#custom_generation_model_select').on('change', () => {
        const value = String($('#custom_generation_model_select').val() ?? '').trim();
        if (!value) {
            return;
        }

        settings.model = value;
        $('#custom_generation_model').val(value);
        saveSettings();
    });

    $('#custom_generation_model_connect').on('click', async () => {
        if (isConnectionActionInProgress) {
            return;
        }

        const status = $('#custom_generation_model_connect_status');
        status.text('Loading models...');
        setConnectionControlsBusy(true);

        const { baseUrl, apiKey } = getConnectionFormValues();
        const requestUrl = baseUrl ? buildConnectionUrl(baseUrl, '/models') : '';

        if (!requestUrl) {
            const message = 'Base URL is required.';
            status.text(message);
            toastr.error(message);
            setConnectionControlsBusy(false);
            return;
        }

        try {
            const response = await fetch(requestUrl, {
                method: 'GET',
                headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
            });

            if (!response.ok) {
                throw new Error(`Request failed (${response.status})`);
            }

            const payload = await response.json();
            const rawList = Array.isArray(payload?.data) ? payload.data : [];
            const candidates = rawList
                .map((entry: any) => String(entry?.id ?? '').trim())
                .filter(Boolean);

            if (candidates.length === 0) {
                throw new Error('No models returned from server.');
            }

            modelCandidates = candidates;
            updateModelSelectOptions();
            const message = `Loaded ${candidates.length} models.`;
            status.text(message);
            toastr.success(message);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
            status.text(`Connect failed: ${message}`);
            toastr.error(message);
        } finally {
            setConnectionControlsBusy(false);
        }
    });

    $('#custom_generation_test_direct').on('click', async () => {
        if (isConnectionActionInProgress) {
            return;
        }

        const status = $('#custom_generation_model_connect_status');
        status.text('Testing /chat/completions...');
        setConnectionControlsBusy(true);

        try {
            const responseText = await testDirectChatCompletionsConnection();
            const preview = getPreviewText(responseText);
            const message = preview
                ? `Direct test passed: ${preview}`
                : 'Direct test passed.';
            status.text(message);
            toastr.success(message);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
            status.text(`Direct test failed: ${message}`);
            toastr.error(message);
        } finally {
            setConnectionControlsBusy(false);
        }
    });

    $('#custom_generation_test_generate').on('click', async () => {
        if (isConnectionActionInProgress) {
            return;
        }

        const status = $('#custom_generation_model_connect_status');
        status.text('Testing via generate()...');
        setConnectionControlsBusy(true);

        try {
            const responseText = await testGenerateConnection();
            const preview = getPreviewText(responseText);
            const message = preview
                ? `Generate test passed: ${preview}`
                : 'Generate test passed.';
            status.text(message);
            toastr.success(message);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
            status.text(`Generate test failed: ${message}`);
            toastr.error(message);
        } finally {
            setConnectionControlsBusy(false);
        }
    });

    $('#custom_generation_advanced_params_toggle').on('click', () => {
        const expanded = !$('#custom_generation_advanced_params_body').is(':visible');
        setAdvancedParametersExpanded(expanded);
    });

    $('#custom_generation_prompt_post_processing').on('change', () => {
        settings.promptPostProcessing = parsePromptPostProcessing($('#custom_generation_prompt_post_processing').val());
        saveSettings();
    });

    const yamlFieldBindings: Array<{ selector: string; key: keyof Pick<Settings, 'includeHeaders' | 'includeBody' | 'excludeBody'>; label: string }> = [
        { selector: '#custom_generation_include_headers_yaml', key: 'includeHeaders', label: 'Request Headers' },
        { selector: '#custom_generation_include_body_yaml', key: 'includeBody', label: 'Request Body' },
        { selector: '#custom_generation_exclude_body_yaml', key: 'excludeBody', label: 'Exclude Body Keys' },
    ];

    for (const field of yamlFieldBindings) {
        $(field.selector).on('change', () => {
            try {
                settings[field.key] = parseYamlRecord($(field.selector).val());
                saveSettings();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error ?? 'Unknown YAML parse error');
                window.alert(`${field.label} YAML parse failed: ${message}`);
                updateSettingsUI();
            }
        });
    }

    $('#custom_generation_preset_select').on('change', () => {
        const parsed = Number($('#custom_generation_preset_select').val());
        settings.currentPreset = Number.isFinite(parsed)
            ? clamp(Math.trunc(parsed), 0, Math.max(0, settings.presets.length - 1))
            : 0;
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_new').on('click', () => {
        const suggested = uniquePresetName('Preset');
        const name = window.prompt('Preset name', suggested);
        if (name === null) {
            return;
        }

        const preset = clone(defaultPreset);
        preset.name = uniquePresetName(name);
        settings.presets.push(preset);
        settings.currentPreset = settings.presets.length - 1;
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_duplicate').on('click', () => {
        const current = getCurrentPreset();
        const duplicated = clone(current);
        duplicated.name = uniquePresetName(`${current.name} Copy`);
        settings.presets.push(duplicated);
        settings.currentPreset = settings.presets.length - 1;
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_rename').on('click', () => {
        const current = getCurrentPreset();
        const name = window.prompt('Rename preset', current.name);
        if (name === null) {
            return;
        }

        current.name = sanitizePresetName(name, current.name);
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_delete').on('click', () => {
        if (settings.presets.length <= 1) {
            window.alert('At least one preset must remain.');
            return;
        }

        const current = getCurrentPreset();
        if (!window.confirm(`Delete preset "${current.name}"?`)) {
            return;
        }

        settings.presets.splice(settings.currentPreset, 1);
        settings.currentPreset = clamp(settings.currentPreset, 0, settings.presets.length - 1);
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_import').on('click', () => {
        const input = document.getElementById('custom_generation_preset_import_input');
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        input.value = '';
        input.click();
    });

    $('#custom_generation_preset_import_input').on('change', async () => {
        const input = document.getElementById('custom_generation_preset_import_input');
        if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
            return;
        }

        const file = input.files[0];

        try {
            await importPresetsFromFile(file);
            window.alert('Presets imported successfully.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Unknown import error');
            window.alert(`Import failed: ${message}`);
        } finally {
            input.value = '';
        }
    });

    $('#custom_generation_preset_export').on('click', () => {
        openExportDialog();
    });

    $('#custom_generation_export_cancel').on('click', () => {
        closeDialog('#custom_generation_export_dialog');
    });

    $('#custom_generation_export_confirm').on('click', () => {
        confirmExport();
    });

    $('#custom_generation_add_prompt').on('click', () => {
        const preset = getCurrentPreset();
        preset.prompts.push(normalizePrompt({
            name: `Prompt ${preset.prompts.length + 1}`,
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: null,
        }, `Prompt ${preset.prompts.length + 1}`));

        selectedPromptIndex = preset.prompts.length - 1;
        updateSettingsUI();
        saveSettings();
        openPromptEditor(selectedPromptIndex);
    });

    $('#custom_generation_add_regex').on('click', () => {
        const preset = getCurrentPreset();
        preset.regexs.push(normalizeRegex({
            name: `Regex ${preset.regexs.length + 1}`,
            regex: '',
            replace: '',
            userInput: true,
            aiOutput: true,
            worldInfo: false,
            enabled: true,
            minDepth: null,
            maxDepth: null,
            ephemerality: false,
            request: true,
            response: true,
        }, `Regex ${preset.regexs.length + 1}`));

        selectedRegexIndex = preset.regexs.length - 1;
        updateSettingsUI();
        saveSettings();
        openRegexEditor(selectedRegexIndex);
    });

    $('#custom_generation_add_template').on('click', () => {
        const preset = getCurrentPreset();
        preset.templates.push(normalizeTemplate({
            decorator: '@@record',
            tag: '',
            processor: 'replace',
            regex: '',
            content: '',
        }));

        selectedTemplateIndex = preset.templates.length - 1;
        updateSettingsUI();
        saveSettings();
        openTemplateEditor(selectedTemplateIndex);
    });

    $('#custom_generation_prompt_injection_position').on('change', () => {
        if (isUpdatingUI) {
            return;
        }

        const position = String($('#custom_generation_prompt_injection_position').val() ?? 'relative');
        updatePromptInjectionControlsVisibility(position);
    });

    $('#custom_generation_prompt_cancel').on('click', () => {
        closePromptEditor();
    });

    $('#custom_generation_prompt_save').on('click', () => {
        savePromptEditor();
    });

    $('#custom_generation_prompt_delete').on('click', () => {
        deletePromptFromEditor();
    });

    $('#custom_generation_regex_cancel').on('click', () => {
        closeRegexEditor();
    });

    $('#custom_generation_regex_save').on('click', () => {
        saveRegexEditor();
    });

    $('#custom_generation_regex_delete').on('click', () => {
        deleteRegexFromEditor();
    });

    $('#custom_generation_template_cancel').on('click', () => {
        closeTemplateEditor();
    });

    $('#custom_generation_template_save').on('click', () => {
        saveTemplateEditor();
    });

    $('#custom_generation_template_delete').on('click', () => {
        deleteTemplateFromEditor();
    });

    $('#custom_generation_prompt_dialog').on('close', () => {
        editingPromptIndex = null;
    });

    $('#custom_generation_regex_dialog').on('close', () => {
        editingRegexIndex = null;
    });

    $('#custom_generation_template_dialog').on('close', () => {
        editingTemplateIndex = null;
    });
}

/**
 * Setup settings UI
 */
export async function setupSettings() {
    // Inject settings into the page
    if (!$('#custom_generation_settings').length) {
        $('#extensions_settings2').append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'settings'));
    }

    await ensureModalTemplatesInjected();
    setAdvancedParametersExpanded(false);

    bindEvents();

    if (!isSettingsLoadedListenerBound) {
        eventSource.on(event_types.SETTINGS_LOADED, onSettingsLoaded);
        isSettingsLoadedListenerBound = true;
    }
}

/**
 * Load settings from localStorage
 */
export function loadSettings(restore: boolean = false) {
    // @ts-ignore: 2339
    if (!extension_settings.CustomGeneration || restore) {
        // @ts-ignore: 2339
        extension_settings.CustomGeneration = clone(defaultSettings);
    }

    // @ts-expect-error: 2339
    Object.assign(settings, clone(extension_settings.CustomGeneration));

    ensureSettingsIntegrity(true);
    updateSettingsUI();
}

/**
 * Update settings UI
 */
export function updateSettingsUI() {
    ensureSettingsIntegrity();

    const currentPreset = getCurrentPreset();

    selectedPromptIndex = clamp(selectedPromptIndex, 0, Math.max(0, currentPreset.prompts.length - 1));
    selectedRegexIndex = clamp(selectedRegexIndex, 0, Math.max(0, currentPreset.regexs.length - 1));
    selectedTemplateIndex = clamp(selectedTemplateIndex, 0, Math.max(0, currentPreset.templates.length - 1));

    isUpdatingUI = true;

    $('#custom_generation_base_url').val(settings.baseUrl);
    $('#custom_generation_api_key').val(settings.apiKey);
    $('#custom_generation_model').val(settings.model);
    $('#custom_generation_context_size').val(settings.contextSize);
    $('#custom_generation_max_tokens').val(settings.maxTokens);
    $('#custom_generation_temperature').val(settings.temperature);
    $('#custom_generation_top_k').val(settings.topK);
    $('#custom_generation_top_p').val(settings.topP);
    $('#custom_generation_frequency_penalty').val(settings.frequencyPenalty);
    $('#custom_generation_presence_penalty').val(settings.presencePenalty);
    $('#custom_generation_prompt_post_processing').val(settings.promptPostProcessing);
    $('#custom_generation_include_headers_yaml').val(stringifyYamlRecord(settings.includeHeaders));
    $('#custom_generation_include_body_yaml').val(stringifyYamlRecord(settings.includeBody));
    $('#custom_generation_exclude_body_yaml').val(stringifyYamlRecord(settings.excludeBody));

    updateModelSelectOptions();

    const presetSelect = $('#custom_generation_preset_select');
    presetSelect.empty();
    settings.presets.forEach((preset, index) => {
        presetSelect.append(`<option value="${index}">${preset.name}</option>`);
    });
    presetSelect.val(String(settings.currentPreset));

    const promptList = $('#custom_generation_prompt_list');
    promptList.empty();
    if (currentPreset.prompts.length === 0) {
        promptList.text(String(promptList.attr('no-items-text') ?? 'No prompts'));
    } else {
        currentPreset.prompts.forEach((prompt, index) => {
            promptList.append(buildPromptRow(prompt, index));
        });
    }

    const regexList = $('#custom_generation_regex_list');
    regexList.empty();
    if (currentPreset.regexs.length === 0) {
        regexList.text(String(regexList.attr('no-items-text') ?? 'No scripts'));
    } else {
        currentPreset.regexs.forEach((regex, index) => {
            regexList.append(buildRegexRow(regex, index));
        });
    }

    const templateList = $('#custom_generation_template_list');
    templateList.empty();
    if (currentPreset.templates.length === 0) {
        templateList.text(String(templateList.attr('no-items-text') ?? 'No templates'));
    } else {
        currentPreset.templates.forEach((template, index) => {
            templateList.append(buildTemplateRow(template, index));
        });
    }

    updatePresetSummary(currentPreset);

    isUpdatingUI = false;

    if (editingPromptIndex !== null) {
        if (currentPreset.prompts[editingPromptIndex]) {
            updatePromptEditor();
        } else {
            closePromptEditor();
        }
    }

    if (editingRegexIndex !== null) {
        if (currentPreset.regexs[editingRegexIndex]) {
            updateRegexEditor();
        } else {
            closeRegexEditor();
        }
    }

    if (editingTemplateIndex !== null) {
        if (currentPreset.templates[editingTemplateIndex]) {
            updateTemplateEditor();
        } else {
            closeTemplateEditor();
        }
    }
}

export function saveSettings() {
    // @ts-ignore: 2339
    if (!extension_settings.CustomGeneration) {
        // @ts-ignore: 2339
        extension_settings.CustomGeneration = {};
    }

    ensureSettingsIntegrity();

    // @ts-ignore: 2339
    Object.assign(extension_settings.CustomGeneration, clone(settings));
    saveSettingsDebounced();
}

function onSettingsLoaded() {
    loadSettings();
}
