import { createRichGridContent, createRichListContent } from './clipboardViewTemplates.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Create reusable rich view rendering hooks for clipboard definitions.
 *
 * @returns {object} View rendering hooks.
 */
export function ClipboardIntegrationViewRich() {
    return {
        createListContent: (config) => {
            return createRichListContent({
                icon: config.icon,
                iconOptions: config.iconOptions,
                gicon: config.gicon,
                flagPath: config.flagPath,
                title: config.title,
                subtitle: config.subtitle,
            });
        },

        createGridContent: (config) => {
            return createRichGridContent({
                icon: config.icon,
                iconOptions: config.iconOptions,
                gicon: config.gicon,
                flagPath: config.flagPath,
                title: config.title,
                subtitle: config.subtitle,
            });
        },
    };
}
