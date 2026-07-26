import { yaml } from '@st/lib.js';
import { ApiConfig, generate as runGenerate } from '@/functions/generate';
import { ApiExportPayload, ApiImportPayload, ApiSettings } from '@/utils/defines';
import { defaultApiSettings } from '@/utils/default-settings';
import { clone, getErrorMessage, getPreviewText, isRecord, parseNumber, parseYamlRecord, sanitizeName, stringifyYamlRecord } from '@/utils/values';
import { bindFileImport, downloadJson, readJsonFile, setDrawerExpanded } from '@/ui/common';
import {
    commitSettings,
    ensureCurrentApiKey,
    getApiKeys,
    getCurrentApi,
    normalizeApiMap,
    parsePromptPostProcessing,
    registerSection,
    resetSectionStates,
    saveSettings,
    settings,
    uniqueApiName,
} from '@/ui/state';

const apiExportSchemaVersion = '1.0.0';

let modelCandidates: string[] = [];
let isConnectionActionInProgress = false;

// ============================================
// Numeric / boolean field bindings
// ============================================

type NumericField = {
    selector: string;
    key: keyof Pick<ApiSettings, 'contextSize' | 'maxTokens' | 'temperature' | 'topK' | 'topP' | 'frequencyPenalty' | 'presencePenalty' | 'maxConcurrency'>;
    min: number;
    max: number;
    integer: boolean;
};

const numericFields: NumericField[] = [
    { selector: '#custom_generation_context_size', key: 'contextSize', min: 1, max: 1_000_000, integer: true },
    { selector: '#custom_generation_max_tokens', key: 'maxTokens', min: 1, max: 1_000_000, integer: true },
    { selector: '#custom_generation_temperature', key: 'temperature', min: 0, max: 2, integer: false },
    { selector: '#custom_generation_top_k', key: 'topK', min: 0, max: 1_000_000, integer: true },
    { selector: '#custom_generation_top_p', key: 'topP', min: 0, max: 1, integer: false },
    { selector: '#custom_generation_frequency_penalty', key: 'frequencyPenalty', min: -2, max: 2, integer: false },
    { selector: '#custom_generation_presence_penalty', key: 'presencePenalty', min: -2, max: 2, integer: false },
    { selector: '#custom_generation_max_concurrency', key: 'maxConcurrency', min: 1, max: 100, integer: true },
];

const yamlFields: Array<{ selector: string; key: keyof Pick<ApiSettings, 'includeHeaders' | 'includeBody' | 'excludeBody'>; label: string }> = [
    { selector: '#custom_generation_include_headers_yaml', key: 'includeHeaders', label: 'Request Headers' },
    { selector: '#custom_generation_include_body_yaml', key: 'includeBody', label: 'Request Body' },
    { selector: '#custom_generation_exclude_body_yaml', key: 'excludeBody', label: 'Exclude Body Keys' },
];

// ============================================
// Model list / connection tests
// ============================================

function updateModelSelectOptions(): void {
    const modelSelect = $('#custom_generation_model_select');
    const currentModel = String(getCurrentApi().model ?? '').trim();
    const candidates = new Set(modelCandidates.map(x => x.trim()).filter(Boolean));

    modelSelect.empty();

    if (candidates.size === 0) {
        modelSelect.append('<option value="" data-i18n="(No models loaded)">(No models loaded)</option>');
    } else {
        modelSelect.append('<option value="" data-i18n="(Select a model)">(Select a model)</option>');
        for (const candidate of candidates) {
            modelSelect.append(`<option value="${candidate}">${candidate}</option>`);
        }
    }

    if (currentModel && !candidates.has(currentModel)) {
        modelSelect.append(`<option value="${currentModel}">${currentModel} (custom)</option>`);
        candidates.add(currentModel);
    }

    modelSelect.val(currentModel && candidates.has(currentModel) ? currentModel : '');
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
    const api = getCurrentApi();
    return {
        baseUrl: String($('#custom_generation_base_url').val() ?? api.baseUrl ?? '').trim(),
        apiKey: String($('#custom_generation_api_key').val() ?? api.apiKey ?? '').trim(),
        model: String($('#custom_generation_model').val() ?? api.model ?? '').trim(),
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

    return typeof payload.message === 'string' ? payload.message.trim() : '';
}

function extractCompletionText(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload;
    }

    if (!isRecord(payload)) {
        return '';
    }

    if (Array.isArray(payload.choices) && payload.choices.length > 0) {
        const firstChoice = payload.choices[0] as any;
        const content = firstChoice?.message?.content ?? firstChoice?.text;
        if (typeof content === 'string') {
            return content;
        }
    }

    return typeof payload.output_text === 'string' ? payload.output_text : '';
}

function buildRequestHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    for (const [key, value] of Object.entries(getCurrentApi().includeHeaders ?? {})) {
        const headerName = key.trim();
        if (headerName && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
            headers[headerName] = String(value);
        }
    }

    const hasAuthorizationHeader = Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
    if (apiKey && !hasAuthorizationHeader) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
}

const TEST_PROMPT = 'This is a connection test. Reply with "OK" only.';

function buildDirectTestBody(model: string): Record<string, unknown> {
    const api = getCurrentApi();
    const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        stream: false,
        max_tokens: Math.max(1, Math.min(api.maxTokens, 64)),
        temperature: 0,
        ...clone(api.includeBody),
    };

    for (const key of Object.keys(api.excludeBody ?? {})) {
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

    const response = await fetch(buildConnectionUrl(baseUrl, '/chat/completions'), {
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
        throw new Error(errorMessage
            ? `Request failed (${response.status}): ${errorMessage}`
            : `Request failed (${response.status}).`);
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

    const api = getCurrentApi();
    const apiConfig: ApiConfig = {
        url: baseUrl,
        key: apiKey,
        model,
        type: 'test-connection',
        stream: api.stream,
        max_context: api.contextSize,
        max_tokens: Math.max(1, Math.min(api.maxTokens, 64)),
        temperature: api.temperature,
        top_k: api.topK,
        top_p: api.topP,
        frequency_penalty: api.frequencyPenalty,
        presence_penalty: api.presencePenalty,
        custom_include_body: yaml.stringify(api.includeBody),
        custom_exclude_body: yaml.stringify(api.excludeBody),
        custom_include_headers: yaml.stringify(api.includeHeaders),
    };

    const messages: ChatCompletionMessage[] = [{ role: 'user', content: TEST_PROMPT }];
    const response = await runGenerate(messages, { api: apiConfig, taskId: 'test-connection' });
    const responseList = Array.isArray(response) ? response : [response];
    return responseList.map(item => String(item ?? '').trim()).find(Boolean) ?? '';
}

/**
 * Runs a connection action while reporting its progress to the status line and toasts.
 */
async function runConnectionAction(pendingMessage: string, action: () => Promise<string>, describe: (result: string) => string, failurePrefix: string): Promise<void> {
    if (isConnectionActionInProgress) {
        return;
    }

    const status = $('#custom_generation_model_connect_status');
    status.text(pendingMessage);
    setConnectionControlsBusy(true);

    try {
        const message = describe(await action());
        status.text(message);
        toastr.success(message);
    } catch (error) {
        const message = getErrorMessage(error);
        status.text(`${failurePrefix}: ${message}`);
        toastr.error(message);
    } finally {
        setConnectionControlsBusy(false);
    }
}

async function loadModelList(): Promise<string> {
    const { baseUrl, apiKey } = getConnectionFormValues();
    if (!baseUrl) {
        throw new Error('Base URL is required.');
    }

    const response = await fetch(buildConnectionUrl(baseUrl, '/models'), {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });

    if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
    }

    const payload = await response.json();
    const candidates = (Array.isArray(payload?.data) ? payload.data : [])
        .map((entry: any) => String(entry?.id ?? '').trim())
        .filter(Boolean);

    if (candidates.length === 0) {
        throw new Error('No models returned from server.');
    }

    modelCandidates = candidates;
    updateModelSelectOptions();
    return String(candidates.length);
}

// ============================================
// Import / export
// ============================================

function exportApiPresets(): void {
    const payload: ApiExportPayload = {
        version: apiExportSchemaVersion,
        apis: clone(settings.apis),
        currentApi: settings.currentApi,
    };

    downloadJson(`st-custom-generation-apis-${Date.now()}.json`, payload);
}

async function importApiPresetsFromFile(file: File): Promise<void> {
    const raw = await readJsonFile(file);
    if (!isRecord(raw)) {
        throw new Error('Invalid JSON payload.');
    }

    const payload = raw as ApiImportPayload;
    if (!isRecord(payload.apis)) {
        throw new Error('Invalid import format: apis is required.');
    }

    const apis = normalizeApiMap(payload.apis);
    if (Object.keys(apis).length === 0) {
        throw new Error('Invalid import format: apis cannot be empty.');
    }

    const currentApi = String(payload.currentApi ?? Object.keys(apis)[0]);
    if (!apis[currentApi]) {
        throw new Error('Invalid import format: currentApi does not exist in apis.');
    }

    Object.assign(settings.apis, apis);
    settings.currentApi = currentApi;

    resetSectionStates();
    commitSettings();
    window.alert('API connections imported successfully.');
}

// ============================================
// Setup
// ============================================

export function setupConnectionSection(): void {
    setDrawerExpanded('#custom_generation_advanced_params_body', '#custom_generation_advanced_params_icon', false);

    $('#custom_generation_advanced_params_toggle').on('click', () => {
        setDrawerExpanded(
            '#custom_generation_advanced_params_body',
            '#custom_generation_advanced_params_icon',
            !$('#custom_generation_advanced_params_body').is(':visible'),
        );
    });

    $('#custom_generation_api_select').on('change', () => {
        const key = String($('#custom_generation_api_select').val() ?? '').trim();
        settings.currentApi = key && settings.apis[key] ? key : ensureCurrentApiKey();

        // Auto-switch to the linked preset, if any.
        const api = getCurrentApi();
        if (api.linkedPreset && settings.presets[api.linkedPreset]) {
            settings.currentPreset = api.linkedPreset;
            resetSectionStates();
        }

        commitSettings();
    });

    $('#custom_generation_api_new').on('click', () => {
        const name = window.prompt('Connection name', uniqueApiName('Connection'));
        if (name === null) {
            return;
        }

        const apiName = uniqueApiName(name);
        settings.apis[apiName] = clone(defaultApiSettings);
        settings.currentApi = apiName;
        commitSettings();
    });

    $('#custom_generation_api_duplicate').on('click', () => {
        const duplicated = clone(getCurrentApi());
        const newName = uniqueApiName(`${settings.currentApi} Copy`);
        settings.apis[newName] = duplicated;
        settings.currentApi = newName;
        commitSettings();
    });

    $('#custom_generation_api_rename').on('click', () => {
        const currentKey = ensureCurrentApiKey();
        const name = window.prompt('Rename connection', currentKey);
        if (name === null) {
            return;
        }

        const nextName = sanitizeName(name, currentKey);
        if (nextName !== currentKey) {
            const current = getCurrentApi();
            delete settings.apis[currentKey];
            settings.apis[nextName] = current;
            settings.currentApi = nextName;
        }

        commitSettings();
    });

    $('#custom_generation_api_delete').on('click', () => {
        if (getApiKeys().length <= 1) {
            window.alert('At least one connection must remain.');
            return;
        }

        const currentKey = ensureCurrentApiKey();
        if (!window.confirm(`Delete connection "${currentKey}"?`)) {
            return;
        }

        delete settings.apis[currentKey];
        settings.currentApi = ensureCurrentApiKey();
        commitSettings();
    });

    bindFileImport('#custom_generation_api_import', 'custom_generation_api_import_input', importApiPresetsFromFile);

    $('#custom_generation_api_export').on('click', () => {
        exportApiPresets();
    });

    $('#custom_generation_base_url').on('input', () => {
        getCurrentApi().baseUrl = String($('#custom_generation_base_url').val() ?? defaultApiSettings.baseUrl);
        saveSettings();
    });

    $('#custom_generation_api_key').on('input', () => {
        getCurrentApi().apiKey = String($('#custom_generation_api_key').val() ?? '');
        saveSettings();
    });

    $('#custom_generation_model').on('input', () => {
        getCurrentApi().model = String($('#custom_generation_model').val() ?? 'None');
        updateModelSelectOptions();
        saveSettings();
    });

    for (const field of numericFields) {
        $(field.selector).on('input', () => {
            const api = getCurrentApi();
            api[field.key] = parseNumber($(field.selector).val(), defaultApiSettings[field.key], field.min, field.max, field.integer);
            saveSettings();
        });
    }

    $('#custom_generation_stream').on('change', () => {
        getCurrentApi().stream = Boolean($('#custom_generation_stream').prop('checked'));
        saveSettings();
    });

    $('#custom_generation_prompt_post_processing').on('change', () => {
        getCurrentApi().promptPostProcessing = parsePromptPostProcessing($('#custom_generation_prompt_post_processing').val());
        saveSettings();
    });

    for (const field of yamlFields) {
        $(field.selector).on('change', () => {
            try {
                getCurrentApi()[field.key] = parseYamlRecord($(field.selector).val());
                saveSettings();
            } catch (error) {
                window.alert(`${field.label} YAML parse failed: ${getErrorMessage(error, 'Unknown YAML parse error')}`);
                commitSettings();
            }
        });
    }

    $('#custom_generation_model_select').on('change', () => {
        const value = String($('#custom_generation_model_select').val() ?? '').trim();
        if (!value) {
            return;
        }

        getCurrentApi().model = value;
        $('#custom_generation_model').val(value);
        saveSettings();
    });

    $('#custom_generation_model_connect').on('click', () => {
        runConnectionAction(
            'Loading models...',
            loadModelList,
            count => `Loaded ${count} models.`,
            'Connect failed',
        );
    });

    $('#custom_generation_test_direct').on('click', () => {
        runConnectionAction(
            'Testing /chat/completions...',
            testDirectChatCompletionsConnection,
            (result) => {
                const preview = getPreviewText(result);
                return preview ? `Direct test passed: ${preview}` : 'Direct test passed.';
            },
            'Direct test failed',
        );
    });

    $('#custom_generation_test_generate').on('click', () => {
        runConnectionAction(
            'Testing via generate()...',
            testGenerateConnection,
            (result) => {
                const preview = getPreviewText(result);
                return preview ? `Generate test passed: ${preview}` : 'Generate test passed.';
            },
            'Generate test failed',
        );
    });

    registerSection({
        render: () => {
            const api = getCurrentApi();

            const apiSelect = $('#custom_generation_api_select');
            apiSelect.empty();
            getApiKeys().forEach((apiKey) => {
                apiSelect.append(`<option value="${apiKey}">${apiKey}</option>`);
            });
            apiSelect.val(String(settings.currentApi));

            $('#custom_generation_base_url').val(api.baseUrl);
            $('#custom_generation_api_key').val(api.apiKey);
            $('#custom_generation_model').val(api.model);
            $('#custom_generation_stream').prop('checked', api.stream);
            $('#custom_generation_prompt_post_processing').val(api.promptPostProcessing);

            for (const field of numericFields) {
                $(field.selector).val(api[field.key]);
            }

            for (const field of yamlFields) {
                $(field.selector).val(stringifyYamlRecord(api[field.key]));
            }

            updateModelSelectOptions();
        },
    });
}
