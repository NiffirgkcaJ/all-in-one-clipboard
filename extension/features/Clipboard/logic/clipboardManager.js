import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';
const TEXT_PREVIEW_MAX_LENGTH = 150;

/**
 * ClipboardManager
 *
 * Manages clipboard history, including monitoring clipboard changes,
 * storing text and image items, and handling pinned items.
 */
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
    _init(uuid, settings) {
        super._init();

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
            this._textsDir
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
        GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
            this._processClipboardContent().catch(e =>
                console.error(`[AIO-Clipboard] Unhandled error: ${e.message}`)
            );
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Process clipboard content when it changes
     * Checks for text first, then images if no text is found
     */
    async _processClipboardContent() {
        try {
            // STEP 1: Check for text first (safest operation)
            const text = await new Promise(resolve => {
                St.Clipboard.get_default().get_text(
                    St.ClipboardType.CLIPBOARD,
                    (_, text) => resolve(text)
                );
            });

            // If text exists, process it and stop
            if (text && text.trim() !== '') {
                if (text !== this._lastContent) {
                    this._lastContent = text;
                    this._addTextItem(text);
                }
                return;
            }

            // STEP 2: Only check for images if no text was found
            const mimetypesToProbe = [
                'image/png',
                'image/jpeg',
                'image/jpg',
                'image/gif',
                'image/webp'
            ];

            for (const mimetype of mimetypesToProbe) {
                const imageData = await new Promise(resolve => {
                    St.Clipboard.get_default().get_content(
                        St.ClipboardType.CLIPBOARD,
                        mimetype,
                        (_, bytes) => {
                            if (bytes && bytes.get_size() > 0) {
                                const data = bytes.get_data();
                                const hash = GLib.compute_checksum_for_data(
                                    GLib.ChecksumType.SHA256,
                                    data
                                );
                                resolve({ data, hash, mimetype });
                            } else {
                                resolve(null);
                            }
                        }
                    );
                });

                if (imageData) {
                    if (imageData.hash !== this._lastContent) {
                        this._lastContent = imageData.hash;
                        this._addImageItem(
                            imageData.data,
                            imageData.mimetype,
                            imageData.hash
                        );
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn(
                `[AIO-Clipboard] Could not process clipboard content: ${e.message}\n${e.stack}`
            );
        }
    }

    /**
     * Add a text item to clipboard history
     * Handles deduplication and stores full content separately if needed
     *
     * @param {string} text - The text content
     */
    _addTextItem(text) {
        const textBytes = new TextEncoder().encode(text);
        const hash = GLib.compute_checksum_for_data(
            GLib.ChecksumType.SHA256,
            textBytes
        );

        // Check for duplicate in history
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
            // If the setting is OFF, do nothing. The item remains pinned.
            return;
        }

        // Create new text item
        const id = GLib.uuid_string_random();

        // For display preview: collapse consecutive spaces/tabs, but preserve newlines
        const preview = text
            .replace(/[ \t]+/g, ' ')  // Only collapse spaces and tabs, NOT newlines
            .trim()
            .substring(0, TEXT_PREVIEW_MAX_LENGTH);

        const has_full_content = text.length > TEXT_PREVIEW_MAX_LENGTH;

        // Save full content to file if it exceeds preview length
        if (has_full_content) {
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([this._textsDir, `${id}.txt`])
            );
            this._saveFile(file, new GLib.Bytes(textBytes));
        }

        // Add to history
        this._history.unshift({
            id,
            type: 'text',
            timestamp: Math.floor(Date.now() / 1000),
            preview: has_full_content ? preview : text,  // Store full text if short
            has_full_content,
            hash
        });

        this._pruneHistory();
        this._saveHistory();
        this.emit('history-changed');
    }

    /**
     * Add an image item to clipboard history
     * Handles deduplication by checking both history and pinned items
     *
     * @param {Uint8Array} data - The image data
     * @param {string} mimetype - The image MIME type
     * @param {string} hash - SHA256 hash of the image data
     */
    _addImageItem(data, mimetype, hash) {
        // Check for duplicate in history
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

        // Create new image item
        const id = GLib.uuid_string_random();
        const extension = mimetype.split('/')[1] || 'img';
        const filename = `${Date.now()}_${id.substring(0, 8)}.${extension}`;
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([this._imagesDir, filename])
        );

        // Save image file
        const bytesToSave = GLib.Bytes.new(data);
        this._saveFile(file, bytesToSave);

        // Add to history
        this._history.unshift({
            id,
            type: 'image',
            timestamp: Math.floor(Date.now() / 1000),
            image_filename: filename,
            hash
        });

        this._pruneHistory();
        this._saveHistory();
        this.emit('history-changed');
    }

    // ===========================
    // Data Management Methods
    // ===========================

    /**
     * Load clipboard history and pinned items from disk
     *
     * @returns {Promise<boolean>} Success status
     */
    async loadData() {
        /**
         * Helper function to load a file asynchronously
         *
         * @param {Gio.File} file - File to load
         * @returns {Promise<Uint8Array|null>} File contents or null
         */
        const loadFile = async (file) => {
            try {
                const bytes = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (source, res) => {
                        try {
                            const [ok, contents] = source.load_contents_finish(res);
                            resolve(ok ? contents : null);
                        } catch (e) {
                            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                                resolve(null);
                            } else {
                                reject(e);
                            }
                        }
                    });
                });
                return bytes;
            } catch (e) {
                return null;
            }
        };

        try {
            const historyBytes = await loadFile(this._historyFile);
            const pinnedBytes = await loadFile(this._pinnedFile);

            this._history = historyBytes
                ? JSON.parse(new TextDecoder().decode(historyBytes))
                : [];
            this._pinned = pinnedBytes
                ? JSON.parse(new TextDecoder().decode(pinnedBytes))
                : [];

            this.emit('history-changed');
            this.emit('pinned-list-changed');
            return true;
        } catch (e) {
            this._history = [];
            this._pinned = [];
            this.emit('history-changed');
            this.emit('pinned-list-changed');
            return false;
        }
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
        file.replace_async(
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            GLib.PRIORITY_DEFAULT,
            null,
            (source, res) => {
                try {
                    const stream = source.replace_finish(res);
                    stream.write_bytes_async(
                        bytes,
                        GLib.PRIORITY_DEFAULT,
                        null,
                        (w_source, w_res) => {
                            try {
                                w_source.write_bytes_finish(w_res);
                                stream.close(null);
                            } catch (e) {
                                console.error(
                                    `[AIO-Clipboard] Error writing bytes to stream: ${e.message}`
                                );
                            }
                        }
                    );
                } catch (e) {
                    console.error(
                        `[AIO-Clipboard] Error replacing file content: ${e.message}`
                    );
                }
            }
        );
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

            // Collect valid filenames from pinned items
            this._pinned.forEach(item => {
                if (item.type === 'image') {
                    validImages.add(item.image_filename);
                }
                if (item.type === 'text' && item.has_full_content) {
                    validTexts.add(`${item.id}.txt`);
                }
            });

            // Collect valid filenames from history items
            this._history.forEach(item => {
                if (item.type === 'image') {
                    validImages.add(item.image_filename);
                }
                if (item.type === 'text' && item.has_full_content) {
                    validTexts.add(`${item.id}.txt`);
                }
            });

            // Clean up both directories
            const dirsToClean = [
                { dir: this._imagesDir, validNames: validImages },
                { dir: this._textsDir, validNames: validTexts }
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
        if (this._selectionOwnerChangedId) {
            this._selection.disconnect(this._selectionOwnerChangedId);
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
        }
    }
});