import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';
import { GridMetrics, ListMetrics } from '../constants/clipboardLayoutConstants.js';
import { ClipboardPriority, ClipboardStyling, ClipboardType } from '../constants/clipboardPluginConstants.js';

/**
 * Create the text clipboard definition.
 *
 * @returns {object} Clipboard definition.
 */
export function ClipboardDefinitionText() {
    return {
        id: ClipboardType.TEXT,
        priority: ClipboardPriority[ClipboardType.TEXT],
        styling: ClipboardStyling[ClipboardType.TEXT],
        viewType: 'label',
        extract: () => TextProcessor.extract(),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: TextProcessor,
            storageDirKey: 'textsDir',
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
        configureView: (config, item) => {
            config.text = item.preview || item.text || '';
        },
        getViewFingerprint: (config) => config.text || '',
        getViewMetadata: (_config, item) => {
            const len = item?.preview?.length || 0;
            let gridHeight = GridMetrics.LABEL_WEIGHTS.TINY.height;
            if (len > GridMetrics.LABEL_WEIGHTS.LONG.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.LONG.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.MEDIUM.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.MEDIUM.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.SHORT.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.SHORT.height;
            }

            return {
                gridHeight,
                listHeight: ListMetrics.ITEM_HEIGHT,
            };
        },
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            pasteShortcut: 'shift-insert',
            mergeBehavior: 'text',
            copyItem: async (item, { manager }) => {
                let content = item.text || (await manager.getContent(item.id));
                if (!content && item.preview) content = item.preview;
                if (!content) return false;
                manager.captureGuard.registerText(content);
                clipboardSetText(content);
                return true;
            },
            getMergeText: async (item, { textContents }) => {
                return textContents.get(item.id) || item.preview || item.text || '';
            },
        },
    };
}
