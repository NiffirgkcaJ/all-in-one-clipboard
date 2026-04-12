import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { eventMatchesShortcut } from '../utilities/utilityShortcutMatcher.js';
import { positionMenu } from '../utilities/utilityMenuPositioner.js';

import { MenuContentArea } from './menuContentArea.js';
import { MenuTabBar } from './menuTabBar.js';
import { MenuTuning } from './menuConstants.js';

/**
 * The main indicator button for the extension.
 */
export const MenuIndicator = GObject.registerClass(
    class MenuIndicator extends PanelMenu.Button {
        /**
         * Initializes the main indicator button and wires up menu instantiation.
         *
         * @param {Gio.Settings} settings Extension settings configuration.
         * @param {object} extension Parent extension instance.
         * @param {object} clipboardManager Global clipboard manager state tracking.
         */
        constructor(settings, extension, clipboardManager) {
            super(0.5, _('All-in-One Clipboard'), false);

            this._settings = settings;
            this._extension = extension;
            this._clipboardManager = clipboardManager;

            this._isOpeningViaShortcut = false;
            this._explicitTabTarget = null;
            this._lastActiveTabName = null;

            this._menuOpenIdleId = 0;
            this._menuPositionIdleId = 0;
            this._dimensionDebounceId = 0;
            this._settingsSignalIds = [];

            const icon = new St.Icon({
                icon_name: 'edit-copy-symbolic',
                style_class: 'system-status-icon',
            });
            this.add_child(icon);

            this._buildMenu();
            this._bindMenuEvents();
        }

        // ========================================================================
        // DOM Construction
        // ========================================================================

        /**
         * Builds the menu structure.
         *
         * @private
         */
        _buildMenu() {
            this.menu.removeAll();

            this._mainVerticalBox = new St.BoxLayout({
                vertical: true,
                width: this._settings.get_int('extension-width'),
                height: this._settings.get_int('extension-height'),
                style_class: 'aio-clipboard-container',
                reactive: true,
                can_focus: false,
            });

            this._mainVerticalBox.connect('captured-event', this._onContainerKeyPress.bind(this));
            this.menu.box.add_child(this._mainVerticalBox);

            const debounceDimensionUpdate = () => {
                if (this._dimensionDebounceId > 0) GLib.source_remove(this._dimensionDebounceId);
                this._dimensionDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MenuTuning.DIMENSION_DEBOUNCE_MS, () => {
                    this._dimensionDebounceId = 0;
                    this._mainVerticalBox.width = this._settings.get_int('extension-width');
                    this._mainVerticalBox.height = this._settings.get_int('extension-height');
                    return GLib.SOURCE_REMOVE;
                });
            };

            this._settingsSignalIds.push(this._settings.connect('changed::extension-width', debounceDimensionUpdate));
            this._settingsSignalIds.push(this._settings.connect('changed::extension-height', debounceDimensionUpdate));

            this._tabBar = new MenuTabBar(this._settings);
            this._mainVerticalBox.add_child(this._tabBar);

            this._contentArea = new MenuContentArea(this._settings, this._extension, this._clipboardManager);
            this._mainVerticalBox.add_child(this._contentArea);

            this._tabBar.connect('tab-selected', (actor, tabName) => {
                if (tabName) {
                    this._executeTabSelection(tabName);
                } else {
                    this._contentArea.clearContent();
                }
            });

            this._contentArea.connect('navigate-to-main-tab', (actor, tabName) => {
                if (this._tabBar.TAB_NAMES.includes(tabName)) {
                    this._executeTabSelection(tabName);
                }
            });

            this._contentArea.connect('set-main-tab-bar-visibility', (actor, isVisible) => {
                this._tabBar.setTabBarVisibility(isVisible);
            });
        }

        // ========================================================================
        // Signal Tracking
        // ========================================================================

        /**
         * Binds menu open/close events.
         *
         * @private
         */
        _bindMenuEvents() {
            this.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    if (this._isOpeningViaShortcut) {
                        this._isOpeningViaShortcut = false;
                        return;
                    }

                    const rememberLastTab = this._settings.get_boolean('remember-last-tab');
                    let targetTab = null;

                    if (rememberLastTab && this._lastActiveTabName && this._tabBar.isTabAvailable(this._lastActiveTabName)) {
                        targetTab = this._lastActiveTabName;
                    }

                    if (!targetTab) {
                        const userDefault = this._settings.get_string('default-tab');
                        const translatedDefault = _(userDefault);
                        if (this._tabBar.isTabAvailable(translatedDefault)) {
                            targetTab = translatedDefault;
                        }
                    }

                    if (!targetTab) {
                        targetTab = this._tabBar.getFirstVisibleTabName();
                    }

                    this._menuOpenIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        if (this.menu.isOpen && targetTab) {
                            this._executeTabSelection(targetTab);
                        }
                        this._menuOpenIdleId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    this._contentArea.onMenuClosed();
                }
            });
        }

        // ========================================================================
        // Tab Dispatch
        // ========================================================================

        /**
         * Selects the target tab.
         *
         * @param {string} tabName Localized target tab string.
         * @returns {Promise<void>} Resolves tracking synchronous operation completion.
         * @private
         */
        async _executeTabSelection(tabName) {
            this._lastActiveTabName = tabName;
            this._tabBar.setActiveTabName(tabName);
            await this._contentArea.selectTab(tabName);
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * State accessor property exposing if popup rendered.
         *
         * @returns {boolean} True if stage maps active.
         */
        get isMenuOpen() {
            return this.menu.isOpen;
        }

        /**
         * Checks if a tab is available.
         *
         * @param {string} tabName Localized tab key.
         * @returns {boolean} True if enabled actively.
         */
        isTabAvailable(tabName) {
            return this._tabBar.isTabAvailable(tabName);
        }

        /**
         * Selects the target tab.
         *
         * @param {string} tabName Target localized identifier string.
         * @returns {Promise<void>} Resolves when asynchronous tab logic completes.
         */
        async selectTab(tabName) {
            await this._executeTabSelection(tabName);
        }

        /**
         * Opens the menu.
         */
        openMenu() {
            if (this.menu.isOpen) return;

            if (!this.visible) {
                this.menu.open(false);
                if (this._menuPositionIdleId) {
                    GLib.source_remove(this._menuPositionIdleId);
                }
                this._menuPositionIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this.menu.actor) {
                        positionMenu(this.menu.actor, this._settings);
                    }
                    this._menuPositionIdleId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this.menu.open();
            }
        }

        /**
         * Toggles the menu.
         */
        toggleMenu() {
            if (this.menu.isOpen) {
                this.menu.close();
            } else {
                this._explicitTabTarget = null;
                this.openMenu();
            }
        }

        /**
         * Opens the menu and selects the target tab.
         *
         * @param {string} tabName Localized identifier string.
         * @returns {Promise<void>} Resolves when instantiated.
         */
        async openMenuAndSelectTab(tabName) {
            await this._executeTabSelection(tabName);
            this._isOpeningViaShortcut = true;
            this.openMenu();
        }

        // ========================================================================
        // Keyboard Navigation
        // ========================================================================

        /**
         * Handles keypress events.
         *
         * @param {Clutter.Actor} actor The actor.
         * @param {Clutter.Event} event The event.
         * @returns {number}
         * @private
         */
        _onContainerKeyPress(actor, event) {
            if (event.type() !== Clutter.EventType.KEY_PRESS) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (eventMatchesShortcut(event, this._settings, 'shortcut-next-tab')) {
                this._tabBar.cycleTab(1);
                return Clutter.EVENT_STOP;
            }

            if (eventMatchesShortcut(event, this._settings, 'shortcut-prev-tab')) {
                this._tabBar.cycleTab(-1);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Cleans up resources and disconnects signals.
         *
         * @override
         */
        destroy() {
            if (this._menuOpenIdleId) {
                GLib.source_remove(this._menuOpenIdleId);
                this._menuOpenIdleId = 0;
            }
            if (this._menuPositionIdleId) {
                GLib.source_remove(this._menuPositionIdleId);
                this._menuPositionIdleId = 0;
            }
            if (this._dimensionDebounceId > 0) {
                GLib.source_remove(this._dimensionDebounceId);
                this._dimensionDebounceId = 0;
            }

            this._settingsSignalIds.forEach((id) => {
                if (this._settings) {
                    this._settings.disconnect(id);
                }
            });
            this._settingsSignalIds = [];

            this._tabBar?.destroy();
            this._tabBar = null;

            this._contentArea?.destroy();
            this._contentArea = null;

            this._mainVerticalBox = null;
            this._settings = null;
            this._extension = null;
            this._clipboardManager = null;

            super.destroy();
        }
    },
);
