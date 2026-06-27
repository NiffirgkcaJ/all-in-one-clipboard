import { ClipboardIntegrationGeneratedFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ColorProcessor } from '../processors/clipboardColorProcessor.js';

/**
 * Create the color clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionColor() {
    return {
        id: 'color',
        priority: 60,
        styling: {
            icon: 'clipboard-type-color-pipette-symbolic.svg',
            iconSize: 16,
            layout: 'color',
            subtypes: {
                single: {
                    icon: 'clipboard-type-color-pipette-symbolic.svg',
                },
                gradient: {
                    icon: 'clipboard-type-color-gradient-symbolic.svg',
                },
                palette: {
                    icon: 'clipboard-type-color-palette-symbolic.svg',
                },
            },
        },
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
    };
}
