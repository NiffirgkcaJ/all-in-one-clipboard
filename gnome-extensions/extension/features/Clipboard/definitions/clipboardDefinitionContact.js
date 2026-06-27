import { ClipboardIntegrationIconFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationWebMetadataEnrichment } from '../integrations/clipboardIntegrationWebMetadata.js';
import { ContactProcessor } from '../processors/clipboardContactProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';

/**
 * Create the contact clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionContact() {
    const linkProcessor = new LinkProcessor();

    return {
        id: 'contact',
        priority: 50,
        styling: {
            layout: 'rich',
            iconSize: 16,
            subtypes: {
                email: {
                    icon: 'clipboard-type-contact-email-symbolic.svg',
                },
                phone: {
                    icon: 'clipboard-type-contact-phone-symbolic.svg',
                },
            },
        },
        initialize: () => ContactProcessor.init(),
        processText: (text) => ContactProcessor.process(text),
        createItem: ClipboardIntegrationInlineItem({
            fields: ['subtype', 'text', 'preview', 'hash', 'metadata'],
        }),
        enrichItem: ClipboardIntegrationWebMetadataEnrichment({
            resolveAddress: (item) => {
                if (item.subtype !== 'email' || !item.text) return null;

                const parts = item.text.split('@');
                return parts.length === 2 ? `https://${parts[1]}` : null;
            },
            updateTitle: false,
            fetchMetadata: (url) => linkProcessor.fetchMetadata(url),
            downloadFavicon: (iconUrl, destinationDir, fileBasename) => linkProcessor.downloadFavicon(iconUrl, destinationDir, fileBasename),
        }),
        healItem: ClipboardIntegrationIconFileHealing({
            shouldHeal: (item) => item.subtype === 'email',
            regenerateIcon: (item, { storage }) => linkProcessor.regenerateIcon(item, storage.linkPreviewsDir),
        }),
        destroy: () => linkProcessor.destroy(),
    };
}
