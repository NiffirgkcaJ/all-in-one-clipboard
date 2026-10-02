import GLib from 'gi://GLib';

import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { IOImage } from '../../../shared/utilities/utilityIO.js';
import { ResourcePath } from '../../../shared/constants/storagePaths.js';

import { ClipboardIntegrationIconFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardIntegrationViewRich } from '../integrations/clipboardIntegrationViewRich.js';
import { ClipboardIntegrationWebMetadataEnrichment } from '../integrations/clipboardIntegrationWebMetadata.js';
import { ContactProcessor } from '../processors/clipboardContactProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { ClipboardType, ClipboardStyling, ClipboardPriority } from '../constants/clipboardPluginConstants.js';

/**
 * Create the contact clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionContact() {
    const linkProcessor = new LinkProcessor();

    return {
        id: ClipboardType.CONTACT,
        priority: ClipboardPriority[ClipboardType.CONTACT],
        styling: ClipboardStyling[ClipboardType.CONTACT],
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
        storageOptions: ClipboardIntegrationStorage({
            files: [
                {
                    dirKey: 'linkPreviewsDir',
                    resolveFilename: (item) => item.icon_filename,
                },
            ],
        }),
        ...ClipboardIntegrationViewRich(),
        getSearchTerms: (item) => [item.text, item.preview, item.metadata?.name, item.metadata?.email],
        copyOptions: {
            mergeBehavior: 'text',
            copyItem: async (item, { manager }) => {
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
        configureView: (config, item, options) => {
            config.title = item.preview || item.text || 'Unknown Contact';
            config.subtitle = item.subtype === 'email' ? 'Email' : 'Phone';

            if (options.style?.subtypes && options.style.subtypes[item.subtype]) {
                config.icon = options.style.subtypes[item.subtype].icon;
            }

            const linkPreviewsDir = options.storage?.linkPreviewsDir;
            if (item.subtype === 'email' && item.icon_filename && linkPreviewsDir) {
                const iconPath = GLib.build_filenamev([linkPreviewsDir, item.icon_filename]);
                config.giconPath = iconPath;
                config.gicon = IOImage.loadIcon(iconPath);
            }

            if (item.subtype === 'phone' && item.metadata && item.metadata.code) {
                const countryCode = item.metadata.code.toLowerCase();
                config.flagPath = `${ResourcePath.FLAGS}/${countryCode}.svg`;
            }
        },
        destroy: () => linkProcessor.destroy(),
    };
}
