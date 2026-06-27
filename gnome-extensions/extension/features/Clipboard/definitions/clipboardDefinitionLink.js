import { ClipboardIntegrationIconFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationWebMetadataEnrichment } from '../integrations/clipboardIntegrationWebMetadata.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';

/**
 * Create the URL clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionLink() {
    const linkProcessor = new LinkProcessor();

    return {
        id: 'url',
        priority: 40,
        styling: {
            icon: 'clipboard-type-link-symbolic.svg',
            iconSize: 16,
            layout: 'rich',
        },
        processText: (text) => LinkProcessor.process(text),
        createItem: ClipboardIntegrationInlineItem({
            fields: ['url', 'title', 'hash'],
            defaults: {
                icon_filename: null,
            },
        }),
        enrichItem: ClipboardIntegrationWebMetadataEnrichment({
            resolveAddress: (item) => item.url,
            fetchMetadata: (url) => linkProcessor.fetchMetadata(url),
            downloadFavicon: (iconUrl, destinationDir, fileBasename) => linkProcessor.downloadFavicon(iconUrl, destinationDir, fileBasename),
        }),
        healItem: ClipboardIntegrationIconFileHealing({
            regenerateIcon: (item, { storage }) => linkProcessor.regenerateIcon(item, storage.linkPreviewsDir),
        }),
        destroy: () => linkProcessor.destroy(),
    };
}
