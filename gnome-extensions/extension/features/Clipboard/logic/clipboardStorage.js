import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { FilePath, FileItem } from '../../../shared/constants/storagePaths.js';
import { IOFile, IOText } from '../../../shared/utilities/utilityIO.js';

import { ClipboardType } from '../constants/clipboardConstants.js';

// Configuration
const PRUNE_BATCH_SIZE = 5;
const WARMUP_BATCH_SIZE = 1;

// Configuration Keys
const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';

/**
 * ClipboardStorage
 *
 * Handles all disk I/O operations, history pruning, and data integrity healing for the clipboard manager.
 */
export class ClipboardStorage {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize storage paths and settings.
     *
     * @param {Gio.Settings} settings Extension settings.
     */
    constructor(settings) {
        this._settings = settings;

        this._linkPreviewsDir = FilePath.LINK_PREVIEWS;
        this._imagesDir = FilePath.IMAGES;
        this._imagePreviewsDir = FilePath.IMAGE_PREVIEWS;
        this._textsDir = FilePath.TEXTS;
        this._historyFilePath = FileItem.CLIPBOARD_HISTORY;
        this._pinnedFilePath = FileItem.CLIPBOARD_PINNED;

        this._previewWarmupId = 0;
        this._previewWarmupQueue = null;

        this._ensureDirectories();
    }

    // ========================================================================
    // Getters
    // ========================================================================

    /**
     * Get the directory path for link previews.
     *
     * @returns {string} Directory path.
     */
    get linkPreviewsDir() {
        return this._linkPreviewsDir;
    }

    /**
     * Get the directory path for captured images.
     *
     * @returns {string} Directory path.
     */
    get imagesDir() {
        return this._imagesDir;
    }

    /**
     * Get the directory path for image previews.
     *
     * @returns {string} Directory path.
     */
    get imagePreviewsDir() {
        return this._imagePreviewsDir;
    }

    /**
     * Get the directory path for full text content.
     *
     * @returns {string} Directory path.
     */
    get textsDir() {
        return this._textsDir;
    }

    /**
     * Read raw bytes from a file.
     *
     * @param {string} path File path.
     * @returns {Promise<Uint8Array|null>} File content or null if reading failed.
     */
    async readRaw(path) {
        return await IOFile.read(path);
    }

    /**
     * Ensure all required storage directories exist.
     *
     * @private
     */
    _ensureDirectories() {
        [this._imagesDir, this._imagePreviewsDir, this._textsDir, this._linkPreviewsDir].forEach((path) => {
            IOFile.mkdir(path);
        });
    }

    // ========================================================================
    // Loading & Saving
    // ========================================================================

    /**
     * Load clipboard history and pinned items from disk.
     *
     * @returns {Promise<Object>} Object containing history and pinned arrays.
     */
    async loadData() {
        const history = (await IOFile.readJson(this._historyFilePath)) || [];
        const pinned = (await IOFile.readJson(this._pinnedFilePath)) || [];

        return { history, pinned };
    }

    /**
     * Save clipboard history to disk.
     *
     * @param {Array} history The history array to save.
     */
    async saveHistory(history) {
        await IOFile.writeJson(this._historyFilePath, history);
    }

    /**
     * Save pinned items to disk.
     *
     * @param {Array} pinned The pinned array to save.
     */
    async savePinned(pinned) {
        await IOFile.writeJson(this._pinnedFilePath, pinned);
    }

    /**
     * Save both history and pinned items to disk simultaneously.
     *
     * @param {Array} history History array.
     * @param {Array} pinned Pinned array.
     */
    async saveAll(history, pinned) {
        await Promise.all([this.saveHistory(history), this.savePinned(pinned)]);
    }

    // ========================================================================
    // Content Retrieval
    // ========================================================================

    /**
     * Get full content for a text or code item from disk.
     *
     * @param {string} id Item ID.
     * @param {Array} allItems Combined history and pinned items.
     * @returns {Promise<string|null>} Full content or null if not found.
     */
    async getContent(id, allItems) {
        const item = allItems.find((i) => i.id === id);

        if (!item || (item.type !== ClipboardType.TEXT && item.type !== ClipboardType.CODE)) {
            return null;
        }

        if (item.has_full_content) {
            try {
                const fullPath = GLib.build_filenamev([this._textsDir, `${item.id}.txt`]);
                const bytes = await IOFile.read(fullPath);
                return bytes ? IOText.parseBytes(bytes) : null;
            } catch {
                return null;
            }
        }

        return item.text || null;
    }

    // ========================================================================
    // Maintenance & Pruning
    // ========================================================================

    /**
     * Remove oldest items from history and clean up their associated files.
     *
     * @param {Array} history The history list to prune.
     */
    pruneHistory(history) {
        const maxHistory = this._settings.get_int(CLIPBOARD_HISTORY_MAX_ITEMS_KEY);
        if (history.length <= maxHistory) return;

        const itemsToRemove = [];
        while (history.length > maxHistory) {
            itemsToRemove.push(history.pop());
        }

        const processBatch = () => {
            if (itemsToRemove.length === 0) return GLib.SOURCE_REMOVE;

            const batch = itemsToRemove.splice(0, PRUNE_BATCH_SIZE);
            batch.forEach((item) => this.deleteItemFiles(item));

            return itemsToRemove.length > 0 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        };

        GLib.idle_add(GLib.PRIORITY_LOW, processBatch);
    }

    /**
     * Delete all files associated with a specific clipboard item.
     *
     * @param {Object} item The item whose files should be deleted.
     */
    deleteItemFiles(item) {
        if (!item) return;

        if (item.icon_filename) this._deleteFile(this._linkPreviewsDir, item.icon_filename);
        if (item.gradient_filename) this._deleteFile(this._imagesDir, item.gradient_filename);

        if (item.type === ClipboardType.IMAGE) {
            this._deleteFile(this._imagesDir, item.image_filename);
            this._deleteFile(this._imagePreviewsDir, item.preview_filename);
        }

        if ((item.type === ClipboardType.TEXT || item.type === ClipboardType.CODE) && item.has_full_content) {
            this._deleteFile(this._textsDir, `${item.id}.txt`);
        }
    }

    /**
     * Internal helper to delete a file if it exists.
     *
     * @param {string} dirPath Directory path.
     * @param {string} filename File name.
     * @private
     */
    _deleteFile(dirPath, filename) {
        if (!filename) return;
        const fullPath = GLib.build_filenamev([dirPath, filename]);
        IOFile.delete(fullPath).catch(() => {});
    }

    // ========================================================================
    // Data Integrity & Healing
    // ========================================================================

    /**
     * Verify the integrity of clipboard items and attempt to heal any missing data.
     *
     * @param {Array} history History items.
     * @param {Array} pinned Pinned items.
     * @param {ClipboardRegistry} clipboardRegistry Clipboard registry.
     * @param {Soup.Session} httpSession HTTP session for network operations.
     * @returns {Promise<boolean>} True if any items were modified or healed.
     */
    async verifyAndHealData(history, pinned, clipboardRegistry, httpSession) {
        let changed = false;
        const allItems = [...history, ...pinned];

        const processChunk = async (items, chunkSize) => {
            if (items.length === 0) return false;
            const chunk = items.slice(0, chunkSize);
            const rest = items.slice(chunkSize);
            const results = await Promise.all(chunk.map((item) => this._processItem(item, clipboardRegistry, httpSession)));
            const chunkChanged = results.some((r) => r);
            const restChanged = await processChunk(rest, chunkSize);
            return chunkChanged || restChanged;
        };

        if (await processChunk(allItems, 5)) changed = true;

        return changed;
    }

    /**
     * Process an item for verification and healing.
     *
     * @param {Object} item Clipboard item.
     * @param {ClipboardRegistry} clipboardRegistry Clipboard registry.
     * @param {Soup.Session} httpSession HTTP session.
     * @returns {Promise<boolean>} True if the item was modified.
     * @private
     */
    async _processItem(item, clipboardRegistry, httpSession) {
        const { healed, isCorrupted } = await clipboardRegistry.verifyAndHealItem(item, {
            storage: this,
            httpSession,
        });

        if (healed) return true;

        const wasCorrupted = item.is_corrupted || false;
        if (isCorrupted !== wasCorrupted) {
            item.is_corrupted = isCorrupted;
            return true;
        }

        return false;
    }

    /**
     * Check if a specific file exists on disk.
     *
     * @param {string} dirPath Directory path.
     * @param {string} filename File name.
     * @returns {boolean} True if the file exists.
     */
    checkFileExists(dirPath, filename) {
        if (!filename) return true;
        return IOFile.existsSync(GLib.build_filenamev([dirPath, filename]));
    }

    // ========================================================================
    // Background Operations
    // ========================================================================

    /**
     * Gradually generate missing image previews in the background.
     *
     * @param {Array} history History items.
     * @param {Array} pinned Pinned items.
     * @param {ClipboardRegistry} clipboardRegistry Clipboard registry.
     * @param {Function} onComplete Callback function for when warmup is complete.
     */
    scheduleImagePreviewWarmup(history, pinned, clipboardRegistry, onComplete) {
        if (this._previewWarmupId) return;

        const queue = clipboardRegistry.getPreviewWarmupItems([...pinned, ...history]);
        if (queue.length === 0) return;

        this._previewWarmupQueue = queue;
        let didUpdate = false;

        this._previewWarmupId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            let processed = 0;

            while (this._previewWarmupQueue.length > 0 && processed < WARMUP_BATCH_SIZE) {
                const item = this._previewWarmupQueue.shift();
                processed += 1;
                if (!item) continue;

                const updated = clipboardRegistry.warmupItem(item, {
                    storage: this,
                });
                if (updated) didUpdate = true;
            }

            if (this._previewWarmupQueue.length === 0) {
                if (didUpdate && onComplete) onComplete();
                this._previewWarmupQueue = null;
                this._previewWarmupId = 0;
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Run garbage collection to remove orphaned files from storage directories.
     *
     * @param {Array} history History items.
     * @param {Array} pinned Pinned items.
     */
    async runGarbageCollection(history, pinned) {
        try {
            const validImages = new Set();
            const validTexts = new Set();
            const validLinks = new Set();
            const validImagePreviews = new Set();

            const collect = (list) => {
                list.forEach((item) => {
                    if (item.type === ClipboardType.IMAGE) validImages.add(item.image_filename);
                    if (item.type === ClipboardType.IMAGE && item.preview_filename) validImagePreviews.add(item.preview_filename);
                    if ((item.type === ClipboardType.TEXT || item.type === ClipboardType.CODE) && item.has_full_content) {
                        validTexts.add(`${item.id}.txt`);
                    }
                    if (item.type === ClipboardType.URL && item.icon_filename) validLinks.add(item.icon_filename);
                    if (item.type === ClipboardType.CONTACT && item.icon_filename) validLinks.add(item.icon_filename);
                    if (item.type === ClipboardType.COLOR && item.gradient_filename) validImages.add(item.gradient_filename);
                });
            };

            collect(pinned);
            collect(history);

            const cleanDir = async (dirPath, validSet) => {
                const files = await IOFile.list(dirPath);
                if (!files) return;

                const deletePromises = [];
                for (const file of files) {
                    if (!validSet.has(file.name)) {
                        deletePromises.push(IOFile.delete(file.path));
                    }
                }
                await Promise.all(deletePromises);
            };

            await Promise.all([
                cleanDir(this._imagesDir, validImages),
                cleanDir(this._imagePreviewsDir, validImagePreviews),
                cleanDir(this._textsDir, validTexts),
                cleanDir(this._linkPreviewsDir, validLinks),
            ]);
        } catch (e) {
            Logger.error(`GC Error: ${e.message}`);
        }
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources and stop background operations before destruction.
     */
    destroy() {
        if (this._previewWarmupId) {
            GLib.source_remove(this._previewWarmupId);
            this._previewWarmupId = 0;
        }

        this._previewWarmupQueue = null;
    }
}
