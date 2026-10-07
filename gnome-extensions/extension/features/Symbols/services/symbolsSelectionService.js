import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { GlobalActionService } from '../../../shared/services/serviceAction.js';

/**
 * SymbolsSelectionService
 *
 * Handles copying selected symbols and triggering auto-paste.
 */
export class SymbolsSelectionService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * @param {Gio.Settings} settings Extension settings.
     */
    constructor(settings) {
        this._settings = settings;
    }

    // ========================================================================
    // Selection Operations
    // ========================================================================

    /**
     * Copy selected symbol text and execute the action lifecycle.
     *
     * @param {string} symbolToCopy Symbol character to copy.
     * @param {Object} [menu] Extension indicator menu.
     * @returns {Promise<boolean>} True if successful.
     */
    async handleSelection(symbolToCopy, menu) {
        if (!symbolToCopy) return false;

        return await GlobalActionService.executeCopyAction({
            onCopy: async () => {
                clipboardSetText(symbolToCopy);
                return true;
            },
            settings: this._settings,
            autoPasteKey: 'auto-paste-symbols',
            menu,
            pasteShortcut: 'shift-insert',
        });
    }
}
