import GLib from 'gi://GLib';

import { clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';
import { IOFile, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
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
            fields: ['preview', 'file_uri', 'hash', 'subtype', 'count'],
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
        getSearchTerms: (item) => [item.preview, item.file_uri],
        copyOptions: {
            pasteShortcut: 'ctrl-v',
            mergeBehavior: 'file',
            copyItem: async (item, { manager }) => {
                if (item.is_corrupted || !verifyResourceUrisExist(item.file_uri)) {
                    item.is_corrupted = true;
                    return false;
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
