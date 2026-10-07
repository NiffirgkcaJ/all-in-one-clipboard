import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { clipboardSetContent, clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardBaseWidgetFactory } from '../view/clipboardBaseWidgetFactory.js';
import { ClipboardIcons } from '../constants/clipboardConstants.js';
import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationItemActions } from '../integrations/clipboardIntegrationItemActions.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardIntegrationViewText } from '../integrations/clipboardIntegrationViewText.js';
import { HtmlProcessor } from '../processors/clipboardHtmlProcessor.js';
import { ClipboardPriority, ClipboardStyling, ClipboardType } from '../constants/clipboardPluginConstants.js';

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
        ...ClipboardIntegrationViewText(),
        configureView: (config, item) => {
            config.text = item.preview || item.text || '';
        },
        ...ClipboardIntegrationItemActions({
            customActions: (item, context) => {
                const buttons = [];
                const { settings, onItemCopy, styleOptions } = context;
                if (!settings || !onItemCopy) return buttons;

                const isPerItem = settings.get_string('clipboard-paste-accessibility') === 'per-item';
                const showFormatButton = isPerItem && settings.get_boolean('clipboard-show-format-paste-button');

                if (showFormatButton) {
                    const isDefaultRich = settings.get_string('clipboard-paste-format') === 'rich';
                    const iconDef = isDefaultRich ? ClipboardIcons.ACTION_PASTE_PLAIN : ClipboardIcons.ACTION_PASTE_RICH;
                    const tooltip = isDefaultRich ? _('Paste as Plain Text') : _('Paste as Rich Text');

                    buttons.push(
                        ClipboardBaseWidgetFactory.createActionButton({
                            icon: iconDef,
                            tooltip,
                            action: 'format-paste',
                            styleOptions,
                            onClick: () => onItemCopy(item, { asRichText: !isDefaultRich }),
                        }),
                    );
                }

                const showImageButton = Boolean(item.has_images) && settings.get_boolean('clipboard-show-image-paste-button');
                if (showImageButton) {
                    buttons.push(
                        ClipboardBaseWidgetFactory.createActionButton({
                            icon: ClipboardIcons.ACTION_PASTE_IMAGE,
                            tooltip: _('Paste Images'),
                            action: 'image-paste',
                            styleOptions,
                            onClick: () => onItemCopy(item, { asImages: true }),
                        }),
                    );
                }

                return buttons;
            },
        }),
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            pasteShortcut: (item, options) => {
                const wantsImages = options?.asImages || (options?.actionBarPasteMode === 'image' && item?.has_images);
                return wantsImages ? 'ctrl-v' : 'shift-insert';
            },
            mergeBehavior: 'text',
            copyItem: async (item, { manager, storage, asImages, asRichText, settings, actionBarPasteMode }) => {
                const wantsImages = asImages ?? (actionBarPasteMode === 'image' && item?.has_images);
                if (wantsImages && item.has_images) {
                    const images = await HtmlProcessor.extractEmbeddedImages(item, storage);
                    if (images.length > 0) {
                        const firstImage = images[0];
                        manager.captureGuard.registerHash(firstImage.hash);
                        clipboardSetContent(firstImage.mimetype, firstImage.data);
                        return true;
                    }
                }

                const wantsRichText = asRichText ?? (actionBarPasteMode ? actionBarPasteMode === 'rich' : settings?.get_string('clipboard-paste-format') !== 'plain');
                if (wantsRichText) {
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
            getCopyQueue: async (item, { manager, storage, asImages, actionBarPasteMode }) => {
                const wantsImages = asImages ?? (actionBarPasteMode === 'image' && item?.has_images);
                if (!wantsImages || !item.has_images) return null;

                const images = await HtmlProcessor.extractEmbeddedImages(item, storage);
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
            getMergeText: async (item, { textContents }) => {
                return textContents.get(item.id) || item.preview || item.text || '';
            },
        },
    };
}
