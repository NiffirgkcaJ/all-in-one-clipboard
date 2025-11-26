import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ColorProcessor } from '../processors/clipboardColorProcessor.js';
import { FileProcessor } from '../processors/clipboardFileProcessor.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';

// Clipboard processing delay for slow applications
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

export const ClipboardManager = GObject.registerClass({
    Signals: {
        'history-changed': {},
        'pinned-list-changed': {},
    },
},
class ClipboardManager extends GObject.Object {
    /**
     * Initialize the clipboard manager
     *
     * @param {string} uuid - Extension UUID
     * @param {Gio.Settings} settings - Extension settings
     */
    constructor(uuid, settings) {
        super();

        this._uuid = uuid;
        this._settings = settings;
        this._initialLoadSuccess = false;

        // Setup directory paths
        this._cacheDir = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            this._uuid
        ]);
        this._dataDir = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            this._uuid
        ]);
        this._linkPreviewsDir = GLib.build_filenamev([this._cacheDir, 'link-previews']);
        this._imagesDir = GLib.build_filenamev([this._dataDir, 'images']);
        this._textsDir = GLib.build_filenamev([this._dataDir, 'texts']);

        // Setup data files
        this._historyFile = Gio.File.new_for_path(
            GLib.build_filenamev([this._cacheDir, 'history_clipboard.json'])
        );
        this._pinnedFile = Gio.File.new_for_path(
            GLib.build_filenamev([this._dataDir, 'pinned_clipboard.json'])
        );

        // Initialize state
        this._history = [];
        this._pinned = [];
        this._lastContent = null;
        this._selection = null;
        this._debouncing = 0;
        this._isPaused = false;
        this._maxHistory = this._settings.get_int(CLIPBOARD_HISTORY_MAX_ITEMS_KEY);
        this._processClipboardTimeoutId = 0;

        this._ensureDirectories();
        this._setupClipboardMonitoring();
        this._setupSettingsMonitoring();
    }

    // ===========================
    // Initialization Methods
    // ===========================

    /**
     * Setup clipboard change monitoring
     */
    _setupClipboardMonitoring() {
        this._selection = Shell.Global.get().get_display().get_selection();

        this._selectionOwnerChangedId = this._selection.connect(
            'owner-changed',
            (selection, selectionType) => {
                if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
                    this._onClipboardChanged();
                }
            }
        );
    }

    /**
     * Setup settings monitoring for max history changes
     */
    _setupSettingsMonitoring() {
        this._settingsChangedId = this._settings.connect(
            `changed::${CLIPBOARD_HISTORY_MAX_ITEMS_KEY}`,
            () => {
                this._maxHistory = this._settings.get_int(CLIPBOARD_HISTORY_MAX_ITEMS_KEY);
                this._pruneHistory();
            }
        );
    }

    /**
     * Load data from disk and prepare the manager for use
     *
     * @returns {Promise<boolean>} Success status of initial load
     */
    async loadAndPrepare() {
        this._initialLoadSuccess = await this.loadData();
        return this._initialLoadSuccess;
    }

    /**
     * Ensure all required directories exist
     */
    _ensureDirectories() {
        const directories = [
            this._cacheDir,
            this._dataDir,
            this._imagesDir,
            this._textsDir,
            this._linkPreviewsDir
        ];

        directories.forEach(path => {
            const dir = Gio.File.new_for_path(path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
        });
    }

    // ===========================
    // Clipboard Processing Methods
    // ===========================

    /**
     * Handle clipboard content changes
     */
    _onClipboardChanged() {
        // Check if paused first
        if (this._isPaused) {
            return;
        }

        // Skip if debouncing
        if (this._debouncing > 0) {
            this._debouncing--;
            return;
        }

        // Use timeout to allow keyboard events to finish processing
        if (this._processClipboardTimeoutId) {
            GLib.source_remove(this._processClipboardTimeoutId);
        }

        // Initial delay to let the app breathe
        this._processClipboardTimeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
            // Process clipboard content with retries
            this._processClipboardContent(1).catch(e =>
                console.error(`[AIO-Clipboard] Unhandled error: ${e.message}`)
            );
            this._processClipboardTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Process clipboard content with retries for slow apps
     *
     * @param {number} attempt - Current attempt number
     */
    async _processClipboardContent(attempt = 1) {
        try {
            // Image first
            const imageResult = await ImageProcessor.extract();
            if (imageResult) {
                if (imageResult.hash !== this._lastContent) {
                    this._lastContent = imageResult.hash;
                    this._handleExtractedContent(imageResult, ImageProcessor, this._imagesDir);
                }
                return; // Found image, stop.
            }

            // Text next
            const textResult = await TextProcessor.extract();
            if (textResult) {
                // Analyze if the text is a file path
                const analysis = await FileProcessor.process(textResult.text);

                if (analysis) {
                    // It's a file URI or path
                    if (analysis.hash !== this._lastContent) {
                        this._lastContent = analysis.hash;
                        if (analysis.type === 'image') {
                            this._handleExtractedContent(analysis, ImageProcessor, this._imagesDir);
                        } else {
                            this._handleGenericFileItem(analysis);
                        }
                    }
                    return; // Found file, stop.
                }

                // Check if it is a Link
                const linkResult = LinkProcessor.process(textResult.text);
                if (linkResult) {
                    if (linkResult.hash !== this._lastContent) {
                        this._lastContent = linkResult.hash;

                        const newItem = {
                            id: GLib.uuid_string_random(),
                            type: 'url',
                            timestamp: Math.floor(Date.now() / 1000),
                            url: linkResult.url,
                            title: linkResult.title,
                            hash: linkResult.hash,
                            icon_filename: null // Initialize as null
                        };

                        this._history.unshift(newItem);
                        this._pruneHistory();
                        this._saveHistory();
                        this.emit('history-changed');

                        // Fetch metadata asynchronously
                        LinkProcessor.fetchMetadata(newItem.url).then(async (metadata) => {
                            let updated = false;
                            const item = this._history.find(i => i.id === newItem.id);

                            if (!item) return; // Item deleted before fetch finished

                            if (metadata.title) {
                                item.title = metadata.title;
                                updated = true;
                            }

                            if (metadata.iconUrl) {
                                const filename = await LinkProcessor.downloadFavicon(
                                    metadata.iconUrl,
                                    this._linkPreviewsDir,
                                    newItem.id
                                );
                                if (filename) {
                                    item.icon_filename = filename;
                                    updated = true;
                                }
                            }

                            if (updated) {
                                this._saveHistory();
                                this.emit('history-changed');
                            }
                        });
                    }
                    return; // Found link, stop.
                }

                // Check if it is a Color
                const colorResult = ColorProcessor.process(textResult.text);
                if (colorResult) {
                    if (colorResult.hash !== this._lastContent) {
                        this._lastContent = colorResult.hash;

                        const newItem = {
                            id: GLib.uuid_string_random(),
                            type: 'color',
                            timestamp: Math.floor(Date.now() / 1000),
                            color_value: colorResult.color_value,
                            format_type: colorResult.format_type,
                            hash: colorResult.hash,
                            preview: colorResult.color_value // Useful for text filtering
                        };

                        this._history.unshift(newItem);
                        this._pruneHistory();
                        this._saveHistory();
                        this.emit('history-changed');
                    }
                    return; // Found color, stop.
                }

                // It's just text
                if (textResult.text !== this._lastContent) {
                    this._lastContent = textResult.text;
                    this._handleExtractedContent(textResult, TextProcessor, this._textsDir);
                }
                return; // Found text, stop.
            }

            // Nothing found, retry if attempts remain
            if (attempt <= MAX_RETRIES) {
                console.log(`[AIO-Clipboard] Nothing found on attempt ${attempt}. Retrying in ${RETRY_DELAY_MS}ms...`);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_DELAY_MS, () => {
                    this._processClipboardContent(attempt + 1);
                    return GLib.SOURCE_REMOVE;
                });
            }

        } catch (e) {
            console.warn(`[AIO-Clipboard] Could not process clipboard content: ${e.message}\n${e.stack}`);
        }
    }

    // ===========================
    // Event Handlers
    // ===========================

    /**
     * Handles generic file items
     *
     * @param {Object} itemData - Extracted item data
     */
    _handleGenericFileItem(itemData) {
        const { hash, file_uri, preview } = itemData;
        const historyIndex = this._history.findIndex(item => item.hash === hash);
        if (historyIndex > -1) {
            const [item] = this._history.splice(historyIndex, 1);
            this._history.unshift(item);
            this._saveHistory();
            this.emit('history-changed');
            return;
        }

        // Check for duplicate in pinned items
        const pinnedIndex = this._pinned.findIndex(item => item.hash === hash);
        if (pinnedIndex > -1) {
            // If the item is already pinned, only unpin it if the setting is enabled.
            if (this._settings.get_boolean('unpin-on-paste')) {
                const [item] = this._pinned.splice(pinnedIndex, 1);
                this._history.unshift(item);
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
            // If the setting is off, do nothing. The item remains pinned.
            return;
        }
        const newItem = {
            id: GLib.uuid_string_random(),
            type: 'file',
            timestamp: Math.floor(Date.now() / 1000),
            preview: preview,
            file_uri: file_uri,
            hash: hash
        };
        this._history.unshift(newItem);
        this._pruneHistory();
        this._saveHistory();
        this.emit('history-changed');
    }

    /**
     * Handle newly extracted content from the clipboard
     *
     * @param {Object} extraction - Extracted content data
     * @param {Class} ProcessorClass - Processor class used for saving
     * @param {string} storageDir - Directory to store content files
     */
    _handleExtractedContent(extraction, ProcessorClass, storageDir) {
        const { hash } = extraction;
        const historyIndex = this._history.findIndex(item => item.hash === hash);
        if (historyIndex > -1) {
            const [item] = this._history.splice(historyIndex, 1);
            this._history.unshift(item);
            this._saveHistory();
            this.emit('history-changed');
            return;
        }

        // Check for duplicate in pinned items
        const pinnedIndex = this._pinned.findIndex(item => item.hash === hash);
        if (pinnedIndex > -1) {
            // If the item is already pinned, only unpin it if the setting is enabled.
            if (this._settings.get_boolean('unpin-on-paste')) {
                const [item] = this._pinned.splice(pinnedIndex, 1);
                this._history.unshift(item);
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
            // If the setting is off, do nothing. The item remains pinned.
            return;
        }
        const newItem = ProcessorClass.save(extraction, storageDir);
        if (newItem) {
            this._history.unshift(newItem);
            this._pruneHistory();
            this._saveHistory();
            this.emit('history-changed');
        }
    }

    // ===========================
    // Data Management Methods
    // ===========================

    /**
     * Load data from disk and prepare the manager for use
     *
     * @returns {Promise<boolean>} Success status of initial load
     */
    async loadData() {
        const loadFile = async (file) => {
            try {
                const bytes = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (source, res) => {
                        try {
                            const [ok, contents] = source.load_contents_finish(res);
                            resolve(ok ? contents : null);
                        } catch (e) {
                            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                                resolve(null); // Not an error, just an empty file
                            } else {
                                reject(e); // A real error
                            }
                        }
                    });
                });
                return bytes;
            } catch (e) {
                // Return null on error so we can handle it gracefully below
                console.warn(`[AIO-Clipboard] Could not load file ${file.get_path()}: ${e.message}`);
                return null;
            }
        };

        // Load history data
        try {
            const historyBytes = await loadFile(this._historyFile);
            this._history = historyBytes
                ? JSON.parse(new TextDecoder().decode(historyBytes))
                : [];
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to parse history_clipboard.json. History will be empty. Error: ${e.message}`);
            this._history = []; // Default to empty on parse failure
        }

        // Load pinned data
        try {
            const pinnedBytes = await loadFile(this._pinnedFile);
            this._pinned = pinnedBytes
                ? JSON.parse(new TextDecoder().decode(pinnedBytes))
                : [];
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to parse pinned_clipboard.json. Pinned items will be empty. Error: ${e.message}`);
            this._pinned = []; // Default to empty on parse failure
        }

        // Emit signals to update the UI with whatever data was successfully loaded.
        this.emit('history-changed');
        this.emit('pinned-list-changed');

        // Load is always successful, resulting in a stable state for safe garbage collection.
        return true;
    }

    /**
     * Save history to disk
     */
    _saveHistory() {
        if (!this._initialLoadSuccess) {
            return;
        }

        const json = JSON.stringify(this._history, null, 2);
        const bytes = new GLib.Bytes(new TextEncoder().encode(json));
        this._saveFile(this._historyFile, bytes);
    }

    /**
     * Save pinned items to disk
     */
    _savePinned() {
        if (!this._initialLoadSuccess) {
            return;
        }

        const json = JSON.stringify(this._pinned, null, 2);
        const bytes = new GLib.Bytes(new TextEncoder().encode(json));
        this._saveFile(this._pinnedFile, bytes);
    }

    /**
     * Save both history and pinned items to disk
     */
    _saveAll() {
        this._saveHistory();
        this._savePinned();
    }

    /**
     * Asynchronously save data to a file
     *
     * @param {Gio.File} file - The file to save to
     * @param {GLib.Bytes} bytes - The data to save
     */
    _saveFile(file, bytes) {
        file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (source, res) => {
            try {
                const stream = source.replace_finish(res);
                stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (w_source, w_res) => {
                    try {
                        w_source.write_bytes_finish(w_res);
                        stream.close(null);
                    } catch (e) {
                        console.error(`[AIO-Clipboard] Error writing bytes to stream: ${e.message}`);
                    }
                });
            } catch (e) {
                console.error(`[AIO-Clipboard] Error replacing file content: ${e.message}`);
            }
        });
    }

    /**
     * Remove excess items from history based on max limit
     */
    _pruneHistory() {
        if (!this._initialLoadSuccess) {
            return;
        }

        while (this._history.length > this._maxHistory) {
            const item = this._history.pop();

            if (item.type === 'image') {
                this._deleteImageFile(item.image_filename);
            }
            if (item.type === 'text' && item.has_full_content) {
                this._deleteTextFile(item.id);
            }
        }
    }

    // ===========================
    // Item Access Methods
    // ===========================

    /**
     * Get all history items
     *
     * @returns {Object[]} Array of history items
     */
    getHistoryItems() {
        return this._history;
    }

    /**
     * Get all pinned items
     *
     * @returns {Object[]} Array of pinned items
     */
    getPinnedItems() {
        return this._pinned;
    }

    /**
     * Get the full content of a text item
     *
     * @param {string} id - Item ID
     * @returns {Promise<string|null>} Full text content or null
     */
    async getContent(id) {
        const item = [...this._history, ...this._pinned].find(i => i.id === id);

        if (!item || item.type !== 'text') {
            return null;
        }

        // Return full content from file if available
        if (item.has_full_content) {
            try {
                const file = Gio.File.new_for_path(
                    GLib.build_filenamev([this._textsDir, `${item.id}.txt`])
                );

                const bytes = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (s, r) => {
                        try {
                            const [ok, c] = s.load_contents_finish(r);
                            resolve(ok ? c : null);
                        } catch (e) {
                            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                                resolve(null);
                            } else {
                                reject(e);
                            }
                        }
                    });
                });

                return bytes ? new TextDecoder().decode(bytes) : item.preview;
            } catch (e) {
                return item.preview;
            }
        }

        return item.preview;
    }

    // ===========================
    // Item Manipulation Methods
    // ===========================

    /**
     * Pin an item from history
     *
     * @param {string} id - Item ID to pin
     */
    pinItem(id) {
        const index = this._history.findIndex(item => item.id === id);

        if (index === -1) {
            return;
        }

        const [item] = this._history.splice(index, 1);
        this._pinned.unshift(item);
        this._saveAll();
        this.emit('history-changed');
        this.emit('pinned-list-changed');
    }

    /**
     * Unpin an item and move it back to history
     *
     * @param {string} id - Item ID to unpin
     */
    unpinItem(id) {
        const index = this._pinned.findIndex(item => item.id === id);

        if (index === -1) {
            return;
        }

        const [item] = this._pinned.splice(index, 1);
        this._history.unshift(item);
        this._pruneHistory();
        this._saveAll();
        this.emit('history-changed');
        this.emit('pinned-list-changed');
    }

    /**
     * Move an item to the top of its list.
     * If the item is pinned, it will be unpinned and moved to history ONLY
     * if the 'unpin-on-paste' setting is enabled.
     *
     * @param {string} id - Item ID to promote
     */
    promoteItemToTop(id) {
        // First, check if the item is in the pinned list
        const pinnedIndex = this._pinned.findIndex(item => item.id === id);
        if (pinnedIndex > -1) {
            // Only unpin if the setting is enabled
            if (this._settings.get_boolean('unpin-on-paste')) {
                const [item] = this._pinned.splice(pinnedIndex, 1);
                this._history.unshift(item);
                this._pruneHistory();
                this._saveAll();
                this.emit('history-changed');
                this.emit('pinned-list-changed');
            }
            // If setting is disabled, do nothing to the pinned item.
            return;
        }

        // If not pinned, check the history list
        const historyIndex = this._history.findIndex(item => item.id === id);
        if (historyIndex > -1) {
            // Only move it if the setting is enabled and it's not already at the top
            if (this._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                const [item] = this._history.splice(historyIndex, 1);
                this._history.unshift(item);
                this._saveHistory();
                this.emit('history-changed');
            }
        }
    }

    /**
     * Delete an item from history or pinned items
     *
     * @param {string} id - Item ID to delete
     */
    deleteItem(id) {
        let wasDeleted = false;

        /**
         * Helper function to delete from a list
         *
         * @param {Object[]} list - List to delete from
         */
        const deleteLogic = (list) => {
            const index = list.findIndex(item => item.id === id);

            if (index > -1) {
                const [item] = list.splice(index, 1);

                if (item.type === 'image') {
                    this._deleteImageFile(item.image_filename);
                }
                if (item.type === 'text' && item.has_full_content) {
                    this._deleteTextFile(item.id);
                }

                wasDeleted = true;
            }
        };

        deleteLogic(this._history);
        deleteLogic(this._pinned);

        if (wasDeleted) {
            this._saveAll();
            this.emit('history-changed');
            this.emit('pinned-list-changed');
        }
    }

    // ===========================
    // List Manipulation Methods
    // ===========================

    /**
     * Deletes all items from the history.
     */
    clearHistory() {
        if (!this._initialLoadSuccess) return;

        // Delete associated files first to prevent orphans
        this._history.forEach(item => {
            if (item.type === 'image') {
                this._deleteImageFile(item.image_filename);
            }
            if (item.type === 'text' && item.has_full_content) {
                this._deleteTextFile(item.id);
            }
        });

        this._history = [];
        this._saveHistory();
        this.emit('history-changed');
    }

    /**
     * Deletes all items from the pinned list.
     */
    clearPinned() {
        if (!this._initialLoadSuccess) return;

        // Delete associated files first to prevent orphans
        this._pinned.forEach(item => {
            if (item.type === 'image') {
                this._deleteImageFile(item.image_filename);
            }
            if (item.type === 'text' && item.has_full_content) {
                this._deleteTextFile(item.id);
            }
        });

        this._pinned = [];
        this._savePinned();
        this.emit('pinned-list-changed');
    }

    // ===========================
    // File Management Methods
    // ===========================

    /**
     * Delete an image file from disk
     *
     * @param {string} filename - Image filename to delete
     */
    _deleteImageFile(filename) {
        if (!filename) {
            return;
        }

        try {
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([this._imagesDir, filename])
            );
            file.delete_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            // Ignore errors
        }
    }

    /**
     * Delete a text file from disk
     *
     * @param {string} id - Item ID of text file to delete
     */
    _deleteTextFile(id) {
        if (!id) {
            return;
        }

        try {
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([this._textsDir, `${id}.txt`])
            );
            file.delete_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            // Ignore errors
        }
    }

    /**
     * Run garbage collection to remove orphaned files
     * Removes files that are not referenced in history or pinned lists
     */
    runGarbageCollection() {
        try {
            const validImages = new Set();
            const validTexts = new Set();
            const validLinks = new Set();

            // Collect valid filenames
            const collect = (list) => {
                list.forEach(item => {
                    if (item.type === 'image') validImages.add(item.image_filename);
                    if (item.type === 'text' && item.has_full_content) validTexts.add(`${item.id}.txt`);
                    if (item.type === 'url' && item.icon_filename) validLinks.add(item.icon_filename);
                });
            };
            collect(this._pinned);
            collect(this._history);

            // Directories to clean
            const dirsToClean = [
                { dir: this._imagesDir, validNames: validImages },
                { dir: this._textsDir, validNames: validTexts },
                { dir: this._linkPreviewsDir, validNames: validLinks }
            ];

            dirsToClean.forEach(({ dir, validNames }) => {
                const dirFile = Gio.File.new_for_path(dir);

                if (!dirFile.query_exists(null)) {
                    return;
                }

                const enumerator = dirFile.enumerate_children(
                    'standard::name',
                    Gio.FileCreateFlags.NONE,
                    null
                );

                while (true) {
                    const fileInfo = enumerator.next_file(null);

                    if (!fileInfo) {
                        break;
                    }

                    const filename = fileInfo.get_name();

                    if (!validNames.has(filename)) {
                        dirFile.get_child(filename).delete(null);
                    }
                }
            });
        } catch (e) {
            console.error(`[AIO-Clipboard] Error during GC: ${e.message}`);
        }
    }

    // ===========================
    // State Management Methods
    // ===========================

    /**
     * Set debounce counter to prevent immediate clipboard processing
     */
    setDebounce() {
        this._debouncing++;
    }

    /**
     * Pause or resume clipboard recording
     *
     * @param {boolean} isPaused - Whether to pause recording
     */
    setPaused(isPaused) {
        this._isPaused = isPaused;
    }

    // ===========================
    // Lifecycle Methods
    // ===========================

    /**
     * Cleanup when the manager is destroyed
     */
    destroy() {
        if (this._processClipboardTimeoutId) {
            GLib.source_remove(this._processClipboardTimeoutId);
            this._processClipboardTimeoutId = 0;
        }
        if (this._selectionOwnerChangedId) {
            this._selection.disconnect(this._selectionOwnerChangedId);
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
        }
    }
});