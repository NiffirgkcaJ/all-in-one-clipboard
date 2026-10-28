import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';
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
        configureView: (config, item, options) => {
            const raw = (item.text || item.preview || '').replace(/\r?\n+$/, '');
            const previewLines = options.textPreviewLines;
            config.text = ProcessorUtils.clampLines(raw, previewLines);
        },
        getViewFingerprint: (config, _item, options) => {
            const lines = options.textPreviewLines || '';
            const floor = options.textEnforceDefaultHeight ? '1' : '0';
            return [config.text || '', lines, floor].join('|');
        },
        getViewMetadata: (_config, item, options) => {
            const raw = item.text || item.preview || '';
            const len = raw.length;
            let gridHeight = GridMetrics.LABEL_WEIGHTS.TINY.height;
            if (len > GridMetrics.LABEL_WEIGHTS.LONG.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.LONG.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.MEDIUM.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.MEDIUM.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.SHORT.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.SHORT.height;
            }

            const rawLines = ProcessorUtils.getLineCount(raw);
            const previewLines = options.textPreviewLines;
            const lines = previewLines !== undefined ? Math.min(rawLines, previewLines) : rawLines;
            const contentHeight = lines * ListMetrics.LINE_HEIGHT_LABEL + ListMetrics.ROW_PADDING_MARGIN_PX;
            const listHeight = options.textEnforceDefaultHeight ? Math.max(ListMetrics.ITEM_HEIGHT, contentHeight) : Math.max(ListMetrics.MIN_ITEM_HEIGHT, contentHeight);

            return {
                gridHeight,
                listHeight,
            };
        },
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            getPasteShortcut: 'shift-insert',
            copyMode: 'string',
            copyItemToClipboard: async (item, options = {}) => {
                const manager = options.manager;
                let content = item.text || (await manager.getContent(item.id));
                if (!content && item.preview) content = item.preview;
                if (!content) return false;
                manager.captureGuard.registerText(content);
                clipboardSetText(content);
                return true;
            },
            serializeItem: async (item, options = {}) => {
                return options.textContents?.get(item.id) || item.text || item.preview || '';
            },
        },
    };
}
