import GLib from 'gi://GLib';

import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { IOImage } from '../../../shared/utilities/utilityIO.js';

import { ClipboardIntegrationIconFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardIntegrationViewRich } from '../integrations/clipboardIntegrationViewRich.js';
import { ClipboardIntegrationWebMetadataEnrichment } from '../integrations/clipboardIntegrationWebMetadata.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { ClipboardType, ClipboardStyling, ClipboardPriority } from '../constants/clipboardPluginConstants.js';

/**
 * Create the URL clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionLink() {
    const linkProcessor = new LinkProcessor();

    return {
        id: ClipboardType.URL,
        priority: ClipboardPriority[ClipboardType.URL],
        styling: ClipboardStyling[ClipboardType.URL],
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
        storageOptions: ClipboardIntegrationStorage({
            files: [
                {
                    dirKey: 'linkPreviewsDir',
                    resolveFilename: (item) => item.icon_filename,
                },
            ],
        }),
        ...ClipboardIntegrationViewRich(),
        getSearchTerms: (item) => [item.title, item.url],
        copyOptions: {
            pasteShortcut: 'shift-insert',
            mergeBehavior: 'text',
            copyItem: async (item, { manager }) => {
                manager.captureGuard.registerText(item.url);
                clipboardSetText(item.url);
                return true;
            },
            getMergeText: (item) => item.url,
        },
        configureView: (config, item, options) => {
            config.title = item.title || item.url;
            config.subtitle = item.url;

            const linkPreviewsDir = options.storage?.linkPreviewsDir;
            if (item.icon_filename && linkPreviewsDir) {
                const iconPath = GLib.build_filenamev([linkPreviewsDir, item.icon_filename]);
                config.giconPath = iconPath;
                config.gicon = IOImage.loadIcon(iconPath);
            }
        },
        destroy: () => linkProcessor.destroy(),
    };
}
