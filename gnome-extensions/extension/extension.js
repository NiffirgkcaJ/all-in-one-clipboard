import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Gettext from 'gettext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { initializeMenuRegistry } from './shared/menu/menuRegistry.js';
import { IOFile } from './shared/utilities/utilityIO.js';
import { MenuIndicator } from './shared/menu/menuIndicator.js';
import { ServiceJson } from './shared/services/serviceJson.js';
import { getAutoPaster, destroyAutoPaster } from './shared/utilities/utilityAutoPaste.js';
import { initStorage, FileItem } from './shared/constants/storagePaths.js';

import { ClipboardManager } from './features/Clipboard/logic/clipboardManager.js';
import { getGifCacheManager, destroyGifCacheManager } from './features/GIF/logic/gifCacheManager.js';
import { getSkinnableCharSet, destroySkinnableCharSetCache } from './features/Emoji/logic/emojiDataCache.js';

/**
 * The main extension class, responsible for the enable and disable lifecycle.
 */
export default class AllInOneClipboardExtension extends Extension {
    /**
     * Initializes the extension.
     */
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._settings = null;
        this._clipboardManager = null;
        this._settingsSignalIds = [];
        this._resource = null;
    }

    // ========================================================================
    // Internal Signals
    // ========================================================================

    /**
     * Updates the visibility of the panel indicator based on user settings.
     * @private
     */
    _updateIndicatorVisibility() {
        if (!this._indicator) {
            return;
        }

        const hide = this._settings.get_boolean('hide-panel-icon');
        this._indicator.visible = !hide;
    }

    /**
     * Handles the signal for the 'clear-recents-trigger' GSettings key.
     * Deletes the appropriate recent items cache file based on the key's value.
     * @private
     */
    _onClearRecentsTrigger() {
        const trigger = this._settings.get_string('clear-recents-trigger');

        if (trigger === '') {
            return;
        }

        const RECENT_PATHS_MAP = {
            emoji: FileItem.RECENT_EMOJI,
            gif: FileItem.RECENT_GIFS,
            kaomoji: FileItem.RECENT_KAOMOJI,
            symbols: FileItem.RECENT_SYMBOLS,
        };

        if (trigger === 'all') {
            for (const filePath of Object.values(RECENT_PATHS_MAP)) {
                this._clearRecentFile(filePath);
            }
        } else if (RECENT_PATHS_MAP[trigger]) {
            this._clearRecentFile(RECENT_PATHS_MAP[trigger]);
        } else if (trigger === 'clipboard-history' && this._clipboardManager) {
            this._clipboardManager.clearHistory();
        } else if (trigger === 'clipboard-pinned' && this._clipboardManager) {
            this._clipboardManager.clearPinned();
        } else if (trigger === 'gif-cache') {
            getGifCacheManager().clearCache();
        }

        this._settings.set_string('clear-recents-trigger', '');
    }

    /**
     * Clears a specified recent items file by overwriting it with an empty array.
     * @param {string} absolutePath - The absolute path of the file to clear.
     * @private
     */
    async _clearRecentFile(absolutePath) {
        await IOFile.write(absolutePath, ServiceJson.stringify([]));
    }

    // ========================================================================
    // Keyboard Navigation
    // ========================================================================

    /**
     * Binds keyboard shortcuts defined in the settings to their respective actions.
     * @private
     */
    _bindKeyboardShortcuts() {
        this._shortcutIds = [];

        this._addKeybinding('shortcut-toggle-main', async () => {
            await this._indicator.toggleMenu();
        });

        const tabMap = {
            'shortcut-open-clipboard': _('Clipboard'),
            'shortcut-open-emoji': _('Emoji'),
            'shortcut-open-gif': _('GIF'),
            'shortcut-open-kaomoji': _('Kaomoji'),
            'shortcut-open-symbols': _('Symbols'),
        };

        Object.entries(tabMap).forEach(([shortcutKey, tabName]) => {
            this._addKeybinding(shortcutKey, async () => {
                if (!this._indicator.isTabAvailable(tabName)) {
                    return;
                }

                if (this._indicator.isMenuOpen) {
                    await this._indicator.selectTab(tabName);
                } else {
                    await this._indicator.openMenuAndSelectTab(tabName);
                }
            });
        });
    }

    /**
     * Helper to add a keybinding and track its ID for later removal.
     * @param {string} name - The name of the keybinding.
     * @param {Function} callback - The function to call when the keybinding is activated.
     * @private
     */
    _addKeybinding(name, callback) {
        const ModeType = Object.prototype.hasOwnProperty.call(Shell, 'ActionMode') ? Shell.ActionMode : Shell.KeyBindingMode;
        Main.wm.addKeybinding(name, this._settings, Meta.KeyBindingFlags.NONE, ModeType.ALL, callback);
        this._shortcutIds.push(name);
    }

    /**
     * Unbinds all keyboard shortcuts that were previously bound.
     * @private
     */
    _unbindKeyboardShortcuts() {
        if (!this._shortcutIds) {
            return;
        }

        this._shortcutIds.forEach((id) => {
            Main.wm.removeKeybinding(id);
        });

        this._shortcutIds = null;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Enables the extension and configures initialization logic.
     * @async
     */
    async enable() {
        try {
            this._resource = Gio.Resource.load(this.path + '/resources.gresource');
            Gio.resources_register(this._resource);
        } catch (e) {
            console.error(`[AIO-Clipboard] FATAL: Could not load GResource file: ${e}`);
            return;
        }

        this.initTranslations('all-in-one-clipboard');
        Gettext.bindtextdomain('all-in-one-clipboard-content', this.dir.get_child('locale').get_path());

        this._settings = this.getSettings();

        initStorage(this.uuid);

        getGifCacheManager(this.uuid, this._settings).runCleanupImmediately();
        getSkinnableCharSet(this.path);
        getAutoPaster();

        this._settingsSignalIds = [];

        try {
            this._clipboardManager = new ClipboardManager(this.uuid, this._settings);
        } catch (e) {
            console.error('[AIO-Clipboard] FATAL: FAILED to initialize ClipboardManager:', e);
            return;
        }

        const isLoadSuccessful = await this._clipboardManager.loadAndPrepare();

        if (this._settings.get_boolean('clear-data-at-login')) {
            if (this._settings.get_boolean('clear-clipboard-history-at-login')) {
                this._clipboardManager.clearHistory();
            }

            const recentsToClear = [
                { setting: 'clear-recent-emojis-at-login', file: FileItem.RECENT_EMOJI },
                { setting: 'clear-recent-gifs-at-login', file: FileItem.RECENT_GIFS },
                { setting: 'clear-recent-kaomojis-at-login', file: FileItem.RECENT_KAOMOJI },
                { setting: 'clear-recent-symbols-at-login', file: FileItem.RECENT_SYMBOLS },
            ];

            for (const item of recentsToClear) {
                if (this._settings.get_boolean(item.setting)) {
                    this._clearRecentFile(item.file);
                }
            }
        }

        if (isLoadSuccessful) {
            this._clipboardManager.runGarbageCollection();
        }

        await initializeMenuRegistry();
        this._indicator = new MenuIndicator(this._settings, this, this._clipboardManager);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1);

        this._updateIndicatorVisibility();

        this._settingsSignalIds.push(this._settings.connect('changed::hide-panel-icon', () => this._updateIndicatorVisibility()));
        this._settingsSignalIds.push(this._settings.connect('changed::clear-recents-trigger', () => this._onClearRecentsTrigger()));

        this._bindKeyboardShortcuts();
    }

    /**
     * Disables the extension and aggressively destroys instantiated dependencies.
     * @override
     */
    disable() {
        this._unbindKeyboardShortcuts();

        this._settingsSignalIds.forEach((id) => {
            if (this._settings) {
                this._settings.disconnect(id);
            }
        });
        this._settingsSignalIds = [];

        destroyAutoPaster();
        destroyGifCacheManager();
        destroySkinnableCharSetCache();

        this._indicator?.destroy();
        this._indicator = null;

        this._clipboardManager?.destroy();
        this._clipboardManager = null;

        if (this._resource) {
            Gio.resources_unregister(this._resource);
            this._resource = null;
        }

        this._settings = null;
    }
}
