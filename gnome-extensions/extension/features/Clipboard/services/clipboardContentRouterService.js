import Soup from 'gi://Soup';

import { Logger } from '../../../shared/utilities/utilityLogger.js';

/**
 * ClipboardContentRouterService
 *
 * Routes captured clipboard content to the appropriate processor and saves the resulting item to the clipboard item store.
 */
export class ClipboardContentRouterService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the content router.
     *
     * @param {ClipboardItemStore} itemStore Clipboard item store.
     * @param {ClipboardHistoryDeduperService} historyDeduper Duplicate handling service.
     * @param {ClipboardHistoryService} historyService Clipboard history service.
     * @param {ClipboardItemUpdateService} itemUpdateService Item update service.
     * @param {ClipboardRegistry} clipboardRegistry Clipboard registry.
     * @param {ClipboardStorage} storage The clipboard storage.
     * @param {ExclusionUtils} exclusionUtils Exclusion utilities.
     */
    constructor(itemStore, historyDeduper, historyService, itemUpdateService, clipboardRegistry, storage, exclusionUtils) {
        this._itemStore = itemStore;
        this._historyDeduper = historyDeduper;
        this._historyService = historyService;
        this._itemUpdateService = itemUpdateService;
        this._clipboardRegistry = clipboardRegistry;
        this._storage = storage;
        this._exclusionUtils = exclusionUtils;

        this._httpSession = new Soup.Session();
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Get the HTTP session instance.
     *
     * @returns {Soup.Session} The HTTP session.
     */
    get httpSession() {
        return this._httpSession;
    }

    /**
     * Process captured clipboard content and route it to the appropriate handler.
     *
     * @param {Object} result Extracted clipboard content.
     */
    processResult(result) {
        this._processResult(result).catch((e) => Logger.error(`Clipboard routing failed: ${e.message}`));
    }

    /**
     * Process captured clipboard content and dispatch generic item creation.
     *
     * @param {Object} result Extracted clipboard content.
     * @private
     */
    async _processResult(result) {
        if (!result || result.hash === this._itemStore.lastContent) return;
        this._itemStore.lastContent = result.hash;

        if (this._historyDeduper.handleDuplicateCheck(result.hash)) return;

        const newItem = await this._clipboardRegistry.createItemFromResult(result, this._storage);
        if (!newItem) {
            Logger.warn(`No clipboard processor could create item for type: ${result.type}`);
            return;
        }

        this._historyService.insertItemToHistory(newItem);
        await this._clipboardRegistry.enrichItem(newItem, {
            exclusionUtils: this._exclusionUtils,
            itemUpdateService: this._itemUpdateService,
            storage: this._storage,
        });
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources.
     */
    destroy() {
        this._httpSession.abort();
        this._httpSession = null;
        this._historyService = null;
        this._itemUpdateService = null;
        this._clipboardRegistry = null;
    }
}
