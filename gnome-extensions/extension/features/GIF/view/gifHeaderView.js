import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';
import { eventMatchesShortcut } from '../../../shared/utilities/utilityShortcutMatcher.js';
import { FocusUtils } from '../../../shared/utilities/utilityFocus.js';
import { HorizontalScrollView, scrollToItemCentered } from '../../../shared/utilities/utilityHorizontalScrollView.js';

import { GifIcons } from '../constants/gifConstants.js';

/**
 * GifHeaderView
 *
 * Component managing the header of the GIF tab.
 * This includes the back button, the scrollable list of category.
 * It includes recents, trending, and API-provided categories, and handles keyboard navigation within the header.
 *
 * @fires category-changed Emitted when a category tab is selected.
 * @fires navigate-back Emitted when the back button is clicked.
 * @fires focus-next-down Emitted when the down arrow key is pressed to move focus out of the header.
 */
export const GifHeaderView = GObject.registerClass(
    {
        Signals: {
            'category-changed': { param_types: [GObject.TYPE_JSOBJECT] },
            'navigate-back': { param_types: [] },
            'focus-next-down': { param_types: [] },
        },
    },
    class GifHeaderView extends St.BoxLayout {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the GIF header view.
         *
         * @param {Gio.Settings} settings Extension settings.
         */
        constructor(settings) {
            super({
                x_expand: true,
                reactive: true,
            });

            this.connect('key-press-event', this._onHeaderKeyPress.bind(this));

            this._settings = settings;

            this._tabButtons = {};
            this._headerFocusables = [];
            this._activeCategory = null;
            this._alwaysShowTabsSignalId = 0;
            this._scrollHeaderIdleId = 0;

            this._buildSkeleton();

            this._alwaysShowTabsSignalId = this._settings.connect('changed::always-show-main-tab', () => this._updateBackButtonPreference());
        }

        // ========================================================================
        // UI Construction
        // ========================================================================

        /**
         * Build the header layout skeleton.
         * @private
         */
        _buildSkeleton() {
            this._backButton = new St.Button({
                style_class: 'aio-clipboard-back-button button',
                child: createStaticIcon(GifIcons.BACK_BUTTON),
                y_align: Clutter.ActorAlign.CENTER,
                can_focus: true,
            });
            this._backButton.connect('clicked', () => {
                this.emit('navigate-back');
            });
            this.add_child(this._backButton);
            this._updateBackButtonPreference();

            this.headerScrollView = new HorizontalScrollView({
                style_class: 'aio-clipboard-tab-scrollview',
                overlay_scrollbars: true,
                x_expand: true,
            });

            this.headerBox = new St.BoxLayout({
                x_expand: false,
                x_align: Clutter.ActorAlign.START,
            });

            this.headerScrollView.set_child(this.headerBox);
            this.add_child(this.headerScrollView);
        }

        /**
         * Updates the visibility of the back button based on user preference.
         * @private
         */
        _updateBackButtonPreference() {
            const shouldShow = !this._settings.get_boolean('always-show-main-tab');

            if (this._backButton) {
                this._backButton.visible = shouldShow;
                this._backButton.reactive = shouldShow;
                this._backButton.can_focus = shouldShow;
            }

            const hasBackButton = this._headerFocusables.includes(this._backButton);

            if (shouldShow && this._backButton && !hasBackButton) {
                this._headerFocusables.unshift(this._backButton);
            } else if (!shouldShow && hasBackButton) {
                this._headerFocusables = this._headerFocusables.filter((actor) => actor !== this._backButton);
            }
        }

        // ========================================================================
        // Category Management
        // ========================================================================

        /**
         * Clears all category tabs and resets focusables.
         */
        clearCategories() {
            this.headerBox.destroy_all_children();
            this._tabButtons = {};
            this._headerFocusables = [];
            this._updateBackButtonPreference();
        }

        /**
         * Helper to create, configure, and register a header tab button.
         * @param {object} categoryData The category data object used for logic.
         * @param {object} params St.Button configuration.
         * @private
         */
        _createHeaderButton(categoryData, params) {
            const { tooltip_text, ...constructorParams } = params;

            const button = new St.Button({
                can_focus: true,
                ...constructorParams,
            });

            if (tooltip_text) {
                button.tooltip_text = tooltip_text;
            }

            button.categoryData = categoryData;

            button.connect('key-focus-in', () => {
                scrollToItemCentered(this.headerScrollView, button);
            });

            button.connect('clicked', () => this.setActiveCategory(categoryData));

            this._tabButtons[categoryData.id] = button;
            this.headerBox.add_child(button);
            this._headerFocusables.push(button);

            return button;
        }

        /**
         * Add the recents button to the header.
         */
        addRecentsButton() {
            const category = {
                id: 'recents',
                name: _('Recents'),
                isSpecial: true,
            };

            const iconWidget = createStaticIcon(GifIcons.RECENTS, { styleClass: 'gif-recents-icon' });

            this._createHeaderButton(category, {
                style_class: 'aio-clipboard-tab-button button',
                child: iconWidget,
                tooltip_text: _('Recents'),
            });
        }

        /**
         * Add the trending button to the header.
         */
        addTrendingButton() {
            const category = {
                id: 'trending',
                name: _('Trending'),
                isSpecial: true,
            };

            this._createHeaderButton(category, {
                style_class: 'gif-category-tab-button button',
                label: _('Trending'),
                tooltip_text: _('Trending GIFs'),
            });
        }

        /**
         * Add a category button to the header.
         * @param {object} category The category data.
         */
        addCategoryButton(category) {
            const categoryData = {
                id: category.searchTerm,
                name: category.name,
                searchTerm: category.searchTerm,
            };

            this._createHeaderButton(categoryData, {
                style_class: 'gif-category-tab-button button',
                label: _(category.name),
                tooltip_text: _(category.name),
            });
        }

        /**
         * Set the active category visually and emit the changed signal.
         *
         * @param {object} category The category to activate.
         */
        setActiveCategory(category) {
            this._activeCategory = category;

            for (const [id, button] of Object.entries(this._tabButtons)) {
                button.checked = id === category.id;
            }

            this.emit('category-changed', category);
        }

        /**
         * Retrieves the currently active category.
         * @returns {object|null} The active category data.
         */
        getActiveCategory() {
            return this._activeCategory;
        }

        /**
         * Checks if a specific tab exists.
         * @param {string} id The category ID.
         * @returns {boolean} True if the tab exists.
         */
        hasTab(id) {
            return !!this._tabButtons[id];
        }

        /**
         * Gets the category data for a specific tab.
         * @param {string} id The category ID.
         * @returns {object|null} The category data.
         */
        getCategoryData(id) {
            return this._tabButtons[id]?.categoryData || null;
        }

        // ========================================================================
        // Keyboard Navigation
        // ========================================================================

        /**
         * Handles global key presses to cycle categories.
         * Call this from the parent's captured-event handler.
         *
         * @param {Clutter.Event} event The key press event.
         * @returns {boolean} True if the event was handled.
         */
        handleGlobalCategoryCycle(event) {
            if (event.type() !== Clutter.EventType.KEY_PRESS) {
                return false;
            }

            if (eventMatchesShortcut(event, this._settings, 'shortcut-next-category')) {
                this._cycleCategory(1);
                return true;
            }

            if (eventMatchesShortcut(event, this._settings, 'shortcut-prev-category')) {
                this._cycleCategory(-1);
                return true;
            }

            return false;
        }

        /**
         * Cycles the active category.
         * @param {number} direction
         */
        _cycleCategory(direction) {
            const children = this.headerBox.get_children();
            const categories = [];

            children.forEach((child) => {
                if (child.categoryData) {
                    categories.push(child.categoryData);
                }
            });

            if (categories.length <= 1) return;

            const currentIndex = categories.findIndex((c) => c.id === this._activeCategory?.id);
            if (currentIndex === -1) return;

            let newIndex = (currentIndex + direction) % categories.length;
            if (newIndex < 0) newIndex += categories.length;

            this.setActiveCategory(categories[newIndex]);

            const button = this._tabButtons[categories[newIndex].id];
            if (button) {
                if (this._scrollHeaderIdleId) {
                    GLib.source_remove(this._scrollHeaderIdleId);
                    this._scrollHeaderIdleId = 0;
                }
                this._scrollHeaderIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._scrollHeaderIdleId = 0;
                    scrollToItemCentered(this.headerScrollView, button);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        /**
         * Handle keyboard navigation in the header for the back button and category tabs.
         *
         * @param {St.Widget} actor The actor that received the event.
         * @param {Clutter.Event} event The key press event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        _onHeaderKeyPress(actor, event) {
            const symbol = event.get_key_symbol();

            if (this._headerFocusables.length === 0) {
                return Clutter.EVENT_PROPAGATE;
            }

            const currentFocus = global.stage.get_key_focus();
            const currentIndex = this._headerFocusables.indexOf(currentFocus);

            if (currentIndex === -1) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return FocusUtils.handleLinearNavigation(event, this._headerFocusables, currentIndex);
            }

            if (symbol === Clutter.KEY_Down) {
                this.emit('focus-next-down');
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Focuses the first element in the header.
         */
        focusFirst() {
            if (this._headerFocusables.length > 0) {
                this._headerFocusables[0].grab_key_focus();
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up all resources.
         */
        destroy() {
            if (this._scrollHeaderIdleId) {
                GLib.source_remove(this._scrollHeaderIdleId);
                this._scrollHeaderIdleId = 0;
            }

            if (this._alwaysShowTabsSignalId) {
                this._settings.disconnect(this._alwaysShowTabsSignalId);
                this._alwaysShowTabsSignalId = 0;
            }

            super.destroy();
        }
    },
);
