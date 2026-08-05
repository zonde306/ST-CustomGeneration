import { ExportPayload, ImportPayload, Preset } from '@/utils/defines';
import { defaultPreset } from '@/utils/default-settings';
import { convertPreset } from '@/utils/compatibility';
import { clamp, clone, isRecord, normalizeRecord, parseNumber, sanitizeName } from '@/utils/values';
import { bindFileImport, closeDialog, downloadJson, openDialog, readJsonFile } from '@/ui/common';
import {
    commitSettings,
    ensureCurrentPresetKey,
    getCurrentApi,
    getCurrentPreset,
    getPresetKeys,
    getTriggerCount,
    normalizePreset,
    normalizePresetMap,
    parsePromptPostProcessing,
    registerSection,
    resetSectionStates,
    settings,
    uniquePresetName,
} from '@/ui/state';

const exportSchemaVersion = '1.0.0';

// ============================================
// Import / export
// ============================================

function openExportDialog(): void {
    $('#custom_generation_export_include_api_connection').prop('checked', false);
    openDialog('#custom_generation_export_dialog');
}

function confirmExport(): void {
    const api = getCurrentApi();
    const payload: ExportPayload = {
        version: exportSchemaVersion,
        presets: clone([settings.presets[settings.currentPreset]]),
        currentPreset: 0,
    };

    if ($('#custom_generation_export_include_api_connection').prop('checked')) {
        payload.apiConnection = {
            baseUrl: api.baseUrl,
            model: api.model,
            contextSize: api.contextSize,
            maxTokens: api.maxTokens,
            temperature: api.temperature,
            topK: api.topK,
            topP: api.topP,
            frequencyPenalty: api.frequencyPenalty,
            presencePenalty: api.presencePenalty,
            promptPostProcessing: api.promptPostProcessing,
            includeHeaders: clone(api.includeHeaders),
            includeBody: clone(api.includeBody),
            excludeBody: clone(api.excludeBody),
            maxConcurrency: api.maxConcurrency,
            stream: api.stream,
        };
    }

    closeDialog('#custom_generation_export_dialog');
    downloadJson(`st-custom-generation-presets-${Date.now()}.json`, payload);
}

function parseImportPayload(raw: unknown, name: string): {
    presets: Preset[];
    currentPreset: number;
    apiConnection: ImportPayload['apiConnection'] | null;
} {
    if (!isRecord(raw)) {
        throw new Error('Invalid JSON payload.');
    }

    // SillyTavern chat completion preset
    if (raw.chat_completion_source) {
        const { api, preset } = convertPreset(raw);
        preset.name = name;
        api.linkedPreset = name;
        return { presets: [preset], apiConnection: api, currentPreset: 0 };
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
    return {
        presets,
        currentPreset: Number.isFinite(currentPresetRaw)
            ? clamp(Math.trunc(currentPresetRaw), 0, presets.length - 1)
            : 0,
        apiConnection: isRecord(payload.apiConnection) ? payload.apiConnection : null,
    };
}

function applyImportedApiConnection(connection: NonNullable<ImportPayload['apiConnection']>): void {
    const api = getCurrentApi();
    const previousApiKey = api.apiKey;

    api.baseUrl = String(connection.baseUrl ?? api.baseUrl);
    api.model = String(connection.model ?? api.model);
    api.contextSize = parseNumber(connection.contextSize, api.contextSize, 1, 1_000_000, true);
    api.maxTokens = parseNumber(connection.maxTokens, api.maxTokens, 1, 1_000_000, true);
    api.temperature = parseNumber(connection.temperature, api.temperature, 0, 2, false);
    api.topK = parseNumber(connection.topK, api.topK, 0, 1_000_000, true);
    api.topP = parseNumber(connection.topP, api.topP, 0, 1, false);
    api.frequencyPenalty = parseNumber(connection.frequencyPenalty, api.frequencyPenalty, -2, 2, false);
    api.presencePenalty = parseNumber(connection.presencePenalty, api.presencePenalty, -2, 2, false);
    api.promptPostProcessing = parsePromptPostProcessing(connection.promptPostProcessing);
    api.includeHeaders = normalizeRecord(connection.includeHeaders);
    api.includeBody = normalizeRecord(connection.includeBody);
    api.excludeBody = normalizeRecord(connection.excludeBody);
    api.maxConcurrency = parseNumber(connection.maxConcurrency, api.maxConcurrency, 1, 100, true);
    api.stream = Boolean(connection.stream);
    api.apiKey = previousApiKey;
}

async function importPresetsFromFile(file: File): Promise<void> {
    const normalized = parseImportPayload(await readJsonFile(file), file.name.replace(/\.json$/i, ''));
    const presetMap = normalizePresetMap(normalized.presets);
    const mapKeys = Object.keys(presetMap);

    Object.assign(settings.presets, presetMap);
    settings.currentPreset = mapKeys[normalized.currentPreset] ?? mapKeys[0] ?? settings.currentPreset;

    if (normalized.apiConnection) {
        applyImportedApiConnection(normalized.apiConnection);
    }

    resetSectionStates();
    commitSettings();
    window.alert('Presets imported successfully.');
}

// ============================================
// Setup
// ============================================

export function setupPresetSection(): void {
    $('#custom_generation_preset_select').on('change', () => {
        const key = String($('#custom_generation_preset_select').val() ?? '').trim();
        settings.currentPreset = key && settings.presets[key] ? key : ensureCurrentPresetKey();
        resetSectionStates();

        // Auto-switch to the API connection that links to this preset.
        if (getCurrentApi().linkedPreset !== settings.currentPreset) {
            const linkedApi = Object.entries(settings.apis)
                .find(([, api]) => api.linkedPreset === settings.currentPreset);
            if (linkedApi) {
                settings.currentApi = linkedApi[0];
            }
        }

        commitSettings();
    });

    $('#custom_generation_link_preset').on('click', () => {
        const api = getCurrentApi();
        api.linkedPreset = api.linkedPreset === settings.currentPreset ? '' : settings.currentPreset;
        commitSettings();
    });

    $('#custom_generation_preset_new').on('click', () => {
        const name = window.prompt('Preset name', uniquePresetName('Preset'));
        if (name === null) {
            return;
        }

        const preset = clone(defaultPreset);
        preset.name = uniquePresetName(name);
        settings.presets[preset.name] = preset;
        settings.currentPreset = preset.name;
        resetSectionStates();
        commitSettings();
    });

    $('#custom_generation_preset_duplicate').on('click', () => {
        const current = getCurrentPreset();
        const duplicated = clone(current);
        duplicated.name = uniquePresetName(`${current.name} Copy`);
        settings.presets[duplicated.name] = duplicated;
        settings.currentPreset = duplicated.name;
        resetSectionStates();
        commitSettings();
    });

    $('#custom_generation_preset_rename').on('click', () => {
        const currentKey = ensureCurrentPresetKey();
        const current = getCurrentPreset();
        const name = window.prompt('Rename preset', current.name);
        if (name === null) {
            return;
        }

        const nextName = sanitizeName(name, current.name);
        current.name = nextName;

        if (nextName !== currentKey) {
            delete settings.presets[currentKey];
            settings.presets[nextName] = current;
            settings.currentPreset = nextName;
        }

        commitSettings();
    });

    $('#custom_generation_preset_delete').on('click', () => {
        if (getPresetKeys().length <= 1) {
            window.alert('At least one preset must remain.');
            return;
        }

        const currentKey = ensureCurrentPresetKey();
        if (!window.confirm(`Delete preset "${getCurrentPreset().name}"?`)) {
            return;
        }

        delete settings.presets[currentKey];
        settings.currentPreset = ensureCurrentPresetKey();
        resetSectionStates();
        commitSettings();
    });

    bindFileImport('#custom_generation_preset_import', 'custom_generation_preset_import_input', importPresetsFromFile);

    $('#custom_generation_preset_export').on('click', () => {
        openExportDialog();
    });

    $('#custom_generation_export_cancel').on('click', () => {
        closeDialog('#custom_generation_export_dialog');
    });

    $('#custom_generation_export_confirm').on('click', () => {
        confirmExport();
    });

    registerSection({
        render: () => {
            const preset = getCurrentPreset();

            const presetSelect = $('#custom_generation_preset_select');
            presetSelect.empty();
            getPresetKeys().forEach((presetKey) => {
                presetSelect.append(`<option value="${presetKey}">${presetKey}</option>`);
            });
            presetSelect.val(String(settings.currentPreset));

            const enabledPromptCount = preset.prompts.filter(x => x.enabled === true).length;
            const enabledRegexCount = preset.regexs.filter(x => x.enabled).length;
            $('#custom_generation_preset_summary').text(
                `Prompts: ${preset.prompts.length} (enabled: ${enabledPromptCount}) · Regex: ${preset.regexs.length} (enabled: ${enabledRegexCount}) · Templates: ${getTriggerCount(preset)}`,
            );

            const isLinked = Boolean(settings.currentPreset) && getCurrentApi().linkedPreset === settings.currentPreset;
            const linkButton = $('#custom_generation_link_preset');
            linkButton.toggleClass('fa-link', isLinked).toggleClass('fa-chain-broken', !isLinked);
            linkButton.css('color', isLinked ? 'var(--SmartThemeQuoteColor)' : '');
        },
    });
}
