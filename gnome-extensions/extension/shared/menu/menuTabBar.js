import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from '../utilities/utilityIcon.js';
import { FocusUtils } from '../utilities/utilityFocus.js';

import { getMenuOrderedSections } from './menuRegistry.js';

/**
 * MenuTabBar is a dynamic tab bar component for the clipboard manager menu, allowing users to switch between different sections of the menu. It reacts to extension settings to show/hide tabs and manages keyboard navigation for accessibility.
 * The component emits 'tab-selected' when a tab is clicked or selected via keyboard, and 'navigate-down' when the user presses the down arrow key while focused on the tab bar.
 * It listens to changes in the extension settings to update the visibility of tabs and the tab bar itself, ensuring that the UI always reflects the current configuration and active tab state.
 *
 * @class MenuTabBar
 * @extends St.BoxLayout
 * @emits 'tab-selected' Emitted when a tab is selected, with the localized tab name as a parameter.
 * @emits 'navigate-down' Emitted when the user presses the down arrow key while focused on the tab bar.
 * @param {Gio.Settings} settings The extension settings object for reactive configuration.
 */
export const MenuTabBar = GObject.registerClass(
    {
        Signals: {
            'tab-selected': { param_types: [GObject.TYPE_STRING] },
            'navigate-down': {},
        },
    },
    class MenuTabBar extends St.BoxLayout {
        /**
         * Initializes the tab bar and configures reactive UI visibility.
         *
         * @param {Gio.Settings} settings Extension settings object.
         */
        constructor(settings) {
            super({ style_class: 'aio-clipboard-tab-topbar', reactive: true });

            this._settings = settings;
            this._tabButtons = {};
            this._activeTabName = null;

            const sections = getMenuOrderedSections();
            this.TAB_NAMES = sections.map((s) => s.name());
            this._fullViewTabs = sections.filter((s) => s.isFullView).map((s) => s.name());

            this._alwaysShowTabBar = this._settings.get_boolean('always-show-main-tab');
            this._forceHideMainTabBar = false;
            this._settingsSignalIds = [];

            this.connect('key-press-event', this._onMainTabBarKeyPress.bind(this));

            this._rebuildTabBar();
            this._updateTabBarMargin();

            this._settingsSignalIds.push(this._settings.connect('changed::tab-order', () => this._rebuildTabBar()));

            this._settingsSignalIds.push(
                this._settings.connect('changed::always-show-main-tab', () => {
                    this._alwaysShowTabBar = this._settings.get_boolean('always-show-main-tab');
                    this._updateTabBarMargin();
                    this._updateTabBarVisibilityForActiveTab();
                }),
            );

            this._settingsSignalIds.push(
                this._settings.connect('changed::hide-last-main-tab', () => {
                    this._updateTabsVisibility();
                }),
            );

            sections.forEach((section) => {
                if (section.settingKey) {
                    const signalId = this._settings.connect(`changed::${section.settingKey}`, () => this._updateTabsVisibility());
                    this._settingsSignalIds.push(signalId);
                }
            });

            this._updateTabsVisibility();
        }

        // ========================================================================
        // DOM Construction
        // ========================================================================

        /**
         * Rebuilds the tab buttons using the dynamic feature registry configuration.
         *
         * @private
         */
        _rebuildTabBar() {
            this.destroy_all_children();
            this._tabButtons = {};

            const tabOrder = this._settings.get_strv('tab-order');
            const sections = getMenuOrderedSections();

            tabOrder.forEach((name) => {
                const translatedName = _(name);

                const sectionConfig = sections.find((s) => s.name() === translatedName);
                if (!sectionConfig) return;

                const iconFile = sectionConfig.icon;
                const iconSize = sectionConfig.iconSize;
                const iconWidget = createStaticIcon({ icon: iconFile, iconSize: iconSize });

                const button = new St.Button({
                    style_class: 'aio-clipboard-tab-button button',
                    can_focus: true,
                    child: iconWidget,
                    x_expand: true,
                });

                button.tooltip_text = translatedName;

                button.connect('clicked', () => this.emit('tab-selected', translatedName));
                this._tabButtons[translatedName] = button;
                this.add_child(button);
            });

            this._updateTabsVisibility();

            if (this._activeTabName) {
                this._updateTabButtonSelection();
            }
        }

        // ========================================================================
        // State Management
        // ========================================================================

        /**
         * Selects a tab button by its localized name and applies visual changes.
         *
         * @param {string} tabName Localized target tab name.
         */
        setActiveTabName(tabName) {
            this._activeTabName = tabName;
            this._updateTabButtonSelection();
            this._updateTabBarMargin();
            this._updateTabBarVisibilityForActiveTab();
        }

        /**
         * Enforces absolute visibility rules on the menu tab bar.
         *
         * @param {boolean} isVisible Flag indicating if the tab bar should render.
         */
        setTabBarVisibility(isVisible) {
            const desiredVisibility = this._alwaysShowTabBar || isVisible;
            const shouldBeVisible = desiredVisibility && !this._forceHideMainTabBar;

            if (this.visible !== shouldBeVisible) {
                this.visible = shouldBeVisible;
            }
        }

        /**
         * Evaluates and updates the zero-margin presentation when toggling full-view tabs.
         *
         * @private
         */
        _updateTabBarMargin() {
            const isActiveTabFullView = this._fullViewTabs.includes(this._activeTabName);
            const shouldHaveMargin = this._alwaysShowTabBar && isActiveTabFullView;
            if (shouldHaveMargin) {
                this.remove_style_class_name('no-margin');
            } else {
                this.add_style_class_name('no-margin');
            }
        }

        /**
         * Checks whether a specific tab should cause the tab bar to appear.
         *
         * @param {string} tabName Localized tab name to inspect.
         * @returns {boolean} True when the tab mandates visibility.
         * @private
         */
        _shouldShowTabBarForTab(tabName) {
            if (this._alwaysShowTabBar || !tabName) {
                return true;
            }
            return !this._fullViewTabs.includes(tabName);
        }

        /**
         * Applies the active tab visibility logic immediately to the UI container.
         *
         * @private
         */
        _updateTabBarVisibilityForActiveTab() {
            this.setTabBarVisibility(this._shouldShowTabBarForTab(this._activeTabName));
        }

        /**
         * Highlights the currently active tab by toggling CSS checked states.
         *
         * @private
         */
        _updateTabButtonSelection() {
            if (!this._tabButtons) return;

            for (const [name, button] of Object.entries(this._tabButtons)) {
                if (name === this._activeTabName) {
                    button.add_style_pseudo_class('checked');
                } else {
                    button.remove_style_pseudo_class('checked');
                }
            }
        }

        /**
         * Updates visibility and focusability for each tab button.
         *
         * @private
         */
        _updateTabsVisibility() {
            const visibleTabs = new Set();
            const sections = getMenuOrderedSections();

            this.get_children().forEach((button) => {
                const name = Object.keys(this._tabButtons).find((key) => this._tabButtons[key] === button);
                if (!name) return;

                const config = sections.find((s) => s.name() === name);
                if (!config) return;

                const isVisible = config.settingKey ? this._settings.get_boolean(config.settingKey) : true;

                button.visible = isVisible;
                button.reactive = isVisible;
                button.can_focus = isVisible;

                if (isVisible) {
                    visibleTabs.add(name);
                }
            });

            const hideWhenSingle = this._settings.get_boolean('hide-last-main-tab');
            this._forceHideMainTabBar = hideWhenSingle && visibleTabs.size <= 1;
            this._updateTabBarVisibilityForActiveTab();

            const fallbackTarget = this.getFirstVisibleTabName();

            if (this._activeTabName && !visibleTabs.has(this._activeTabName)) {
                if (fallbackTarget) {
                    this.emit('tab-selected', fallbackTarget);
                } else {
                    this.emit('tab-selected', '');
                }
            }
        }

        /**
         * Returns the internal localized name of the first accessible tab widget.
         *
         * @returns {string|null} Localized target name or null fallback.
         */
        getFirstVisibleTabName() {
            const tabOrder = this._settings.get_strv('tab-order');

            for (const name of tabOrder) {
                const translated = _(name);
                if (this._tabButtons[translated]?.visible) {
                    return translated;
                }
            }
            return null;
        }

        /**
         * Returns whether a tab is currently available and visible.
         *
         * @param {string} tabName Localized tab name.
         * @returns {boolean} True when the tab is visible.
         */
        isTabAvailable(tabName) {
            const button = this._tabButtons[tabName];
            return button && button.visible;
        }

        /**
         * Cycles to the next or previous visible tab.
         *
         * @param {number} direction Direction offset. Use `1` for next, `-1` for previous.
         */
        cycleTab(direction) {
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
            this.emit('tab-selected', targetTab);
        }

        // ========================================================================
        // Keyboard Navigation
        // ========================================================================

        /**
         * Handles keyboard navigation in the main tab bar.
         *
         * @param {Clutter.Actor} actor Event source.
         * @param {Clutter.Event} event Key press event.
         * @returns {number} Clutter event handling result.
         * @private
         */
        _onMainTabBarKeyPress(actor, event) {
            const symbol = event.get_key_symbol();

            const buttons = Object.values(this._tabButtons);
            if (buttons.length === 0) {
                return Clutter.EVENT_PROPAGATE;
            }

            const currentFocus = global.stage.get_key_focus();
            const currentIndex = buttons.indexOf(currentFocus);

            if (currentIndex === -1) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return FocusUtils.handleLinearNavigation(event, buttons, currentIndex);
            }

            if (symbol === Clutter.KEY_Down) {
                this.emit('navigate-down');
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Cleans up resources and disconnects settings signals.
         *
         * @override
         */
        destroy() {
            if (this._settingsSignalIds) {
                this._settingsSignalIds.forEach((id) => this._settings.disconnect(id));
                this._settingsSignalIds = [];
            }
            this._tabButtons = null;
            this._settings = null;
            super.destroy();
        }
    },
);
