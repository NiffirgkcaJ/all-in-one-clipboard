import GLib from 'gi://GLib';

import { clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';
import { IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationViewRich } from '../integrations/clipboardIntegrationViewRich.js';
import { ResourceProcessor } from '../processors/clipboardResourceProcessor.js';
import { ClipboardType, ClipboardStyling, ClipboardPriority } from '../constants/clipboardPluginConstants.js';

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
        processText: (text, context) => ResourceProcessor.process(text, context),
        createItem: ClipboardIntegrationInlineItem({
            fields: ['preview', 'file_uri', 'hash', 'subtype', 'count'],
            defaults: {
                subtype: 'file',
                count: 1,
            },
        }),
        ...ClipboardIntegrationViewRich(),
        getSearchTerms: (item) => [item.preview, item.file_uri],
        copyOptions: {
            pasteShortcut: 'ctrl-v',
            mergeBehavior: 'file',
            copyItem: async (item, { manager }) => {
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

            if (options.style?.subtypes && options.style.subtypes[item.subtype]) {
                config.icon = options.style.subtypes[item.subtype].icon;
            } else if (options.style?.icon) {
                config.icon = options.style.icon;
            }
        },
    };
}
