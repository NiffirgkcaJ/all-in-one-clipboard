import { GridMetrics, ListMetrics } from '../constants/clipboardLayoutConstants.js';
import { createTextGridContent, createTextListContent } from './clipboardViewTemplates.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Create reusable plain text view rendering hooks for clipboard definitions.
 *
 * @returns {object} View rendering hooks.
 */
export function ClipboardIntegrationViewText() {
    return {
        createListContent: (config) => {
            return createTextListContent({
                text: config.text,
            });
        },

        createGridContent: (config) => {
            return createTextGridContent({
                text: config.text,
            });
        },

        getViewFingerprint: (config) => {
            return config.text || '';
        },

        getViewMetadata: (_config, item) => {
            const len = item?.preview?.length || 0;
            let gridHeight = GridMetrics.TEXT_WEIGHTS.TINY.height;
            if (len > GridMetrics.TEXT_WEIGHTS.LONG.threshold) {
                gridHeight = GridMetrics.TEXT_WEIGHTS.LONG.height;
            } else if (len > GridMetrics.TEXT_WEIGHTS.MEDIUM.threshold) {
                gridHeight = GridMetrics.TEXT_WEIGHTS.MEDIUM.height;
            } else if (len > GridMetrics.TEXT_WEIGHTS.SHORT.threshold) {
                gridHeight = GridMetrics.TEXT_WEIGHTS.SHORT.height;
            }

            return {
                gridHeight,
                listHeight: ListMetrics.ITEM_HEIGHT,
            };
        },
    };
}
