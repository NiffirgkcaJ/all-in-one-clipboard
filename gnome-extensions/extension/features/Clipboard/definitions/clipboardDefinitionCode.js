import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardStyles } from '../constants/clipboardStyleConstants.js';
import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';
import { GridMetrics, ListMetrics } from '../constants/clipboardLayoutConstants.js';
import { ClipboardPriority, ClipboardStyling, ClipboardType } from '../constants/clipboardPluginConstants.js';

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
        viewType: 'gutter',
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
        getViewFingerprint: (config, _item, options) => {
            const lines = options.codePreviewLines || '';
            const floor = options.codeEnforceDefaultHeight ? '1' : '0';
            return [config.text || '', config.gutterText || '', config.badgeText || '', lines, floor].join('|');
        },
        getGridBadge: (config) => {
            if (!config.badgeText) return null;

            return {
                text: config.badgeText,
                style_class: ClipboardStyles.GRID_GUTTER_VISUAL,
            };
        },
        getViewMetadata: (_config, item, options) => {
            const raw = item?.preview || item?.text || '';
            const len = raw.length;
            let gridHeight = GridMetrics.LABEL_WEIGHTS.TINY.height;
            if (len > GridMetrics.LABEL_WEIGHTS.LONG.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.LONG.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.MEDIUM.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.MEDIUM.height;
            } else if (len > GridMetrics.LABEL_WEIGHTS.SHORT.threshold) {
                gridHeight = GridMetrics.LABEL_WEIGHTS.SHORT.height;
            }

            const rawLines = item?.raw_lines || (raw ? ProcessorUtils.getLineCount(raw) : 1);
            const previewLines = options.codePreviewLines;
            const lines = previewLines !== undefined ? Math.min(rawLines, previewLines) : rawLines;
            const contentHeight = lines * ListMetrics.LINE_HEIGHT_GUTTER + ListMetrics.ROW_PADDING_MARGIN_PX;
            const listHeight = options.codeEnforceDefaultHeight ? Math.max(ListMetrics.ITEM_HEIGHT, contentHeight) : Math.max(ListMetrics.MIN_ITEM_HEIGHT, contentHeight);

            return {
                gridHeight,
                listHeight,
            };
        },
        getSearchTerms: (item) => [item.text, item.preview],
        copyOptions: {
            pasteShortcut: 'shift-insert',
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
        configureView: (config, item, options) => {
            const raw = item.preview || item.text || '';
            const previewLines = options.codePreviewLines;
            config.text = ProcessorUtils.clampLines(raw, previewLines);
            const rawLines = item.raw_lines || 0;
            const previewLinesCount = config.text ? ProcessorUtils.getLineCount(config.text) : 0;
            const lineCount = Math.min(previewLines, previewLinesCount || rawLines);
            config.gutterText = Array.from({ length: lineCount }, (_unused, i) => (i + 1).toString()).join('\n');
            config.badgeText = rawLines > 0 ? `${rawLines} lines` : null;
        },
    };
}
