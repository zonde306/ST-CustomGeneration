import { eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../../extensions.js';
import * as YAML from 'yaml';

interface PresetPrompt {
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
}

interface RegEx {
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

interface Preset {
    // preset group name (displayed in the UI)
    name: string;

    // preset prompts
    prompts: PresetPrompt[];

    // preset regexs
    regexs: RegEx[];
}

interface Settings {
    // Custom Endpoint (Base URL)
    baseUrl: string;

    // Custom API Key (Optional)
    apiKey: string;

    // Model ID
    model: string;

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

const defaultPreset: Preset = {
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
        },
        {
            name: 'World Info (before)',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'worldInfoBefore',
        },
        {
            name: 'Persona Description',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'personaDescription',
        },
        {
            name: 'Char Description',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'charDescription',
        },
        {
            name: 'Char Personality',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'charPersonality',
        },
        {
            name: 'Scenario',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'scenario',
        },
        {
            name: 'Enhance Definitions',
            role: 'system',
            triggers: [],
            prompt: 'If you have more knowledge of {{char}}, add to the character\'s lore and personality to enhance them but keep the Character Sheet\'s definitions absolute.',
            injectionPosition: 'relative',
            enabled: false,
            internal: null,
        },
        {
            name: 'Auxiliary Prompt',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: null,
        },
        {
            name: 'World Info (after)',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'worldInfoAfter',
        },
        {
            name: 'Chat Examples',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'chatExamples',
        },
        {
            name: 'Chat History',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: 'chatHistory',
        },
        {
            name: 'Post-History Instructions (jailbreak)',
            role: 'system',
            triggers: [],
            prompt: '',
            injectionPosition: 'relative',
            enabled: true,
            internal: null,
        },
    ],
    regexs: [],
};

const defaultSettings: Settings = {
    baseUrl: 'http://localhost:8080/v1',
    apiKey: '',
    model: 'None',
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
let isUpdatingUI = false;
let isEventsBound = false;

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

function normalizeRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return clone(value as Record<string, unknown>);
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

function normalizePreset(input: Partial<Preset>, fallbackName: string): Preset {
    const prompts = Array.isArray(input.prompts)
        ? input.prompts.map((prompt, index) => normalizePrompt(prompt, `Prompt ${index + 1}`))
        : clone(defaultPreset.prompts);

    const regexs = Array.isArray(input.regexs)
        ? input.regexs.map((regex, index) => normalizeRegex(regex, `Regex ${index + 1}`))
        : [];

    return {
        name: sanitizePresetName(String(input.name ?? ''), fallbackName),
        prompts,
        regexs,
    };
}

function ensureSettingsIntegrity(resetSelections: boolean = false) {
    settings.baseUrl = String(settings.baseUrl ?? defaultSettings.baseUrl);
    settings.apiKey = String(settings.apiKey ?? '');
    settings.model = String(settings.model ?? 'None');
    settings.includeHeaders = normalizeRecord(settings.includeHeaders);
    settings.includeBody = normalizeRecord(settings.includeBody);
    settings.excludeBody = normalizeRecord(settings.excludeBody);

    if (!['none', 'merge', 'semi', 'strict', 'single'].includes(settings.promptPostProcessing)) {
        settings.promptPostProcessing = 'none';
    }

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

function buildPromptRow(prompt: PresetPrompt, index: number) {
    const item = $('<div class="menu_button flex-container alignItemsCenter justifySpaceBetween"></div>');
    item.toggleClass('active', index === selectedPromptIndex);

    const left = $('<div class="flex1"></div>');
    left.text(prompt.name || `Prompt ${index + 1}`);

    const right = $('<small class="text_muted"></small>');
    const roleLabel = prompt.role.toUpperCase();
    const stateLabel = prompt.enabled === null ? 'hidden' : (prompt.enabled ? 'on' : 'off');
    right.text(`${roleLabel} · ${stateLabel}`);

    item.append(left, right);
    item.on('click', () => {
        selectedPromptIndex = index;
        updateSettingsUI();
    });

    return item;
}

function buildRegexRow(regex: RegEx, index: number) {
    const item = $('<div class="menu_button flex-container alignItemsCenter justifySpaceBetween"></div>');
    item.toggleClass('active', index === selectedRegexIndex);

    const left = $('<div class="flex1"></div>');
    left.text(regex.name || `Regex ${index + 1}`);

    const right = $('<small class="text_muted"></small>');
    right.text(regex.enabled ? 'enabled' : 'disabled');

    item.append(left, right);
    item.on('click', () => {
        selectedRegexIndex = index;
        updateSettingsUI();
    });

    return item;
}

function updatePresetSummary(preset: Preset) {
    const enabledPromptCount = preset.prompts.filter(x => x.enabled === true).length;
    const enabledRegexCount = preset.regexs.filter(x => x.enabled).length;

    $('#custom_generation_preset_summary').text(
        `Prompts: ${preset.prompts.length} (enabled: ${enabledPromptCount}) · Regex: ${preset.regexs.length} (enabled: ${enabledRegexCount})`,
    );
}

function setPromptEditorEnabled(enabled: boolean) {
    const selectors = [
        '#custom_generation_prompt_name',
        '#custom_generation_prompt_role',
        '#custom_generation_prompt_injection_position',
        '#custom_generation_prompt_triggers',
        '#custom_generation_prompt_enable',
        '#custom_generation_prompt_content',
        '#custom_generation_prompt_delete',
    ];

    for (const selector of selectors) {
        $(selector).prop('disabled', !enabled);
    }
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
    ];

    for (const selector of selectors) {
        $(selector).prop('disabled', !enabled);
    }
}

function updatePromptEditor(preset: Preset) {
    const prompt = preset.prompts[selectedPromptIndex];

    isUpdatingUI = true;

    if (!prompt) {
        setPromptEditorEnabled(false);
        $('#custom_generation_prompt_name').val('');
        $('#custom_generation_prompt_role').val('system');
        $('#custom_generation_prompt_injection_position').val('relative');
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
    $('#custom_generation_prompt_triggers').val(prompt.triggers.join(', '));
    $('#custom_generation_prompt_enable').prop('checked', prompt.enabled === null ? false : prompt.enabled);
    $('#custom_generation_prompt_content').val(prompt.prompt);

    isUpdatingUI = false;
}

function updateRegexEditor(preset: Preset) {
    const regex = preset.regexs[selectedRegexIndex];

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

function applyPromptEditorChanges() {
    if (isUpdatingUI) {
        return;
    }

    const preset = getCurrentPreset();
    const prompt = preset.prompts[selectedPromptIndex];
    if (!prompt) {
        return;
    }

    prompt.name = sanitizePresetName(String($('#custom_generation_prompt_name').val() ?? ''), `Prompt ${selectedPromptIndex + 1}`);

    const role = String($('#custom_generation_prompt_role').val() ?? 'system');
    prompt.role = role === 'assistant' || role === 'user' ? role : 'system';

    const position = String($('#custom_generation_prompt_injection_position').val() ?? 'relative');
    prompt.injectionPosition = position === 'inChat' ? 'inChat' : 'relative';

    const triggersRaw = String($('#custom_generation_prompt_triggers').val() ?? '');
    prompt.triggers = triggersRaw.split(',').map(x => x.trim()).filter(Boolean);

    prompt.enabled = Boolean($('#custom_generation_prompt_enable').prop('checked'));
    prompt.prompt = String($('#custom_generation_prompt_content').val() ?? '');

    updateSettingsUI();
    saveSettings();
}

function applyRegexEditorChanges() {
    if (isUpdatingUI) {
        return;
    }

    const preset = getCurrentPreset();
    const regex = preset.regexs[selectedRegexIndex];
    if (!regex) {
        return;
    }

    regex.name = sanitizePresetName(String($('#custom_generation_regex_name').val() ?? ''), `Regex ${selectedRegexIndex + 1}`);
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

    updateSettingsUI();
    saveSettings();
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
        saveSettings();
    });

    $('#custom_generation_prompt_post_processing').on('change', () => {
        const value = String($('#custom_generation_prompt_post_processing').val() ?? 'none');
        settings.promptPostProcessing = ['none', 'merge', 'semi', 'strict', 'single'].includes(value)
            ? value as Settings['promptPostProcessing']
            : 'none';
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
        updateSettingsUI();
        saveSettings();
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
    });

    $('#custom_generation_prompt_delete').on('click', () => {
        const preset = getCurrentPreset();
        if (!preset.prompts.length) {
            return;
        }

        const prompt = preset.prompts[selectedPromptIndex];
        if (!prompt) {
            return;
        }

        if (!window.confirm(`Delete prompt "${prompt.name}"?`)) {
            return;
        }

        preset.prompts.splice(selectedPromptIndex, 1);
        selectedPromptIndex = clamp(selectedPromptIndex, 0, Math.max(0, preset.prompts.length - 1));
        updateSettingsUI();
        saveSettings();
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
    });

    $('#custom_generation_regex_delete').on('click', () => {
        const preset = getCurrentPreset();
        if (!preset.regexs.length) {
            return;
        }

        const regex = preset.regexs[selectedRegexIndex];
        if (!regex) {
            return;
        }

        if (!window.confirm(`Delete regex "${regex.name}"?`)) {
            return;
        }

        preset.regexs.splice(selectedRegexIndex, 1);
        selectedRegexIndex = clamp(selectedRegexIndex, 0, Math.max(0, preset.regexs.length - 1));
        updateSettingsUI();
        saveSettings();
    });

    const promptEditorSelectors = [
        '#custom_generation_prompt_name',
        '#custom_generation_prompt_role',
        '#custom_generation_prompt_injection_position',
        '#custom_generation_prompt_triggers',
        '#custom_generation_prompt_enable',
        '#custom_generation_prompt_content',
    ];
    for (const selector of promptEditorSelectors) {
        $(selector).on('input change', applyPromptEditorChanges);
    }

    const regexEditorSelectors = [
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
    ];
    for (const selector of regexEditorSelectors) {
        $(selector).on('input change', applyRegexEditorChanges);
    }
}

/**
 * Setup settings UI
 */
export async function setupSettings() {
    // Inject settings into the page
    if (!$('#custom_generation_settings').length) {
        $('#extensions_settings').append(await renderExtensionTemplateAsync('third-party/ST-CustomGeneration', 'settings'));
    }

    bindEvents();
    eventSource.on(event_types.SETTINGS_LOADED, onSettingsLoaded);
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

    isUpdatingUI = true;

    $('#custom_generation_base_url').val(settings.baseUrl);
    $('#custom_generation_api_key').val(settings.apiKey);
    $('#custom_generation_model').val(settings.model);
    $('#custom_generation_prompt_post_processing').val(settings.promptPostProcessing);
    $('#custom_generation_include_headers_yaml').val(stringifyYamlRecord(settings.includeHeaders));
    $('#custom_generation_include_body_yaml').val(stringifyYamlRecord(settings.includeBody));
    $('#custom_generation_exclude_body_yaml').val(stringifyYamlRecord(settings.excludeBody));

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

    updatePresetSummary(currentPreset);

    isUpdatingUI = false;

    updatePromptEditor(currentPreset);
    updateRegexEditor(currentPreset);
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
