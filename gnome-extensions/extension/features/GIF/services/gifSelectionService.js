import { FileItem } from '../../../shared/constants/storagePaths.js';
import { getRecentItemsManager } from '../../../shared/utilities/utilityRecents.js';
import { GlobalActionService } from '../../../shared/services/serviceAction.js';

import { GifSettings } from '../constants/gifConstants.js';

/**
 * GifSelectionService
 *
 * Handles GIF selection events by copying to clipboard and updating recents.
 */
export class GifSelectionService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * @param {object} extension The extension instance.
     * @param {Gio.Settings} settings Extension settings.
     * @param {ClipboardManager} clipboardManager The clipboard manager instance.
     * @param {GifDownloadService} downloadService The download service.
     */
    constructor(extension, settings, clipboardManager, downloadService) {
        this._extension = extension;
        this._settings = settings;
        this._clipboardManager = clipboardManager;
        this._downloadService = downloadService;

        this._recentsManager = null;
        this._recentsSignalId = 0;
    }

    // ========================================================================
    // Recents
    // ========================================================================

    /**
     * Initializes the recents manager and connects the change listener.
     * @param {Function} onRecentsChanged Callback for when recents change.
     */
    initializeRecents(onRecentsChanged) {
        if (this._recentsManager) return;

        this._recentsManager = getRecentItemsManager(this._extension.uuid, this._settings, FileItem.RECENT_GIFS, GifSettings.RECENTS_MAX_ITEMS_KEY);

        this._recentsSignalId = this._recentsManager.connect('recents-changed', () => {
            onRecentsChanged();
        });
    }

    /**
     * Returns the current list of recent GIFs.
     * @returns {Array} The list of recent GIFs.
     */
    getRecents() {
        return this._recentsManager?.getRecents() || [];
    }

    // ========================================================================
    // Selection
    // ========================================================================

    /**
     * Handle GIF selection by copying to clipboard and updating recents.
     * @param {object} gifObject The selected GIF data.
     */
    async handleSelection(gifObject) {
        if (!gifObject || !gifObject.full_url) return;

        await GlobalActionService.executeCopyAction({
            onCopy: async () => {
                await this._downloadService.copyToClipboard(gifObject, this._settings, this._clipboardManager);
                return true;
            },
            onPostCopy: () => {
                if (gifObject.preview_url) {
                    const recentItem = { ...gifObject, value: gifObject.full_url };
                    this._recentsManager?.addItem(recentItem);
                }
            },
            settings: this._settings,
            autoPasteKey: 'auto-paste-gif',
            menu: this._extension._indicator.menu,
        });
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources.
     */
    destroy() {
        if (this._recentsSignalId && this._recentsManager) {
            this._recentsManager.disconnect(this._recentsSignalId);
            this._recentsSignalId = 0;
        }

        if (this._recentsManager) {
            this._recentsManager.destroy();
            this._recentsManager = null;
        }
    }
}
