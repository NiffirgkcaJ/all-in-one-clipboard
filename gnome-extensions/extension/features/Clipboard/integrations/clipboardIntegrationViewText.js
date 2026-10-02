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
    };
}
