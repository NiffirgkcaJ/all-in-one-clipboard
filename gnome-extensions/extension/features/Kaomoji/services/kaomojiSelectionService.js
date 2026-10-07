import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { GlobalActionService } from '../../../shared/services/serviceAction.js';

/**
 * KaomojiSelectionService
 *
 * Handles copying selected kaomojis and triggering auto-paste.
 */
export class KaomojiSelectionService {
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
     * Copy selected kaomoji text and execute the action lifecycle.
     *
     * @param {string} kaomojiToCopy Kaomoji string to copy.
     * @param {Object} [menu] Extension indicator menu.
     * @returns {Promise<boolean>} True if successful.
     */
    async handleSelection(kaomojiToCopy, menu) {
        if (!kaomojiToCopy) return false;

        return await GlobalActionService.executeCopyAction({
            onCopy: async () => {
                clipboardSetText(kaomojiToCopy);
                return true;
            },
            settings: this._settings,
            autoPasteKey: 'auto-paste-kaomoji',
            menu,
            pasteShortcut: 'shift-insert',
        });
    }
}
