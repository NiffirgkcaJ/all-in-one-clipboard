import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardType } from '../constants/clipboardConstants.js';
import { CodeProcessor } from '../processors/clipboardCodeProcessor.js';
import { ColorProcessor } from '../processors/clipboardColorProcessor.js';
import { FileProcessor } from '../processors/clipboardFileProcessor.js';
import { ImageProcessor } from '../processors/clipboardImageProcessor.js';
import { LinkProcessor } from '../processors/clipboardLinkProcessor.js';
import { TextProcessor } from '../processors/clipboardTextProcessor.js';

const CLIPBOARD_HISTORY_MAX_ITEMS_KEY = 'clipboard-history-max-items';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

export const ClipboardManager = GObject.registerClass({
    Signals: {
        'history-changed': {},
        'pinned-list-changed': {},
    },
},
class ClipboardManager extends GObject.Object {
    constructor(uuid, settings) {
        super();
        this._uuid = uuid;
        this._settings = settings;
        this._initialLoadSuccess = false;

        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), this._uuid]);
        this._dataDir = GLib.build_filenamev([GLib.get_user_data_dir(), this._uuid]);
        this._linkPreviewsDir = GLib.build_filenamev([this._cacheDir, 'link-previews']);
        this._imagesDir = GLib.build_filenamev([this._dataDir, 'images']);
        this._textsDir = GLib.build_filenamev([this._dataDir, 'texts']);

        this._historyFile = Gio.File.new_for_path(GLib.build_filenamev([this._cacheDir, 'history_clipboard.json']));
        this._pinnedFile = Gio.File.new_for_path(GLib.build_filenamev([this._dataDir, 'pinned_clipboard.json']));

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

    _setupSettingsMonitoring() {
        this._settingsChangedId = this._settings.connect(
            `changed::${CLIPBOARD_HISTORY_MAX_ITEMS_KEY}`,
            () => {
                this._maxHistory = this._settings.get_int(CLIPBOARD_HISTORY_MAX_ITEMS_KEY);
                this._pruneHistory();
            }
        );
    }

    async loadAndPrepare() {
        this._initialLoadSuccess = await this.loadData();
        return this._initialLoadSuccess;
    }

    _ensureDirectories() {
        [this._cacheDir, this._dataDir, this._imagesDir, this._textsDir, this._linkPreviewsDir].forEach(path => {
            const dir = Gio.File.new_for_path(path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
        });
    }

    _onClipboardChanged() {
        if (this._isPaused) return;
        if (this._debouncing > 0) {
            this._debouncing--;
            return;
        }
        if (this._processClipboardTimeoutId) {
            GLib.source_remove(this._processClipboardTimeoutId);
        }

        this._processClipboardTimeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
            this._processClipboardContent(1).catch(e =>
                console.error(`[AIO-Clipboard] Unhandled error: ${e.message}`)
            );
            this._processClipboardTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    async _processClipboardContent(attempt = 1) {
        try {
            // 1. Image
            const imageResult = await ImageProcessor.extract();
            if (imageResult) {
                this._processResult(imageResult);
                return;
            }

            // 2. Text Extraction
            const textResult = await TextProcessor.extract();
            if (textResult) {
                const text = textResult.text;

                // 2a. File
                const fileResult = await FileProcessor.process(text);
                if (fileResult) {
                    this._processResult(fileResult);
                    return;
                }

                // 2b. Link
                const linkResult = LinkProcessor.process(text);
                if (linkResult) {
                    this._processResult(linkResult);
                    return;
                }

                // 2c. Color
                const colorResult = ColorProcessor.process(text);
                if (colorResult) {
                    this._processResult(colorResult);
                    return;
                }

                // 2d. Code (NEW)
                const codeResult = CodeProcessor.process(text);
                if (codeResult) {
                    this._processResult(codeResult);
                    return;
                }

                // 2e. Fallback Text
                this._processResult(textResult);
                return;
            }

            if (attempt <= MAX_RETRIES) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_DELAY_MS, () => {
                    this._processClipboardContent(attempt + 1);
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            console.warn(`[AIO-Clipboard] Could not process clipboard content: ${e.message}\n${e.stack}`);
        }
    }

    _processResult(result) {
        if (!result || result.hash === this._lastContent) return;
        this._lastContent = result.hash;

        switch (result.type) {
            case ClipboardType.IMAGE:
                this._handleExtractedContent(result, ImageProcessor, this._imagesDir);
                break;
            case ClipboardType.FILE:
                this._handleGenericFileItem(result);
                break;
            case ClipboardType.URL:
                this._handleLinkItem(result);
                break;
            case ClipboardType.COLOR:
                this._handleColorItem(result);
                break;
            case ClipboardType.CODE: // NEW
                this._handleCodeItem(result);
                break;
            case ClipboardType.TEXT:
                this._handleExtractedContent(result, TextProcessor, this._textsDir);
                break;
            default:
                console.warn(`[AIO-Clipboard] Unknown result type: ${result.type}`);
        }
    }

    _handleCodeItem(codeResult) {
        // Reuse TextProcessor storage logic. 
        // codeResult contains { text: 'raw code', preview: 'markup', ... }
        // TextProcessor.save will use 'text' for the file and 'preview' for the display.
        this._handleExtractedContent(codeResult, TextProcessor, this._textsDir);
    }

    _handleLinkItem(linkResult) {
        const newItem = {
            id: GLib.uuid_string_random(),
            type: ClipboardType.URL,
            timestamp: Math.floor(Date.now() / 1000),
            url: linkResult.url,
            title: linkResult.title,
            hash: linkResult.hash,
            icon_filename: null
        };

        this._addItemToHistory(newItem);

        LinkProcessor.fetchMetadata(newItem.url).then(async (metadata) => {
            let updated = false;
            const item = this._history.find(i => i.id === newItem.id);
            if (!item) return;

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

    _handleColorItem(colorResult) {
        const newItem = {
            id: GLib.uuid_string_random(),
            type: ClipboardType.COLOR,
            timestamp: Math.floor(Date.now() / 1000),
            color_value: colorResult.color_value,
            format_type: colorResult.format_type,
            hash: colorResult.hash,
            preview: colorResult.color_value
        };
        this._addItemToHistory(newItem);
    }

    _handleGenericFileItem(fileResult) {
        const newItem = {
            id: GLib.uuid_string_random(),
            type: ClipboardType.FILE,
            timestamp: Math.floor(Date.now() / 1000),
            preview: fileResult.preview,
            file_uri: fileResult.file_uri,
            hash: fileResult.hash
        };
        this._addItemToHistory(newItem);
    }

    _handleExtractedContent(extraction, ProcessorClass, storageDir) {
        const hash = extraction.hash;

        const historyIndex = this._history.findIndex(item => item.hash === hash);
        if (historyIndex > -1) {
            this._promoteExistingItem(historyIndex, this._history);
            return;
        }

        const pinnedIndex = this._pinned.findIndex(item => item.hash === hash);
        if (pinnedIndex > -1) {
            this._promotePinnedItem(pinnedIndex);
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

    _addItemToHistory(newItem) {
        const hash = newItem.hash;

        const historyIndex = this._history.findIndex(item => item.hash === hash);
        if (historyIndex > -1) {
            this._promoteExistingItem(historyIndex, this._history);
            return;
        }

        const pinnedIndex = this._pinned.findIndex(item => item.hash === hash);
        if (pinnedIndex > -1) {
            this._promotePinnedItem(pinnedIndex);
            return;
        }

        this._history.unshift(newItem);
        this._pruneHistory();
        this._saveHistory();
        this.emit('history-changed');
    }

    _promoteExistingItem(index, list) {
        const [item] = list.splice(index, 1);
        list.unshift(item);
        if (list === this._history) this._saveHistory();
        this.emit('history-changed'); 
    }

    _promotePinnedItem(index) {
        if (this._settings.get_boolean('unpin-on-paste')) {
            const [item] = this._pinned.splice(index, 1);
            this._history.unshift(item);
            this._saveAll();
            this.emit('history-changed');
            this.emit('pinned-list-changed');
        }
    }

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
                                resolve(null);
                            } else {
                                reject(e);
                            }
                        }
                    });
                });
                return bytes;
            } catch (e) {
                console.warn(`[AIO-Clipboard] Could not load file ${file.get_path()}: ${e.message}`);
                return null;
            }
        };

        try {
            const historyBytes = await loadFile(this._historyFile);
            this._history = historyBytes ? JSON.parse(new TextDecoder().decode(historyBytes)) : [];
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to parse history_clipboard.json: ${e.message}`);
            this._history = [];
        }

        try {
            const pinnedBytes = await loadFile(this._pinnedFile);
            this._pinned = pinnedBytes ? JSON.parse(new TextDecoder().decode(pinnedBytes)) : [];
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to parse pinned_clipboard.json: ${e.message}`);
            this._pinned = [];
        }

        this.emit('history-changed');
        this.emit('pinned-list-changed');
        return true;
    }

    _saveHistory() {
        if (!this._initialLoadSuccess) return;
        const json = JSON.stringify(this._history, null, 2);
        const bytes = new GLib.Bytes(new TextEncoder().encode(json));
        this._saveFile(this._historyFile, bytes);
    }

    _savePinned() {
        if (!this._initialLoadSuccess) return;
        const json = JSON.stringify(this._pinned, null, 2);
        const bytes = new GLib.Bytes(new TextEncoder().encode(json));
        this._saveFile(this._pinnedFile, bytes);
    }

    _saveAll() {
        this._saveHistory();
        this._savePinned();
    }

    _saveFile(file, bytes) {
        file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (source, res) => {
            try {
                const stream = source.replace_finish(res);
                stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (w_source, w_res) => {
                    try {
                        w_source.write_bytes_finish(w_res);
                        stream.close(null);
                    } catch (e) {
                        console.error(`[AIO-Clipboard] Error writing bytes: ${e.message}`);
                    }
                });
            } catch (e) {
                console.error(`[AIO-Clipboard] Error replacing file content: ${e.message}`);
            }
        });
    }

    _pruneHistory() {
        if (!this._initialLoadSuccess) return;
        while (this._history.length > this._maxHistory) {
            const item = this._history.pop();
            if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
            if (item.type === ClipboardType.TEXT && item.has_full_content) this._deleteTextFile(item.id);
        }
    }

    getHistoryItems() { return this._history; }
    getPinnedItems() { return this._pinned; }

    async getContent(id) {
        const item = [...this._history, ...this._pinned].find(i => i.id === id);
        if (!item || item.type !== ClipboardType.TEXT) return null;

        if (item.has_full_content) {
            try {
                const file = Gio.File.new_for_path(GLib.build_filenamev([this._textsDir, `${item.id}.txt`]));
                const bytes = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (s, r) => {
                        try {
                            const [ok, c] = s.load_contents_finish(r);
                            resolve(ok ? c : null);
                        } catch (e) {
                            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) resolve(null);
                            else reject(e);
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

    pinItem(id) {
        const index = this._history.findIndex(item => item.id === id);
        if (index === -1) return;
        const [item] = this._history.splice(index, 1);
        this._pinned.unshift(item);
        this._saveAll();
        this.emit('history-changed');
        this.emit('pinned-list-changed');
    }

    unpinItem(id) {
        const index = this._pinned.findIndex(item => item.id === id);
        if (index === -1) return;
        const [item] = this._pinned.splice(index, 1);
        this._history.unshift(item);
        this._pruneHistory();
        this._saveAll();
        this.emit('history-changed');
        this.emit('pinned-list-changed');
    }

    promoteItemToTop(id) {
        const pinnedIndex = this._pinned.findIndex(item => item.id === id);
        if (pinnedIndex > -1) {
            this._promotePinnedItem(pinnedIndex);
            return;
        }
        const historyIndex = this._history.findIndex(item => item.id === id);
        if (historyIndex > -1) {
            if (this._settings.get_boolean('update-recency-on-copy') && historyIndex > 0) {
                this._promoteExistingItem(historyIndex, this._history);
            }
        }
    }

    deleteItem(id) {
        let wasDeleted = false;
        const deleteLogic = (list) => {
            const index = list.findIndex(item => item.id === id);
            if (index > -1) {
                const [item] = list.splice(index, 1);
                if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
                if (item.type === ClipboardType.TEXT && item.has_full_content) this._deleteTextFile(item.id);
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

    clearHistory() {
        if (!this._initialLoadSuccess) return;
        this._history.forEach(item => {
            if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
            if (item.type === ClipboardType.TEXT && item.has_full_content) this._deleteTextFile(item.id);
        });
        this._history = [];
        this._saveHistory();
        this.emit('history-changed');
    }

    clearPinned() {
        if (!this._initialLoadSuccess) return;
        this._pinned.forEach(item => {
            if (item.type === ClipboardType.IMAGE) this._deleteImageFile(item.image_filename);
            if (item.type === ClipboardType.TEXT && item.has_full_content) this._deleteTextFile(item.id);
        });
        this._pinned = [];
        this._savePinned();
        this.emit('pinned-list-changed');
    }

    _deleteImageFile(filename) {
        if (!filename) return;
        try {
            Gio.File.new_for_path(GLib.build_filenamev([this._imagesDir, filename])).delete_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {}
    }

    _deleteTextFile(id) {
        if (!id) return;
        try {
            Gio.File.new_for_path(GLib.build_filenamev([this._textsDir, `${id}.txt`])).delete_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {}
    }

    runGarbageCollection() {
        try {
            const validImages = new Set();
            const validTexts = new Set();
            const validLinks = new Set();

            const collect = (list) => {
                list.forEach(item => {
                    if (item.type === ClipboardType.IMAGE) validImages.add(item.image_filename);
                    if (item.type === ClipboardType.TEXT && item.has_full_content) validTexts.add(`${item.id}.txt`);
                    if (item.type === ClipboardType.URL && item.icon_filename) validLinks.add(item.icon_filename);
                });
            };
            collect(this._pinned);
            collect(this._history);

            const cleanDir = (dirPath, validSet) => {
                const dir = Gio.File.new_for_path(dirPath);
                if (!dir.query_exists(null)) return;
                const enumerator = dir.enumerate_children('standard::name', Gio.FileCreateFlags.NONE, null);
                while (true) {
                    const info = enumerator.next_file(null);
                    if (!info) break;
                    const name = info.get_name();
                    if (!validSet.has(name)) dir.get_child(name).delete(null);
                }
            };

            cleanDir(this._imagesDir, validImages);
            cleanDir(this._textsDir, validTexts);
            cleanDir(this._linkPreviewsDir, validLinks);
        } catch (e) {
            console.error(`[AIO-Clipboard] GC Error: ${e.message}`);
        }
    }

    setDebounce() { this._debouncing++; }
    setPaused(isPaused) { this._isPaused = isPaused; }

    destroy() {
        if (this._processClipboardTimeoutId) GLib.source_remove(this._processClipboardTimeoutId);
        if (this._selectionOwnerChangedId) this._selection.disconnect(this._selectionOwnerChangedId);
        if (this._settingsChangedId) this._settings.disconnect(this._settingsChangedId);
    }
});