import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

/**
 * Create the text clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionText() {
    return {
        id: 'text',
        priority: 20,
        styling: {
            icon: 'clipboard-type-text-symbolic.svg',
            iconSize: 16,
            layout: 'text',
        },
        extract: () => TextProcessor.extract(),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: TextProcessor,
            storageDirKey: 'textsDir',
        }),
        healItem: ClipboardIntegrationFileIntegrity({
            dirKey: 'textsDir',
            filenameResolver: (item) => `${item.id}.txt`,
            shouldCheck: (item) => Boolean(item?.has_full_content),
        }),
    };
}
