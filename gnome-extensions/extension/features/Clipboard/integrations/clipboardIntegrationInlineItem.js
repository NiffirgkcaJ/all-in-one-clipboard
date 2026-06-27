import GLib from 'gi://GLib';

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a integration that maps processor result fields into an inline clipboard item.
 *
 * @param {object} config Integration configuration.
 * @param {Array<string>} config.fields Result fields to copy.
 * @param {object} config.defaults Default item fields.
 * @param {string|null} config.previewField Result field to mirror into preview.
 * @returns {Function} Item creation integration.
 */
export function ClipboardIntegrationInlineItem({ fields = [], defaults = {}, previewField = null } = {}) {
    return (result, { definition } = {}) => {
        const item = {
            id: GLib.uuid_string_random(),
            type: definition.id,
            timestamp: Math.floor(Date.now() / 1000),
            ...defaults,
        };

        fields.forEach((field) => {
            if (result[field] !== undefined) {
                item[field] = result[field];
            }
        });

        if (previewField && item.preview === undefined) {
            item.preview = result[previewField];
        }

        return item;
    };
}
