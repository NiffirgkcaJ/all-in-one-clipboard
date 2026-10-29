import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { IOImage } from '../../../shared/utilities/utilityIO.js';

import { ClipboardBaseWidgetFactory } from '../view/clipboardBaseWidgetFactory.js';
import { ClipboardIcons } from '../constants/clipboardConstants.js';
import { ClipboardIntegrationIconFileHealing } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationItemActions } from '../integrations/clipboardIntegrationItemActions.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardIntegrationWebMetadataEnrichment } from '../integrations/clipboardIntegrationWebMetadata.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';
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
        initialize: () => LinkProcessor.init(),
        processText: (text) => LinkProcessor.process(text),
        intentSources: [ClipboardType.TEXT, ClipboardType.HTML],
        intentField: 'text',
        extractIntents: (result, context) => {
            const { settings } = context;
            if (!settings || !settings.get_boolean('clipboard-link-extract-from-text')) {
                return [];
            }

            const limitEnabled = settings.get_boolean('clipboard-link-limit-extract');
            const limit = limitEnabled ? settings.get_int('clipboard-link-extract-limit') : undefined;
            const urls = LinkProcessor.extractLinks(result.text, limit);

            return urls.map((url) => ({
                type: ClipboardType.LINK,
                url,
                title: url,
                hash: ProcessorUtils.computeHashForString(url),
            }));
        },
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
        ...ClipboardIntegrationItemActions({
            customActions: (item, context) => {
                if (item.is_corrupted) return [];

                const buttons = [];
                const { settings, onItemCopy, styleOptions } = context;

                // Button Actions
                if (settings.get_boolean('clipboard-link-show-action-button')) {
                    const defaultAction = settings.get_string('clipboard-link-default-action');
                    const target = defaultAction === 'launch' ? 'paste' : 'launch';

                    const LINK_TARGET_ACTIONS = {
                        launch: {
                            icon: ClipboardIcons.ACTION_LAUNCH,
                            tooltip: _('Launch Link'),
                            action: 'launch-link',
                            target: 'launch',
                        },
                        paste: {
                            icon: ClipboardIcons.ACTION_PASTE_LINK,
                            tooltip: _('Paste Link'),
                            action: 'paste-link',
                            target: 'paste',
                        },
                    };

                    const LINK_BUTTON_ACTIONS = {
                        action: {
                            icon: LINK_TARGET_ACTIONS[target].icon,
                            tooltip: LINK_TARGET_ACTIONS[target].tooltip,
                            action: LINK_TARGET_ACTIONS[target].action,
                            target,
                        },
                    };

                    const actionMeta = LINK_BUTTON_ACTIONS.action;

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
        copyOptions: {
            getPasteShortcut: (_item, options = {}) => {
                const target = options.target ?? options.settings.get_string('clipboard-link-default-action');
                return target === 'launch' ? null : 'shift-insert';
            },
            copyMode: 'string',
            copyItemToClipboard: async (item, options = {}) => {
                const { manager, settings } = options;
                const target = options.target ?? settings.get_string('clipboard-link-default-action');

                if (target === 'launch') {
                    try {
                        Gio.AppInfo.launch_default_for_uri(item.url, null);
                        return true;
                    } catch {
                        return false;
                    }
                }

                manager.captureGuard.registerText(item.url);
                clipboardSetText(item.url);
                return true;
            },
            serializeItem: (item) => item.url,
        },
        destroy: () => linkProcessor.destroy(),
    };
}
