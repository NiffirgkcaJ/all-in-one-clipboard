import { createSnippetGridContent, createSnippetListContent } from './clipboardViewTemplates.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Create reusable snippet view rendering hooks for clipboard definitions.
 *
 * @returns {object} View rendering hooks.
 */
export function ClipboardIntegrationViewSnippet() {
    return {
        createListContent: (config) => {
            return createSnippetListContent({
                icon: config.icon,
                iconOptions: config.iconOptions,
                text: config.text,
                rawLines: config.rawLines,
                previewLinesCount: config.previewLinesCount,
            });
        },

        createGridContent: (config) => {
            return createSnippetGridContent({
                text: config.text,
            });
        },

        getViewFingerprint: (config) => {
            return [config.text || '', config.rawLines || 0, config.previewLinesCount || 0].join('|');
        },

        getGridBadge: (config) => {
            if (!config.rawLines || config.rawLines <= 0) return null;

            return {
                text: `${config.rawLines} lines`,
                style_class: 'clipboard-grid-code-line-count',
            };
        },
    };
}
