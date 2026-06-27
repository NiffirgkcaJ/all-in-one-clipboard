import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationImageFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationPreviewWarmup } from '../integrations/clipboardIntegrationPreviewWarmup.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';

/**
 * Create the image clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionImage() {
    return {
        id: 'image',
        priority: 10,
        styling: {
            icon: 'clipboard-type-image-symbolic.svg',
            iconSize: 16,
            layout: 'image',
        },
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
        ...ClipboardIntegrationPreviewWarmup({
            shouldWarmupItem: (item) => Boolean(item?.image_filename),
            warmupItem: (item, { storage }) => ImageProcessor.ensurePreviewForItem(item, storage.imagesDir, storage.imagePreviewsDir),
        }),
    };
}
