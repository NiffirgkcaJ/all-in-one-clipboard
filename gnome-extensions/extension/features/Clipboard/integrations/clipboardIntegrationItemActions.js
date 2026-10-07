import { ClipboardBaseWidgetFactory } from '../view/clipboardBaseWidgetFactory.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a unified item actions integration for clipboard definitions.
 * Combines plugin-specific actions with standard pin and delete buttons.
 *
 * @param {object} [config] Integration configuration.
 * @param {Function} [config.customActions] Optional callback to produce plugin-specific action buttons.
 * @returns {object} Object with createActions method.
 */
export function ClipboardIntegrationItemActions({ customActions } = {}) {
    return {
        /**
         * Create all action buttons for an item.
         *
         * @param {Object} item Clipboard item.
         * @param {Object} context Action context.
         * @param {Object} context.manager Clipboard manager instance.
         * @param {Gio.Settings} context.settings Extension settings.
         * @param {Function} context.onItemCopy Callback when item copy action is triggered.
         * @param {boolean} [context.isPinned] Whether item is currently pinned.
         * @param {Object} [context.styleOptions] Button styling options.
         * @returns {Array<St.Button>} List of action buttons.
         */
        createActions(item, context = {}) {
            const buttons = [];

            // Plugin Actions
            if (customActions) {
                const pluginButtons = customActions(item, context) || [];
                buttons.push(...pluginButtons);
            }

            // Standard Actions
            if (context.manager) {
                const isPinned = context.isPinned !== undefined ? context.isPinned : item._isPinned;
                const pinButton = ClipboardBaseWidgetFactory.createPinButton(item, isPinned, { manager: context.manager }, context.styleOptions);
                const deleteButton = ClipboardBaseWidgetFactory.createDeleteButton(item, { manager: context.manager }, context.styleOptions);
                buttons.push(pinButton, deleteButton);
            }

            return buttons;
        },
    };
}
