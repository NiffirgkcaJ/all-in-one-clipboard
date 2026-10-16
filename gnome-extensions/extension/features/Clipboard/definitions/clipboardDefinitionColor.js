import GLib from 'gi://GLib';

import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationGeneratedFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ColorProcessor } from '../processors/clipboardColorProcessor.js';
import { GridMetrics, ListMetrics } from '../constants/clipboardLayoutConstants.js';
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
        viewType: 'tile',
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
        getViewFingerprint: (config, item) => {
            return [item.gradient_filename || '', config.cssColor || ''].join('|');
        },
        getViewMetadata: () => {
            return {
                isFullBleedGrid: true,
                gridHeight: GridMetrics.HEIGHT_DEFAULT,
                listHeight: ListMetrics.ITEM_HEIGHT,
            };
        },
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

            const filename = item.gradient_filename;
            const imagesDir = options.storage?.imagesDir;
            if (filename && imagesDir) {
                const gradientPath = GLib.build_filenamev([imagesDir, filename]);
                config.tileStyle = `background-image: url('file://${gradientPath}'); background-size: cover;`;
                config.gridTileStyle = `background-image: url('file://${gradientPath}'); background-size: contain; background-repeat: repeat;`;
            } else {
                const color = config.cssColor || '#000000';
                config.tileStyle = `background-color: ${color};`;
                config.gridTileStyle = config.cssColor ? `background-color: ${config.cssColor};` : '';
            }
        },
    };
}
