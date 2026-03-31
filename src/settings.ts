import { eventSource, event_types, saveSettingsDebounced } from '@st/script.js';
import { extension_settings, renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { DEFAULT_DEPTH, DEFAULT_WEIGHT } from '@st/scripts/world-info.js';
import { generate as runGenerate, ApiConfig } from '@/functions/generate';
import { WI_DECORATOR_BEFORE_MAPPING, WI_DECORATOR_MAPPING } from '@/features/generate-processor';
import { PresetPrompt, RegEx, Template, Preset, Settings, ExportPayload, ListExportKind, ListExportItem, ListExportDialogState, ListExportPayload, ImportPayload } from '@/utils/defines';
import { defaultSettings, defaultTemplate, defaultPreset } from './utils/default-settings';
import { yaml } from "@st/lib.js";
import { t } from "@st/scripts/i18n.js";

export const settings: Settings = clone(defaultSettings);

const ALL_DECORATORS = Array.from(WI_DECORATOR_MAPPING.keys()).concat(Array.from(WI_DECORATOR_BEFORE_MAPPING.keys()));
const DEFAULT_TEMPLATE_DECORATOR = (ALL_DECORATORS.find(x => x === '@@record') ?? ALL_DECORATORS[0] ?? '@@record') as TemplateDecorator;
const PROMPT_TRIGGER_OPTIONS = ['normal', 'regenerate', 'swipe', 'continue', ...ALL_DECORATORS];
export const TEMPLATE_FILTER_OPTIONS = [
    'main',
    'personaDescription',
    'charDescription',
    'charPersonality',
    'scenario',
    'chatExamples',
    'worldInfoBefore',
    'worldInfoAfter',
    'chatHistory',
    'worldInfoDepth',
    'authorsNoteDepth',
    'presetDepth',
    'charDepth',
    'worldInfoOutlet',
    'charNote',
    'authorsNote',
    'lastCharMessage',
    'lastUserMessage',
    'worldInfoDepth0',
    'worldInfoDepth1',
    'worldInfoDepth2',
    'worldInfoDepth3',
    'worldInfoDepth4',
    'presetDepth0',
    'presetDepth1',
    'presetDepth2',
    'presetDepth3',
    'presetDepth4',
    'chatDepth0',
    'chatDepth1',
    'chatDepth2',
    'chatDepth3',
    'chatDepth4',
];

let selectedPromptIndex = 0;
let selectedRegexIndex = 0;
let selectedTemplateIndex = 0;
let selectedTemplatePromptIndex = 0;
let editingPromptIndex: number | null = null;
let editingRegexIndex: number | null = null;
let editingTemplateIndex: number | null = null;
let editingTemplatePromptIndex: number | null = null;
let promptEditorTarget: 'preset' | 'template' = 'preset';
let isCreatingPrompt = false;
let isCreatingRegex = false;
let isCreatingTemplate = false;
let isCreatingTemplatePrompt = false;
let creatingPromptDraft: PresetPrompt | null = null;
let creatingRegexDraft: RegEx | null = null;
let creatingTemplateDraft: Template | null = null;
let creatingTemplatePromptDraft: PresetPrompt | null = null;
let isUpdatingUI = false;
let isEventsBound = false;
let isSettingsLoadedListenerBound = false;
let modelCandidates: string[] = [];
let isConnectionActionInProgress = false;
let templateEditorDraft: { decorator: string; tag: string; filters: string[]; regex: string; findRegex: string; retryCount: number; retryInterval: number } | null = null;
let templateEditorDraftKey: string | null = null;

const exportSchemaVersion = '1.0.0';
const listExportSchemaVersion = '1.0.0';
const listExportDialogState: ListExportDialogState = {
    kind: null,
    items: [],
};
type TemplateDecorator = Template['decorator'];

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

function normalizeSelectValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) {
            return [];
        }
        return text.split(',').map(item => item.trim()).filter(Boolean);
    }

    return [];
}

function normalizePromptInternal(value: unknown): PresetPrompt['internal'] {
    const text = String(value ?? '').trim();
    return text ? text as PresetPrompt['internal'] : null;
}

function ensurePromptInternalOption(select: JQuery, value: PresetPrompt['internal']): void {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return;
    }

    ensureSelectOption(select, normalized);
}

function ensureSelectOptions(select: JQuery, options: Array<string | number>): void {
    options.forEach((option) => {
        ensureSelectOption(select, option);
    });
}

function ensureSelectOption(select: JQuery, option: string | number): void {
    const value = String(option);
    const exists = select.find('option').toArray().some(item => String($(item).val()) === value);
    if (!exists) {
        const i18nKey = value.startsWith('@@') ? value.substring(2) : value;
        select.append($(`<option data-i18n="cg_${i18nKey}"></option>`).val(value).text(value));
    }
}

function getSelectValues(selector: string): string[] {
    return normalizeSelectValues($(selector).val());
}

function setSelectValues(selector: string, values: Array<string | number>): void {
    const select = $(selector);
    const normalized = values.map(value => String(value).trim()).filter(Boolean);
    normalized.forEach(value => ensureSelectOption(select, value));
    select.val(normalized);
    if (select.data('select2')) {
        select.trigger('change.select2');
    } else {
        select.trigger('change');
    }
}

function initSelect2Multi(selector: string, options: string[]): void {
    const select = $(selector);
    if (!select.length) {
        return;
    }

    const hasSelect2 = typeof (select as any).select2 === 'function';
    if (!hasSelect2) {
        return;
    }

    if (select.data('select2')) {
        ensureSelectOptions(select, options);
        return;
    }

    ensureSelectOptions(select, options);

    const dialogParent = select.closest('dialog');
    const dropdownParent = dialogParent.length ? dialogParent : $(document.body);
    (select as any).select2({
        width: '100%',
        placeholder: String(select.data('placeholder') ?? ''),
        allowClear: true,
        tags: true,
        closeOnSelect: false,
        tokenSeparators: [','],
        dropdownParent,
    });
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

    const parsed = yaml.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('YAML must be an object mapping.');
    }

    return clone(parsed as Record<string, unknown>);
}

function stringifyYamlRecord(value: Record<string, unknown>): string {
    if (!value || Object.keys(value).length === 0) {
        return '';
    }

    return yaml.stringify(value).trimEnd();
}

function uniquePresetName(baseName: string): string {
    const base = sanitizePresetName(baseName, 'Preset');
    const existing = new Set(Object.keys(settings.presets ?? {}));
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
    const maxDepth = parseNumber(input.maxDepth, 999, 0, 9999, true);

    return {
        name: sanitizePresetName(String(input.name ?? ''), fallbackName),
        role,
        triggers: Array.isArray(input.triggers)
            ? input.triggers.map(x => String(x).trim()).filter(Boolean)
            : [],
        prompt: String(input.prompt ?? ''),
        injectionPosition,
        enabled: enable,
        internal: normalizePromptInternal(input.internal),
        injectionDepth,
        injectionOrder,
        maxDepth,
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

function buildTemplateMatchKey(template: Template): string {
    return `${template.decorator}:${String(template.tag ?? '')}`;
}

function getTemplateKey(template: Template, existingKeys: Iterable<string> = [], preferredKey: string | null = null): string {
    const baseKey = buildTemplateMatchKey(template);
    const taken = new Set(Array.from(existingKeys, key => String(key)));

    if (preferredKey && (preferredKey === baseKey || preferredKey.startsWith(`${baseKey}#`))) {
        return preferredKey;
    }

    if (!taken.has(baseKey)) {
        return baseKey;
    }

    if (preferredKey && !taken.has(preferredKey)) {
        return preferredKey;
    }

    let suffix = 2;
    let candidate = `${baseKey}:${suffix}`;
    while (taken.has(candidate) && candidate !== preferredKey) {
        suffix++;
        candidate = `${baseKey}:${suffix}`;
    }

    return candidate;
}

function buildTemplateMap(templates: Template[], existingKeys: Iterable<string> = []): Record<string, Template> {
    const map: Record<string, Template> = {};
    const taken = new Set(Array.from(existingKeys, key => String(key)));

    for (const template of templates) {
        const key = getTemplateKey(template, taken);
        map[key] = template;
        taken.add(key);
    }

    return map;
}

function normalizeTemplatePrompts(raw: unknown): PresetPrompt[] {
    if (Array.isArray(raw)) {
        return raw.map((prompt, index) => normalizePrompt(
            isRecord(prompt) ? prompt as Partial<PresetPrompt> : {},
            `Template Prompt ${index + 1}`,
        ));
    }

    if (raw === undefined || raw === null) {
        return clone(defaultTemplate.prompts);
    }

    const content = String(raw ?? '');
    return [normalizePrompt({
        name: 'Template Prompt',
        role: 'user',
        triggers: [],
        prompt: content,
        injectionPosition: 'relative',
        enabled: true,
        internal: null,
    }, 'Template Prompt')];
}

function normalizeListExportPrompt(raw: unknown, index: number): PresetPrompt {
    return normalizePrompt(isRecord(raw) ? raw as Partial<PresetPrompt> : {}, `Prompt ${index + 1}`);
}

function normalizeListExportRegex(raw: unknown, index: number): RegEx {
    return normalizeRegex(isRecord(raw) ? raw as Partial<RegEx> : {}, `Regex ${index + 1}`);
}

function normalizeListExportTemplate(raw: unknown): Template {
    return normalizeTemplate(isRecord(raw) ? raw as Partial<Template> : {});
}

function normalizeListExportPayload(raw: unknown): { kind: ListExportKind; items: Array<PresetPrompt | RegEx | Template> } {
    if (!isRecord(raw)) {
        throw new Error('Invalid JSON payload.');
    }

    const kind = String(raw.kind ?? '').trim();
    if (kind !== 'prompt' && kind !== 'regex' && kind !== 'template') {
        throw new Error('Invalid import format: kind is required.');
    }

    if (!Array.isArray(raw.items)) {
        throw new Error('Invalid import format: items is required.');
    }

    if (raw.items.length === 0) {
        throw new Error('Invalid import format: items cannot be empty.');
    }

    if (kind === 'prompt') {
        return {
            kind,
            items: raw.items.map((item, index) => normalizeListExportPrompt(item, index)),
        };
    }

    if (kind === 'regex') {
        return {
            kind,
            items: raw.items.map((item, index) => normalizeListExportRegex(item, index)),
        };
    }

    return {
        kind,
        items: raw.items.map(item => normalizeListExportTemplate(item)),
    };
}

function normalizeTemplate(input: Partial<Template>): Template {
    const decoratorRaw = String(input.decorator ?? DEFAULT_TEMPLATE_DECORATOR);
    const decorator = ALL_DECORATORS.includes(decoratorRaw as TemplateDecorator)
        ? decoratorRaw as TemplateDecorator
        : DEFAULT_TEMPLATE_DECORATOR;

    const legacyContent = (input as { content?: unknown }).content;
    const prompts = normalizeTemplatePrompts((input as { prompts?: unknown }).prompts ?? legacyContent);

    return {
        decorator,
        tag: String(input.tag ?? ''),
        prompts,
        regex: String(input.regex ?? ''),
        findRegex: String(input.findRegex ?? ''),
        filters: Array.isArray(input.filters)
            ? input.filters.map(value => String(value).trim()).filter(Boolean) as Template['filters']
            : [],
        retryCount: parseNumber(input.retryCount, defaultTemplate.retryCount, 0, 9999, true),
        retryInterval: parseNumber(input.retryInterval, defaultTemplate.retryInterval, 0, 86_400_000, true),
    };
}

function normalizeTemplates(raw: unknown): Record<string, Template> {
    const templates: Template[] = [];
    if (Array.isArray(raw)) {
        raw.forEach(item => {
            templates.push(normalizeTemplate(isRecord(item) ? item as Partial<Template> : {}));
        });
    } else if (isRecord(raw)) {
        Object.values(raw).forEach(value => {
            if (Array.isArray(value)) {
                value.forEach(item => {
                    templates.push(normalizeTemplate(isRecord(item) ? item as Partial<Template> : {}));
                });
                return;
            }

            if (isRecord(value)) {
                templates.push(normalizeTemplate(value as Partial<Template>));
            }
        });
    }

    return buildTemplateMap(templates);
}

type TemplateEntry = { key: string; template: Template };

function getTemplateEntries(preset: Preset): TemplateEntry[] {
    const entries: TemplateEntry[] = [];
    Object.entries(preset.templates ?? {}).forEach(([key, template]) => {
        if (!template) {
            return;
        }
        entries.push({ key, template });
    });
    return entries;
}

function getTemplateCount(preset: Preset): number {
    return getTemplateEntries(preset).length;
}

function getEditingTemplate(): Template | null {
    if (isCreatingTemplate && creatingTemplateDraft) {
        return creatingTemplateDraft;
    }

    const preset = getCurrentPreset();
    const entries = getTemplateEntries(preset);
    const entry = editingTemplateIndex === null ? null : entries[editingTemplateIndex] ?? null;
    return entry?.template ?? null;
}

function getEditingTemplatePrompt(): PresetPrompt | null {
    const template = getEditingTemplate();
    if (!template) {
        return null;
    }

    if (isCreatingTemplatePrompt && creatingTemplatePromptDraft) {
        return creatingTemplatePromptDraft;
    }

    if (editingTemplatePromptIndex === null) {
        return null;
    }

    return template.prompts[editingTemplatePromptIndex] ?? null;
}

function resetPromptCreationState(): void {
    isCreatingPrompt = false;
    creatingPromptDraft = null;
}

function resetRegexCreationState(): void {
    isCreatingRegex = false;
    creatingRegexDraft = null;
}

function resetTemplateCreationState(): void {
    isCreatingTemplate = false;
    creatingTemplateDraft = null;
}

function resetTemplatePromptCreationState(): void {
    isCreatingTemplatePrompt = false;
    creatingTemplatePromptDraft = null;
}

function normalizePreset(input: Partial<Preset>, fallbackName: string): Preset {
    const prompts = Array.isArray(input.prompts)
        ? input.prompts.map((prompt, index) => normalizePrompt(prompt, `Prompt ${index + 1}`))
        : clone(defaultPreset.prompts);

    const regexs = Array.isArray(input.regexs)
        ? input.regexs.map((regex, index) => normalizeRegex(regex, `Regex ${index + 1}`))
        : [];

    const templates = normalizeTemplates((input as { templates?: unknown }).templates);

    return {
        name: sanitizePresetName(String(input.name ?? ''), fallbackName),
        prompts,
        regexs,
        templates,
    };
}

function normalizePresetList(raw: unknown): Preset[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw.map((preset, index) => normalizePreset(
        isRecord(preset) ? preset as Partial<Preset> : {},
        `Preset ${index + 1}`,
    ));
}

function normalizePresetMap(raw: unknown): Record<string, Preset> {
    const result: Record<string, Preset> = {};

    if (Array.isArray(raw)) {
        const presets = normalizePresetList(raw);
        presets.forEach(preset => {
            const key = sanitizePresetName(preset.name, 'Preset');
            preset.name = key;
            result[key] = preset;
        });
        return result;
    }

    if (!isRecord(raw)) {
        return result;
    }

    Object.entries(raw).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            const list = normalizePresetList(value);
            if (list.length > 0) {
                const normalizedKey = sanitizePresetName(key, 'Preset');
                const preset = list[0];
                preset.name = normalizedKey;
                result[normalizedKey] = preset;
            }
            return;
        }

        if (isRecord(value)) {
            const preset = normalizePreset(value as Partial<Preset>, sanitizePresetName(key, 'Preset'));
            result[preset.name] = preset;
        }
    });

    return result;
}

function getPresetKeys(): string[] {
    return Object.keys(settings.presets ?? {});
}

function ensureCurrentPresetKey(): string {
    const keys = getPresetKeys();
    if (keys.length === 0) {
        settings.presets = {
            [defaultPreset.name]: clone(defaultPreset),
        };
        return defaultPreset.name;
    }

    const current = String(settings.currentPreset ?? '').trim();
    if (current && settings.presets[current]) {
        return current;
    }

    return keys[0];
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
    settings.maxConcurrency = parseNumber(settings.maxConcurrency, defaultSettings.maxConcurrency, 1, 100, true);

    settings.presets = normalizePresetMap(settings.presets);
    if (Object.keys(settings.presets).length === 0) {
        settings.presets = {
            [defaultPreset.name]: clone(defaultPreset),
        };
    }

    settings.currentPreset = ensureCurrentPresetKey();

    if (resetSelections) {
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        selectedTemplatePromptIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        editingTemplatePromptIndex = null;
    }
}

function getCurrentPreset(): Preset {
    const key = ensureCurrentPresetKey();
    settings.currentPreset = key;
    let preset = settings.presets[key];
    if (!preset) {
        preset = clone(defaultPreset);
        settings.presets[key] = preset;
    }

    return preset;
}

function readSortableOrder(list: JQuery): number[] {
    return list.children('.custom_generation_list_row').toArray().map((element) => {
        const value = Number($(element).attr('data-index'));
        return Number.isFinite(value) ? Math.trunc(value) : -1;
    }).filter(value => value >= 0);
}

function isIdentityOrder(order: number[]): boolean {
    return order.every((value, index) => value === index);
}

function resolveReorderedIndex(order: number[], current: number | null): number | null {
    if (current === null) {
        return null;
    }

    const nextIndex = order.indexOf(current);
    return nextIndex >= 0 ? nextIndex : current;
}

function applyPromptOrderFromList(list: JQuery): void {
    const preset = getCurrentPreset();
    const order = readSortableOrder(list);
    if (order.length !== preset.prompts.length || isIdentityOrder(order)) {
        return;
    }

    const next = order.map(index => preset.prompts[index]).filter(Boolean) as PresetPrompt[];
    if (next.length !== preset.prompts.length) {
        return;
    }

    preset.prompts = next;
    selectedPromptIndex = resolveReorderedIndex(order, selectedPromptIndex) ?? selectedPromptIndex;
    editingPromptIndex = resolveReorderedIndex(order, editingPromptIndex);
    updateSettingsUI();
    saveSettings();
}

function applyRegexOrderFromList(list: JQuery): void {
    const preset = getCurrentPreset();
    const order = readSortableOrder(list);
    if (order.length !== preset.regexs.length || isIdentityOrder(order)) {
        return;
    }

    const next = order.map(index => preset.regexs[index]).filter(Boolean) as RegEx[];
    if (next.length !== preset.regexs.length) {
        return;
    }

    preset.regexs = next;
    selectedRegexIndex = resolveReorderedIndex(order, selectedRegexIndex) ?? selectedRegexIndex;
    editingRegexIndex = resolveReorderedIndex(order, editingRegexIndex);
    updateSettingsUI();
    saveSettings();
}

function applyTemplateOrderFromList(list: JQuery): void {
    const preset = getCurrentPreset();
    const entries = getTemplateEntries(preset);
    const order = readSortableOrder(list);
    if (order.length !== entries.length || isIdentityOrder(order)) {
        return;
    }

    const nextEntries = order.map(index => entries[index]).filter(Boolean) as TemplateEntry[];
    if (nextEntries.length !== entries.length) {
        return;
    }

    const nextTemplates: Record<string, Template> = {};
    nextEntries.forEach((entry) => {
        nextTemplates[entry.key] = entry.template;
    });

    preset.templates = nextTemplates;
    selectedTemplateIndex = resolveReorderedIndex(order, selectedTemplateIndex) ?? selectedTemplateIndex;
    editingTemplateIndex = resolveReorderedIndex(order, editingTemplateIndex);
    updateSettingsUI();
    saveSettings();
}

function applyTemplatePromptOrderFromList(list: JQuery): void {
    const template = getEditingTemplate();
    if (!template) {
        return;
    }

    const order = readSortableOrder(list);
    if (order.length !== template.prompts.length || isIdentityOrder(order)) {
        return;
    }

    const next = order.map(index => template.prompts[index]).filter(Boolean) as PresetPrompt[];
    if (next.length !== template.prompts.length) {
        return;
    }

    template.prompts = next;
    selectedTemplatePromptIndex = resolveReorderedIndex(order, selectedTemplatePromptIndex) ?? selectedTemplatePromptIndex;
    editingTemplatePromptIndex = resolveReorderedIndex(order, editingTemplatePromptIndex);
    updateSettingsUI();
    saveSettings();
}

function initSortableList(list: JQuery, onUpdate: () => void): void {
    if (!list.length) {
        return;
    }

    const sortable = (list as any).sortable;
    if (typeof sortable !== 'function') {
        return;
    }

    if (list.data('ui-sortable')) {
        try {
            (list as any).sortable('destroy');
        } catch {
            // ignore
        }
    }

    const itemCount = list.children('.custom_generation_list_row').length;
    if (itemCount < 2) {
        return;
    }

    (list as any).sortable({
        handle: '.custom_generation_drag_handle',
        items: '> .custom_generation_list_row',
        tolerance: 'pointer',
        update: () => {
            if (isUpdatingUI) {
                return;
            }
            onUpdate();
        },
    });
}

function initSortableLists(): void {
    initSortableList($('#custom_generation_prompt_list'), () => applyPromptOrderFromList($('#custom_generation_prompt_list')));
    initSortableList($('#custom_generation_regex_list'), () => applyRegexOrderFromList($('#custom_generation_regex_list')));
    initSortableList($('#custom_generation_template_list'), () => applyTemplateOrderFromList($('#custom_generation_template_list')));
    initSortableList($('#custom_generation_template_prompt_list'), () => applyTemplatePromptOrderFromList($('#custom_generation_template_prompt_list')));
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
        modelSelect.append('<option value="" data-i18n="(No models loaded)">(No models loaded)</option>');
    } else {
        modelSelect.append('<option value="" data-i18n="(Select a model)">(Select a model)</option>');
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
    return normalized || t`Default`;
}

function getTemplateSummary(template: Template): string {
    return `${template.decorator} · ${getTemplateTagLabel(template)}`;
}

function buildPromptUniqueKey(prompt: PresetPrompt): string {
    return `${String(prompt.internal ?? '')}:${String(prompt.name ?? '').trim()}`;
}

function buildRegexUniqueKey(regex: RegEx): string {
    return String(regex.name ?? '').trim();
}

function promptUniqueKeyExists(prompts: PresetPrompt[], prompt: PresetPrompt, excludeIndex: number | null = null): boolean {
    const targetKey = buildPromptUniqueKey(prompt);
    return prompts.some((item, index) => index !== excludeIndex && buildPromptUniqueKey(item) === targetKey);
}

function regexUniqueKeyExists(regexs: RegEx[], regex: RegEx, excludeIndex: number | null = null): boolean {
    const targetKey = buildRegexUniqueKey(regex);
    return regexs.some((item, index) => index !== excludeIndex && buildRegexUniqueKey(item) === targetKey);
}

function templateUniqueKeyExists(templates: Record<string, Template>, template: Template, excludeKey: string | null = null): boolean {
    const targetKey = buildTemplateMatchKey(template);
    return Object.entries(templates).some(([key, item]) => key !== excludeKey && buildTemplateMatchKey(item) === targetKey);
}

function getPromptDuplicateMessage(prompt: PresetPrompt): string {
    const name = String(prompt.name ?? '').trim() || 'Prompt';
    const internal = String(prompt.internal ?? '').trim();
    return internal
        ? `A prompt with the same unique key already exists: ${internal} / ${name}`
        : `A prompt with the same name already exists: ${name}`;
}

function getRegexDuplicateMessage(regex: RegEx): string {
    const name = String(regex.name ?? '').trim() || 'Regex';
    return `A regex with the same name already exists: ${name}`;
}

function getTemplateDuplicateMessage(template: Template): string {
    return `A template with the same unique key already exists: ${buildTemplateMatchKey(template)}`;
}

function buildPromptDisplayName(prompt: PresetPrompt, index: number): string {
    return prompt.name || `Prompt ${index + 1}`;
}

function buildRegexDisplayName(regex: RegEx, index: number): string {
    return regex.name || `Regex ${index + 1}`;
}

function buildTemplateDisplayName(template: Template): string {
    return getTemplateSummary(template);
}

function openListExportDialog(kind: ListExportKind, items: ListExportItem[], title: string): void {
    listExportDialogState.kind = kind;
    listExportDialogState.items = items;
    const titleEl = $('#custom_generation_list_export_title');
    if (titleEl.length) {
        titleEl.text(title);
    }

    const container = $('#custom_generation_list_export_items');
    container.empty();
    items.forEach(item => {
        const row = $('<label class="checkbox_label"></label>');
        const checkbox = $('<input type="checkbox" />').prop('checked', item.checked);
        checkbox.on('change', () => {
            item.checked = Boolean(checkbox.prop('checked'));
        });
        row.append(checkbox, $('<span></span>').text(item.label));
        container.append(row);
    });

    openDialog('#custom_generation_list_export_dialog');
}

function closeListExportDialog(): void {
    closeDialog('#custom_generation_list_export_dialog');
    listExportDialogState.kind = null;
    listExportDialogState.items = [];
}

function buildListExportPayload(kind: ListExportKind, items: ListExportItem[]): ListExportPayload {
    return {
        version: listExportSchemaVersion,
        kind,
        items: items.map(item => item.data),
    };
}

function downloadListExportPayload(kind: ListExportKind, payload: ListExportPayload): void {
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filenameSuffix = kind === 'prompt' ? 'prompts' : kind === 'regex' ? 'regex' : 'templates';

    link.href = url;
    link.download = `st-custom-generation-${filenameSuffix}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

function confirmListExport(): void {
    const kind = listExportDialogState.kind;
    if (!kind) {
        return;
    }

    const selected = listExportDialogState.items.filter(item => item.checked);
    if (selected.length === 0) {
        window.alert('Please select at least one item to export.');
        return;
    }

    const payload = buildListExportPayload(kind, selected);
    closeListExportDialog();
    downloadListExportPayload(kind, payload);
}

function buildPromptExportItems(prompts: PresetPrompt[]): ListExportItem[] {
    return prompts.map((prompt, index) => ({
        id: `prompt-${index}`,
        label: buildPromptDisplayName(prompt, index),
        checked: true,
        data: clone(prompt),
    }));
}

function buildRegexExportItems(regexs: RegEx[]): ListExportItem[] {
    return regexs.map((regex, index) => ({
        id: `regex-${index}`,
        label: buildRegexDisplayName(regex, index),
        checked: true,
        data: clone(regex),
    }));
}

function buildTemplateExportItems(entries: TemplateEntry[]): ListExportItem[] {
    return entries.map((entry, index) => ({
        id: `template-${entry.key}`,
        label: buildTemplateDisplayName(entry.template),
        checked: true,
        data: clone(entry.template),
    }));
}

function openPromptExportDialogForPreset(): void {
    const preset = getCurrentPreset();
    if (preset.prompts.length === 0) {
        window.alert('No prompts to export.');
        return;
    }

    const items = buildPromptExportItems(preset.prompts);
    openListExportDialog('prompt', items, 'Export Prompts');
}

function openPromptExportDialogForSingle(index: number): void {
    const preset = getCurrentPreset();
    const prompt = preset.prompts[index];
    if (!prompt) {
        return;
    }

    const items = buildPromptExportItems([prompt]);
    openListExportDialog('prompt', items, 'Export Prompt');
}

function openRegexExportDialogForPreset(): void {
    const preset = getCurrentPreset();
    if (preset.regexs.length === 0) {
        window.alert('No regex scripts to export.');
        return;
    }

    const items = buildRegexExportItems(preset.regexs);
    openListExportDialog('regex', items, 'Export Regex');
}

function openRegexExportDialogForSingle(index: number): void {
    const preset = getCurrentPreset();
    const regex = preset.regexs[index];
    if (!regex) {
        return;
    }

    const items = buildRegexExportItems([regex]);
    openListExportDialog('regex', items, 'Export Regex');
}

function openTemplateExportDialogForPreset(): void {
    const preset = getCurrentPreset();
    const entries = getTemplateEntries(preset);
    if (entries.length === 0) {
        window.alert('No templates to export.');
        return;
    }

    const items = buildTemplateExportItems(entries);
    openListExportDialog('template', items, 'Export Templates');
}

function openTemplateExportDialogForSingle(index: number): void {
    const preset = getCurrentPreset();
    const entries = getTemplateEntries(preset);
    const entry = entries[index];
    if (!entry) {
        return;
    }

    const items = buildTemplateExportItems([entry]);
    openListExportDialog('template', items, 'Export Template');
}

async function importListFromFile(kind: ListExportKind, file: File): Promise<void> {
    const text = await file.text();
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Invalid JSON file.');
    }

    const normalized = normalizeListExportPayload(parsed);
    if (normalized.kind !== kind) {
        throw new Error(`Import type mismatch: expected ${kind}.`);
    }

    const preset = getCurrentPreset();
    if (kind === 'prompt') {
        const incomingPrompts = normalized.items as PresetPrompt[];
        const promptIndexMap = new Map(preset.prompts.map((p, index) => [`${p.internal}:${p.name}`, index]));
        for (const prompt of incomingPrompts) {
            const key = `${prompt.internal}:${prompt.name}`;
            const existingIndex = promptIndexMap.get(key);
            if (existingIndex !== undefined) {
                preset.prompts[existingIndex] = prompt;
            } else {
                promptIndexMap.set(key, preset.prompts.length);
                preset.prompts.push(prompt);
            }
        }
        selectedPromptIndex = clamp(preset.prompts.length - 1, 0, Math.max(0, preset.prompts.length - 1));
    } else if (kind === 'regex') {
        const incomingRegexs = normalized.items as RegEx[];
        const regexIndexMap = new Map(preset.regexs.map((re, index) => [re.name, index]));
        for (const regex of incomingRegexs) {
            const existingIndex = regexIndexMap.get(regex.name);
            if (existingIndex !== undefined) {
                preset.regexs[existingIndex] = regex;
            } else {
                regexIndexMap.set(regex.name, preset.regexs.length);
                preset.regexs.push(regex);
            }
        }
        selectedRegexIndex = clamp(preset.regexs.length - 1, 0, Math.max(0, preset.regexs.length - 1));
    } else {
        const templateList = normalized.items as Template[];
        const existingTemplateKeys = Object.keys(preset.templates);
        const templateMap = buildTemplateMap(templateList, existingTemplateKeys);
        const mergedTemplates: typeof preset.templates = {};
        for (const key of existingTemplateKeys) {
            mergedTemplates[key] = templateMap[key] ?? preset.templates[key];
        }
        for (const key of Object.keys(templateMap)) {
            if (!(key in mergedTemplates)) {
                mergedTemplates[key] = templateMap[key];
            }
        }
        preset.templates = mergedTemplates;
        selectedTemplateIndex = clamp(getTemplateCount(preset) - 1, 0, Math.max(0, getTemplateCount(preset) - 1));
    }

    updateSettingsUI();
    saveSettings();
}

/*
function getTemplateRegexPreview(template: Template): string {
    const preview = getPreviewText(String(template.regex ?? ''));
    return preview || '(no regex)';
}

function getTemplateContentPreview(template: Template): string {
    const firstLine = template.prompts.find(prompt => prompt.prompt)?.prompt ?? '';
    const preview = getPreviewText(String(firstLine));
    return preview || '(empty content)';
}
*/

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
        custom_include_body: yaml.stringify(settings.includeBody),
        custom_exclude_body: yaml.stringify(settings.excludeBody),
        custom_include_headers: yaml.stringify(settings.includeHeaders),
    };

    const messages: ChatCompletionMessage[] = [
        {
            role: 'user',
            content: 'This is a connection test. Reply with "OK" only.',
        },
    ];

    const response = await runGenerate(messages, new AbortController().signal, 'custom_generation_connection_test', apiConfig, {}, false);
    const responseList = Array.isArray(response) ? response : [response];
    return responseList.map(item => String(item ?? '').trim()).find(Boolean) ?? '';
}

function buildPromptRow(prompt: PresetPrompt, index: number) {
    const row = $('<div class="custom_generation_list_row flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>');
    row.attr('data-index', String(index));
    row.toggleClass('active', index === selectedPromptIndex);

    const left = $('<div class="flex-container alignItemsCenter flex1"></div>');
    const dragHandle = $('<i class="menu_button fa-solid fa-grip-lines custom_generation_drag_handle" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
    const toggle = $('<input type="checkbox" />').prop('checked', prompt.enabled === true);
    const name = $('<div class="flex1"></div>').text(buildPromptDisplayName(prompt, index));

    left.append(dragHandle, toggle, name);

    const actions = $('<div class="flex-container alignItemsCenter"></div>');
    const editButton = $('<i class="menu_button fa-solid fa-pen-to-square" title="Edit" data-i18n="[title]Edit"></i>');
    const exportButton = $('<i class="menu_button fa-solid fa-file-export" title="Export" data-i18n="[title]Export"></i>');
    const deleteButton = $('<i class="menu_button fa-solid fa-trash" title="Delete" data-i18n="[title]Delete"></i>');
    actions.append(editButton, exportButton, deleteButton);

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

    exportButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openPromptExportDialogForSingle(index);
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

    row.append(left, actions);
    return row;
}

function buildTemplatePromptRow(prompt: PresetPrompt, index: number) {
    const row = $('<div class="custom_generation_list_row flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>');
    row.attr('data-index', String(index));
    row.toggleClass('active', index === selectedTemplatePromptIndex);

    const left = $('<div class="flex-container alignItemsCenter flex1"></div>');
    const dragHandle = $('<i class="menu_button fa-solid fa-grip-lines custom_generation_drag_handle" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
    const toggle = $('<input type="checkbox" />').prop('checked', prompt.enabled === true);
    const name = $('<div class="flex1"></div>').text(prompt.name || `Prompt ${index + 1}`);

    left.append(dragHandle, toggle, name);

    const actions = $('<div class="flex-container alignItemsCenter"></div>');
    const editButton = $('<i class="menu_button fa-solid fa-pen-to-square" title="Edit" data-i18n="[title]Edit"></i>');
    const deleteButton = $('<i class="menu_button fa-solid fa-trash" title="Delete" data-i18n="[title]Delete"></i>');
    actions.append(editButton, deleteButton);

    row.on('click', () => {
        selectedTemplatePromptIndex = index;
        updateSettingsUI();
    });

    toggle.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
    });

    toggle.on('change', () => {
        const template = getEditingTemplate();
        const target = template?.prompts[index];
        if (!target) {
            return;
        }

        target.enabled = Boolean(toggle.prop('checked'));
        selectedTemplatePromptIndex = index;
        updateSettingsUI();
        saveSettings();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openTemplatePromptEditor(index);
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const template = getEditingTemplate();
        const target = template?.prompts[index];
        if (!target) {
            return;
        }

        if (!window.confirm(`Delete prompt "${target.name}"?`)) {
            return;
        }

        template.prompts.splice(index, 1);
        selectedTemplatePromptIndex = clamp(index, 0, Math.max(0, template.prompts.length - 1));
        updateSettingsUI();
        saveSettings();
    });

    row.append(left, actions);
    return row;
}

function buildRegexRow(regex: RegEx, index: number) {
    const row = $('<div class="custom_generation_list_row flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>');
    row.attr('data-index', String(index));
    row.toggleClass('active', index === selectedRegexIndex);

    const left = $('<div class="flex-container alignItemsCenter flex1"></div>');
    const dragHandle = $('<i class="menu_button fa-solid fa-grip-lines custom_generation_drag_handle" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
    const toggle = $('<input type="checkbox" />').prop('checked', regex.enabled);
    const name = $('<div class="flex1"></div>').text(buildRegexDisplayName(regex, index));

    left.append(dragHandle, toggle, name);

    const actions = $('<div class="flex-container alignItemsCenter"></div>');
    const editButton = $('<i class="menu_button fa-solid fa-pen-to-square" title="Edit" data-i18n="[title]Edit"></i>');
    const exportButton = $('<i class="menu_button fa-solid fa-file-export" title="Export" data-i18n="[title]Export"></i>');
    const deleteButton = $('<i class="menu_button fa-solid fa-trash" title="Delete" data-i18n="[title]Delete"></i>');
    actions.append(editButton, exportButton, deleteButton);

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

    exportButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openRegexExportDialogForSingle(index);
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

    row.append(left, actions);
    return row;
}

function buildTemplateRow(entry: TemplateEntry, index: number) {
    const template = entry.template;
    const row = $('<div class="custom_generation_list_row custom_generation_template_row flex-container alignItemsCenter justifySpaceBetween marginTop5"></div>');
    row.attr('data-index', String(index));
    row.toggleClass('active', index === selectedTemplateIndex);

    const left = $('<div class="flex-container alignItemsCenter flex1 custom_generation_template_row_body"></div>');
    const dragHandle = $('<i class="menu_button fa-solid fa-grip-lines custom_generation_drag_handle" title="Drag to reorder" data-i18n="[title]Drag to reorder"></i>');
    const meta = $('<div class="flex-container flexFlowColumn flex1 custom_generation_template_meta"></div>');
    const title = $('<div class="custom_generation_template_title"></div>').text(getTemplateSummary(template));
    // const subtitle = $('<div class="custom_generation_template_subtitle"></div>').text(getTemplateRegexPreview(template));
    // const preview = $('<div class="custom_generation_template_preview"></div>').text(getTemplateContentPreview(template));
    meta.append(title/*, subtitle, preview*/);
    left.append(dragHandle, meta);

    const actions = $('<div class="flex-container alignItemsCenter"></div>');
    const editButton = $('<i class="menu_button fa-solid fa-pen-to-square" title="Edit" data-i18n="[title]Edit"></i>');
    const exportButton = $('<i class="menu_button fa-solid fa-file-export" title="Export" data-i18n="[title]Export"></i>');
    const deleteButton = $('<i class="menu_button fa-solid fa-trash" title="Delete" data-i18n="[title]Delete"></i>');
    actions.append(editButton, exportButton, deleteButton);

    row.on('click', () => {
        selectedTemplateIndex = index;
        updateSettingsUI();
    });

    editButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openTemplateEditor(index);
    });

    exportButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        openTemplateExportDialogForSingle(index);
    });

    deleteButton.on('click', (event: JQuery.TriggeredEvent) => {
        event.stopPropagation();
        const preset = getCurrentPreset();
        const entries = getTemplateEntries(preset);
        const target = entries[index];
        if (!target) {
            return;
        }

        if (!window.confirm(getTemplateDeleteConfirmationText(target.template))) {
            return;
        }

        delete preset.templates[target.key];
        selectedTemplateIndex = clamp(index, 0, Math.max(0, getTemplateCount(preset) - 1));
        updateSettingsUI();
        saveSettings();
    });

    row.append(left, actions);
    return row;
}

function updatePresetSummary(preset: Preset) {
    const enabledPromptCount = preset.prompts.filter(x => x.enabled === true).length;
    const enabledRegexCount = preset.regexs.filter(x => x.enabled).length;
    const templateCount = getTemplateCount(preset);

    $('#custom_generation_preset_summary').text(
        `Prompts: ${preset.prompts.length} (enabled: ${enabledPromptCount}) · Regex: ${preset.regexs.length} (enabled: ${enabledRegexCount}) · Templates: ${templateCount}`,
    );
}

function setPromptEditorEnabled(enabled: boolean) {
    const selectors = [
        '#custom_generation_prompt_name',
        '#custom_generation_prompt_role',
        '#custom_generation_prompt_injection_position',
        '#custom_generation_prompt_injection_depth',
        '#custom_generation_prompt_injection_order',
        '#custom_generation_prompt_max_depth',
        '#custom_generation_prompt_triggers',
        '#custom_generation_prompt_internal',
        '#custom_generation_prompt_enable',
        '#custom_generation_prompt_content',
        '#custom_generation_prompt_delete',
        '#custom_generation_prompt_save_as',
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

function updatePromptInternalControls(internal: PresetPrompt['internal']): void {
    const shouldShowChatHistoryControls = internal === 'chatHistory';
    const isNonMainInternalPrompt = internal !== null && internal !== 'main';
    $('#custom_generation_prompt_chat_history_controls').toggle(shouldShowChatHistoryControls);
    $('#custom_generation_prompt_max_depth').prop('disabled', !shouldShowChatHistoryControls);
    $('#custom_generation_prompt_content').prop('disabled', isNonMainInternalPrompt);
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
        '#custom_generation_regex_save_as',
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
        '#custom_generation_template_filters',
        '#custom_generation_template_regex',
        '#custom_generation_template_find_regex',
        '#custom_generation_template_retry_count',
        '#custom_generation_template_retry_interval',
        '#custom_generation_template_delete',
        '#custom_generation_template_save_as',
        '#custom_generation_template_save',
    ];

    for (const selector of selectors) {
        $(selector).prop('disabled', !enabled);
    }

    $('#custom_generation_template_add_prompt').prop('disabled', !enabled);
}

function resetTemplateEditorDraft(): void {
    templateEditorDraft = null;
    templateEditorDraftKey = null;
}

function readTemplateEditorDraft(): { decorator: string; tag: string; filters: string[]; regex: string; findRegex: string; retryCount: number; retryInterval: number } {
    return {
        decorator: String($('#custom_generation_template_decorator').val() ?? DEFAULT_TEMPLATE_DECORATOR),
        tag: String($('#custom_generation_template_tag').val() ?? ''),
        filters: getSelectValues('#custom_generation_template_filters'),
        regex: String($('#custom_generation_template_regex').val() ?? ''),
        findRegex: String($('#custom_generation_template_find_regex').val() ?? ''),
        retryCount: parseNumber($('#custom_generation_template_retry_count').val(), defaultTemplate.retryCount, 0, 9999, true),
        retryInterval: parseNumber($('#custom_generation_template_retry_interval').val(), defaultTemplate.retryInterval, 0, 86_400_000, true),
    };
}

function applyTemplateEditorDraft(draft: { decorator: string; tag: string; filters: string[]; regex: string; findRegex: string; retryCount: number; retryInterval: number }): void {
    $('#custom_generation_template_decorator').val(draft.decorator);
    $('#custom_generation_template_tag').val(draft.tag);
    setSelectValues('#custom_generation_template_filters', draft.filters);
    $('#custom_generation_template_regex').val(draft.regex);
    $('#custom_generation_template_find_regex').val(draft.findRegex);
    $('#custom_generation_template_retry_count').val(draft.retryCount);
    $('#custom_generation_template_retry_interval').val(draft.retryInterval);
}

function syncTemplateEditorDraft(): void {
    if (isCreatingTemplate && creatingTemplateDraft) {
        templateEditorDraftKey = '__creating__';
        templateEditorDraft = readTemplateEditorDraft();
        return;
    }

    if (editingTemplateIndex === null) {
        resetTemplateEditorDraft();
        return;
    }

    const preset = getCurrentPreset();
    const entries = getTemplateEntries(preset);
    const entry = entries[editingTemplateIndex];
    if (!entry) {
        resetTemplateEditorDraft();
        return;
    }

    templateEditorDraftKey = entry.key;
    templateEditorDraft = readTemplateEditorDraft();
}

function updateTemplatePromptList(template: Template | null) {
    const list = $('#custom_generation_template_prompt_list');
    if (!list.length) {
        return;
    }

    list.empty();

    if (!template || !template.prompts.length) {
        list.text(String(list.attr('no-items-text') ?? 'No prompts'));
    } else {
        template.prompts.forEach((prompt, index) => {
            list.append(buildTemplatePromptRow(prompt, index));
        });
    }

    initSortableList(list, () => applyTemplatePromptOrderFromList(list));
}

function updatePromptEditor() {
    const preset = getCurrentPreset();
    let prompt: PresetPrompt | null = null;

    if (promptEditorTarget === 'template') {
        prompt = getEditingTemplatePrompt();
    } else if (isCreatingPrompt && creatingPromptDraft) {
        prompt = creatingPromptDraft;
    } else {
        prompt = editingPromptIndex === null ? null : preset.prompts[editingPromptIndex] ?? null;
    }

    isUpdatingUI = true;

    const internalSelect = $('#custom_generation_prompt_internal');
    if (internalSelect.length) {
        internalSelect.empty();
        internalSelect.append('<option value="" data-i18n="cg_none">none</option>');
        TEMPLATE_FILTER_OPTIONS.forEach((option) => {
            internalSelect.append(`<option value="${option}" data-i18n="cg_${option}">${option}</option>`);
        });
    }

    if (!prompt) {
        setPromptEditorEnabled(false);
        $('#custom_generation_prompt_name').val('');
        $('#custom_generation_prompt_role').val('system');
        $('#custom_generation_prompt_injection_position').val('relative');
        $('#custom_generation_prompt_injection_depth').val(DEFAULT_DEPTH);
        $('#custom_generation_prompt_injection_order').val(DEFAULT_WEIGHT);
        $('#custom_generation_prompt_max_depth').val(999);
        updatePromptInjectionControlsVisibility('relative');
        $('#custom_generation_prompt_internal').val('');
        updatePromptInternalControls(null);
        setSelectValues('#custom_generation_prompt_triggers', []);
        $('#custom_generation_prompt_enable').prop('checked', false);
        $('#custom_generation_prompt_content').val('');
        $('#custom_generation_prompt_delete').toggle(false);
        $('#custom_generation_prompt_save_as').toggle(false);
        isUpdatingUI = false;
        return;
    }

    setPromptEditorEnabled(true);
    ensurePromptInternalOption(internalSelect, prompt.internal);
    $('#custom_generation_prompt_name').val(prompt.name);
    $('#custom_generation_prompt_role').val(prompt.role);
    $('#custom_generation_prompt_injection_position').val(prompt.injectionPosition);
    $('#custom_generation_prompt_injection_depth').val(parseNumber(prompt.injectionDepth, DEFAULT_DEPTH, 0, 9999, true));
    $('#custom_generation_prompt_injection_order').val(parseNumber(prompt.injectionOrder, DEFAULT_WEIGHT, -1_000_000, 1_000_000, true));
    $('#custom_generation_prompt_max_depth').val(parseNumber(prompt.maxDepth, 999, 0, 9999, true));
    updatePromptInjectionControlsVisibility(prompt.injectionPosition);
    $('#custom_generation_prompt_internal').val(String(prompt.internal ?? ''));
    updatePromptInternalControls(prompt.internal);
    setSelectValues('#custom_generation_prompt_triggers', prompt.triggers);
    $('#custom_generation_prompt_enable').prop('checked', prompt.enabled === true);
    $('#custom_generation_prompt_content').val(prompt.prompt);
    $('#custom_generation_prompt_delete').toggle(!isCreatingPrompt && !isCreatingTemplatePrompt);
    $('#custom_generation_prompt_save_as').toggle(!isCreatingPrompt && !isCreatingTemplatePrompt);

    isUpdatingUI = false;
}

function updateRegexEditor() {
    const preset = getCurrentPreset();
    const regex = isCreatingRegex && creatingRegexDraft
        ? creatingRegexDraft
        : editingRegexIndex === null ? null : preset.regexs[editingRegexIndex];

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
        $('#custom_generation_regex_delete').toggle(false);
        $('#custom_generation_regex_save_as').toggle(false);
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
    $('#custom_generation_regex_delete').toggle(!isCreatingRegex);
    $('#custom_generation_regex_save_as').toggle(!isCreatingRegex);

    isUpdatingUI = false;
}

function updateTemplateEditor() {
    const preset = getCurrentPreset();
    const entries = getTemplateEntries(preset);
    const templateEntry = isCreatingTemplate && creatingTemplateDraft
        ? { key: '__creating__', template: creatingTemplateDraft }
        : editingTemplateIndex === null ? null : entries[editingTemplateIndex] ?? null;

    isUpdatingUI = true;

    if (!templateEntry) {
        setTemplateEditorEnabled(false);
        resetTemplateEditorDraft();
        $('#custom_generation_template_decorator').val(DEFAULT_TEMPLATE_DECORATOR);
        $('#custom_generation_template_tag').val('');
        setSelectValues('#custom_generation_template_filters', []);
        $('#custom_generation_template_regex').val('');
        $('#custom_generation_template_find_regex').val('');
        $('#custom_generation_template_retry_count').val(defaultTemplate.retryCount);
        $('#custom_generation_template_retry_interval').val(defaultTemplate.retryInterval);
        $('#custom_generation_template_delete').toggle(false);
        $('#custom_generation_template_save_as').toggle(false);
        updateTemplatePromptList(null);
        isUpdatingUI = false;
        return;
    }

    const template = templateEntry.template;
    const shouldRestoreDraft = templateEditorDraft && templateEditorDraftKey === templateEntry.key;
    setTemplateEditorEnabled(true);
    $('#custom_generation_template_delete').toggle(!isCreatingTemplate);
    $('#custom_generation_template_save_as').toggle(!isCreatingTemplate);
    if (shouldRestoreDraft && templateEditorDraft) {
        applyTemplateEditorDraft(templateEditorDraft);
    } else {
        $('#custom_generation_template_decorator').val(template.decorator);
        $('#custom_generation_template_tag').val(template.tag);
        setSelectValues('#custom_generation_template_filters', template.filters ?? []);
        $('#custom_generation_template_regex').val(template.regex);
        $('#custom_generation_template_find_regex').val(template.findRegex);
        $('#custom_generation_template_retry_count').val(template.retryCount);
        $('#custom_generation_template_retry_interval').val(template.retryInterval);
        templateEditorDraft = readTemplateEditorDraft();
        templateEditorDraftKey = templateEntry.key;
    }
    selectedTemplatePromptIndex = clamp(selectedTemplatePromptIndex, 0, Math.max(0, template.prompts.length - 1));
    updateTemplatePromptList(template);

    isUpdatingUI = false;
}

function openPromptEditor(index: number): void {
    const preset = getCurrentPreset();
    if (!preset.prompts[index]) {
        return;
    }

    resetPromptCreationState();
    resetTemplatePromptCreationState();
    promptEditorTarget = 'preset';
    editingPromptIndex = index;
    selectedPromptIndex = index;
    updatePromptEditor();
    openDialog('#custom_generation_prompt_dialog');
}

function closePromptEditor(): void {
    editingPromptIndex = null;
    editingTemplatePromptIndex = null;
    promptEditorTarget = 'preset';
    resetPromptCreationState();
    resetTemplatePromptCreationState();
    closeDialog('#custom_generation_prompt_dialog');
}

function savePromptEditor(saveAs: boolean = false): void {
    const preset = getCurrentPreset();
    if (promptEditorTarget === 'template') {
        const template = getEditingTemplate();
        if (!template) {
            return;
        }

        const fallbackName = `Prompt ${template.prompts.length + 1}`;
        const nextPrompt = normalizePrompt({
            name: String($('#custom_generation_prompt_name').val() ?? ''),
            role: String($('#custom_generation_prompt_role').val() ?? 'system') as PresetPrompt['role'],
            triggers: getSelectValues('#custom_generation_prompt_triggers'),
            prompt: String($('#custom_generation_prompt_content').val() ?? ''),
            injectionPosition: String($('#custom_generation_prompt_injection_position').val() ?? 'relative') as PresetPrompt['injectionPosition'],
            enabled: Boolean($('#custom_generation_prompt_enable').prop('checked')),
            internal: normalizePromptInternal($('#custom_generation_prompt_internal').val()),
            injectionDepth: parseNumber($('#custom_generation_prompt_injection_depth').val(), DEFAULT_DEPTH, 0, 9999, true),
            injectionOrder: parseNumber($('#custom_generation_prompt_injection_order').val(), DEFAULT_WEIGHT, -1_000_000, 1_000_000, true),
            maxDepth: parseNumber($('#custom_generation_prompt_max_depth').val(), 999, 0, 9999, true),
        }, fallbackName);

        if (isCreatingTemplatePrompt) {
            template.prompts.push(nextPrompt);
            selectedTemplatePromptIndex = template.prompts.length - 1;
            closePromptEditor();
            updateSettingsUI();
            saveSettings();
            return;
        }

        if (editingTemplatePromptIndex === null) {
            return;
        }

        const prompt = template.prompts[editingTemplatePromptIndex];
        if (!prompt) {
            return;
        }

        if (saveAs) {
            if (buildPromptUniqueKey(prompt) === buildPromptUniqueKey(nextPrompt)) {
                window.alert('Save As requires a different unique key from the original prompt.');
                return;
            }

            if (promptUniqueKeyExists(template.prompts, nextPrompt)) {
                window.alert(getPromptDuplicateMessage(nextPrompt));
                return;
            }

            template.prompts.push(nextPrompt);
            selectedTemplatePromptIndex = template.prompts.length - 1;
            closePromptEditor();
            updateSettingsUI();
            saveSettings();
            return;
        }

        prompt.name = nextPrompt.name;
        prompt.role = nextPrompt.role;
        prompt.triggers = nextPrompt.triggers;
        prompt.prompt = nextPrompt.prompt;
        prompt.injectionPosition = nextPrompt.injectionPosition;
        prompt.enabled = nextPrompt.enabled;
        prompt.internal = nextPrompt.internal;
        prompt.injectionDepth = nextPrompt.injectionDepth;
        prompt.injectionOrder = nextPrompt.injectionOrder;
        prompt.maxDepth = nextPrompt.maxDepth;

        selectedTemplatePromptIndex = editingTemplatePromptIndex;
        closePromptEditor();
        updateSettingsUI();
        saveSettings();
        return;
    }

    const fallbackName = `Prompt ${preset.prompts.length + 1}`;
    const nextPrompt = normalizePrompt({
        name: String($('#custom_generation_prompt_name').val() ?? ''),
        role: String($('#custom_generation_prompt_role').val() ?? 'system') as PresetPrompt['role'],
        triggers: getSelectValues('#custom_generation_prompt_triggers'),
        prompt: String($('#custom_generation_prompt_content').val() ?? ''),
        injectionPosition: String($('#custom_generation_prompt_injection_position').val() ?? 'relative') as PresetPrompt['injectionPosition'],
        enabled: Boolean($('#custom_generation_prompt_enable').prop('checked')),
        internal: normalizePromptInternal($('#custom_generation_prompt_internal').val()),
        injectionDepth: parseNumber($('#custom_generation_prompt_injection_depth').val(), DEFAULT_DEPTH, 0, 9999, true),
        injectionOrder: parseNumber($('#custom_generation_prompt_injection_order').val(), DEFAULT_WEIGHT, -1_000_000, 1_000_000, true),
        maxDepth: parseNumber($('#custom_generation_prompt_max_depth').val(), 999, 0, 9999, true),
    }, fallbackName);

    if (isCreatingPrompt) {
        preset.prompts.push(nextPrompt);
        selectedPromptIndex = preset.prompts.length - 1;
        closePromptEditor();
        updateSettingsUI();
        saveSettings();
        return;
    }

    if (editingPromptIndex === null) {
        return;
    }

    const prompt = preset.prompts[editingPromptIndex];
    if (!prompt) {
        return;
    }

    if (saveAs) {
        if (buildPromptUniqueKey(prompt) === buildPromptUniqueKey(nextPrompt)) {
            window.alert('Save As requires a different unique key from the original prompt.');
            return;
        }

        if (promptUniqueKeyExists(preset.prompts, nextPrompt)) {
            window.alert(getPromptDuplicateMessage(nextPrompt));
            return;
        }

        preset.prompts.push(nextPrompt);
        selectedPromptIndex = preset.prompts.length - 1;
        closePromptEditor();
        updateSettingsUI();
        saveSettings();
        return;
    }

    prompt.name = nextPrompt.name;
    prompt.role = nextPrompt.role;
    prompt.triggers = nextPrompt.triggers;
    prompt.prompt = nextPrompt.prompt;
    prompt.injectionPosition = nextPrompt.injectionPosition;
    prompt.enabled = nextPrompt.enabled;
    prompt.internal = nextPrompt.internal;
    prompt.injectionDepth = nextPrompt.injectionDepth;
    prompt.injectionOrder = nextPrompt.injectionOrder;
    prompt.maxDepth = nextPrompt.maxDepth;

    selectedPromptIndex = editingPromptIndex;
    closePromptEditor();
    updateSettingsUI();
    saveSettings();
}

function deletePromptFromEditor(): void {
    const preset = getCurrentPreset();
    if (promptEditorTarget === 'template') {
        const template = getEditingTemplate();
        if (!template) {
            return;
        }

        if (isCreatingTemplatePrompt) {
            closePromptEditor();
            updateSettingsUI();
            return;
        }

        if (editingTemplatePromptIndex === null) {
            return;
        }

        const prompt = template.prompts[editingTemplatePromptIndex];
        if (!prompt) {
            return;
        }

        if (!window.confirm(`Delete prompt "${prompt.name}"?`)) {
            return;
        }

        const removedIndex = editingTemplatePromptIndex;
        template.prompts.splice(removedIndex, 1);
        closePromptEditor();
        selectedTemplatePromptIndex = clamp(removedIndex, 0, Math.max(0, template.prompts.length - 1));
        updateSettingsUI();
        saveSettings();
        return;
    }

    if (isCreatingPrompt) {
        closePromptEditor();
        updateSettingsUI();
        return;
    }

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

    resetRegexCreationState();
    editingRegexIndex = index;
    selectedRegexIndex = index;
    updateRegexEditor();
    openDialog('#custom_generation_regex_dialog');
}

function openTemplatePromptEditor(index: number): void {
    syncTemplateEditorDraft();
    const template = getEditingTemplate();
    if (!template || !template.prompts[index]) {
        return;
    }

    promptEditorTarget = 'template';
    editingTemplatePromptIndex = index;
    selectedTemplatePromptIndex = index;
    updatePromptEditor();
    openDialog('#custom_generation_prompt_dialog');
}

function closeRegexEditor(): void {
    editingRegexIndex = null;
    resetRegexCreationState();
    closeDialog('#custom_generation_regex_dialog');
}

function saveRegexEditor(saveAs: boolean = false): void {
    const preset = getCurrentPreset();
    const fallbackName = `Regex ${preset.regexs.length + 1}`;
    const nextRegex = normalizeRegex({
        name: String($('#custom_generation_regex_name').val() ?? ''),
        regex: String($('#custom_generation_regex_regex').val() ?? ''),
        replace: String($('#custom_generation_regex_replace').val() ?? ''),
        userInput: Boolean($('#custom_generation_regex_user_input').prop('checked')),
        aiOutput: Boolean($('#custom_generation_regex_ai_output').prop('checked')),
        worldInfo: Boolean($('#custom_generation_regex_world_info').prop('checked')),
        enabled: Boolean($('#custom_generation_regex_enable').prop('checked')),
        minDepth: parseNullableInt($('#custom_generation_regex_min_depth').val(), -1),
        maxDepth: parseNullableInt($('#custom_generation_regex_max_depth').val(), 0),
        ephemerality: Boolean($('#custom_generation_regex_ephemerality').prop('checked')),
        request: Boolean($('#custom_generation_regex_request').prop('checked')),
        response: Boolean($('#custom_generation_regex_response').prop('checked')),
    }, fallbackName);

    if (isCreatingRegex) {
        preset.regexs.push(nextRegex);
        selectedRegexIndex = preset.regexs.length - 1;
        closeRegexEditor();
        updateSettingsUI();
        saveSettings();
        return;
    }

    if (editingRegexIndex === null) {
        return;
    }

    const regex = preset.regexs[editingRegexIndex];
    if (!regex) {
        return;
    }

    if (saveAs) {
        if (buildRegexUniqueKey(regex) === buildRegexUniqueKey(nextRegex)) {
            window.alert('Save As requires a different name from the original regex.');
            return;
        }

        if (regexUniqueKeyExists(preset.regexs, nextRegex)) {
            window.alert(getRegexDuplicateMessage(nextRegex));
            return;
        }

        preset.regexs.push(nextRegex);
        selectedRegexIndex = preset.regexs.length - 1;
        closeRegexEditor();
        updateSettingsUI();
        saveSettings();
        return;
    }

    preset.regexs[editingRegexIndex] = nextRegex;
    selectedRegexIndex = editingRegexIndex;
    closeRegexEditor();
    updateSettingsUI();
    saveSettings();
}

function deleteRegexFromEditor(): void {
    const preset = getCurrentPreset();
    if (isCreatingRegex) {
        closeRegexEditor();
        updateSettingsUI();
        return;
    }

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
    const entries = getTemplateEntries(preset);
    if (!entries[index]) {
        return;
    }

    resetTemplateCreationState();
    editingTemplateIndex = index;
    selectedTemplateIndex = index;
    selectedTemplatePromptIndex = 0;
    editingTemplatePromptIndex = null;
    promptEditorTarget = 'template';
    updateTemplateEditor();
    openDialog('#custom_generation_template_dialog');
}

function closeTemplateEditor(): void {
    editingTemplateIndex = null;
    selectedTemplatePromptIndex = 0;
    editingTemplatePromptIndex = null;
    promptEditorTarget = 'preset';
    resetTemplateCreationState();
    resetTemplateEditorDraft();
    closeDialog('#custom_generation_template_dialog');
}

function saveTemplateEditor(saveAs: boolean = false): void {
    const preset = getCurrentPreset();
    const nextTemplate = normalizeTemplate({
        decorator: $('#custom_generation_template_decorator').val() as Template['decorator'],
        tag: String($('#custom_generation_template_tag').val() ?? ''),
        filters: getSelectValues('#custom_generation_template_filters') as Template['filters'],
        regex: String($('#custom_generation_template_regex').val() ?? ''),
        findRegex: String($('#custom_generation_template_find_regex').val() ?? ''),
        retryCount: parseNumber($('#custom_generation_template_retry_count').val(), defaultTemplate.retryCount, 0, 9999, true),
        retryInterval: parseNumber($('#custom_generation_template_retry_interval').val(), defaultTemplate.retryInterval, 0, 86_400_000, true),
        prompts: getEditingTemplate()?.prompts ?? [],
    });

    if (isCreatingTemplate) {
        const nextKey = getTemplateKey(nextTemplate, Object.keys(preset.templates));
        preset.templates[nextKey] = nextTemplate;
        selectedTemplateIndex = getTemplateCount(preset) - 1;
        resetTemplateEditorDraft();
        closeTemplateEditor();
        updateSettingsUI();
        saveSettings();
        return;
    }

    const entries = getTemplateEntries(preset);
    if (editingTemplateIndex === null) {
        return;
    }

    const entry = entries[editingTemplateIndex];
    if (!entry) {
        return;
    }

    const previousKey = entry.key;
    if (saveAs) {
        if (buildTemplateMatchKey(entry.template) === buildTemplateMatchKey(nextTemplate)) {
            window.alert('Save As requires a different unique key from the original template.');
            return;
        }

        if (templateUniqueKeyExists(preset.templates, nextTemplate)) {
            window.alert(getTemplateDuplicateMessage(nextTemplate));
            return;
        }

        const nextKey = getTemplateKey(nextTemplate, Object.keys(preset.templates));
        preset.templates[nextKey] = nextTemplate;
        selectedTemplateIndex = getTemplateCount(preset) - 1;
        resetTemplateEditorDraft();
        closeTemplateEditor();
        updateSettingsUI();
        saveSettings();
        return;
    }

    const nextKeys = Object.keys(preset.templates).filter(key => key !== previousKey);
    const nextKey = getTemplateKey(nextTemplate, nextKeys, previousKey);

    if (previousKey !== nextKey) {
        delete preset.templates[previousKey];
    }

    preset.templates[nextKey] = nextTemplate;

    selectedTemplateIndex = editingTemplateIndex;
    resetTemplateEditorDraft();
    closeTemplateEditor();
    updateSettingsUI();
    saveSettings();
}

function deleteTemplateFromEditor(): void {
    const preset = getCurrentPreset();
    if (isCreatingTemplate) {
        closeTemplateEditor();
        updateSettingsUI();
        return;
    }

    const entries = getTemplateEntries(preset);
    if (editingTemplateIndex === null) {
        return;
    }

    const entry = entries[editingTemplateIndex];
    if (!entry) {
        return;
    }

    if (!window.confirm(getTemplateDeleteConfirmationText(entry.template))) {
        return;
    }

    delete preset.templates[entry.key];

    const removedIndex = editingTemplateIndex;
    resetTemplateEditorDraft();
    closeTemplateEditor();
    const remainingCount = getTemplateCount(preset);
    selectedTemplateIndex = clamp(removedIndex, 0, Math.max(0, remainingCount - 1));
    updateSettingsUI();
    saveSettings();
}

function buildExportPayload(includeApiConnection: boolean): ExportPayload {
    const payload: ExportPayload = {
        version: exportSchemaVersion,
        presets: clone([settings.presets[settings.currentPreset]]),
        currentPreset: 0,
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
    const presetMap = normalizePresetMap(normalized.presets);
    const mapKeys = Object.keys(presetMap);

    Object.assign(settings.presets, presetMap);

    settings.currentPreset = mapKeys[normalized.currentPreset] ?? mapKeys[0] ?? settings.currentPreset;
    selectedPromptIndex = 0;
    selectedRegexIndex = 0;
    selectedTemplateIndex = 0;
    selectedTemplatePromptIndex = 0;
    editingPromptIndex = null;
    editingRegexIndex = null;
    editingTemplateIndex = null;
    editingTemplatePromptIndex = null;

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
        for (const decorator of ALL_DECORATORS) {
            decoratorSelect.append(`<option value="${decorator}" data-i18n="cg_${decorator.substring(2)}">${decorator.substring(2)}</option>`);
        }
    }

    initSelect2Multi('#custom_generation_prompt_triggers', PROMPT_TRIGGER_OPTIONS);
    initSelect2Multi('#custom_generation_template_filters', TEMPLATE_FILTER_OPTIONS);
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

    $('#custom_generation_stream').on('change', () => {
        settings.stream = Boolean($('#custom_generation_stream').prop('checked'));
        saveSettings();
    });

    $('#custom_generation_max_concurrency').on('input', () => {
        settings.maxConcurrency = parseNumber($('#custom_generation_max_concurrency').val(), defaultSettings.maxConcurrency, 1, 100, true);
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
        const key = String($('#custom_generation_preset_select').val() ?? '').trim();
        settings.currentPreset = key && settings.presets[key]
            ? key
            : ensureCurrentPresetKey();
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        selectedTemplatePromptIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        editingTemplatePromptIndex = null;
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
        settings.presets[preset.name] = preset;
        settings.currentPreset = preset.name;
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        selectedTemplatePromptIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        editingTemplatePromptIndex = null;
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_duplicate').on('click', () => {
        const current = getCurrentPreset();
        const duplicated = clone(current);
        duplicated.name = uniquePresetName(`${current.name} Copy`);
        settings.presets[duplicated.name] = duplicated;
        settings.currentPreset = duplicated.name;
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        selectedTemplatePromptIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        editingTemplatePromptIndex = null;
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_rename').on('click', () => {
        const currentKey = ensureCurrentPresetKey();
        const current = getCurrentPreset();
        const name = window.prompt('Rename preset', current.name);
        if (name === null) {
            return;
        }

        const nextName = sanitizePresetName(name, current.name);
        if (nextName === currentKey) {
            current.name = nextName;
            updateSettingsUI();
            saveSettings();
            return;
        }

        current.name = nextName;
        delete settings.presets[currentKey];
        settings.presets[nextName] = current;
        settings.currentPreset = nextName;
        updateSettingsUI();
        saveSettings();
    });

    $('#custom_generation_preset_delete').on('click', () => {
        const keys = Object.keys(settings.presets ?? {});
        if (keys.length <= 1) {
            window.alert('At least one preset must remain.');
            return;
        }

        const currentKey = ensureCurrentPresetKey();
        const current = getCurrentPreset();
        if (!window.confirm(`Delete preset "${current.name}"?`)) {
            return;
        }

        delete settings.presets[currentKey];
        settings.currentPreset = ensureCurrentPresetKey();
        selectedPromptIndex = 0;
        selectedRegexIndex = 0;
        selectedTemplateIndex = 0;
        selectedTemplatePromptIndex = 0;
        editingPromptIndex = null;
        editingRegexIndex = null;
        editingTemplateIndex = null;
        editingTemplatePromptIndex = null;
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

    $('#custom_generation_list_export_cancel').on('click', () => {
        closeListExportDialog();
    });

    $('#custom_generation_list_export_confirm').on('click', () => {
        confirmListExport();
    });

    $('#custom_generation_import_prompt').on('click', () => {
        const input = document.getElementById('custom_generation_prompt_import_input');
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        input.value = '';
        input.click();
    });

    $('#custom_generation_prompt_import_input').on('change', async () => {
        const input = document.getElementById('custom_generation_prompt_import_input');
        if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
            return;
        }

        const file = input.files[0];
        try {
            await importListFromFile('prompt', file);
            window.alert('Prompts imported successfully.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Unknown import error');
            window.alert(`Import failed: ${message}`);
        } finally {
            input.value = '';
        }
    });

    $('#custom_generation_export_prompt').on('click', () => {
        openPromptExportDialogForPreset();
    });

    $('#custom_generation_import_regex').on('click', () => {
        const input = document.getElementById('custom_generation_regex_import_input');
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        input.value = '';
        input.click();
    });

    $('#custom_generation_regex_import_input').on('change', async () => {
        const input = document.getElementById('custom_generation_regex_import_input');
        if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
            return;
        }

        const file = input.files[0];
        try {
            await importListFromFile('regex', file);
            window.alert('Regex scripts imported successfully.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Unknown import error');
            window.alert(`Import failed: ${message}`);
        } finally {
            input.value = '';
        }
    });

    $('#custom_generation_export_regex').on('click', () => {
        openRegexExportDialogForPreset();
    });

    $('#custom_generation_import_template').on('click', () => {
        const input = document.getElementById('custom_generation_template_import_input');
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        input.value = '';
        input.click();
    });

    $('#custom_generation_template_import_input').on('change', async () => {
        const input = document.getElementById('custom_generation_template_import_input');
        if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
            return;
        }

        const file = input.files[0];
        try {
            await importListFromFile('template', file);
            window.alert('Templates imported successfully.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? 'Unknown import error');
            window.alert(`Import failed: ${message}`);
        } finally {
            input.value = '';
        }
    });

    $('#custom_generation_export_template').on('click', () => {
        openTemplateExportDialogForPreset();
    });

    $('#custom_generation_add_prompt').on('click', () => {
        resetPromptCreationState();
        creatingPromptDraft = normalizePrompt({
            name: 'Unnamed Prompt',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: null,
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
            maxDepth: 999,
        }, 'Prompt');
        isCreatingPrompt = true;
        editingPromptIndex = null;
        promptEditorTarget = 'preset';
        updatePromptEditor();
        openDialog('#custom_generation_prompt_dialog');
    });

    $('#custom_generation_add_regex').on('click', () => {
        resetRegexCreationState();
        creatingRegexDraft = normalizeRegex({
            name: '',
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
        }, 'Regex');
        isCreatingRegex = true;
        editingRegexIndex = null;
        updateRegexEditor();
        openDialog('#custom_generation_regex_dialog');
    });

    $('#custom_generation_add_template').on('click', () => {
        resetTemplateCreationState();
        resetTemplateEditorDraft();
        creatingTemplateDraft = normalizeTemplate(clone(defaultTemplate));
        isCreatingTemplate = true;
        editingTemplateIndex = null;
        selectedTemplatePromptIndex = 0;
        editingTemplatePromptIndex = null;
        promptEditorTarget = 'template';
        updateTemplateEditor();
        openDialog('#custom_generation_template_dialog');
    });

    $('#custom_generation_prompt_injection_position').on('change', () => {
        if (isUpdatingUI) {
            return;
        }

        const position = String($('#custom_generation_prompt_injection_position').val() ?? 'relative');
        updatePromptInjectionControlsVisibility(position);
    });

    $('#custom_generation_prompt_internal').on('change', () => {
        if (isUpdatingUI) {
            return;
        }

        const internal = normalizePromptInternal($('#custom_generation_prompt_internal').val());
        updatePromptInternalControls(internal);
    });

    $('#custom_generation_prompt_cancel').on('click', () => {
        closePromptEditor();
    });

    $('#custom_generation_prompt_save').on('click', () => {
        savePromptEditor();
    });

    $('#custom_generation_prompt_save_as').on('click', () => {
        savePromptEditor(true);
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

    $('#custom_generation_regex_save_as').on('click', () => {
        saveRegexEditor(true);
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

    $('#custom_generation_template_save_as').on('click', () => {
        saveTemplateEditor(true);
    });

    $('#custom_generation_template_delete').on('click', () => {
        deleteTemplateFromEditor();
    });

    const templateDraftSelectors = [
        '#custom_generation_template_decorator',
        '#custom_generation_template_tag',
        '#custom_generation_template_filters',
        '#custom_generation_template_regex',
        '#custom_generation_template_find_regex',
        '#custom_generation_template_retry_count',
        '#custom_generation_template_retry_interval',
    ];

    for (const selector of templateDraftSelectors) {
        $(selector).on('input', () => {
            if (isUpdatingUI || editingTemplateIndex === null) {
                return;
            }
            syncTemplateEditorDraft();
        });

        $(selector).on('change', () => {
            if (isUpdatingUI || editingTemplateIndex === null) {
                return;
            }
            syncTemplateEditorDraft();
        });
    }

    $('#custom_generation_template_add_prompt').on('click', () => {
        const template = getEditingTemplate();
        if (!template) {
            return;
        }

        resetTemplatePromptCreationState();
        creatingTemplatePromptDraft = normalizePrompt({
            name: '',
            role: 'user',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: null,
            injectionDepth: DEFAULT_DEPTH,
            injectionOrder: DEFAULT_WEIGHT,
            maxDepth: 999,
        }, 'Prompt');
        isCreatingTemplatePrompt = true;
        promptEditorTarget = 'template';
        editingTemplatePromptIndex = null;
        selectedTemplatePromptIndex = template.prompts.length;
        updatePromptEditor();
        openDialog('#custom_generation_prompt_dialog');
    });

    $('#custom_generation_prompt_dialog').on('close', () => {
        editingPromptIndex = null;
        editingTemplatePromptIndex = null;
        promptEditorTarget = 'preset';
        resetPromptCreationState();
        resetTemplatePromptCreationState();
    });

    $('#custom_generation_regex_dialog').on('close', () => {
        editingRegexIndex = null;
        resetRegexCreationState();
    });

    $('#custom_generation_template_dialog').on('close', () => {
        editingTemplateIndex = null;
        selectedTemplatePromptIndex = 0;
        editingTemplatePromptIndex = null;
        promptEditorTarget = 'preset';
        resetTemplateCreationState();
        resetTemplateEditorDraft();
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
    selectedTemplateIndex = clamp(selectedTemplateIndex, 0, Math.max(0, getTemplateCount(currentPreset) - 1));

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
    $('#custom_generation_stream').prop('checked', settings.stream);
    $('#custom_generation_max_concurrency').val(settings.maxConcurrency);
    $('#custom_generation_prompt_post_processing').val(settings.promptPostProcessing);
    $('#custom_generation_include_headers_yaml').val(stringifyYamlRecord(settings.includeHeaders));
    $('#custom_generation_include_body_yaml').val(stringifyYamlRecord(settings.includeBody));
    $('#custom_generation_exclude_body_yaml').val(stringifyYamlRecord(settings.excludeBody));

    updateModelSelectOptions();

    const presetSelect = $('#custom_generation_preset_select');
    presetSelect.empty();
    getPresetKeys().forEach((presetKey) => {
        presetSelect.append(`<option value="${presetKey}">${presetKey}</option>`);
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
    const templateEntries = getTemplateEntries(currentPreset);
    if (templateEntries.length === 0) {
        templateList.text(String(templateList.attr('no-items-text') ?? 'No templates'));
    } else {
        templateEntries.forEach((entry, index) => {
            templateList.append(buildTemplateRow(entry, index));
        });
    }

    initSortableLists();

    updatePresetSummary(currentPreset);

    isUpdatingUI = false;

    if (editingPromptIndex !== null || isCreatingPrompt) {
        if (isCreatingPrompt || currentPreset.prompts[editingPromptIndex ?? -1]) {
            updatePromptEditor();
        } else {
            closePromptEditor();
        }
    }

    if (editingRegexIndex !== null || isCreatingRegex) {
        if (isCreatingRegex || currentPreset.regexs[editingRegexIndex ?? -1]) {
            updateRegexEditor();
        } else {
            closeRegexEditor();
        }
    }

    if (editingTemplateIndex !== null || isCreatingTemplate) {
        const nextTemplateEntries = getTemplateEntries(currentPreset);
        if (isCreatingTemplate || nextTemplateEntries[editingTemplateIndex ?? -1]) {
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

