import GLib from 'gi://GLib';

import { clipboardSetContent, clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardIntegrationViewText } from '../integrations/clipboardIntegrationViewText.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';
import { ClipboardType, ClipboardStyling, ClipboardPriority } from '../constants/clipboardPluginConstants.js';

/**
 * Create the text clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionText() {
    return {
        id: ClipboardType.TEXT,
        priority: ClipboardPriority[ClipboardType.TEXT],
        styling: ClipboardStyling[ClipboardType.TEXT],
        extract: () => TextProcessor.extract(),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: TextProcessor,
            storageDirKey: 'textsDir',
        }),
        healItem: ClipboardIntegrationFileIntegrity({
            dirKey: 'textsDir',
            filenameResolver: (item) => `${item.id}.txt`,
            shouldCheck: (item) => Boolean(item.has_full_content),
        }),
        storageOptions: ClipboardIntegrationStorage({
            files: [
                {
                    dirKey: 'textsDir',
                    resolveFilename: (item) => `${item.id}.txt`,
                    shouldDelete: (item) => Boolean(item.has_full_content),
                    shouldCollect: (item) => Boolean(item.has_full_content),
                },
                {
                    dirKey: 'textsDir',
                    resolveFilename: (item) => `${item.id}.html`,
                    shouldDelete: (item) => Boolean(item.has_rich_content),
                    shouldCollect: (item) => Boolean(item.has_rich_content),
                },
            ],
        }),
        hasFullContent: true,
        ...ClipboardIntegrationViewText(),
        configureView: (config, item, options) => {
            config.text = item.preview || item.text || '';
            if (item.has_rich_content && options.style?.subtypes?.html?.icon) {
                config.icon = options.style.subtypes.html.icon;
            }
        },
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            mergeBehavior: 'text',
            copyItem: async (item, { manager, storage, asRichText, asImages, options }) => {
                if (asImages && item.has_images) {
                    return await manager.pasteImagesFromItem(item, options);
                }
                if (asRichText && item.has_rich_content) {
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
            getMergeText: async (item, { textContents }) => {
                return textContents.get(item.id) || item.preview || item.text || '';
            },
        },
    };
}
