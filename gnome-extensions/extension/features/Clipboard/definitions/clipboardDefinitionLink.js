import GLib from 'gi://GLib';

import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { IOImage } from '../../../shared/utilities/utilityIO.js';

import { ClipboardIntegrationIconFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardIntegrationWebMetadataEnrichment } from '../integrations/clipboardIntegrationWebMetadata.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { GridMetrics, ListMetrics } from '../constants/clipboardLayoutConstants.js';
import { ClipboardPriority, ClipboardStyling, ClipboardType } from '../constants/clipboardPluginConstants.js';

/**
 * Create the link clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionLink() {
    const linkProcessor = new LinkProcessor();

    return {
        id: ClipboardType.LINK,
        priority: ClipboardPriority[ClipboardType.LINK],
        styling: ClipboardStyling[ClipboardType.LINK],
        viewType: 'header',
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
        getViewFingerprint: (config, _item, options) => {
            const floor = options.metadataEnforceDefaultHeight ? '1' : '0';
            return [config.title || '', config.subtitle || '', config.icon || '', config.flagPath || '', config.giconPath || '', floor].join('|');
        },
        getViewMetadata: (_config, _item, options) => {
            const contentHeight = ListMetrics.LINE_COUNT_HEADER * ListMetrics.LINE_HEIGHT_HEADER + ListMetrics.ROW_PADDING_MARGIN_PX;
            const listHeight = options.metadataEnforceDefaultHeight ? ListMetrics.ITEM_HEIGHT : Math.max(ListMetrics.MIN_ITEM_HEIGHT, contentHeight);

            return {
                gridHeight: GridMetrics.HEIGHT_DEFAULT,
                listHeight,
            };
        },
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
