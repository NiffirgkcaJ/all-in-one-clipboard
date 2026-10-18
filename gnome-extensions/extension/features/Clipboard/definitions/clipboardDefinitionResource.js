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
                if (settings.get_boolean('clipboard-resource-show-format-paste-button')) {
                    const isMultiple = Boolean(item.count && item.count > 1);
                    const currentFormat = settings.get_string('clipboard-resource-paste-format');
                    const targetFormat = currentFormat === 'resource' ? 'uri' : 'resource';

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
                        uri: {
                            icon: isMultiple ? ClipboardIcons.ACTION_PASTE_RESOURCE_URIS : ClipboardIcons.ACTION_PASTE_RESOURCE_URI,
                            tooltip: isMultiple ? _('Paste as URIs') : _('Paste as URI'),
                        },
                        resource: {
                            icon: RESOURCE_SUBTYPE_ACTIONS[item.subtype].icon,
                            tooltip: RESOURCE_SUBTYPE_ACTIONS[item.subtype].tooltip,
                        },
                    };

                    const actionMeta = RESOURCE_FORMAT_ACTIONS[targetFormat];

                    buttons.push(
                        ClipboardBaseWidgetFactory.createActionButton({
                            icon: actionMeta.icon,
                            tooltip: actionMeta.tooltip,
                            action: 'format-paste',
                            styleOptions,
                            onClick: () => onItemCopy(item, { format: targetFormat }),
                        }),
                    );
                }

                return buttons;
            },
        }),
        getSearchTerms: (item) => [item.preview, item.file_uri],
        copyOptions: {
            pasteShortcut: (_item, options) => {
                const isUri = options?.format === 'uri' || (!options?.format && options?.settings?.get_string('clipboard-resource-paste-format') === 'uri');
                return isUri ? 'shift-insert' : 'ctrl-v';
            },
            mergeBehavior: 'file',
            copyItem: async (item, { manager, format, settings }) => {
                if (item.is_corrupted || !verifyResourceUrisExist(item.file_uri)) {
                    item.is_corrupted = true;
                    return false;
                }

                const targetFormat = format ?? settings?.get_string('clipboard-resource-paste-format') ?? 'resource';

                if (targetFormat === 'uri') {
                    const textPayload = item.text || item.file_uri;
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
            getMergeUri: (item) => item.file_uri,
            getMergeText: async (item) => item.text || item.file_uri || item.preview || '',
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
            } else if (options.style?.icon) {
                config.icon = options.style.icon;
            } else {
                config.icon = 'clipboard-type-resource-item-symbolic.svg';
            }
        },
    };
}
