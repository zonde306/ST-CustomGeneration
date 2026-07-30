import { eventSource, event_types } from '@st/script.js';
import { extension_settings, renderExtensionTemplateAsync } from '@st/scripts/extensions.js';
import { t } from '@st/scripts/i18n.js';
import { TEMPLATE_FILTER_OPTIONS } from '@/utils/defines';
import { defaultSettings, templatePath } from '@/utils/default-settings';
import { openLargeEditor } from '@/utils/large-editor';
import { clone } from '@/utils/values';
import { bindDrawerToggle, initSelect2Multi, setDrawerExpanded } from '@/ui/common';
import { PROMPT_TRIGGER_OPTIONS, ensureSettingsIntegrity, registerSection, resetSectionStates, saveSettings, settings, updateSettingsUI } from '@/ui/state';
import { setupListExportDialog } from '@/ui/list-export';
import { setupConnectionSection } from '@/ui/connection';
import { setupPresetSection } from '@/ui/preset';
import { setupPromptSection } from '@/ui/prompt-modal';
import { setupRegexSection } from '@/ui/regex-modal';
import { fillDecoratorOptions, setupTriggerSection } from '@/ui/trigger-modal';
import { setupToolSection } from '@/ui/tool-modal';
import { setupFilesSection } from '@/ui/files';

export { settings, saveSettings, updateSettingsUI } from '@/ui/state';

const drawers: Array<{ toggle: string; body: string; icon: string }> = [
    { toggle: '#custom_generation_prompt_toggle', body: '#custom_generation_prompt_body', icon: '#custom_generation_prompt_icon' },
    { toggle: '#custom_generation_regex_toggle', body: '#custom_generation_regex_body', icon: '#custom_generation_regex_icon' },
    { toggle: '#custom_generation_template_toggle', body: '#custom_generation_template_body', icon: '#custom_generation_template_icon' },
    { toggle: '#custom_generation_tool_toggle', body: '#custom_generation_tool_body', icon: '#custom_generation_tool_icon' },
    { toggle: '#custom_generation_files_toggle', body: '#custom_generation_files_body', icon: '#custom_generation_files_icon' },
];

const modalTemplates: Array<{ dialog: string; template: string }> = [
    { dialog: '#custom_generation_prompt_dialog', template: 'prompt-modal' },
    { dialog: '#custom_generation_regex_dialog', template: 'regex-modal' },
    { dialog: '#custom_generation_template_dialog', template: 'trigger-modal' },
    { dialog: '#custom_generation_tool_dialog', template: 'tool-modal' },
    { dialog: '#custom_generation_large_editor_dialog', template: 'large-editor' },
];

async function injectModalTemplates(): Promise<void> {
    for (const modal of modalTemplates) {
        if (!$(modal.dialog).length) {
            $('#custom_generation_settings').append(await renderExtensionTemplateAsync(templatePath, modal.template));
        }
    }

    fillDecoratorOptions();

    initSelect2Multi('#custom_generation_prompt_triggers', PROMPT_TRIGGER_OPTIONS);
    initSelect2Multi('#custom_generation_template_filters', TEMPLATE_FILTER_OPTIONS);
    initSelect2Multi('#custom_generation_tool_triggers', PROMPT_TRIGGER_OPTIONS);
}

/**
 * Opens a large editor for any textarea/input referenced by a `data-target` attribute.
 */
function bindLargeEditorButtons(): void {
    $(document).on('click', '.custom_generation_large_editor_button', (event: JQuery.ClickEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const button = $(event.currentTarget);
        const targetId = button.attr('data-target');
        if (!targetId) {
            console.warn('[LargeEditor] Button missing data-target attribute');
            return;
        }

        const textarea = document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
        if (!textarea || !('value' in textarea)) {
            console.warn(`[LargeEditor] Target element not found or not a textarea: ${targetId}`);
            return;
        }

        if (textarea.disabled) {
            console.warn(`[LargeEditor] Target element is disabled: ${targetId}`);
            return;
        }

        const title = button.closest('label')?.find('span, small')?.text()?.trim() || t`Edit Content`;
        openLargeEditor(title, textarea.value ?? '', (newContent) => {
            textarea.value = newContent;
            // Trigger change event so existing handlers (YAML parsing, etc.) pick up the change
            $(textarea).trigger('change');
        });
    });
}

/**
 * "Replace default generation" (generate_interceptor takeover) checkbox
 */
function setupInterceptSection(): void {
    const checkbox = $('#custom_generation_intercept');

    checkbox.on('change', () => {
        settings.interceptGenerate = checkbox.prop('checked') === true;
        saveSettings();
    });

    registerSection({
        render: () => {
            checkbox.prop('checked', Boolean(settings.interceptGenerate));
        },
    });
}

/**
 * Setup settings UI
 */
export async function setupSettings(): Promise<void> {
    if (!$('#custom_generation_settings').length) {
        $('#extensions_settings2').append(await renderExtensionTemplateAsync(templatePath, 'settings'));
    }

    await injectModalTemplates();

    for (const drawer of drawers) {
        setDrawerExpanded(drawer.body, drawer.icon, false);
        bindDrawerToggle(drawer.toggle, drawer.body, drawer.icon);
    }

    setupInterceptSection();
    setupListExportDialog();
    setupConnectionSection();
    setupPresetSection();
    setupPromptSection();
    setupRegexSection();
    setupTriggerSection();
    setupToolSection();
    setupFilesSection();
    bindLargeEditorButtons();

    eventSource.on(event_types.SETTINGS_LOADED, onSettingsLoaded);
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, onSettingsLoaded);
    eventSource.on(event_types.APP_READY, onSettingsLoaded);
}

/**
 * Load settings from the extension storage
 */
export function loadSettings(restore: boolean = false): void {
    // @ts-expect-error: Storage configured, but type not specified.
    if (!extension_settings.CustomGeneration || restore) {
        // @ts-expect-error: Storage configured, but type not specified.
        extension_settings.CustomGeneration = clone(defaultSettings);
    }

    // @ts-expect-error: Storage configured, but type not specified.
    Object.assign(settings, clone(extension_settings.CustomGeneration));

    ensureSettingsIntegrity();
    resetSectionStates();
    updateSettingsUI();
}

function onSettingsLoaded(): void {
    loadSettings();
    console.log('Custom Generation loaded');
}
