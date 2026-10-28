import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { clipboardSetContent, clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { IOFile, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardBaseWidgetFactory } from '../view/clipboardBaseWidgetFactory.js';
import { ClipboardIcons } from '../constants/clipboardConstants.js';
import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationItemActions } from '../integrations/clipboardIntegrationItemActions.js';
import { ResourceProcessor } from '../processors/clipboardResourceProcessor.js';
import { GridMetrics, ListMetrics } from '../constants/clipboardLayoutConstants.js';
import { ClipboardPriority, ClipboardStyling, ClipboardType } from '../constants/clipboardPluginConstants.js';

/**
 * Check whether all files and directories in a URI list exist on disk.
 *
 * @param {string} fileUri Single URI or newline separated URI list.
 * @returns {boolean} True if all resources exist on disk.
 */
function verifyResourceUrisExist(fileUri) {
    if (!fileUri) return false;

    const lines = fileUri
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length === 0) return false;

    for (const line of lines) {
        let path = null;
        try {
            [path] = GLib.filename_from_uri(line);
        } catch {
            path = line.startsWith('/') ? line : null;
        }

        if (!path || !IOFile.existsSync(path)) {
            return false;
        }
    }

    return true;
}

/**
 * Convert a URI list string to newline separated filesystem paths.
 *
 * @param {string} fileUri Single URI or newline separated URI list.
 * @returns {string} Newline separated filesystem paths.
 */
function extractResourcePaths(fileUri) {
    if (!fileUri) return '';

    const lines = fileUri
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const paths = lines.map((uri) => {
        try {
            const [path] = GLib.filename_from_uri(uri);
            return path || uri;
        } catch {
            return uri;
        }
    });

    return paths.join('\n');
}

/**
 * Create the resource clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionResource() {
    return {
        id: ClipboardType.RESOURCE,
        priority: ClipboardPriority[ClipboardType.RESOURCE],
        styling: ClipboardStyling[ClipboardType.RESOURCE],
        viewType: 'header',
        processText: (text, context) => ResourceProcessor.process(text, context),
        createItem: ClipboardIntegrationInlineItem({
            fields: ['preview', 'file_uri', 'text', 'hash', 'subtype', 'count'],
            defaults: {
                subtype: 'file',
                count: 1,
            },
        }),
        healItem: (item) => {
            const exists = verifyResourceUrisExist(item.file_uri);
            return { healed: false, isCorrupted: !exists };
        },
        configureView: (config, item, options) => {
            config.title = item.preview;

            if (item.count && item.count > 1) {
                config.subtitle = `${item.count} ${item.subtype}`;
            } else {
                config.subtitle = item.file_uri;
            }

            if (!verifyResourceUrisExist(item.file_uri)) {
                item.is_corrupted = true;
            }

            if (options.style?.subtypes && options.style.subtypes[item.subtype]) {
                config.icon = options.style.subtypes[item.subtype].icon;
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
        ...ClipboardIntegrationItemActions({
            customActions: (item, context) => {
                if (item.is_corrupted) return [];

                const buttons = [];
                const { settings, onItemCopy, styleOptions } = context;

                // Format Action
                const isMultiple = Boolean(item.count && item.count > 1);
                const defaultFormat = settings ? settings.get_string('clipboard-resource-default-format') : 'resource';
                const formatOrder = settings ? settings.get_strv('clipboard-resource-format-order') : ['resource', 'path', 'uri'];

                const RESOURCE_SUBTYPE_ACTIONS = {
                    [isMultiple ? 'files' : 'file']: {
                        icon: isMultiple ? ClipboardIcons.ACTION_PASTE_RESOURCE_FILES : ClipboardIcons.ACTION_PASTE_RESOURCE_FILE,
                        tooltip: isMultiple ? _('Paste as Files') : _('Paste as File'),
                    },
                    [isMultiple ? 'folders' : 'folder']: {
                        icon: isMultiple ? ClipboardIcons.ACTION_PASTE_RESOURCE_FOLDERS : ClipboardIcons.ACTION_PASTE_RESOURCE_FOLDER,
                        tooltip: isMultiple ? _('Paste as Folders') : _('Paste as Folder'),
                    },
                    [isMultiple ? 'items' : 'item']: {
                        icon: isMultiple ? ClipboardIcons.ACTION_PASTE_RESOURCE_ITEMS : ClipboardIcons.ACTION_PASTE_RESOURCE_ITEM,
                        tooltip: isMultiple ? _('Paste as Items') : _('Paste as Item'),
                    },
                };

                const RESOURCE_FORMAT_ACTIONS = {
                    path: {
                        icon: isMultiple ? ClipboardIcons.ACTION_PASTE_RESOURCE_PATHS : ClipboardIcons.ACTION_PASTE_RESOURCE_PATH,
                        tooltip: isMultiple ? _('Paste as Paths') : _('Paste as Path'),
                    },
                    uri: {
                        icon: isMultiple ? ClipboardIcons.ACTION_PASTE_RESOURCE_URIS : ClipboardIcons.ACTION_PASTE_RESOURCE_URI,
                        tooltip: isMultiple ? _('Paste as URIs') : _('Paste as URI'),
                    },
                    resource: {
                        icon: RESOURCE_SUBTYPE_ACTIONS[item.subtype].icon,
                        tooltip: RESOURCE_SUBTYPE_ACTIONS[item.subtype].tooltip,
                    },
                };

                const FORMAT_PERMISSION_KEYS = {
                    resource: 'clipboard-resource-show-resource-button',
                    path: 'clipboard-resource-show-path-button',
                    uri: 'clipboard-resource-show-uri-button',
                };

                const activeFormats = formatOrder.filter((format) => {
                    if (format === defaultFormat) return false;
                    const key = FORMAT_PERMISSION_KEYS[format];
                    return key && settings ? settings.get_boolean(key) : false;
                });

                for (const format of activeFormats) {
                    const actionMeta = RESOURCE_FORMAT_ACTIONS[format];
                    if (!actionMeta) continue;

                    buttons.push(
                        ClipboardBaseWidgetFactory.createActionButton({
                            icon: actionMeta.icon,
                            tooltip: actionMeta.tooltip,
                            action: `paste-format-${format}`,
                            styleOptions,
                            onClick: () => onItemCopy(item, { format }),
                        }),
                    );
                }

                return buttons;
            },
        }),
        getSearchTerms: (item) => [item.preview, item.file_uri],
        copyOptions: {
            getPasteShortcut: (_item, options = {}) => {
                const settings = options.settings;
                const defaultFormat = settings ? settings.get_string('clipboard-resource-default-format') : 'resource';
                const format = options.format || defaultFormat;
                return format === 'resource' ? 'ctrl-v' : 'shift-insert';
            },
            copyMode: 'blob',
            copyItemToClipboard: async (item, options = {}) => {
                const { manager, format, settings } = options;
                if (item.is_corrupted || !verifyResourceUrisExist(item.file_uri)) {
                    item.is_corrupted = true;
                    return false;
                }

                const defaultFormat = settings ? settings.get_string('clipboard-resource-default-format') : 'resource';
                const targetFormat = format || defaultFormat;

                if (targetFormat === 'path') {
                    const textPayload = extractResourcePaths(item.file_uri);
                    if (!textPayload) return false;

                    manager.captureGuard.registerText(textPayload);
                    if (item.hash) {
                        manager.captureGuard.registerHash(item.hash);
                    }

                    clipboardSetText(textPayload);
                    return true;
                }

                if (targetFormat === 'uri') {
                    const textPayload = item.file_uri;
                    if (!textPayload) return false;

                    manager.captureGuard.registerText(textPayload);
                    if (item.hash) {
                        manager.captureGuard.registerHash(item.hash);
                    }

                    clipboardSetText(textPayload);
                    return true;
                }

                const lines = item.file_uri
                    .split(/[\r\n]+/)
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);

                if (lines.length === 0) return false;

                const uriListPayload = `${lines.join('\r\n')}\r\n`;
                const payloadBytes = IOText.stringifyBytes(uriListPayload);
                if (!payloadBytes) return false;

                manager.captureGuard.registerText(item.file_uri);
                if (item.hash) {
                    manager.captureGuard.registerHash(item.hash);
                }

                clipboardSetContent('text/uri-list', new GLib.Bytes(payloadBytes));
                return true;
            },
            copyBatchToClipboard: async (items, options = {}) => {
                const { manager, format, settings } = options;
                const defaultFormat = settings ? settings.get_string('clipboard-resource-default-format') : 'resource';
                const targetFormat = format || defaultFormat;
                if (targetFormat !== 'resource') {
                    return false;
                }

                const allUriLines = [];
                for (const item of items) {
                    if (item.is_corrupted) continue;
                    if (!item.file_uri) continue;
                    const lines = item.file_uri
                        .split(/[\r\n]+/)
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0);
                    allUriLines.push(...lines);
                }

                if (allUriLines.length === 0) return false;

                const uriListPayload = `${allUriLines.join('\r\n')}\r\n`;
                const payloadBytes = IOText.stringifyBytes(uriListPayload);
                if (!payloadBytes) return false;

                for (const item of items) {
                    if (item.file_uri) manager.captureGuard.registerText(item.file_uri);
                    if (item.hash) manager.captureGuard.registerHash(item.hash);
                }
                manager.captureGuard.registerText(allUriLines.join('\n'));
                manager.captureGuard.registerText(uriListPayload);

                clipboardSetContent('text/uri-list', new GLib.Bytes(payloadBytes));
                return true;
            },
            serializeItem: async (item, options = {}) => {
                const settings = options.settings;
                const defaultFormat = settings ? settings.get_string('clipboard-resource-default-format') : 'resource';
                const targetFormat = options.format || (defaultFormat === 'uri' ? 'uri' : 'path');
                if (targetFormat === 'uri') {
                    return item.file_uri;
                }
                return extractResourcePaths(item.file_uri) || item.text || item.preview || '';
            },
        },
    };
}
