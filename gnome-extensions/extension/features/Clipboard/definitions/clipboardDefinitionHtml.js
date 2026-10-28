import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { clipboardSetContent, clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardBaseWidgetFactory } from '../view/clipboardBaseWidgetFactory.js';
import { ClipboardIcons } from '../constants/clipboardConstants.js';
import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationItemActions } from '../integrations/clipboardIntegrationItemActions.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { HtmlProcessor } from '../processors/clipboardHtmlProcessor.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';
import { GridMetrics, ListMetrics } from '../constants/clipboardLayoutConstants.js';
import { ClipboardPriority, ClipboardStyling, ClipboardType } from '../constants/clipboardPluginConstants.js';

/**
 * Extract embedded images from a stored HTML item.
 *
 * @param {object} item Item with HTML content.
 * @param {object} storage Storage instance for reading files.
 * @param {number} [limit] Maximum number of images to fetch.
 * @returns {Promise<Array<object>>} Array of extracted image objects.
 */
async function extractEmbeddedImages(item, storage, limit) {
    const sources = await HtmlProcessor.extractImageSources(item, storage);
    if (sources.length === 0) return [];

    const candidates = typeof limit === 'number' && limit > 0 ? sources.slice(0, limit) : sources;
    const imageResults = await Promise.all(candidates.map((src) => ImageProcessor.fetchImageFromSource(src)));
    return imageResults.filter(Boolean);
}

/**
 * Create the HTML clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionHtml() {
    return {
        id: ClipboardType.HTML,
        priority: ClipboardPriority[ClipboardType.HTML],
        styling: ClipboardStyling[ClipboardType.HTML],
        viewType: 'label',
        extract: () => HtmlProcessor.extract(),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: HtmlProcessor,
            storageDirKey: 'textsDir',
        }),
        healItem: ClipboardIntegrationFileIntegrity({
            dirKey: 'textsDir',
            filenameResolver: (item) => `${item.id}.html`,
        }),
        storageOptions: ClipboardIntegrationStorage({
            files: [
                {
                    dirKey: 'textsDir',
                    resolveFilename: (item) => `${item.id}.html`,
                },
                {
                    dirKey: 'textsDir',
                    resolveFilename: (item) => `${item.id}.txt`,
                    shouldDelete: (item) => Boolean(item.has_full_content),
                    shouldCollect: (item) => Boolean(item.has_full_content),
                },
            ],
        }),
        hasFullContent: true,
        configureView: (config, item, options) => {
            const raw = (item.text || item.preview || '').replace(/\r?\n+$/, '');
            const previewLines = options.htmlPreviewLines;
            config.text = ProcessorUtils.clampLines(raw, previewLines);
        },
        getViewFingerprint: (config, _item, options) => {
            const lines = options.htmlPreviewLines || '';
            const floor = options.htmlEnforceDefaultHeight ? '1' : '0';
            return [config.text || '', lines, floor].join('|');
        },
        getViewMetadata: (_config, item, options) => {
            const raw = item.text || item.preview || '';
            const len = raw.length;
            let gridHeight = GridMetrics.LABEL_WEIGHTS.TINY.height;
            if (len > GridMetrics.LABEL_WEIGHTS.LONG.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.LONG.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.MEDIUM.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.MEDIUM.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.SHORT.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.SHORT.height;
            }

            const rawLines = ProcessorUtils.getLineCount(raw);
            const previewLines = options.htmlPreviewLines;
            const lines = previewLines !== undefined ? Math.min(rawLines, previewLines) : rawLines;
            const contentHeight = lines * ListMetrics.LINE_HEIGHT_LABEL + ListMetrics.ROW_PADDING_MARGIN_PX;
            const listHeight = options.htmlEnforceDefaultHeight ? Math.max(ListMetrics.ITEM_HEIGHT, contentHeight) : Math.max(ListMetrics.MIN_ITEM_HEIGHT, contentHeight);

            return {
                gridHeight,
                listHeight,
            };
        },
        ...ClipboardIntegrationItemActions({
            customActions: (item, context) => {
                if (item.is_corrupted) return [];

                const buttons = [];
                const { settings, onItemCopy, styleOptions } = context;

                // Format Action
                if (settings.get_boolean('clipboard-html-show-format-button')) {
                    const currentFormat = settings.get_string('clipboard-html-default-format');
                    const targetFormat = currentFormat === 'rich' ? 'plain' : 'rich';

                    const HTML_FORMAT_ACTIONS = {
                        plain: {
                            icon: ClipboardIcons.ACTION_PASTE_HTML_PLAIN,
                            tooltip: _('Paste as Plain Text'),
                        },
                        rich: {
                            icon: ClipboardIcons.ACTION_PASTE_HTML_RICH,
                            tooltip: _('Paste as Rich HTML'),
                        },
                    };

                    const actionMeta = HTML_FORMAT_ACTIONS[targetFormat];

                    buttons.push(
                        ClipboardBaseWidgetFactory.createActionButton({
                            icon: actionMeta.icon,
                            tooltip: actionMeta.tooltip,
                            action: 'paste-format',
                            styleOptions,
                            onClick: () => onItemCopy(item, { format: targetFormat }),
                        }),
                    );
                }

                // Image Action
                if (item.has_images && settings.get_boolean('clipboard-html-show-image-button')) {
                    buttons.push(
                        ClipboardBaseWidgetFactory.createActionButton({
                            icon: ClipboardIcons.ACTION_PASTE_HTML_IMAGE,
                            tooltip: _('Paste Images'),
                            action: 'paste-image',
                            styleOptions,
                            onClick: () => onItemCopy(item, { format: 'image' }),
                        }),
                    );
                }

                return buttons;
            },
        }),
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            getPasteShortcut: (_item, options = {}) => {
                const format = options.format || (options.settings ? options.settings.get_string('clipboard-html-default-format') : null);
                return format === 'image' ? 'ctrl-v' : 'shift-insert';
            },
            copyMode: 'string',
            copyItemToClipboard: async (item, options = {}) => {
                const { manager, storage, format, settings } = options;
                const targetFormat = format || (settings ? settings.get_string('clipboard-html-default-format') : 'rich');

                if (targetFormat === 'image' && item.has_images) {
                    const images = await extractEmbeddedImages(item, storage);
                    if (images.length > 0) {
                        const firstImage = images[0];
                        manager.captureGuard.registerHash(firstImage.hash);
                        clipboardSetContent(firstImage.mimetype, firstImage.data);
                        return true;
                    }
                }

                if (targetFormat === 'rich') {
                    const htmlPath = GLib.build_filenamev([storage.textsDir, `${item.id}.html`]);
                    const rawBytes = await storage.readRaw(htmlPath);
                    if (rawBytes) {
                        manager.captureGuard.registerHash(item.hash);
                        clipboardSetContent('text/html', new GLib.Bytes(rawBytes));
                        return true;
                    }
                }

                let content = item.text || (await manager.getContent(item.id));
                if (!content && item.preview) content = item.preview;
                if (!content) return false;
                manager.captureGuard.registerText(content);
                clipboardSetText(content);
                return true;
            },
            getCopyQueue: async (item, options = {}) => {
                const { manager, storage, format } = options;
                if (format !== 'image' || !item.has_images) return null;

                const images = await extractEmbeddedImages(item, storage);
                if (images.length <= 1) return null;

                return images.map((image) => ({
                    pasteShortcut: 'ctrl-v',
                    execute: async () => {
                        manager.captureGuard.registerHash(image.hash);
                        clipboardSetContent(image.mimetype, image.data);
                        return true;
                    },
                }));
            },
            serializeItem: async (item, options = {}) => {
                return options.textContents?.get(item.id) || item.text || item.preview || '';
            },
        },
    };
}
