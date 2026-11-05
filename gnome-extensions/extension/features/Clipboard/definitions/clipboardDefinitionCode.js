import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';

import { ClipboardIntegrationFileBackedItem } from '../integrations/clipboardIntegrationFileBackedItem.js';
import { ClipboardIntegrationFileIntegrity } from '../integrations/clipboardIntegrationFileHealing.js';
import { ClipboardIntegrationStorage } from '../integrations/clipboardIntegrationStorage.js';
import { ClipboardStyles } from '../constants/clipboardStyleConstants.js';
import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { ProcessorUtils } from '../utilities/clipboardProcessorUtils.js';
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
        intentSources: [ClipboardType.TEXT, ClipboardType.HTML],
        intentField: 'text',
        intentSettings: {
            [ClipboardType.TEXT]: {
                enabledSetting: 'clipboard-code-extract-from-text',
                limitEnabledSetting: 'clipboard-code-limit-extract',
                limitSetting: 'clipboard-code-extract-limit',
            },
            [ClipboardType.HTML]: {
                enabledSetting: 'clipboard-code-extract-from-text',
                limitEnabledSetting: 'clipboard-code-limit-extract',
                limitSetting: 'clipboard-code-extract-limit',
            },
        },
        extractIntents: (result, context) => CodeProcessor.extractIntents(result.text, context),
        createItem: ClipboardIntegrationFileBackedItem({
            processor: CodeProcessor,
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
        configureView: (config, item, options) => {
            const raw = item.preview || item.text || '';
            const previewLines = options.codePreviewLines ?? options.settings.get_default_value('clipboard-code-preview-lines').get_int32();
            config.text = ProcessorUtils.clampLines(raw, previewLines);
            const rawLines = item.raw_lines || 0;
            const previewLinesCount = config.text ? ProcessorUtils.getLineCount(config.text) : 0;
            const lineCount = Math.min(previewLines, previewLinesCount || rawLines);
            config.gutterText = Array.from({ length: lineCount }, (_unused, i) => (i + 1).toString()).join('\n');
            config.badgeText = rawLines > 0 ? `${rawLines} lines` : null;
        },
        getViewFingerprint: (config, _item, options) => {
            const lines = options.codePreviewLines ?? options.settings.get_default_value('clipboard-code-preview-lines').get_int32();
            const floor = (options.codeEnforceDefaultHeight ?? options.settings.get_default_value('clipboard-code-enforce-default-height').get_boolean()) ? '1' : '0';
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
            const raw = item.preview || item.text || '';
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
            const previewLines = options.codePreviewLines ?? options.settings.get_default_value('clipboard-code-preview-lines').get_int32();
            const lines = previewLines !== undefined ? Math.min(rawLines, previewLines) : rawLines;
            const contentHeight = lines * ListMetrics.LINE_HEIGHT_GUTTER + ListMetrics.ROW_PADDING_MARGIN_PX;
            const enforceDefault = options.codeEnforceDefaultHeight ?? options.settings.get_default_value('clipboard-code-enforce-default-height').get_boolean();
            const listHeight = enforceDefault ? Math.max(ListMetrics.ITEM_HEIGHT, contentHeight) : Math.max(ListMetrics.MIN_ITEM_HEIGHT, contentHeight);

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
