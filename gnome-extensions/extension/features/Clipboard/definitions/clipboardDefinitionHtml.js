import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';
import { IOText } from '../../../shared/utilities/utilityIO.js';

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
 * Read stored HTML markup string from disk.
 *
 * @param {object} item Item with HTML content.
 * @param {object} storage Storage instance for reading files.
 * @returns {Promise<string|null>} Stored HTML string or null.
 */
async function _readStoredHtml(item, storage) {
    if (!item?.has_images || !storage) return null;

    const htmlPath = GLib.build_filenamev([storage.textsDir, `${item.id}.html`]);
    const rawBytes = await storage.readRaw(htmlPath);
    if (!rawBytes) return null;

    return IOText.parseBytes(rawBytes);
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

                // Button Actions
                const defaultFormat = settings.get_string('clipboard-html-default-format');
                const target = defaultFormat === 'rich' ? 'plain' : 'rich';

                const HTML_TARGET_ACTIONS = {
                    plain: {
                        icon: ClipboardIcons.ACTION_PASTE_HTML_PLAIN,
                        tooltip: _('Paste as Plain Text'),
                    },
                    rich: {
                        icon: ClipboardIcons.ACTION_PASTE_HTML_RICH,
                        tooltip: _('Paste as Rich HTML'),
                    },
                };

                const HTML_BUTTON_ACTIONS = {
                    format: {
                        icon: HTML_TARGET_ACTIONS[target].icon,
                        tooltip: HTML_TARGET_ACTIONS[target].tooltip,
                        action: 'paste-format',
                        target,
                    },
                    image: {
                        icon: ClipboardIcons.ACTION_PASTE_HTML_IMAGE,
                        tooltip: _('Paste Images'),
                        action: 'paste-image',
                        target: 'image',
                    },
                };

                const HTML_BUTTON_PERMISSIONS = {
                    format: () => settings.get_boolean('clipboard-html-show-format-button'),
                    image: () => item.has_images && settings.get_boolean('clipboard-html-show-image-button'),
                };

                const buttonOrder = settings.get_strv('clipboard-html-button-order');
                const activeButtons = buttonOrder.filter((buttonId) => {
                    const isAllowed = HTML_BUTTON_PERMISSIONS[buttonId];
                    return isAllowed ? isAllowed() : false;
                });

                for (const buttonId of activeButtons) {
                    const actionMeta = HTML_BUTTON_ACTIONS[buttonId];
                    if (!actionMeta) continue;

                    buttons.push(
                        ClipboardBaseWidgetFactory.createActionButton({
                            icon: actionMeta.icon,
                            tooltip: actionMeta.tooltip,
                            action: actionMeta.action,
                            styleOptions,
                            onClick: () => onItemCopy(item, { target: actionMeta.target }),
                        }),
                    );
                }

                return buttons;
            },
        }),
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            getPasteShortcut: (_item, options = {}) => {
                const target = options.target ?? options.settings.get_string('clipboard-html-default-format');
                return target === 'image' ? 'ctrl-v' : 'shift-insert';
            },
            copyMode: 'string',
            copyItemToClipboard: async (item, options = {}) => {
                const { manager, storage, settings, registry } = options;
                const target = options.target ?? settings.get_string('clipboard-html-default-format');

                if (target === 'image' && item.has_images) {
                    const htmlString = await _readStoredHtml(item, storage);
                    const sources = HtmlProcessor.parseImageSources(htmlString);
                    const images = (await ImageProcessor.extractIntents(sources.join('\n'))).slice(0, 1);
                    if (images.length > 0) {
                        return registry ? await registry.copyItemToClipboard(images[0], { ...options, target: 'image' }) : false;
                    }
                    return false;
                }

                if (target === 'rich') {
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

                return registry ? await registry.copyItemToClipboard({ ...item, type: ClipboardType.TEXT, text: content }, options) : false;
            },
            getCopyQueue: async (item, options = {}) => {
                const { storage, registry } = options;
                if (options.target !== 'image' || !item.has_images || !registry) return null;

                const htmlString = await _readStoredHtml(item, storage);
                const sources = HtmlProcessor.parseImageSources(htmlString);
                const images = await ImageProcessor.extractIntents(sources.join('\n'));
                if (images.length <= 1) return null;

                return images.map((image) => ({
                    pasteShortcut: 'ctrl-v',
                    execute: async () => {
                        return await registry.copyItemToClipboard(image, { ...options, target: 'image' });
                    },
                }));
            },
            serializeItem: async (item, options = {}) => {
                return options.textContents?.get(item.id) || item.text || item.preview || '';
            },
        },
    };
}
