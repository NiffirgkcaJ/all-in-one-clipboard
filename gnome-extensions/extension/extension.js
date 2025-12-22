import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Gettext from 'gettext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from './shared/utilities/utilityIcon.js';
import { eventMatchesShortcut } from './shared/utilities/utilityShortcutMatcher.js';
import { FocusUtils } from './shared/utilities/utilityFocus.js';
import { IOFile } from './shared/utilities/utilityIO.js';
import { positionMenu } from './shared/utilities/utilityMenuPositioner.js';
import { ServiceJson } from './shared/services/serviceJson.js';
import { getAutoPaster, destroyAutoPaster } from './shared/utilities/utilityAutoPaste.js';
import { initStorage, FileItem, FilePath } from './shared/constants/storagePaths.js';

import { ClipboardManager } from './features/Clipboard/logic/clipboardManager.js';
import { getGifCacheManager, destroyGifCacheManager } from './features/GIF/logic/gifCacheManager.js';
import { getSkinnableCharSet, destroySkinnableCharSetCache } from './features/Emoji/logic/emojiDataCache.js';

/**
 * Creates a simple, predictable identifier from a tab name.
 */
function getTabIdentifier(tabName) {
    return tabName.replace(/\s+/g, '');
}

/**
 * A single, declarative configuration for all main tabs.
 * This is the single source of truth for tab properties.
 */
const TABS = [
    {
        name: 'Recently Used',
        icon: 'utility-recents-symbolic.svg',
        iconSize: 16,
        isFullView: false,
        settingKey: 'enable-recents-tab',
    },
    {
        name: 'Emoji',
        icon: 'main-emoji-symbolic.svg',
        iconSize: 16,
        isFullView: true,
        settingKey: 'enable-emoji-tab',
    },
    {
        name: 'GIF',
        icon: 'main-gif-symbolic.svg',
        iconSize: 16,
        isFullView: true,
        settingKey: 'enable-gif-tab',
    },
    {
        name: 'Kaomoji',
        icon: 'main-kaomoji-symbolic.svg',
        iconSize: 16,
        isFullView: true,
        settingKey: 'enable-kaomoji-tab',
    },
    {
        name: 'Symbols',
        icon: 'main-symbols-symbolic.svg',
        iconSize: 16,
        isFullView: true,
        settingKey: 'enable-symbols-tab',
    },
    {
        name: 'Clipboard',
        icon: 'main-clipboard-symbolic.svg',
        iconSize: 16,
        isFullView: false,
        settingKey: 'enable-clipboard-tab',
    },
];

/**
 * The main panel indicator and menu for the All-in-One Clipboard extension.
 * This class is responsible for building the main UI, managing the tab bar,
 * and dynamically loading the content for each selected tab.
 */
const AllInOneClipboardIndicator = GObject.registerClass(
    class AllInOneClipboardIndicator extends PanelMenu.Button {
        constructor(settings, extension, clipboardManager) {
            super(0.5, _('All-in-One Clipboard'), false);

            this._settings = settings;
            this._extension = extension;
            this._clipboardManager = clipboardManager;

            // Generate tab properties from the single TABS constant.
            this.TAB_NAMES = TABS.map((t) => _(t.name));
            this._fullViewTabs = TABS.filter((t) => t.isFullView).map((t) => _(t.name));

            this._tabButtons = {};
            this._activeTabName = null;
            this._lastActiveTabName = null;
            this._tabContentArea = null;
            this._currentTabActor = null;
            this._mainTabBar = null;
            this._explicitTabTarget = null;
            this._isOpeningViaShortcut = false;
            this._alwaysShowTabBar = this._settings.get_boolean('always-show-main-tab');
            this._isSelectingTab = false;

            this._currentTabVisibilitySignalId = 0;
            this._currentTabNavigateSignalId = 0;
            this._selectTabTimeoutId = 0;
            this._loadingIndicatorTimeoutId = 0;
            this._tabVisibilitySignalIds = [];

            const icon = new St.Icon({
                icon_name: 'edit-copy-symbolic',
                style_class: 'system-status-icon',
            });
            this.add_child(icon);

            this._buildMenu();

            // Connect signals for tab management.
            TABS.forEach((tab) => {
                if (Object.prototype.hasOwnProperty.call(tab, 'settingKey')) {
                    const signalId = this._settings.connect(`changed::${tab.settingKey}`, () => this._updateTabsVisibility());
                    this._tabVisibilitySignalIds.push(signalId);
                }
            });

            // Listen for changes to the tab order and rebuild the tab bar in real-time.
            const tabOrderSignalId = this._settings.connect('changed::tab-order', () => this._rebuildTabBar());
            this._tabVisibilitySignalIds.push(tabOrderSignalId);

            // Listen for changes to the 'always-show-main-tab' setting.
            const alwaysShowTabsSignalId = this._settings.connect('changed::always-show-main-tab', () => {
                this._alwaysShowTabBar = this._settings.get_boolean('always-show-main-tab');
                this._updateTabBarVisibilityForActiveTab();
            });
            this._tabVisibilitySignalIds.push(alwaysShowTabsSignalId);

            // Listen for changes to the 'hide-last-main-tab' setting.
            const hideSingleTabSignalId = this._settings.connect('changed::hide-last-main-tab', () => {
                // Recalculate the force-hide flag and update visibility
                this._updateTabsVisibility();
            });
            this._tabVisibilitySignalIds.push(hideSingleTabSignalId);

            // Run once on startup to set the initial state.
            this._updateTabsVisibility();
        }

        // ========================================================================
        // Menu Construction
        // ========================================================================

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
                style_class: 'aio-clipboard-container',
                reactive: true, // Essential for capturing key events
                can_focus: false,
            });
            // Intercept key presses for tab cycling
            mainVerticalBox.connect('captured-event', this._onContainerKeyPress.bind(this));
            this.menu.box.add_child(mainVerticalBox);

            this._mainTabBar = new St.BoxLayout();
            mainVerticalBox.add_child(this._mainTabBar);

            this._tabContentArea = new St.Bin({
                style_class: 'aio-clipboard-content-area',
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.FILL,
            });
            mainVerticalBox.add_child(this._tabContentArea);

            // Rebuild the tab bar based on current settings
            this._rebuildTabBar();

            this._mainTabBar.set_reactive(true);
            this._mainTabBar.connect('key-press-event', this._onMainTabBarKeyPress.bind(this));

            // Handle menu open/close events
            this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    // If we're opening via a shortcut, do not interfere with the tab selection.
                    if (this._isOpeningViaShortcut) {
                        this._isOpeningViaShortcut = false;
                        return;
                    }

                    // Otherwise, this is a general open (e.g., panel click), so run default logic.
                    const rememberLastTab = this._settings.get_boolean('remember-last-tab');
                    let targetTab = null;

                    // Remember last used tab if enabled and visible.
                    if (rememberLastTab && this._lastActiveTabName && this._tabButtons[this._lastActiveTabName]?.visible) {
                        targetTab = this._lastActiveTabName;
                    }

                    // Use the user's default tab if visible.
                    if (!targetTab) {
                        const userDefault = this._settings.get_string('default-tab');
                        const translatedDefault = _(userDefault);
                        if (this._tabButtons[translatedDefault]?.visible) {
                            targetTab = translatedDefault;
                        }
                    }

                    // As a final fallback, use the first visible tab in the user's order.
                    if (!targetTab) {
                        const tabOrder = this._settings.get_strv('tab-order');
                        for (const name of tabOrder) {
                            const translated = _(name);
                            if (this._tabButtons[translated]?.visible) {
                                targetTab = translated;
                                break;
                            }
                        }
                    }

                    // If the menu is open, select the target tab.
                    this._menuOpenIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        if (this.menu.isOpen && targetTab) {
                            this._selectTab(targetTab);
                        }
                        this._menuOpenIdleId = 0;
                        // If no tabs are visible, it will just open empty.
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    // Only call onMenuClosed if the actor is still valid and on stage
                    if (this._currentTabActor && this._currentTabActor.get_stage()) {
                        this._currentTabActor.onMenuClosed?.();
                    }
                }
            });
        }

        /**
         * Clears and rebuilds the main tab bar based on the current 'tab-order' setting.
         * This is called when the tab order changes in real-time.
         * @private
         */
        _rebuildTabBar() {
            // Clear all existing buttons and references
            this._mainTabBar.destroy_all_children();
            this._tabButtons = {};

            const tabOrder = this._settings.get_strv('tab-order');

            tabOrder.forEach((name) => {
                const translatedName = _(name);
                const tabConfig = TABS.find((t) => t.name === name);
                if (!tabConfig) return;

                const iconFile = tabConfig.icon;
                const iconSize = tabConfig.iconSize;
                const iconWidget = createStaticIcon({ icon: iconFile, iconSize: iconSize });

                const button = new St.Button({
                    style_class: 'aio-clipboard-tab-button button',
                    can_focus: true,
                    child: iconWidget,
                    x_expand: true,
                });

                button.tooltip_text = translatedName;

                button.connect('clicked', () => this._selectTab(translatedName));
                this._tabButtons[translatedName] = button;
                this._mainTabBar.add_child(button);
            });

            // After rebuilding, we must re-apply the visibility rules.
            this._updateTabsVisibility();

            // Re-highlight the active tab with the new buttons
            if (this._activeTabName) {
                this._updateTabButtonSelection();
            }
        }

        // ========================================================================
        // Tab Bar Management
        // ========================================================================

        /**
         * Sets the visibility of the main tab bar.
         * @param {boolean} isVisible - Whether the tab bar should be visible.
         * @private
         */
        _setMainTabBarVisibility(isVisible) {
            // Determine desired visibility based on settings and force-hide flag
            const desiredVisibility = this._alwaysShowTabBar || isVisible;
            const shouldBeVisible = desiredVisibility && !this._forceHideMainTabBar;

            if (this._mainTabBar && this._mainTabBar.visible !== shouldBeVisible) {
                this._mainTabBar.visible = shouldBeVisible;
            }
        }

        /**
         * Determines if the tab bar should be shown for a given tab.
         * @param {string} tabName - The name of the tab to check.
         * @returns {boolean} - True if the tab bar should be shown, false otherwise.
         */
        _shouldShowTabBarForTab(tabName) {
            // If the global setting is on, or if we don't have a tab name, always show.
            if (this._alwaysShowTabBar || !tabName) {
                return true;
            }

            // Otherwise, show only if the tab is not a full-view tab.
            return !this._fullViewTabs.includes(tabName);
        }

        /**
         * Updates the tab bar visibility based on the currently active tab.
         * @private
         */
        _updateTabBarVisibilityForActiveTab() {
            this._setMainTabBarVisibility(this._shouldShowTabBarForTab(this._activeTabName));
        }

        /**
         * Updates the visual state of the tab buttons so the active tab is highlighted.
         * @private
         */
        _updateTabButtonSelection() {
            if (!this._tabButtons) {
                return;
            }

            for (const [name, button] of Object.entries(this._tabButtons)) {
                if (name === this._activeTabName) {
                    button.add_style_pseudo_class('checked');
                } else {
                    button.remove_style_pseudo_class('checked');
                }
            }
        }

        /**
         * Updates the visibility and interactivity of all main tabs based on user settings.
         * @private
         */
        _updateTabsVisibility() {
            const visibleTabs = new Set();

            // Iterate through all buttons in the tab bar to respect user order.
            this._mainTabBar.get_children().forEach((button) => {
                // Find the translated name associated with this button widget
                const name = Object.keys(this._tabButtons).find((key) => this._tabButtons[key] === button);
                if (!name) return;

                // Find the original, non-translated name to look up its config
                const originalName = TABS.find((t) => _(t.name) === name)?.name;
                const config = TABS.find((t) => t.name === originalName);
                if (!config) return;

                // Determine visibility based on the associated setting key
                const isVisible = config.settingKey ? this._settings.get_boolean(config.settingKey) : true;

                button.visible = isVisible;
                button.reactive = isVisible;
                button.can_focus = isVisible;

                if (isVisible) {
                    visibleTabs.add(name);
                }
            });

            // Determine if we need to force-hide the tab bar due to single-tab setting
            const hideWhenSingle = this._settings.get_boolean('hide-last-main-tab');
            this._forceHideMainTabBar = hideWhenSingle && visibleTabs.size <= 1;
            this._updateTabBarVisibilityForActiveTab();

            const fallbackTarget = this._getFirstVisibleTabName();

            // Always use _selectTab to ensure content is properly loaded
            if (this._activeTabName && !visibleTabs.has(this._activeTabName)) {
                if (fallbackTarget) {
                    // If menu is open, select immediately
                    if (this.menu?.isOpen) {
                        this._selectTab(fallbackTarget);
                    } else {
                        // If menu is closed, just update active tab reference
                        if (this._currentTabActor) {
                            this._disconnectTabSignals(this._currentTabActor);
                            this._currentTabActor.destroy();
                            this._currentTabActor = null;
                        }
                        this._activeTabName = fallbackTarget;
                    }
                } else {
                    // No tabs are visible, clear active tab and content
                    if (this._currentTabActor) {
                        this._disconnectTabSignals(this._currentTabActor);
                        this._currentTabActor.destroy();
                        this._currentTabActor = null;
                    }
                    this._activeTabName = null;
                }
            }

            // Also update last active tab
            if (this._lastActiveTabName && !visibleTabs.has(this._lastActiveTabName)) {
                this._lastActiveTabName = fallbackTarget;
            }
        }

        /**
         * Retrieves the first visible tab name based on the current user order.
         * @returns {string|null} The translated tab name if available, otherwise null.
         * @private
         */
        _getFirstVisibleTabName() {
            // Iterate through the user's tab order to find the first visible tab
            const tabOrder = this._settings.get_strv('tab-order');
            for (const name of tabOrder) {
                const translated = _(name);
                if (this._tabButtons[translated]?.visible) {
                    return translated;
                }
            }
            return null; // Should not happen if at least one tab is visible
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
            } catch {
                // Errors on disconnect are usually safe to ignore
            } finally {
                this._currentTabVisibilitySignalId = 0;
                this._currentTabNavigateSignalId = 0;
            }
        }

        // ========================================================================
        // Tab Selection and Loading
        // ========================================================================

        /**
         * Selects and loads the specified tab, updating the UI accordingly.
         * @param {string} tabName - The name of the tab to select.
         * @private
         */
        async _selectTab(tabName) {
            // Prevent concurrent tab selections
            if (!IOFile.mkdir(FilePath.DATA)) {
                return;
            }
            this._isSelectingTab = true;

            const oldActor = this._currentTabActor;

            try {
                // If clicking the same tab, just call its onSelected method and exit.
                if (this._activeTabName === tabName && oldActor) {
                    oldActor.onTabSelected?.();
                    return;
                }

                // Update active tab references and button states
                const wasOldTabFullView = this._fullViewTabs.includes(this._activeTabName);

                // Update state
                this._activeTabName = tabName;
                this._lastActiveTabName = tabName;
                this._updateTabButtonSelection();
                const isNewTabFullView = this._fullViewTabs.includes(tabName);

                // Load the new content actor
                const newContentActor = await this._loadTabModule(tabName);

                // If the active tab changed while we were loading, abort this operation.
                if (this._activeTabName !== tabName) {
                    newContentActor?.destroy();
                    return;
                }

                // Replace the old actor with the new one.
                this._tabContentArea.set_child(newContentActor);

                // Adjust tab bar visibility based on the new content's properties.
                if (!isNewTabFullView) {
                    // Moving to a non-full-view tab, show the tab bar
                    this._setMainTabBarVisibility(true);
                } else if (!wasOldTabFullView) {
                    // Moving to full-view tab, hide the tab bar
                    this._setMainTabBarVisibility(false);
                }

                // Now that the old actor is off-stage, safely disconnect signals and destroy it.
                this._disconnectTabSignals(oldActor);
                oldActor?.destroy();

                // Update the internal reference to the new actor.
                this._currentTabActor = newContentActor;

                // Connect signals to the new actor for tab bar visibility and navigation.
                this._connectTabSignals(newContentActor);

                // Call the onTabSelected method after a brief idle to ensure UI stability.
                this._scheduleTabSelected();
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to load tab '${tabName}': ${e.message}\n${e.stack}`);

                // If an error occurs, destroy the old actor and show an error message.
                oldActor?.destroy();
                this._setMainTabBarVisibility(true);

                if (this._tabContentArea && this._activeTabName === tabName) {
                    const errorLabel = new St.Label({
                        text: `Error loading tab: ${e.message}`,
                        style_class: 'aio-clipboard-error-label',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                        y_expand: true,
                    });
                    this._tabContentArea.set_child(errorLabel);
                    this._currentTabActor = errorLabel;
                }
            } finally {
                this._isSelectingTab = false;
            }
        }

        /**
         * Load and instantiate a tab module
         * @param {string} tabName - The name of the tab to load
         * @returns {Promise<St.Widget>} The tab content actor
         * @private
         */
        async _loadTabModule(tabName) {
            const tabId = getTabIdentifier(tabName);

            // Handle Recently Used tab specially
            if (tabName === _('Recently Used')) {
                const moduleUrl = `file://${this._extension.path}/features/RecentlyUsed/tabRecentlyUsed.js`;
                const tabModule = await import(moduleUrl);
                const newContentActor = new tabModule.RecentlyUsedTabContent(this._extension, this._settings, this._clipboardManager);

                // Wait for the tab's internal async loading to complete.
                if (newContentActor.initializationPromise) {
                    await newContentActor.initializationPromise;
                }
                return newContentActor;
            }

            // Handle standard tabs
            const moduleUrl = `file://${this._extension.path}/features/${tabId}/tab${tabId}.js`;
            const tabModule = await import(moduleUrl);
            const className = `${tabId}TabContent`;

            if (!tabModule[className]) {
                throw new Error(`Class '${className}' not found in module: ${moduleUrl}`);
            }

            // Clipboard tab and GIF tab need special constructor arguments
            if (tabName === _('Clipboard') || tabName === _('GIF')) {
                return new tabModule[className](this._extension, this._settings, this._clipboardManager);
            }

            return new tabModule[className](this._extension, this._settings);
        }

        /**
         * Connect signals to a tab actor for visibility and navigation
         * @param {St.Widget} actor - The tab actor to connect signals to
         * @private
         */
        _connectTabSignals(actor) {
            if (!actor?.constructor?.$gtype) return;

            // Connect visibility signal
            if (GObject.signal_lookup('set-main-tab-bar-visibility', actor.constructor.$gtype)) {
                this._currentTabVisibilitySignalId = actor.connect('set-main-tab-bar-visibility', (tabActor, isVisible) => {
                    this._setMainTabBarVisibility(isVisible);
                });
            }

            // Connect navigation signal
            if (GObject.signal_lookup('navigate-to-main-tab', actor.constructor.$gtype)) {
                this._currentTabNavigateSignalId = actor.connect('navigate-to-main-tab', (tabActor, targetTabName) => {
                    if (this.TAB_NAMES.includes(targetTabName)) {
                        this._selectTab(targetTabName);
                    }
                });
            }
        }

        /**
         * Schedule the onTabSelected callback to run after a brief idle
         * @private
         */
        _scheduleTabSelected() {
            if (this._selectTabTimeoutId) {
                GLib.source_remove(this._selectTabTimeoutId);
            }
            this._selectTabTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 10, () => {
                this._currentTabActor?.onTabSelected?.();
                this._selectTabTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        // ========================================================================
        // Keyboard Navigation
        // ========================================================================

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

            return FocusUtils.handleLinearNavigation(event, buttons, currentIndex);
        }

        /**
         * Handles key presses on the main container to support tab cycling.
         * @param {Clutter.Actor} actor
         * @param {Clutter.Event} event
         */
        _onContainerKeyPress(actor, event) {
            // Only handle key press events
            if (event.type() !== Clutter.EventType.KEY_PRESS) {
                return Clutter.EVENT_PROPAGATE;
            }

            // Check Next Tab Shortcuts
            if (eventMatchesShortcut(event, this._settings, 'shortcut-next-tab')) {
                this._cycleTab(1);
                return Clutter.EVENT_STOP;
            }

            // Check Previous Tab Shortcuts
            if (eventMatchesShortcut(event, this._settings, 'shortcut-prev-tab')) {
                this._cycleTab(-1);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Cycles to the next or previous visible tab.
         * @param {number} direction - 1 for next, -1 for previous
         */
        _cycleTab(direction) {
            const tabOrder = this._settings.get_strv('tab-order');
            const visibleTabs = [];

            tabOrder.forEach((name) => {
                const translatedName = _(name);
                if (this._tabButtons[translatedName] && this._tabButtons[translatedName].visible) {
                    visibleTabs.push(translatedName);
                }
            });

            if (visibleTabs.length <= 1) return;

            const currentIndex = visibleTabs.indexOf(this._activeTabName);
            if (currentIndex === -1) return;

            let newIndex = (currentIndex + direction) % visibleTabs.length;
            if (newIndex < 0) newIndex += visibleTabs.length;

            const targetTab = visibleTabs[newIndex];
            this._selectTab(targetTab);
        }

        // ========================================================================
        // Menu Operations
        // ========================================================================

        /**
         * Opens the menu, respecting the positioning settings for a hidden icon.
         * The 'open-state-changed' signal handler will manage which tab to display.
         */
        openMenu() {
            if (this.menu.isOpen) {
                return;
            }

            // If the menu is hidden, open it manually and position it.
            if (!this.visible) {
                this.menu.open(false); // Open without animation for manual positioning
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this.menu.actor) {
                        positionMenu(this.menu.actor, this._settings);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this.menu.open();
            }
        }

        /**
         * Toggles the menu's visibility. Called by the main toggle shortcut and mouse clicks.
         * This is a general open, so we do not set a specific tab target.
         */
        toggleMenu() {
            if (this.menu.isOpen) {
                this.menu.close();
            } else {
                // Reset the target tab when opening the menu generally.
                this._explicitTabTarget = null;
                this.openMenu();
            }
        }

        /**
         * Opens the menu and ensures a specific tab is selected.
         * Used by the specific-tab keyboard shortcuts.
         * @param {string} tabName - The name of the tab to open.
         */
        async openMenuAndSelectTab(tabName) {
            await this._selectTab(tabName);

            // Tell the 'open-state-changed' handler to not interfere.
            this._isOpeningViaShortcut = true;
            this.openMenu();
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Cleans up resources when the indicator is destroyed.
         * @override
         */
        destroy() {
            // Clean up any pending timeouts
            if (this._selectTabTimeoutId) {
                GLib.source_remove(this._selectTabTimeoutId);
                this._selectTabTimeoutId = 0;
            }
            if (this._loadingIndicatorTimeoutId) {
                GLib.source_remove(this._loadingIndicatorTimeoutId);
                this._loadingIndicatorTimeoutId = 0;
            }
            if (this._menuOpenIdleId) {
                GLib.source_remove(this._menuOpenIdleId);
                this._menuOpenIdleId = 0;
            }
            if (this._currentTabActor) {
                this._disconnectTabSignals(this._currentTabActor);
            }
            this._currentTabActor?.destroy();
            this._currentTabActor = null;

            this._tabVisibilitySignalIds.forEach((id) => {
                if (this._settings) {
                    this._settings.disconnect(id);
                }
            });
            this._tabVisibilitySignalIds = [];

            this._tabButtons = null;
            this._mainTabBar = null;
            this._tabContentArea = null;
            this._settings = null;
            this._extension = null;

            super.destroy();
        }
    },
);

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
        this._resource = null;
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

        // Ignore if the trigger is empty, which happens when we reset it
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
            // Clear all known recent files
            for (const filePath of Object.values(RECENT_PATHS_MAP)) {
                this._clearRecentFile(filePath);
            }
        } else if (RECENT_PATHS_MAP[trigger]) {
            // Clear a specific recent file
            this._clearRecentFile(RECENT_PATHS_MAP[trigger]);
        } else if (trigger === 'clipboard-history' && this._clipboardManager) {
            this._clipboardManager.clearHistory();
        } else if (trigger === 'clipboard-pinned' && this._clipboardManager) {
            this._clipboardManager.clearPinned();
        } else if (trigger === 'gif-cache') {
            getGifCacheManager().clearCache();
        }

        // Reset the trigger back to empty so it can be used again.
        this._settings.set_string('clear-recents-trigger', '');
    }

    /**
     * Clears a specified recent items file by overwriting it with an empty array.
     * This avoids race conditions that can occur with file deletion.
     * @param {string} absolutePath - The absolute path of the file to clear.
     * @private
     */
    async _clearRecentFile(absolutePath) {
        await IOFile.write(absolutePath, ServiceJson.stringify([]));
    }

    /**
     * Enables the extension, initializing settings, clipboard manager, and UI components.
     * Also binds keyboard shortcuts for quick access.
     * @async
     */
    async enable() {
        // Load resources
        try {
            this._resource = Gio.Resource.load(this.path + '/resources.gresource');
            Gio.resources_register(this._resource);
        } catch (e) {
            console.error(`[AIO-Clipboard] FATAL: Could not load GResource file: ${e}`);
            return;
        }

        // Initialize translations
        this.initTranslations('all-in-one-clipboard');
        Gettext.bindtextdomain('all-in-one-clipboard-content', this.dir.get_child('locale').get_path());

        // Load settings
        this._settings = this.getSettings();

        // Initialize storage paths
        initStorage(this.uuid);

        // Initialize singleton managers
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

        // Clear data at login if the setting is enabled
        if (this._settings.get_boolean('clear-data-at-login')) {
            // Clear Clipboard History if enabled
            if (this._settings.get_boolean('clear-clipboard-history-at-login')) {
                this._clipboardManager.clearHistory();
            }

            // Define and clear all other recent item types if enabled
            const recentsToClear = [
                { setting: 'clear-recent-emojis-at-login', file: 'recent_emojis.json' },
                { setting: 'clear-recent-gifs-at-login', file: 'recent_gifs.json' },
                { setting: 'clear-recent-kaomojis-at-login', file: 'recent_kaomojis.json' },
                { setting: 'clear-recent-symbols-at-login', file: 'recent_symbols.json' },
            ];

            for (const item of recentsToClear) {
                if (this._settings.get_boolean(item.setting)) {
                    // Clear the recent items file
                    this._clearRecentFile(item.file);
                }
            }
        }

        // Run garbage collection if the clipboard data loaded successfully
        if (isLoadSuccessful) {
            this._clipboardManager.runGarbageCollection();
        }

        // Start auto-paste functionality
        this._indicator = new AllInOneClipboardIndicator(this._settings, this, this._clipboardManager);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1);

        this._updateIndicatorVisibility();

        this._settingsSignalIds.push(this._settings.connect('changed::hide-panel-icon', () => this._updateIndicatorVisibility()));

        this._settingsSignalIds.push(this._settings.connect('changed::clear-recents-trigger', () => this._onClearRecentsTrigger()));

        this._bindKeyboardShortcuts();
    }

    /**
     * Binds keyboard shortcuts defined in the settings to their respective actions.
     * @private
     */
    _bindKeyboardShortcuts() {
        this._shortcutIds = [];

        // Main toggle shortcut simply calls the toggle method.
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
                // If the button for this tab is not visible, do nothing.
                const button = this._indicator._tabButtons[tabName];
                if (!button || !button.visible) {
                    return;
                }

                if (this._indicator.menu.isOpen) {
                    // If the menu is already open, just switch tabs.
                    await this._indicator._selectTab(tabName);
                } else {
                    // If the menu is closed, open it and select the tab.
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

    /**
     * Disables the extension, cleaning up all resources and UI components.
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

        // Destroy singleton managers
        destroyAutoPaster();
        destroyGifCacheManager();
        destroySkinnableCharSetCache();

        this._indicator?.destroy();
        this._indicator = null;

        this._clipboardManager?.destroy();
        this._clipboardManager = null;

        // Clean up resources
        if (this._resource) {
            Gio.resources_unregister(this._resource);
            this._resource = null;
        }

        this._settings = null;
    }
}
