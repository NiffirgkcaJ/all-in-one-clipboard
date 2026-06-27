import { ClipboardIntegrationInlineItem } from '../integrations/clipboardIntegrationInlineItem.js';
import { FileProcessor } from '../processors/clipboardFileProcessor.js';

/**
 * Create the file clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionFile() {
    return {
        id: 'file',
        priority: 30,
        styling: {
            icon: 'clipboard-type-file-symbolic.svg',
            iconSize: 16,
            layout: 'rich',
        },
        processText: (text) => FileProcessor.process(text),
        createItem: ClipboardIntegrationInlineItem({
            fields: ['preview', 'file_uri', 'hash'],
        }),
    };
}
