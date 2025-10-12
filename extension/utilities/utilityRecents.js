import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

const DEFAULT_MAX_RECENTS_FALLBACK = 45;

/**
 * Manages a list of recently used items for a specific data type (e.g., emojis, kaomojis).
 * Handles loading from and saving to a cache file, enforcing a maximum item limit
 * from GSettings, and notifying listeners of changes.
 *
 * @fires recents-changed - Emitted when the list of recent items is modified.
 */
export const RecentItemsManager = GObject.registerClass(
    {
        Signals: {
            'recents-changed': {},
        },
    },
    class RecentItemsManager extends GObject.Object {
        /**
         * @param {string} extensionUUID - The UUID of the extension.
         * @param {Gio.Settings} settings - The GSettings object.
         * @param {string} filename - The specific filename for this manager's recents (e.g., 'recent_emojis.json').
         * @param {string} maxItemsSettingKey - The GSettings key for the max items for this type (e.g., 'emoji-recents-max-items').
         */
        _init(extensionUUID, settings, filename, maxItemsSettingKey) {
            super._init();
            this._uuid = extensionUUID;
            this._settings = settings;
            this._recents = [];

            if (!filename || typeof filename !== 'string' || filename.trim() === '') {
                throw new Error(`[AIO-Clipboard] RecentItemsManager requires a valid filename.`);
            }
            this._filename = filename.trim();

            if (!maxItemsSettingKey || typeof maxItemsSettingKey !== 'string' || maxItemsSettingKey.trim() === '') {
                throw new Error(`[AIO-Clipboard] RecentItemsManager requires a valid maxItemsSettingKey for ${this._filename}.`);
            }
            this._maxItemsSettingKey = maxItemsSettingKey.trim();

            this._cacheFilePath = GLib.build_filenamev([
                GLib.get_user_cache_dir(),
                this._uuid,
                this._filename
            ]);
            this._isLoaded = false;
            this._maxItems = this._settings.get_int(this._maxItemsSettingKey);

            // Listen for changes to the max items setting and prune if necessary.
            this._settingsSignalId = this._settings.connect(`changed::${this._maxItemsSettingKey}`, () => {
                if (!this._settings) return;
                this._maxItems = this._settings.get_int(this._maxItemsSettingKey);
                if (this._isLoaded) {
                    this._pruneRecents();
                    this._save().catch(e => console.warn(`[AIO-Clipboard] Save after maxItems change failed for ${this._filename}: ${e.message}`));
                }
            });

            // Asynchronously load the initial list of recents.
            this._load().then(() => {
                this._isLoaded = true;
            }).catch(e => {
                this._isLoaded = true;
                console.warn(`[AIO-Clipboard] Initial load of recents from ${this._filename} failed: ${e.message}. Recents will be empty.`);
                if (this._settings) {
                    this._recents = [];
                    this.emit('recents-changed');
                }
            });
        }

        /**
         * Gets the Gio.File object for the cache file.
         * @returns {Gio.File} The cache file.
         * @private
         */
        _getCacheFile() {
            return Gio.File.new_for_path(this._cacheFilePath);
        }

        /**
         * Asynchronously loads and parses the recents list from the cache file.
         * @private
         */
        async _load() {
            const file = this._getCacheFile();
            try {
                if (!this._settings) return;

                // Wrap the callback-based function in a native Promise
                const bytes = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (source, res) => {
                        try {
                            // load_contents_finish can throw an error which will be caught
                            const [ok, contents] = source.load_contents_finish(res);
                            resolve(ok ? contents : null);
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                if (!bytes) {
                    this._recents = [];
                } else {
                    const decoder = new TextDecoder('utf-8');
                    const jsonString = decoder.decode(bytes);
                    const loadedRecents = jsonString.trim() ? JSON.parse(jsonString) : [];

                    if (Array.isArray(loadedRecents)) {
                        this._recents = loadedRecents;
                        this._pruneRecents();
                    } else {
                        this._recents = [];
                        console.warn(`[AIO-Clipboard] Recents file ${this._filename} content is not an array. Initializing as empty.`);
                    }
                }
            } catch (e) {
                // If the file doesn't exist, it's not an error; just start with an empty list.
                if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                    this._recents = [];
                } else {
                    this._recents = [];
                    console.warn(`[AIO-Clipboard] Error loading recents from ${this._filename}: ${e.message}. Initializing as empty.`);
                }
            } finally {
                if (this._settings) {
                    this.emit('recents-changed');
                }
            }
        }

        /**
         * Asynchronously saves the current recents list to the cache file.
         * @private
         */
        async _save() {
            if (!this._settings) return;
            const file = this._getCacheFile();
            const parentDir = file.get_parent();
            try {
                if (!parentDir.query_exists(null)) {
                    parentDir.make_directory_with_parents(null);
                }
                const jsonString = JSON.stringify(this._recents, null, 2);
                const bytes = new GLib.Bytes(new TextEncoder().encode(jsonString));
                await file.replace_contents_bytes_async(
                    bytes, null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
                    null, null
                );
            } catch (e) {
                console.warn(`[AIO-Clipboard] Failed to save recents to ${this._filename}: ${e.message}`);
            }
        }

        /**
         * Adds an item to the top of the recents list.
         * If the item already exists, it is moved to the top.
         * @param {object} item - The item to add. Must have a 'value' property.
         */
        addItem(item) {
            if (!this._settings) return;
            if (!item || typeof item.value !== 'string' || item.value.trim() === '') {
                console.warn(`[AIO-Clipboard] Attempted to add invalid item to recents for ${this._filename}: ${JSON.stringify(item)}`);
                return;
            }
            // Remove any existing instance of the item to prevent duplicates.
            const existingIndex = this._recents.findIndex(r => r.value === item.value);
            if (existingIndex > -1) {
                this._recents.splice(existingIndex, 1);
            }

            this._recents.unshift({ ...item });
            this._pruneRecents();
            this._save().catch(e => console.warn(`[AIO-Clipboard] Save after addItem failed for ${this._filename}: ${e.message}`));
            this.emit('recents-changed');
        }

        /**
         * Gets a copy of the current list of recent items.
         * @returns {Array<object>} The list of recent items.
         */
        getRecents() {
            return [...this._recents];
        }

        /**
         * Trims the recents list to the maximum allowed length.
         * @private
         */
        _pruneRecents() {
            if (!this._settings) return;
            const max = (typeof this._maxItems === 'number' && this._maxItems >= 0)
                        ? this._maxItems
                        : DEFAULT_MAX_RECENTS_FALLBACK;
            if (this._recents.length > max) {
                this._recents.length = max; // More efficient than splice
            }
        }

        /**
         * Cleans up resources, particularly the GSettings signal connection.
         */
        destroy() {
            if (this._settings && this._settingsSignalId > 0) {
                try {
                    this._settings.disconnect(this._settingsSignalId);
                } catch (e) { /* Ignore */ }
            }
            this._settingsSignalId = 0;
            this._settings = null;
            this._recents = [];
            this._uuid = null;
            this._filename = null;
            this._maxItemsSettingKey = null;
        }
    }
);