import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createThemedIcon } from './utilities/utilityThemedIcon.js';
import { ClipboardManager } from './features/Clipboard/logic/clipboardManager.js';
import { positionMenu } from './utilities/utilityMenuPositioner.js';

/**
 * Creates a simple, predictable identifier from a tab name.
 */
function getTabIdentifier(tabName) {
    return tabName.replace(/\s+/g, '');
}

/**
 * Maps main tab names to their corresponding icon filenames.
 */
const MAIN_TAB_ICONS_MAP = {
    "Recently Used": 'utility-recents-symbolic.svg',
    "Emoji": 'main-emoji-symbolic.svg',
    "GIF": 'main-gif-symbolic.svg',
    "Kaomoji": 'main-kaomoji-symbolic.svg',
    "Symbols": 'main-symbols-symbolic.svg',
    "Clipboard": 'main-clipboard-symbolic.svg'
};

/**
 * The main panel indicator and menu for the All-in-One Clipboard extension.
 * This class is responsible for building the main UI, managing the tab bar,
 * and dynamically loading the content for each selected tab.
 */
const AllInOneClipboardIndicator = GObject.registerClass(
class AllInOneClipboardIndicator extends PanelMenu.Button {
    _init(settings, extension, clipboardManager) {
        super._init(0.5, _("All-in-One Clipboard"), false);

        this._settings = settings;
        this._extension = extension;
        this._clipboardManager = clipboardManager;

        this._tabButtons = {};
        this._activeTabName = null;
        this._tabContentArea = null;
        this._currentTabActor = null;
        this._mainTabBar = null;

        this._currentTabVisibilitySignalId = 0;
        this._currentTabNavigateSignalId = 0;

        this.TAB_NAMES = [
            _("Recently Used"),
            _("Emoji"),
            _("GIF"),
            _("Kaomoji"),
            _("Symbols"),
            _("Clipboard")
        ];

        const icon = new St.Icon({ icon_name: 'edit-copy-symbolic', style_class: 'system-status-icon' });
        this.add_child(icon);

        this._buildMenu();
    }

    /**
     * Constructs the main menu layout with a tab bar and content area.
     * @private
     */
    _buildMenu() {
        this.menu.removeAll();

        const mainVerticalBox = new St.BoxLayout({
            vertical: true,
            width: 420,
            height: 420,
            style_class: 'aio-clipboard-container'
        });
        this.menu.box.add_child(mainVerticalBox);

        this._mainTabBar = new St.BoxLayout();
        mainVerticalBox.add_child(this._mainTabBar);

        this._tabContentArea = new St.Bin({
            style_class: 'aio-clipboard-content-area',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            x_align: Clutter.ActorAlign.FILL
        });
        mainVerticalBox.add_child(this._tabContentArea);

        // Build tab buttons with themed icons
        this.TAB_NAMES.forEach(name => {
            const translatedName = _(name);
            const iconFile = MAIN_TAB_ICONS_MAP[translatedName];

            // Use the helper function to create themed icon
            const iconWidget = createThemedIcon(this._extension.path, iconFile, 16);

            const button = new St.Button({
                style_class: 'aio-clipboard-tab-button button',
                can_focus: true,
                child: iconWidget,
                x_expand: true,
            });

            button.tooltip_text = translatedName;

            button.connect('clicked', () => this._selectTab(name));
            this._tabButtons[name] = button;
            this._mainTabBar.add_child(button);
        });

        this._mainTabBar.set_reactive(true);
        this._mainTabBar.connect('key-press-event', this._onMainTabBarKeyPress.bind(this));

        if (this.TAB_NAMES.length > 0) {
            this._selectTab(this.TAB_NAMES[0]);
        }
    }

    /**
     * Sets the visibility of the main tab bar.
     * @param {boolean} isVisible - Whether the tab bar should be visible.
     * @private
     */
    _setMainTabBarVisibility(isVisible) {
        if (this._mainTabBar && this._mainTabBar.visible !== isVisible) {
            this._mainTabBar.visible = isVisible;
        }
    }

    /**
     * Disconnects signals from the previously active tab's content actor.
     * @param {St.Actor} tabActor - The actor of the tab content being deactivated.
     * @private
     */
    _disconnectTabSignals(tabActor) {
        if (!tabActor?.constructor.$gtype) return;

        try {
            if (this._currentTabVisibilitySignalId > 0 && GObject.signal_lookup('set-main-tab-bar-visibility', tabActor.constructor.$gtype)) {
                tabActor.disconnect(this._currentTabVisibilitySignalId);
            }
            if (this._currentTabNavigateSignalId > 0 && GObject.signal_lookup('navigate-to-main-tab', tabActor.constructor.$gtype)) {
                tabActor.disconnect(this._currentTabNavigateSignalId);
            }
        } catch (e) {
            // Errors on disconnect are usually safe to ignore
        } finally {
            this._currentTabVisibilitySignalId = 0;
            this._currentTabNavigateSignalId = 0;
        }
    }

    /**
     * Selects a tab by name, destroying the old content and loading the new content.
     * This method handles dynamic importing of tab modules.
     * @param {string} tabName - The name of the tab to select.
     * @private
     */
    async _selectTab(tabName) {
        if (this._activeTabName === tabName && this._currentTabActor) {
            // Tab is already active, just call onTabSelected to restore focus
            this._currentTabActor.onTabSelected?.();
            return;
        }

        this._disconnectTabSignals(this._currentTabActor);
        this._currentTabActor?.destroy();
        this._currentTabActor = null;
        this._tabContentArea.set_child(null);

        this._activeTabName = tabName;
        const tabId = getTabIdentifier(tabName);

        this._setMainTabBarVisibility(true);

        try {
            let newContentActor;

            const loadingLabel = new St.Label({
                text: _("Loading %s...").format(tabName),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true
            });
            this._tabContentArea.set_child(loadingLabel);


            if (tabName === _("Recently Used")) {
                const moduleUrl = `file://${this._extension.path}/features/RecentlyUsed/tabRecentlyUsed.js`;
                const tabModule = await import(moduleUrl);
                newContentActor = new tabModule.RecentlyUsedTabContent(this._extension, this._settings, this._clipboardManager);
            } else {
                const moduleUrl = `file://${this._extension.path}/features/${tabId}/tab${tabId}.js`;
                const tabModule = await import(moduleUrl);
                const className = `${tabId}TabContent`;

                if (!tabModule[className]) {
                    throw new Error(`Class '${className}' not found in module: ${moduleUrl}`);
                }

                if (tabName === _("Clipboard")) {
                    newContentActor = new tabModule[className](this._extension, this._settings, this._clipboardManager);
                } else {
                    newContentActor = new tabModule[className](this._extension, this._settings);
                }
            }

            if (newContentActor.constructor.$gtype) {
                if (GObject.signal_lookup('set-main-tab-bar-visibility', newContentActor.constructor.$gtype)) {
                    this._currentTabVisibilitySignalId = newContentActor.connect('set-main-tab-bar-visibility', (actor, isVisible) => {
                        this._setMainTabBarVisibility(isVisible);
                    });
                }
                if (GObject.signal_lookup('navigate-to-main-tab', newContentActor.constructor.$gtype)) {
                    this._currentTabNavigateSignalId = newContentActor.connect('navigate-to-main-tab', (actor, targetTabName) => {
                        if (this.TAB_NAMES.includes(targetTabName)) {
                            this._selectTab(targetTabName);
                        }
                    });
                }
            }

            if (this._activeTabName !== tabName) {
                newContentActor?.destroy();
                return;
            }

            this._tabContentArea.set_child(newContentActor);
            this._currentTabActor = newContentActor;

            // Always call onTabSelected after the actor is set as child and ready
            // Use a small delay to ensure the UI is fully rendered
            GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 10, () => {
                this._currentTabActor?.onTabSelected?.();
                return GLib.SOURCE_REMOVE;
            });

        } catch (e) {
            console.error(`AllInOneClipboard: Failed to load tab '${tabName}': ${e.message}\n${e.stack}`);
            this._setMainTabBarVisibility(true);

            if (this._tabContentArea && this._activeTabName === tabName) {
                const errorLabel = new St.Label({
                    text: `Error loading tab: ${e.message}`,
                    style_class: 'aio-clipboard-error-label',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                    y_expand: true
                });
                this._tabContentArea.set_child(errorLabel);
                this._currentTabActor = errorLabel;
            }
        }
    }

    /**
     * Handles left/right arrow key navigation within the main tab bar.
     * Prevents focus from moving out of the tab bar when at the edges.
     * @param {Clutter.Actor} actor - The actor receiving the event.
     * @param {Clutter.Event} event - The key press event.
     * @returns {Clutter.EVENT_STOP|Clutter.EVENT_PROPAGATE} Whether to stop or propagate the event.
     * @private
    */
    _onMainTabBarKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        if (symbol !== Clutter.KEY_Left && symbol !== Clutter.KEY_Right) {
            return Clutter.EVENT_PROPAGATE;
        }

        const buttons = Object.values(this._tabButtons);
        if (buttons.length === 0) {
            return Clutter.EVENT_PROPAGATE;
        }

        const currentFocus = global.stage.get_key_focus();
        const currentIndex = buttons.indexOf(currentFocus);

        if (currentIndex === -1) {
            return Clutter.EVENT_PROPAGATE;
        }

        if (currentIndex === 0 && symbol === Clutter.KEY_Left) {
            return Clutter.EVENT_STOP;
        }

        if (currentIndex === buttons.length - 1 && symbol === Clutter.KEY_Right) {
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Toggles the menu's visibility and intelligently positions it based on context.
     * This is the primary method called by keyboard shortcuts.
     */
    toggleMenu() {
        if (this.menu.isOpen) {
            this.menu.close();
            return;
        }

        // If the indicator is visible, open the menu normally, attached to the icon.
        if (this.visible) {
            this.menu.open();
            return;
        }

        // If the indicator is HIDDEN, open the menu and then position it.
        this.menu.open(false);

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this.menu.actor) {
                // Pass this._settings as the second argument
                positionMenu(this.menu.actor, this._settings);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Cleans up resources when the indicator is destroyed.
     * @override
     */
    destroy() {
        this._disconnectTabSignals(this._currentTabActor);
        this._currentTabActor?.destroy();
        this._currentTabActor = null;

        this._tabButtons = null;
        this._mainTabBar = null;
        this._tabContentArea = null;
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

/**
 * The main extension class, responsible for the enable/disable lifecycle.
 */
export default class AllInOneClipboardExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._settings = null;
        this._clipboardManager = null;
        this._settingsSignalIds = [];
    }

    /**
     * Updates the visibility of the panel indicator based on user settings.
     * @private
     */
    _updateIndicatorVisibility() {
        if (!this._indicator) {
            return; // Safety check
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

        // Ignore if the trigger is empty (which happens when we reset it)
        if (trigger === '') {
            return;
        }

        const RECENT_FILES_MAP = {
            'emoji': 'recent_emojis.json',
            'gif': 'recent_gifs.json',
            'kaomoji': 'recent_kaomojis.json',
            'symbols': 'recent_symbols.json'
        };

        if (trigger === 'all') {
            // Delete all known recent files
            for (const filename of Object.values(RECENT_FILES_MAP)) {
                this._deleteRecentFile(filename);
            }
        } else if (RECENT_FILES_MAP[trigger]) {
            // Delete a specific recent file
            this._deleteRecentFile(RECENT_FILES_MAP[trigger]);
        }

        // IMPORTANT: Reset the trigger back to empty so it can be used again.
        this._settings.set_string('clear-recents-trigger', '');
    }

    /**
     * Deletes a specified recent items cache file.
     * @param {string} filename - The name of the file to delete (e.g., 'recent_emojis.json').
     * @private
     */
    _deleteRecentFile(filename) {
        try {
            const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), this.uuid]);
            const filePath = GLib.build_filenamev([cacheDir, filename]);
            const file = Gio.File.new_for_path(filePath);

            // Asynchronously delete the file, we don't need to wait for it to complete.
            // A null callback is used for fire-and-forget deletion.
            file.delete_async(GLib.PRIORITY_DEFAULT, null, null);
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to delete recent file '${filename}': ${e.message}`);
        }
    }

    /**
     * Enables the extension, initializing settings, clipboard manager, and UI components.
     * Also binds keyboard shortcuts for quick access.
     * @async
     */
    async enable() {
        this._settings = this.getSettings();
        this._settingsSignalIds = [];

        try {
            this._clipboardManager = new ClipboardManager(this.uuid, this._settings);
        } catch (e) {
            console.error('[AIO-Clipboard] FATAL: FAILED to initialize ClipboardManager:', e);
            return;
        }

        const isLoadSuccessful = await this._clipboardManager.loadAndPrepare();

        if (isLoadSuccessful) {
            this._clipboardManager.runGarbageCollection();
        }

        this._indicator = new AllInOneClipboardIndicator(this._settings, this, this._clipboardManager);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1);

        this._updateIndicatorVisibility();

        this._settingsSignalIds.push(
            this._settings.connect('changed::hide-panel-icon', () => this._updateIndicatorVisibility())
        );

        this._settingsSignalIds.push(
            this._settings.connect('changed::clear-recents-trigger', () => this._onClearRecentsTrigger())
        );

        this._bindKeyboardShortcuts();
    }

    /**
     * Binds keyboard shortcuts defined in the settings to their respective actions.
     * @private
     */
    _bindKeyboardShortcuts() {
        const ModeType = Shell.hasOwnProperty('ActionMode')
            ? Shell.ActionMode
            : Shell.KeyBindingMode;

        this._shortcutIds = [];

        this._addKeybinding('shortcut-toggle-main', () => {
            this._indicator.toggleMenu();
        });

        const tabMap = {
            'shortcut-open-clipboard': _("Clipboard"),
            'shortcut-open-emoji': _("Emoji"),
            'shortcut-open-gif': _("GIF"),
            'shortcut-open-kaomoji': _("Kaomoji"),
            'shortcut-open-symbols': _("Symbols")
        };

        Object.entries(tabMap).forEach(([shortcutKey, tabName]) => {
            this._addKeybinding(shortcutKey, () => {
                if (!this._indicator.menu.isOpen) {
                    this._indicator.toggleMenu();
                }

                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this._indicator._selectTab(tabName);
                    return GLib.SOURCE_REMOVE;
                });
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
        const ModeType = Shell.hasOwnProperty('ActionMode')
            ? Shell.ActionMode
            : Shell.KeyBindingMode;

        Main.wm.addKeybinding(
            name,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            ModeType.ALL,
            callback
        );

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

        this._shortcutIds.forEach(id => {
            Main.wm.removeKeybinding(id);
        });

        this._shortcutIds = null;
    }

    /**
     * Disables the extension, cleaning up all resources and UI components.
     * @override
     */
    disable() {
        this._unbindKeyboardShortcuts();

        this._settingsSignalIds.forEach(id => {
            if (this._settings) {
                this._settings.disconnect(id);
            }
        });
        this._settingsSignalIds = [];

        import('./utilities/utilityAutoPaste.js').then(module => {
            module.cleanup();
        }).catch(() => {
            // Ignore
        });

        this._indicator?.destroy();
        this._indicator = null;

        this._clipboardManager?.destroy();
        this._clipboardManager = null;

        this._settings = null;
    }
}