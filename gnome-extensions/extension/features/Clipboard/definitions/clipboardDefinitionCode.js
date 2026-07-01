import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';
import { ClipboardType, ClipboardStyling, ClipboardPriority } from '../constants/clipboardPluginConstants.js';

/**
 * Create the code clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionCode() {
    return {
        id: ClipboardType.CODE,
        priority: ClipboardPriority[ClipboardType.CODE],
        styling: ClipboardStyling[ClipboardType.CODE],
        processText: (text) => CodeProcessor.process(text),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: TextProcessor,
            storageDirKey: 'textsDir',
            forceFileSave: true,
        }),
        healItem: ClipboardIntegrationFileIntegrity({
            dirKey: 'textsDir',
            filenameResolver: (item) => `${item.id}.txt`,
            shouldCheck: (item) => Boolean(item.has_full_content),
        }),
        storageOptions: ClipboardIntegrationStorage({
            files: [
                {
                    dirKey: 'textsDir',
                    resolveFilename: (item) => `${item.id}.txt`,
                    shouldDelete: (item) => Boolean(item.has_full_content),
                    shouldCollect: (item) => Boolean(item.has_full_content),
                },
            ],
        }),
        hasFullContent: true,
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            mergeBehavior: 'text',
            copyItem: async (item, { manager }) => {
                let content = item.text || (await manager.getContent(item.id));
                if (!content) return false;
                manager.captureGuard.registerText(content);
                clipboardSetText(content);
                return true;
            },
            getMergeText: async (item, { textContents }) => {
                return textContents.get(item.id) || item.preview || item.text || '';
            },
        },
        configureView: (config, item) => {
            config.text = item.preview || '';
            config.rawLines = item.raw_lines || 0;
            config.previewLinesCount = config.text ? config.text.split('\n').length : 0;
        },
    };
}
