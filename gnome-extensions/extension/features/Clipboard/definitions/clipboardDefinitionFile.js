import GLib from 'gi://GLib';

import { clipboardSetContent } from '../../../shared/utilities/utilityClipboard.js';
import { IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { ClipboardIntegrationViewRich } from '../integrations/clipboardIntegrationViewRich.js';
import { FileProcessor } from '../processors/clipboardFileProcessor.js';
import { ClipboardType, ClipboardStyling, ClipboardPriority } from '../constants/clipboardPluginConstants.js';

/**
 * Create the file clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionFile() {
    return {
        id: ClipboardType.FILE,
        priority: ClipboardPriority[ClipboardType.FILE],
        styling: ClipboardStyling[ClipboardType.FILE],
        processText: (text) => FileProcessor.process(text),
        createItem: ClipboardIntegrationInlineItem({
            fields: ['preview', 'file_uri', 'hash'],
        }),
        ...ClipboardIntegrationViewRich(),
        getSearchTerms: (item) => [item.preview, item.file_uri],
        copyOptions: {
            mergeBehavior: 'file',
            copyItem: async (item, { manager }) => {
                const uriText = item.file_uri + '\r\n';
                const uriBytes = IOText.stringifyBytes(uriText);
                if (!uriBytes) return false;
                manager.captureGuard.registerText(uriText);
                clipboardSetContent('text/uri-list', new GLib.Bytes(uriBytes));
                return true;
            },
            getMergeUri: (item) => item.file_uri,
        },
        configureView: (config, item) => {
            config.title = item.preview || 'Unknown File';
            config.subtitle = item.file_uri;
        },
    };
}
