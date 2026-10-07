import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationGeneratedFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardIntegrationViewSwatch } from '../integrations/clipboardIntegrationViewSwatch.js';
import { ColorProcessor } from '../processors/clipboardColorProcessor.js';
import { ClipboardPriority, ClipboardStyling, ClipboardType } from '../constants/clipboardPluginConstants.js';

/**
 * Create the color clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionColor() {
    return {
        id: ClipboardType.COLOR,
        priority: ClipboardPriority[ClipboardType.COLOR],
        styling: ClipboardStyling[ClipboardType.COLOR],
        processText: (text, { imagesDir }) => ColorProcessor.process(text, imagesDir),
        createItem: ClipboardIntegrationInlineItem({
            fields: ['subtype', 'color_value', 'format_type', 'hash', 'gradient_filename'],
            defaults: {
                subtype: 'single',
            },
            previewField: 'color_value',
        }),
        healItem: ClipboardIntegrationGeneratedFileHealing({
            fileField: 'gradient_filename',
            dirKey: 'imagesDir',
            regenerate: (item, { storage }) => ColorProcessor.regenerateGradient(item, storage.imagesDir),
        }),
        storageOptions: ClipboardIntegrationStorage({
            files: [
                {
                    dirKey: 'imagesDir',
                    resolveFilename: (item) => item.gradient_filename,
                },
            ],
        }),
        ...ClipboardIntegrationViewSwatch({
            resolveFilename: (item) => item.gradient_filename,
        }),
        getSearchTerms: (item) => [item.color_value],
        copyOptions: {
            pasteShortcut: 'shift-insert',
            mergeBehavior: 'text',
            copyItem: async (item, { manager }) => {
                manager.captureGuard.registerText(item.color_value);
                clipboardSetText(item.color_value);
                return true;
            },
            getMergeText: (item) => item.color_value,
        },
        configureView: (config, item, options) => {
            config.title = item.color_value;
            config.subtitle = item.format_type;
            config.cssColor = item.color_value;

            if (options.style?.subtypes && options.style.subtypes[item.subtype]) {
                config.icon = options.style.subtypes[item.subtype].icon;
            }
        },
    };
}
