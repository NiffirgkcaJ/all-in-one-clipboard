import { AutoPaster, getAutoPaster } from '../utilities/utilityAutoPaste.js';

/**
 * GlobalActionService
 *
 * Orchestrates the golden path for click-to-copy-and-paste actions across the extension.
 * Ensures that Clutter modal grabs and keyboard focus are safely dropped before
 * simulating keystrokes to prevent stuck modifiers and missed inputs.
 */
export class GlobalActionService {
    /**
     * Executes a safe copy and auto-paste lifecycle.
     *
     * @param {Object} params
     * @param {Function} params.onCopy Async callback that performs the actual clipboard copy. Must return a boolean indicating success.
     * @param {Function} [params.onPostCopy] Optional synchronous callback executed after focus is dropped but before auto-paste.
     * @param {Gio.Settings} params.settings Extension settings object.
     * @param {string} [params.autoPasteKey] The specific settings key to check for auto-paste.
     * @param {Object} [params.menu] The extension indicator menu.
     * @returns {Promise<boolean>} True if the copy action succeeded.
     */
    static async executeCopyAction({ onCopy, onPostCopy, settings, autoPasteKey, menu }) {
        if (typeof onCopy !== 'function') return false;
        const copySuccess = await onCopy();
        if (!copySuccess) return false;

        // Close the menu to pop the modal grab synchronously so the active Wayland window regains focus immediately.
        if (menu && typeof menu.close === 'function') {
            menu.close();
        }

        // Drop key focus to prevent routing simulated keystrokes into dying widgets during the menu fade-out animation.
        const currentFocus = global.stage.get_key_focus();
        if (currentFocus) {
            global.stage.set_key_focus(null);
        }

        if (typeof onPostCopy === 'function') {
            onPostCopy();
        }

        if (settings && autoPasteKey && AutoPaster.shouldAutoPaste(settings, autoPasteKey)) {
            await getAutoPaster().trigger();
        }

        return true;
    }
}
