import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

/**
 * Create the code clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionCode() {
    return {
        id: 'code',
        priority: 70,
        styling: {
            icon: 'clipboard-type-code-symbolic.svg',
            iconSize: 16,
            layout: 'code',
        },
        processText: (text) => CodeProcessor.process(text),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: TextProcessor,
            storageDirKey: 'textsDir',
            forceFileSave: true,
        }),
        healItem: ClipboardIntegrationFileIntegrity({
            dirKey: 'textsDir',
            filenameResolver: (item) => `${item.id}.txt`,
            shouldCheck: (item) => Boolean(item?.has_full_content),
        }),
    };
}
