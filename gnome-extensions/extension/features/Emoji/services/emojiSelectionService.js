import { clipboardSetText } from '../../../shared/utilities/utilityClipboard.js';
import { GlobalActionService } from '../../../shared/services/serviceAction.js';

/**
 * EmojiSelectionService
 *
 * Handles copying selected emojis and triggering auto-paste.
 */
export class EmojiSelectionService {
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
     * Copy selected emoji character and execute the action lifecycle.
     *
     * @param {string} charToCopy Emoji character to copy.
     * @param {Object} [menu] Extension indicator menu.
     * @returns {Promise<boolean>} True if successful.
     */
    async handleSelection(charToCopy, menu) {
        if (!charToCopy) return false;

        return await GlobalActionService.executeCopyAction({
            onCopy: async () => {
                clipboardSetText(charToCopy);
                return true;
            },
            settings: this._settings,
            autoPasteKey: 'auto-paste-emoji',
            menu,
            pasteShortcut: 'shift-insert',
        });
    }
}
