import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';
import { IOImage, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationImageFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationPreviewWarmup } from '../integrations/clipboardIntegrationPreviewWarmup.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { ClipboardType, ClipboardStyling, ClipboardPriority } from '../constants/clipboardPluginConstants.js';

/**
 * Create the image clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionImage() {
    return {
        id: ClipboardType.IMAGE,
        priority: ClipboardPriority[ClipboardType.IMAGE],
        styling: ClipboardStyling[ClipboardType.IMAGE],
        extract: () => ImageProcessor.extract(),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: ImageProcessor,
            storageDirKey: 'imagesDir',
            previewDirKey: 'imagePreviewsDir',
        }),
        healItem: ClipboardIntegrationImageFileHealing({
            ensurePreview: (item, { storage }) => ImageProcessor.ensurePreviewForItem(item, storage.imagesDir, storage.imagePreviewsDir),
            regenerateThumbnail: (item, { storage }) => ImageProcessor.regenerateThumbnail(item, storage.imagesDir, storage.imagePreviewsDir),
            regenerateFromUrl: (item, { storage, httpSession }) => ImageProcessor.regenerateFromUrl(httpSession, item, storage.imagesDir, storage.imagePreviewsDir),
        }),
        storageOptions: ClipboardIntegrationStorage({
            files: [
                {
                    dirKey: 'imagesDir',
                    resolveFilename: (item) => item.image_filename,
                },
                {
                    dirKey: 'imagePreviewsDir',
                    resolveFilename: (item) => item.preview_filename,
                },
            ],
        }),
        ...ClipboardIntegrationPreviewWarmup({
            shouldWarmupItem: (item) => Boolean(item.image_filename),
            warmupItem: (item, { storage }) => ImageProcessor.ensurePreviewForItem(item, storage.imagesDir, storage.imagePreviewsDir),
        }),
        getSearchTerms: (item) => [item.image_filename],
        copyOptions: {
            mergeBehavior: 'file',
            copyItem: async (item, { storage, manager }) => {
                if (item.file_uri) {
                    const uriText = item.file_uri + '\r\n';
                    const uriBytes = IOText.stringifyBytes(uriText);
                    if (!uriBytes) return false;
                    manager.captureGuard.registerText(uriText);
                    clipboardSetContent('text/uri-list', new GLib.Bytes(uriBytes));
                    return true;
                }

                const imagePath = GLib.build_filenamev([storage.imagesDir, item.image_filename]);
                const bytes = IOImage.parseBytes(await storage.readRaw(imagePath));

                if (!bytes) return false;
                manager.captureGuard.registerHash(item.hash);
                clipboardSetContent(IOImage.getMimeType(item.image_filename), bytes);
                return true;
            },
            getMergeUri: (item, { manager }) => {
                if (item.file_uri) {
                    return item.file_uri;
                }
                if (item.image_filename) {
                    try {
                        const imagesDir = manager.imagesDir || manager.storage.imagesDir;
                        if (!imagesDir) return null;
                        const imagePath = GLib.build_filenamev([imagesDir, item.image_filename]);
                        return Gio.File.new_for_path(imagePath).get_uri();
                    } catch {
                        return null;
                    }
                }
                return null;
            },
        },
        configureView: (config, item) => {
            config.text = item.preview || item.text || '';
        },
    };
}
