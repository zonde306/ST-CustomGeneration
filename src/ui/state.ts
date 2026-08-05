import { saveSettingsDebounced } from '@st/script.js';
import { extension_settings } from '@st/scripts/extensions.js';
import { DEFAULT_DEPTH, DEFAULT_WEIGHT } from '@st/scripts/world-info.js';
import { z } from 'zod';
import { KNOWN_DECORATORS } from '@/functions/worldinfo';
import { TOOL_DEFINITION } from '@/features/tool-manager';
import { ApiSettings, Preset, PresetPrompt, RegEx, Settings, StorageSettings, Template, ToolSettings } from '@/utils/defines';
import { defaultApiName, defaultApiSettings, defaultPreset, defaultSettings, defaultStorageSettings, defaultTemplate, defaultToolSettings } from '@/utils/default-settings';
import { clone, isRecord, normalizeFileMap, normalizeRecord, parseNumber, sanitizeName } from '@/utils/values';
import { withUiUpdate } from '@/ui/common';

export const settings: Settings = clone(defaultSettings);

export const ALL_DECORATORS = Array.from(KNOWN_DECORATORS);
export const DEFAULT_TRIGGER_DECORATOR = ALL_DECORATORS[0] as Template['binding'];
/** Profile kinds selectable in the template editor. */
export const PROFILE_KIND_OPTIONS = ['trigger', 'agent'];
export const PROMPT_TRIGGER_OPTIONS = [
    'normal', 'regenerate', 'swipe', 'continue',
    'agent',
    ...ALL_DECORATORS.map(decorator => `trigger:${decorator}`),
];

/**
 * Migrate a legacy `PresetPrompt.triggers` / `ToolSettings.triggers` value to
 * the namespaced form: bare decorators become `trigger:@@x`, `@@agent` becomes
 * the kind-level `agent`. Generation types (normal/swipe/...) are unchanged.
 */
export function migrateTriggerValue(value: string): string {
    if (value === '@@agent') {
        return 'agent';
    }

    if (value.startsWith('@@')) {
        return `trigger:${value}`;
    }

    return value;
}

function generateProfileId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

export type TriggerEntry = { key: string; template: Template };
export type ToolEntry = { key: string; settings: ToolSettings };

// ============================================
// Section registry
// ============================================

export interface SettingsSection {
    /** Repaints the section from the current settings. */
    render: () => void;
    /** Drops selection/editing state, e.g. after switching or importing a preset. */
    reset?: () => void;
}

const sections: SettingsSection[] = [];

export function registerSection(section: SettingsSection): void {
    sections.push(section);
}

export function resetSectionStates(): void {
    sections.forEach(section => section.reset?.());
}

export function updateSettingsUI(): void {
    ensureSettingsIntegrity();
    withUiUpdate(() => {
        sections.forEach(section => section.render());
    });
}

export function saveSettings(): void {
    // @ts-expect-error: Storage configured, but type not specified.
    if (!extension_settings.CustomGeneration) {
        // @ts-expect-error: Storage configured, but type not specified.
        extension_settings.CustomGeneration = {};
    }

    ensureSettingsIntegrity();

    // @ts-expect-error: Storage configured, but type not specified.
    Object.assign(extension_settings.CustomGeneration, clone(settings));
    saveSettingsDebounced();
}

/** Repaints the settings UI and persists the current settings. */
export function commitSettings(): void {
    updateSettingsUI();
    saveSettings();
}

// ============================================
// Normalizers
// ============================================

export function normalizePromptInternal(value: unknown): PresetPrompt['internal'] {
    const text = String(value ?? '').trim();
    return text ? text as PresetPrompt['internal'] : null;
}

export function normalizePrompt(input: Partial<PresetPrompt>, fallbackName: string): PresetPrompt {
    return {
        name: sanitizeName(String(input.name ?? ''), fallbackName),
        role: input.role === 'assistant' || input.role === 'user' ? input.role : 'system',
        triggers: Array.isArray(input.triggers)
            ? input.triggers.map(x => migrateTriggerValue(String(x).trim())).filter(Boolean)
            : [],
        prompt: String(input.prompt ?? ''),
        injectionPosition: input.injectionPosition === 'inChat' ? 'inChat' : 'relative',
        enabled: input.enabled === null ? null : Boolean(input.enabled),
        internal: normalizePromptInternal(input.internal),
        injectionDepth: parseNumber(input.injectionDepth, DEFAULT_DEPTH, 0, 9999, true),
        injectionOrder: parseNumber(input.injectionOrder, DEFAULT_WEIGHT, -1_000_000, 1_000_000, true),
        maxDepth: parseNumber(input.maxDepth, 999, 0, 9999, true),
        scan: Boolean(input.scan),
    };
}

export function normalizeRegex(input: Partial<RegEx>, fallbackName: string): RegEx {
    return {
        name: sanitizeName(String(input.name ?? ''), fallbackName),
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

function normalizeTriggerPrompts(raw: unknown): PresetPrompt[] {
    if (Array.isArray(raw)) {
        return raw.map((prompt, index) => normalizePrompt(
            isRecord(prompt) ? prompt as Partial<PresetPrompt> : {},
            `Template Prompt ${index + 1}`,
        ));
    }

    if (raw === undefined || raw === null) {
        return clone(defaultTemplate.prompts);
    }

    return [normalizePrompt({
        name: 'Template Prompt',
        role: 'user',
        prompt: String(raw ?? ''),
        enabled: true,
    }, 'Template Prompt')];
}

export function normalizeTrigger(input: Partial<Template>): Template {
    const legacyContent = (input as { content?: unknown }).content;
    // Legacy field: `decorator` was the binding key before kind/binding existed.
    const legacyDecorator = String((input as { decorator?: unknown }).decorator ?? '');

    let kind = String(input.kind ?? '').trim();
    let binding = String(input.binding ?? legacyDecorator ?? '').trim();

    if (!kind) {
        // Versioned migration: '@@agent' profiles become kind 'agent' (binding = agent name from tag),
        // everything else was a WI trigger.
        if (binding === '@@agent') {
            kind = 'agent';
            binding = String(input.tag ?? '').trim();
            input = { ...input, tag: '' };
        } else {
            kind = 'trigger';
        }
    }

    if (kind === 'trigger') {
        binding = ALL_DECORATORS.includes(binding as Template['binding'])
            ? binding
            : DEFAULT_TRIGGER_DECORATOR;
    }

    return {
        id: String(input.id ?? '').trim() || generateProfileId(),
        kind,
        binding,
        tag: String(input.tag ?? ''),
        prompts: normalizeTriggerPrompts((input as { prompts?: unknown }).prompts ?? legacyContent),
        regex: String(input.regex ?? ''),
        findRegex: String(input.findRegex ?? ''),
        filters: Array.isArray(input.filters)
            ? input.filters.map(value => String(value).trim()).filter(Boolean) as Template['filters']
            : [],
        retryCount: parseNumber(input.retryCount, defaultTemplate.retryCount, 0, 9999, true),
        retryInterval: parseNumber(input.retryInterval, defaultTemplate.retryInterval, 0, 86_400_000, true),
    };
}

export function normalizeToolSettings(raw: unknown): ToolSettings {
    if (!isRecord(raw)) {
        return clone(defaultToolSettings);
    }

    const toolSetting = raw as Partial<ToolSettings>;
    return {
        enabled: Boolean(toolSetting.enabled),
        triggers: Array.isArray(toolSetting.triggers)
            ? toolSetting.triggers.map(x => migrateTriggerValue(String(x).trim())).filter(Boolean)
            : [],
        parameters: isRecord(toolSetting.parameters)
            ? Object.fromEntries(Object.entries(toolSetting.parameters).map(([key, value]) => [key, String(value ?? '')]))
            : {},
        description: String(toolSetting.description ?? ''),
    };
}

function normalizeTriggers(raw: unknown): Record<string, Template> {
    const triggers: Template[] = [];

    const collect = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(collect);
            return;
        }

        if (isRecord(value)) {
            triggers.push(normalizeTrigger(value as Partial<Template>));
        }
    };

    if (Array.isArray(raw)) {
        raw.forEach(collect);
    } else if (isRecord(raw)) {
        Object.values(raw).forEach(collect);
    }

    return buildTriggerMap(triggers);
}

function normalizeToolMap(raw: unknown): Record<string, ToolSettings> {
    const result: Record<string, ToolSettings> = {};

    if (!isRecord(raw)) {
        return result;
    }

    Object.entries(raw).forEach(([key, value]) => {
        if (isRecord(value)) {
            result[key] = normalizeToolSettings(value);
        }
    });

    return result;
}

export function normalizePreset(input: Partial<Preset>, fallbackName: string): Preset {
    return {
        name: sanitizeName(String(input.name ?? ''), fallbackName),
        prompts: Array.isArray(input.prompts)
            ? input.prompts.map((prompt, index) => normalizePrompt(prompt, `Prompt ${index + 1}`))
            : clone(defaultPreset.prompts),
        regexs: Array.isArray(input.regexs)
            ? input.regexs.map((regex, index) => normalizeRegex(regex, `Regex ${index + 1}`))
            : [],
        templates: normalizeTriggers((input as { templates?: unknown }).templates),
        tools: normalizeToolMap((input as { tools?: unknown }).tools),
        // Must be normalized here, or importing a preset silently drops its files.
        files: normalizeFileMap((input as { files?: unknown }).files),
    };
}

export function normalizePresetMap(raw: unknown): Record<string, Preset> {
    const result: Record<string, Preset> = {};

    const add = (preset: Preset) => {
        const key = sanitizeName(preset.name, 'Preset');
        preset.name = key;
        result[key] = preset;
    };

    if (Array.isArray(raw)) {
        raw.forEach((preset, index) => {
            add(normalizePreset(isRecord(preset) ? preset as Partial<Preset> : {}, `Preset ${index + 1}`));
        });
        return result;
    }

    if (!isRecord(raw)) {
        return result;
    }

    Object.entries(raw).forEach(([key, value]) => {
        const fallbackName = sanitizeName(key, 'Preset');
        if (Array.isArray(value)) {
            const first = value.find(isRecord);
            if (first) {
                add(normalizePreset(first as Partial<Preset>, fallbackName));
            }
            return;
        }

        if (isRecord(value)) {
            add(normalizePreset(value as Partial<Preset>, fallbackName));
        }
    });

    return result;
}

export function parsePromptPostProcessing(value: unknown): ApiSettings['promptPostProcessing'] {
    const text = String(value ?? 'none');
    return ['none', 'merge', 'semi', 'strict', 'single'].includes(text)
        ? text as ApiSettings['promptPostProcessing']
        : 'none';
}

export function normalizeApiSettings(input: Partial<ApiSettings>): ApiSettings {
    return {
        baseUrl: String(input.baseUrl ?? defaultApiSettings.baseUrl),
        apiKey: String(input.apiKey ?? ''),
        model: String(input.model ?? 'None'),
        contextSize: parseNumber(input.contextSize, defaultApiSettings.contextSize, 1, 1_000_000, true),
        maxTokens: parseNumber(input.maxTokens, defaultApiSettings.maxTokens, 1, 1_000_000, true),
        temperature: parseNumber(input.temperature, defaultApiSettings.temperature, 0, 2, false),
        topK: parseNumber(input.topK, defaultApiSettings.topK, 0, 1_000_000, true),
        topP: parseNumber(input.topP, defaultApiSettings.topP, 0, 1, false),
        frequencyPenalty: parseNumber(input.frequencyPenalty, defaultApiSettings.frequencyPenalty, -2, 2, false),
        presencePenalty: parseNumber(input.presencePenalty, defaultApiSettings.presencePenalty, -2, 2, false),
        stream: Boolean(input.stream),
        includeHeaders: normalizeRecord(input.includeHeaders),
        includeBody: normalizeRecord(input.includeBody),
        excludeBody: normalizeRecord(input.excludeBody),
        promptPostProcessing: parsePromptPostProcessing(input.promptPostProcessing),
        linkedPreset: String(input.linkedPreset ?? ''),
        maxConcurrency: parseNumber(input.maxConcurrency, defaultApiSettings.maxConcurrency, 1, 100, true),
    };
}

export function normalizeApiMap(raw: unknown): Record<string, ApiSettings> {
    const result: Record<string, ApiSettings> = {};

    if (!isRecord(raw)) {
        return result;
    }

    Object.entries(raw).forEach(([key, value]) => {
        if (isRecord(value)) {
            result[sanitizeName(key, 'Connection')] = normalizeApiSettings(value as Partial<ApiSettings>);
        }
    });

    return result;
}

// ============================================
// Preset accessors
// ============================================

export function getPresetKeys(): string[] {
    return Object.keys(settings.presets ?? {});
}

export function ensureCurrentPresetKey(): string {
    const keys = getPresetKeys();
    if (keys.length === 0) {
        settings.presets = {
            [defaultPreset.name]: clone(defaultPreset),
        };
        return defaultPreset.name;
    }

    const current = String(settings.currentPreset ?? '').trim();
    return current && settings.presets[current] ? current : keys[0];
}

export function getCurrentPreset(): Preset {
    const key = ensureCurrentPresetKey();
    settings.currentPreset = key;

    let preset = settings.presets[key];
    if (!preset) {
        preset = clone(defaultPreset);
        settings.presets[key] = preset;
    }

    return preset;
}

export function uniquePresetName(baseName: string): string {
    return uniqueKey(baseName, 'Preset', new Set(getPresetKeys()));
}

// ============================================
// API connection accessors
// ============================================

export function getApiKeys(): string[] {
    return Object.keys(settings.apis ?? {});
}

export function ensureCurrentApiKey(): string {
    const keys = getApiKeys();
    if (keys.length === 0) {
        settings.apis = {
            [defaultApiName]: clone(defaultApiSettings),
        };
        return defaultApiName;
    }

    const current = String(settings.currentApi ?? '').trim();
    return current && settings.apis[current] ? current : keys[0];
}

export function getCurrentApi(): ApiSettings {
    const key = ensureCurrentApiKey();
    settings.currentApi = key;

    let api = settings.apis[key];
    if (!api) {
        api = clone(defaultApiSettings);
        settings.apis[key] = api;
    }

    return api;
}

export function uniqueApiName(baseName: string): string {
    return uniqueKey(baseName, 'Connection', new Set(getApiKeys()));
}

function uniqueKey(baseName: string, fallback: string, existing: Set<string>): string {
    const base = sanitizeName(baseName, fallback);
    if (!existing.has(base)) {
        return base;
    }

    let suffix = 2;
    while (existing.has(`${base} ${suffix}`)) {
        suffix++;
    }

    return `${base} ${suffix}`;
}

// ============================================
// Trigger accessors
// ============================================

export function buildTriggerMatchKey(trigger: Template): string {
    return `${trigger.kind}:${trigger.binding}:${String(trigger.tag ?? '')}`;
}

export function getTriggerKey(trigger: Template, existingKeys: Iterable<string> = [], preferredKey: string | null = null): string {
    const baseKey = buildTriggerMatchKey(trigger);
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

export function buildTriggerMap(triggers: Template[], existingKeys: Iterable<string> = []): Record<string, Template> {
    const map: Record<string, Template> = {};
    const taken = new Set(Array.from(existingKeys, key => String(key)));

    for (const trigger of triggers) {
        const key = getTriggerKey(trigger, taken);
        map[key] = trigger;
        taken.add(key);
    }

    return map;
}

export function getTriggerEntries(preset: Preset = getCurrentPreset()): TriggerEntry[] {
    return Object.entries(preset.templates ?? {})
        .filter(([, template]) => Boolean(template))
        .map(([key, template]) => ({ key, template }));
}

export function getTriggerCount(preset: Preset = getCurrentPreset()): number {
    return getTriggerEntries(preset).length;
}

// ============================================
// Tool accessors
// ============================================

export function getToolKeys(): string[] {
    return Array.from(TOOL_DEFINITION.keys());
}

export function getToolEntries(): ToolEntry[] {
    const preset = getCurrentPreset();
    if (!preset.tools) {
        preset.tools = {};
    }

    return getToolKeys().map(key => ({
        key,
        settings: preset.tools[key] ?? clone(defaultToolSettings),
    }));
}

/**
 * Extract default parameter descriptions from a Zod schema.
 */
function extractDefaultParameters(schema: z.ZodSchema | undefined): Record<string, string> {
    if (!schema) {
        return {};
    }

    try {
        const properties = schema.toJSONSchema()?.properties ?? {};
        const result: Record<string, string> = {};

        for (const [key, value] of Object.entries(properties)) {
            if (isRecord(value) && 'description' in value) {
                result[key] = String(value.description ?? '');
            }
        }

        return result;
    } catch {
        return {};
    }
}

/**
 * Add tools newly declared in TOOL_DEFINITION and drop obsolete ones.
 */
function syncToolsWithDefinitions(): void {
    const preset = getCurrentPreset();
    if (!preset.tools) {
        preset.tools = {};
    }

    const definedToolKeys = getToolKeys();

    for (const key of definedToolKeys) {
        if (!preset.tools[key]) {
            const toolDef = TOOL_DEFINITION.get(key);
            preset.tools[key] = {
                enabled: false,
                triggers: [],
                description: toolDef?.description ?? '',
                parameters: extractDefaultParameters(toolDef?.parameters),
            };
        }
    }

    for (const key of Object.keys(preset.tools)) {
        // TODO: Compatibility with agent router
        if (!definedToolKeys.includes(key)) {
            delete preset.tools[key];
        }
    }
}

// ============================================
// Integrity
// ============================================

/** Tools replaced by the virtual file system, and their replacements. */
const LEGACY_FS_TOOLS = ['get_worldinfo', 'search_worldinfo', 'set_worldinfo'];
const FS_TOOLS = ['list_dir', 'read_file', 'search_files', 'write_file', 'edit_file'];

function normalizeStorageSettings(): void {
    const storage = isRecord(settings.storage) ? settings.storage : {} as Partial<StorageSettings>;

    settings.storage = {
        autoCompact: storage.autoCompact ?? defaultStorageSettings.autoCompact,
        keepDepth: parseNumber(storage.keepDepth, defaultStorageSettings.keepDepth, 1, 100000, true),
        sizeThreshold: parseNumber(storage.sizeThreshold, defaultStorageSettings.sizeThreshold, 0, Number.MAX_SAFE_INTEGER, true),
        pruneLegacy: storage.pruneLegacy ?? defaultStorageSettings.pruneLegacy,
        fuzzyIndexFiles: storage.fuzzyIndexFiles ?? defaultStorageSettings.fuzzyIndexFiles,
    };
}

/**
 * One-off migrations. Enabling the file tools for anyone who had the World Info
 * tools enabled keeps existing presets working, since tool settings are keyed by
 * tool name and the old names are now deprecated shims.
 */
function applyMigrations(): void {
    if (!isRecord(settings.migrations)) {
        settings.migrations = {};
    }

    if (!settings.migrations['fs-tools']) {
        for (const preset of Object.values(settings.presets)) {
            if (!preset.tools)
                continue;

            const enabled = LEGACY_FS_TOOLS.some(name => preset.tools[name]?.enabled);
            if (!enabled)
                continue;

            const triggers = LEGACY_FS_TOOLS.map(name => preset.tools[name]).find(t => t?.enabled)?.triggers ?? [];
            for (const name of FS_TOOLS) {
                if (!preset.tools[name]) {
                    preset.tools[name] = clone(defaultToolSettings);
                }

                const tool = preset.tools[name];
                if (!tool.enabled) {
                    tool.enabled = true;
                    tool.triggers = [...triggers];
                }
            }
        }

        settings.migrations['fs-tools'] = true;
    }
}

export function ensureSettingsIntegrity(): void {
    settings.interceptGenerate = Boolean(settings.interceptGenerate);
    normalizeStorageSettings();
    settings.apis = normalizeApiMap(settings.apis);
    if (Object.keys(settings.apis).length === 0) {
        settings.apis = {
            [defaultApiName]: clone(defaultApiSettings),
        };
    }
    settings.currentApi = ensureCurrentApiKey();

    settings.presets = normalizePresetMap(settings.presets);
    if (Object.keys(settings.presets).length === 0) {
        settings.presets = {
            [defaultPreset.name]: clone(defaultPreset),
        };
    }
    settings.currentPreset = ensureCurrentPresetKey();

    syncToolsWithDefinitions();
    applyMigrations();
}
