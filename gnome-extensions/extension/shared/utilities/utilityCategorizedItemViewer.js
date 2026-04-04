import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from './utilityIcon.js';
import { Debouncer } from './utilityDebouncer.js';
import { eventMatchesShortcut } from './utilityShortcutMatcher.js';
import { FocusUtils } from './utilityFocus.js';
import { getRecentItemsManager } from './utilityRecents.js';
import { IOResource } from './utilityIO.js';
import { SearchComponent } from './utilitySearch.js';
import { ServiceJson } from '../services/serviceJson.js';
import { HorizontalScrollView, scrollToItemCentered } from './utilityHorizontalScrollView.js';

const WIDTH_CHANGE_DEBOUNCE_MS = 200;
const TAB_SCROLL_POLICY_DEBOUNCE_MS = 50;

const RECENTS_TAB_ID = '##RECENTS##';
const ViewerIcons = {
    RECENTS: {
        icon: 'utility-recents-symbolic.svg',
        iconSize: 16,
    },
    BACK_BUTTON: {
        icon: 'utility-backwards-symbolic.svg',
        iconSize: 16,
    },
};

/**
 * @typedef {object} ViewerConfig
 * @property {string} jsonPath - The path to the main JSON data file, relative to the extension root.
 * @property {Function} parserClass - The constructor for the class that will parse the JSON data.
 * @property {string} recentsPath - The absolute path for storing recent items.
 * @property {string} recentsMaxItemsKey - The GSettings key for the maximum number of recent items.
 * @property {number} [itemsPerRow] - Static number of items per row. Used as fallback if targetItemWidth is not set.
 * @property {number} [targetItemWidth] - The width of a single grid item while excluding margin. When set, columns are calculated dynamically.
 * @property {string} [limitItemsPerRowKey] - GSettings key that enables column limiting for this grid.
 * @property {string} [maxItemsPerRowKey] - GSettings key for the maximum number of columns when limiting is enabled.
 * @property {string} categoryPropertyName - The name of the property in the parsed data that holds the category name.
 * @property {boolean} [sortCategories=false] - Whether to sort the categories alphabetically. Defaults to false (preserves order).
 * @property {Function} searchFilterFn - A function `(item, searchText)` that returns true if the item matches the search.
 * @property {Function} renderGridItemFn - A function `(itemData)` that returns an `St.Button` widget for a grid item.
 * @property {Function} renderCategoryButtonFn - A function `(categoryId, extensionPath)` that returns an `St.Button` for a category tab.
 * @property {Function} createSignalPayload - A function `(itemData)` that returns a simple object to be emitted in the 'item-selected' signal.
 */

/**
 * A generic, reusable component for displaying a grid of items that are
 * organized by category, searchable, and include a "Recents" tab.
 *
 * This component is highly configurable and abstracts away the complexity of
 * UI construction, data loading, state management, and user interaction.
 *
 * @fires back-requested - Emitted when the user clicks the back button.
 * @fires item-selected - Emitted with a JSON string payload when a grid item is clicked.
 */
export const CategorizedItemViewer = GObject.registerClass(
    {
        Signals: {
            'back-requested': {},
            'item-selected': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class CategorizedItemViewer extends St.BoxLayout {
        /**
         * @param {Extension} extension - The main extension instance.
         * @param {Gio.Settings} settings - The GSettings object for the extension.
         * @param {ViewerConfig} config - The configuration object that defines the component's behavior.
         */
        constructor(extension, settings, config) {
            super({
                vertical: true,
                x_expand: true,
                y_expand: true,
                style_class: 'categorized-item-viewer',
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });
            this.spacing = 4;

            this._extension = extension;
            this._settings = settings;
            this._config = config;

            if (!this._validateConfig(config)) {
                this._renderErrorState(_('Component configuration is invalid. Check logs.'));
                return;
            }

            this._parser = new this._config.parserClass(extension.uuid);
            this._recentItemsManager = getRecentItemsManager(extension.uuid, settings, this._config.recentsPath, this._config.recentsMaxItemsKey);

            this._recentsChangedSignalId = 0;
            this._mainData = null;
            this._filteredData = null;
            this._allDisplayableTabs = [];
            this._categoriesFromJSON = [];
            this._activeCategory = null;
            this._categoryButtons = {};
            this._isLoading = false;
            this._isContentLoaded = false;
            this._currentSearchText = '';
            this._lastActiveTabBeforeSearch = null;
            this._gridAllButtons = [];
            this._setActiveCategoryTimeoutId = 0;
            this._yieldTimeoutId = 0;
            this._scrollIdleId = 0;
            this._focusIdleId = 0;
            this._initIdleId = 0;
            this._layoutIdleId = 0;
            this._itemFocusIdleId = 0;
            this._renderIdleId = 0;
            this._searchDebouncer = new Debouncer(() => this._applyFiltersAndRenderGrid(), 250);
            this._extensionWidthSignalId = 0;
            this._tabScrollPolicyDebouncer = null;
            this._tabScrollPolicyWidthSignalId = 0;
            this._tabScrollPolicyAllocationSignalId = 0;
            this._tabScrollPolicyState = null;
            this._tabContainer = null;
            this._layoutSettingSignalIds = [];
            this._pendingExternalSearchText = null;
            this._suppressSearchTextChanged = false;

            this._buildUI();

            // Re-render grid when extension width changes for dynamic column count
            if (this._config.targetItemWidth) {
                this._widthChangeDebouncer = new Debouncer(() => {
                    if (this._isContentLoaded) this._applyFiltersAndRenderGrid();
                }, WIDTH_CHANGE_DEBOUNCE_MS);
                this._extensionWidthSignalId = this._settings.connect('changed::extension-width', () => {
                    this._widthChangeDebouncer.trigger();
                });
            }

            const layoutKeys = [this._config.limitItemsPerRowKey, this._config.maxItemsPerRowKey].filter(Boolean);
            if (layoutKeys.length > 0) {
                layoutKeys.forEach((key) => {
                    const id = this._settings.connect(`changed::${key}`, () => {
                        if (this._widthChangeDebouncer) {
                            this._widthChangeDebouncer.trigger();
                        } else {
                            this._applyFiltersAndRenderGrid();
                        }
                    });
                    this._layoutSettingSignalIds.push(id);
                });
            }
            if (this._config.enableTabScrolling) {
                this._tabScrollPolicyDebouncer = new Debouncer(() => this._updateTabScrollPolicy(), TAB_SCROLL_POLICY_DEBOUNCE_MS);
                this._tabScrollPolicyWidthSignalId = this._settings.connect('changed::extension-width', () => {
                    this._tabScrollPolicyDebouncer.trigger();
                });
                if (this._tabContainer) {
                    this._tabScrollPolicyAllocationSignalId = this._tabContainer.connect('notify::width', () => {
                        this._tabScrollPolicyDebouncer.trigger();
                    });
                }
            }

            const setupRender = () => {
                this._loadAndRenderInitialState();

                this._recentsChangedSignalId = this._recentItemsManager.connect('recents-changed', () => {
                    if (this._currentSearchText === '' && this._activeCategory === RECENTS_TAB_ID) this._applyFiltersAndRenderGrid();
                });
            };

            if (this._recentItemsManager._isLoaded) {
                setupRender();
            } else {
                const initialLoadSignalId = this._recentItemsManager.connect('recents-changed', () => {
                    this._recentItemsManager.disconnect(initialLoadSignalId);
                    setupRender();
                });
            }
        }

        /**
         * Validates that all required keys are present in the configuration object.
         * @param {ViewerConfig} config - The configuration object.
         * @returns {boolean} True if the configuration is valid.
         * @private
         */
        _validateConfig(config) {
            const requiredKeys = [
                'jsonPath',
                'parserClass',
                'recentsPath',
                'recentsMaxItemsKey',
                'categoryPropertyName',
                'searchFilterFn',
                'renderGridItemFn',
                'renderCategoryButtonFn',
                'createSignalPayload',
            ];
            for (const key of requiredKeys) {
                if (!(key in config)) {
                    console.error(`[AIO-Clipboard] Missing required configuration key in CategorizedItemViewer: ${key}`);
                    return false;
                }
            }
            return true;
        }

        /**
         * Constructs the initial UI layout for the component.
         * @private
         */
        _buildUI() {
            this._header = new St.BoxLayout({
                style_class: 'internal-header',
                vertical: false,
                x_expand: true,
            });

            this._backButton = new St.Button({
                style_class: 'aio-clipboard-back-button button',
                child: createStaticIcon(ViewerIcons.BACK_BUTTON),
                y_align: Clutter.ActorAlign.CENTER,
                can_focus: true,
            });
            this._backButton.connect('clicked', () => this.emit('back-requested'));
            this._header.add_child(this._backButton);

            this._categoryTabBar = new St.BoxLayout({});

            if (this._config.enableTabScrolling) {
                const scrollView = new HorizontalScrollView({
                    style_class: 'aio-clipboard-tab-scrollview',
                    x_expand: false,
                    overlay_scrollbars: true,
                    clip_to_allocation: true,
                    hscrollbar_policy: St.PolicyType.AUTOMATIC,
                    vscrollbar_policy: St.PolicyType.NEVER,
                });
                scrollView.set_child(this._categoryTabBar);
                this._categoryTabScrollView = scrollView;

                const tabContainer = new St.Bin({
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    child: scrollView,
                });
                this._tabContainer = tabContainer;
                this._header.add_child(tabContainer);
            } else {
                this._categoryTabScrollView = null;
                this._tabContainer = null;
                const tabContainer = new St.Bin({
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    child: this._categoryTabBar,
                });
                this._header.add_child(tabContainer);
            }

            this.add_child(this._header);

            this._backButton.connect('key-press-event', this._onFocusRingKeyPress.bind(this));
            this._categoryTabBar.connect('key-press-event', this._onFocusRingKeyPress.bind(this));
            this._categoryTabBar.set_reactive(true);
            this.connect('captured-event', this._onGlobalKeyPress.bind(this));
            this.set_reactive(true);

            this._searchComponent = new SearchComponent((searchText) => this._onSearchTextChanged(searchText), {
                onNavigateDown: () => this._focusFirstGridItem(),
                onNavigateUp: () => {
                    const focusables = this._getHeaderFocusables();
                    if (focusables.length > 0) {
                        focusables[0].grab_key_focus();
                        return true;
                    }
                    return false;
                },
            });
            this.add_child(this._searchComponent.getWidget());

            this._contentArea = new St.BoxLayout({
                style_class: 'content-grid-area',
                vertical: true,
                y_expand: true,
                x_expand: true,
            });
            this._contentArea.set_reactive(true);
            this._contentArea.connect('key-press-event', this._onGridKeyPress.bind(this));
            this.add_child(this._contentArea);
        }

        /**
         * Toggles the visibility and focusability of the back button.
         * @param {boolean} isVisible - Whether the back button should be shown.
         */
        setBackButtonVisible(isVisible) {
            if (!this._backButton) {
                return;
            }

            const shouldShow = Boolean(isVisible);
            this._backButton.visible = shouldShow;
            this._backButton.reactive = shouldShow;
            this._backButton.can_focus = shouldShow;
        }

        /**
         * Handles key presses on the viewer container to cycle categories.
         * @param {Clutter.Actor} actor
         * @param {Clutter.Event} event
         */
        _onGlobalKeyPress(actor, event) {
            if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;

            if (eventMatchesShortcut(event, this._settings, 'shortcut-next-category')) {
                this._cycleCategory(1);
                return Clutter.EVENT_STOP;
            }
            if (eventMatchesShortcut(event, this._settings, 'shortcut-prev-category')) {
                this._cycleCategory(-1);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Cycles to the next or previous category.
         * @param {number} direction - 1 for next, -1 for previous
         */
        _cycleCategory(direction) {
            const tabs = this._allDisplayableTabs;
            if (!tabs || tabs.length <= 1) return;

            const currentIndex = tabs.indexOf(this._activeCategory);
            if (currentIndex === -1) return;

            let newIndex = (currentIndex + direction) % tabs.length;
            if (newIndex < 0) newIndex += tabs.length;

            const targetId = tabs[newIndex];
            this._setActiveCategory(targetId);

            if (this._config.enableTabScrolling && this._categoryButtons[targetId]) {
                const button = this._categoryButtons[targetId];
                if (this._scrollIdleId) {
                    GLib.source_remove(this._scrollIdleId);
                    this._scrollIdleId = 0;
                }
                this._scrollIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    scrollToItemCentered(this._categoryTabScrollView, button);
                    this._scrollIdleId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        /**
         * Get all focusable header elements (back button + category tabs)
         * @returns {Array<St.Button>} Array of focusable actors
         * @private
         */
        _getHeaderFocusables() {
            const focusables = [];
            if (this._backButton?.visible && this._backButton?.can_focus) focusables.push(this._backButton);

            const categoryButtons = this._categoryTabBar.get_children();
            focusables.push(...categoryButtons.filter((btn) => btn.can_focus));
            return focusables;
        }

        /**
         * Handles Left/Right arrow key presses for navigating between the back button and category tabs.
         * @param {Clutter.Actor} actor - The actor that received the event.
         * @param {Clutter.Event} event - The key press event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _onFocusRingKeyPress(actor, event) {
            const symbol = event.get_key_symbol();

            if (symbol !== Clutter.KEY_Left && symbol !== Clutter.KEY_Right) {
                return Clutter.EVENT_PROPAGATE;
            }

            const focusables = this._getHeaderFocusables();
            if (focusables.length === 0) {
                return Clutter.EVENT_PROPAGATE;
            }

            const currentFocus = global.stage.get_key_focus();
            const currentIndex = focusables.indexOf(currentFocus);
            if (currentIndex === -1) return Clutter.EVENT_PROPAGATE;

            return FocusUtils.handleLinearNavigation(event, focusables, currentIndex);
        }

        /**
         * Handles arrow key presses for navigating the grid of items.
         * @param {Clutter.Actor} actor - The actor that received the event.
         * @param {Clutter.Event} event - The key press event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _onGridKeyPress(actor, event) {
            if (!this._gridAllButtons || this._gridAllButtons.length === 0) {
                return Clutter.EVENT_PROPAGATE;
            }

            const currentFocus = global.stage.get_key_focus();
            const currentIndex = this._gridAllButtons.indexOf(currentFocus);
            if (currentIndex === -1) return Clutter.EVENT_PROPAGATE;

            return FocusUtils.handleGridNavigation(event, this._gridAllButtons, currentIndex, this._currentItemsPerRow || this._config.itemsPerRow || 1, {
                onBoundary: (side) => {
                    if (side === 'up') {
                        this._searchComponent?.grabFocus();
                        return Clutter.EVENT_STOP;
                    }
                    return undefined;
                },
            });
        }

        /**
         * Focuses the first grid item and ensures it's visible in the scroll view.
         * Used by the search bar's Down key handler to deterministically route focus.
         * @private
         */
        _focusFirstGridItem() {
            if (!this._gridAllButtons || this._gridAllButtons.length === 0) return false;

            const firstButton = this._gridAllButtons[0];
            firstButton.grab_key_focus();
            const scrollView = this._contentArea.get_first_child();
            if (scrollView instanceof St.ScrollView) {
                ensureActorVisibleInScrollView(scrollView, firstButton);
            }
            return true;
        }

        /**
         * Public method called by the parent when this view becomes visible.
         * Focuses the search bar for immediate typing.
         */
        onSelected() {
            if (this._focusIdleId) {
                GLib.source_remove(this._focusIdleId);
                this._focusIdleId = 0;
            }
            this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._searchComponent?.grabFocus();
                this._focusIdleId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Applies an externally provided query to the viewer search state.
         *
         * @param {string} query Query text to apply.
         * @param {object} [options] Additional options.
         * @param {boolean} [options.focus=false] Whether to focus the search entry.
         */
        applyExternalSearch(query, { focus = false } = {}) {
            const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';

            if (!this._isContentLoaded || !this._searchComponent) {
                this._pendingExternalSearchText = normalizedQuery;
                return;
            }

            const previousQuery = this._currentSearchText;
            this._currentSearchText = normalizedQuery;

            if (normalizedQuery.length > 0 && previousQuery.length === 0) {
                this._lastActiveTabBeforeSearch = this._activeCategory;
            } else if (normalizedQuery.length === 0 && previousQuery.length > 0) {
                this._activeCategory = this._lastActiveTabBeforeSearch;
            }

            this._pendingExternalSearchText = null;
            this._searchDebouncer?.cancel?.();
            this._suppressSearchTextChanged = true;
            this._searchComponent.setSearchText(normalizedQuery, { focus });
            this._suppressSearchTextChanged = false;
            this._applyFiltersAndRenderGrid();
        }

        /**
         * Clears external search state.
         *
         * @param {object} [options] Additional options.
         * @param {boolean} [options.focus=false] Whether to focus the search entry.
         */
        clearExternalSearch({ focus = false } = {}) {
            this.applyExternalSearch('', { focus });
        }

        /**
         * Public method called by the parent when the main menu is closed.
         * Resets the state of the component, like clearing the search bar.
         */
        onMenuClosed() {
            this._searchComponent?.clearSearch();
        }

        /**
         * Public method to command the viewer to re-render its grid.
         * Useful when external state (like settings) changes.
         */
        rerenderGrid() {
            this._applyFiltersAndRenderGrid();
        }

        /**
         * Asynchronously loads data from GResource and renders the initial state of the component.
         * This is called from the constructor to ensure the widget is fully built upon creation.
         * @private
         */
        async _loadAndRenderInitialState() {
            if (this._isContentLoaded) return;
            this._isLoading = true;

            try {
                // Ensure the UI loop has a chance to render the loading state
                await new Promise((resolve) => {
                    if (this._initIdleId) {
                        GLib.source_remove(this._initIdleId);
                        this._initIdleId = 0;
                    }
                    this._initIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        resolve();
                        this._initIdleId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                });

                const contents = await IOResource.read(this._config.jsonPath);
                if (!contents) throw new Error('Failed to load resource contents');

                await new Promise((resolve) => {
                    if (this._yieldTimeoutId) {
                        GLib.source_remove(this._yieldTimeoutId);
                        this._yieldTimeoutId = 0;
                    }
                    this._yieldTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                        this._yieldTimeoutId = 0;
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    });
                });

                const rawData = ServiceJson.parse(contents);

                this._mainData = this._parser.parse(rawData);
                if (!this._mainData) throw new Error('Parser returned invalid data.');

                const categoryProp = this._config.categoryPropertyName;
                const uniqueCategoriesInOrder = [];
                const seenCategories = new Set();
                for (const item of this._mainData) {
                    const category = item[categoryProp];
                    if (category && !seenCategories.has(category)) {
                        seenCategories.add(category);
                        uniqueCategoriesInOrder.push(category);
                    }
                }

                if (this._config.sortCategories) this._categoriesFromJSON = uniqueCategoriesInOrder.sort();
                else this._categoriesFromJSON = uniqueCategoriesInOrder;

                this._allDisplayableTabs = [RECENTS_TAB_ID, ...this._categoriesFromJSON];
                this._buildCategoryTabs();
                this._isContentLoaded = true;

                const targetCategory = this._allDisplayableTabs.includes(RECENTS_TAB_ID) ? RECENTS_TAB_ID : this._allDisplayableTabs[0] || null;
                this._setActiveCategory(targetCategory);

                if (typeof this._pendingExternalSearchText === 'string') {
                    const pendingQuery = this._pendingExternalSearchText;
                    this._pendingExternalSearchText = null;
                    this.applyExternalSearch(pendingQuery, { focus: false });
                }
            } catch (e) {
                console.error(`[AIO-Clipboard] Critical error loading or parsing data in CategorizedItemViewer: ${e.message}`);
                this._isContentLoaded = false;
                this._renderErrorState(_('Error loading data. Check logs.'));
            } finally {
                this._isLoading = false;
            }
        }

        /**
         * Callback for when the search text changes.
         * @param {string} searchText - The new search text.
         * @private
         */
        _onSearchTextChanged(searchText) {
            if (this._suppressSearchTextChanged) {
                return;
            }

            const newSearchText = searchText.toLowerCase().trim();
            if (this._currentSearchText === newSearchText) return;

            const oldSearchText = this._currentSearchText;
            this._currentSearchText = newSearchText;

            if (newSearchText.length > 0 && oldSearchText.length === 0) this._lastActiveTabBeforeSearch = this._activeCategory;
            else if (newSearchText.length === 0 && oldSearchText.length > 0) this._activeCategory = this._lastActiveTabBeforeSearch;

            this._searchDebouncer.trigger();
        }

        /**
         * Filters the main data based on the current search text or active category, then triggers a grid render.
         * @private
         */
        _applyFiltersAndRenderGrid() {
            if (!this._isContentLoaded) return;
            let itemsToDisplay = [];
            const isSearching = this._currentSearchText.length > 0;

            if (isSearching) {
                itemsToDisplay = this._mainData.filter((item) => this._config.searchFilterFn(item, this._currentSearchText));
            } else {
                if (!this._activeCategory && this._allDisplayableTabs.length > 0) {
                    this._setActiveCategory(this._allDisplayableTabs[0]);
                    return;
                }
                if (this._activeCategory === RECENTS_TAB_ID) {
                    itemsToDisplay = this._recentItemsManager.getRecents();
                } else if (this._activeCategory) {
                    const categoryProp = this._config.categoryPropertyName;
                    itemsToDisplay = this._mainData.filter((item) => item[categoryProp] === this._activeCategory);
                }
            }
            this._filteredData = itemsToDisplay;
            this._renderGrid();
        }

        /**
         * Builds the category tab buttons based on the loaded data.
         * @private
         */
        _buildCategoryTabs() {
            this._categoryTabBar.destroy_all_children();
            this._categoryButtons = {};

            for (const tabId of this._allDisplayableTabs) {
                let button;
                if (tabId === RECENTS_TAB_ID) {
                    const iconWidget = createStaticIcon(ViewerIcons.RECENTS, { styleClass: 'categorized-item-viewer-recents-icon' });

                    button = new St.Button({
                        style_class: 'aio-clipboard-tab-button button',
                        child: iconWidget,
                        can_focus: true,
                        x_expand: false,
                        x_align: Clutter.ActorAlign.CENTER,
                    });
                    button.tooltip_text = _('Recents');
                } else {
                    button = this._config.renderCategoryButtonFn(tabId, this._extension.path);
                }
                button.connect('key-focus-in', () => {
                    if (this._config.enableTabScrolling) {
                        scrollToItemCentered(this._categoryTabScrollView, button);
                    }
                });
                button.connect('clicked', () => this._setActiveCategory(tabId));
                this._categoryTabBar.add_child(button);
                this._categoryButtons[tabId] = button;
            }

            if (this._config.enableTabScrolling) {
                if (this._layoutIdleId) {
                    GLib.source_remove(this._layoutIdleId);
                    this._layoutIdleId = 0;
                }
                this._layoutIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._categoryTabBar.queue_relayout();
                    this._layoutIdleId = 0;
                    this._scheduleTabScrollPolicyUpdate();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._scheduleTabScrollPolicyUpdate();
            }
        }

        /**
         * Schedule a scroll policy update for the category tab bar.
         * @private
         */
        _scheduleTabScrollPolicyUpdate() {
            if (!this._config.enableTabScrolling || !this._categoryTabScrollView || !this._tabScrollPolicyDebouncer) return;
            this._tabScrollPolicyDebouncer.trigger();
        }

        /**
         * Determine the available width for the category tab bar.
         * @returns {number}
         * @private
         */
        _getTabScrollAvailableWidth() {
            if (this._tabContainer) {
                const width = this._tabContainer.get_width();
                if (width > 0) return width;
            }

            if (this._categoryTabScrollView) {
                const width = this._categoryTabScrollView.get_width();
                if (width > 0) return width;
            }

            if (this._header) {
                const width = this._header.get_width();
                if (width > 0) {
                    let backWidth = 0;
                    if (this._backButton) {
                        const [, nat] = this._backButton.get_preferred_width(-1);
                        backWidth = nat || 0;
                    }
                    return Math.max(0, width - backWidth);
                }
            }

            if (this._settings) {
                const width = this._settings.get_int('extension-width');
                if (width > 0) {
                    let backWidth = 0;
                    if (this._backButton) {
                        const [, nat] = this._backButton.get_preferred_width(-1);
                        backWidth = nat || 0;
                    }
                    return Math.max(0, width - backWidth);
                }
            }

            return 0;
        }

        /**
         * Update the scroll policy based on overflow.
         * @private
         */
        _updateTabScrollPolicy() {
            if (!this._config.enableTabScrolling || !this._categoryTabScrollView || !this._categoryTabBar) return;

            const availableWidth = this._getTabScrollAvailableWidth();
            if (availableWidth <= 0) return;

            const [, naturalWidth] = this._categoryTabBar.get_preferred_width(-1);
            const shouldScroll = naturalWidth > availableWidth;

            if (this._tabScrollPolicyState === shouldScroll) return;
            this._tabScrollPolicyState = shouldScroll;

            this._categoryTabScrollView.hscrollbar_policy = shouldScroll ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER;
            this._categoryTabScrollView.overlay_scrollbars = shouldScroll;

            if (!shouldScroll && this._categoryTabScrollView.hadjustment) {
                this._categoryTabScrollView.hadjustment.value = 0;
            }
        }

        /**
         * Sets the active category, updates the UI, and triggers a grid re-render.
         * @param {string} id - The ID of the category to activate.
         * @private
         */
        _setActiveCategory(id) {
            if (this._currentSearchText) {
                this._searchComponent?.clearSearch();
            }
            if (this._activeCategory === id) return;
            this._activeCategory = id;
            this._lastActiveTabBeforeSearch = id;

            for (const btnId in this._categoryButtons) {
                this._categoryButtons[btnId].remove_style_pseudo_class('checked');
            }
            if (this._categoryButtons[this._activeCategory]) {
                this._categoryButtons[this._activeCategory].add_style_pseudo_class('checked');
            }

            this._applyFiltersAndRenderGrid();

            if (this._setActiveCategoryTimeoutId) GLib.source_remove(this._setActiveCategoryTimeoutId);
            this._setActiveCategoryTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
                this._searchComponent?.grabFocus();
                this._setActiveCategoryTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Calculate the number of items per row based on the current container width.
         * If `targetItemWidth` is configured, calculates dynamically from the available width.
         * @returns {number} The number of items per row
         * @private
         */
        _getItemsPerRow() {
            if (this._config.targetItemWidth) {
                let availableWidth = this._contentArea.get_width();
                if (availableWidth <= 0) {
                    availableWidth = this._settings.get_int('extension-width');
                }

                const cellWidth = this._config.targetItemWidth + (this._gridItemHorizontalMargin || 0);
                let itemsPerRow = Math.max(1, Math.floor(availableWidth / cellWidth));

                const limitKey = this._config.limitItemsPerRowKey;
                const maxKey = this._config.maxItemsPerRowKey;
                if (limitKey && maxKey && this._settings.get_boolean(limitKey)) {
                    const maxColumns = this._settings.get_int(maxKey);
                    if (maxColumns > 0) {
                        itemsPerRow = Math.min(itemsPerRow, maxColumns);
                    }
                }

                return itemsPerRow;
            }
            return this._config.itemsPerRow;
        }

        /**
         * Renders the grid of items based on the currently filtered data.
         * @private
         */
        _renderGrid() {
            this._contentArea.destroy_all_children();
            this._gridAllButtons = [];
            this._renderSession = {};

            // Read CSS margin from a probe button before calculating columns
            if (this._config.targetItemWidth && !this._gridItemHorizontalMargin) {
                const probe = this._config.renderGridItemFn({ char: ' ', value: ' ', name: '' });
                this._contentArea.add_child(probe);
                const themeNode = probe.get_theme_node();
                this._gridItemHorizontalMargin = themeNode.get_margin(St.Side.LEFT) + themeNode.get_margin(St.Side.RIGHT);
                probe.destroy();
            }

            let scrollView = new St.ScrollView({
                style_class: 'menu-scrollview',
                overlay_scrollbars: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true,
            });

            let scrollableContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });
            scrollView.set_child(scrollableContainer);

            if (!this._filteredData || this._filteredData.length === 0) {
                let msg = _('No items available.');
                if (this._currentSearchText) msg = _('No items match your search.');
                else if (this._activeCategory === RECENTS_TAB_ID) msg = _('No recent items yet.');

                let bin = new St.Bin({
                    child: new St.Label({ text: msg, style_class: 'info-label' }),
                    x_expand: true,
                    y_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                scrollableContainer.add_child(bin);
            } else {
                let grid = new St.Widget({
                    style_class: 'grid-layout',
                    layout_manager: new Clutter.GridLayout({ column_homogeneous: true }),
                    x_expand: true,
                    x_align: Clutter.ActorAlign.FILL,
                });
                scrollableContainer.add_child(grid);
                this._currentItemsPerRow = this._getItemsPerRow();
                this._renderGridChunk(grid, 0, this._renderSession, scrollView);
            }
            this._contentArea.add_child(scrollView);
        }

        /**
         * Renders a chunk of grid items asynchronously to keep the UI responsive.
         * @param {St.Widget} grid - The grid layout widget to add items to.
         * @param {number} startIndex - The starting index in this._filteredData to render.
         * @param {object} session - The render session token to check against.
         * @param {St.ScrollView} scrollView - The parent scroll view for focus handling.
         * @private
         */
        _renderGridChunk(grid, startIndex, session, scrollView) {
            if (session !== this._renderSession || !this.get_stage()) return;

            const itemsPerChunk = 36;
            const endIndex = Math.min(startIndex + itemsPerChunk, this._filteredData.length);
            const layout = grid.get_layout_manager();

            for (let i = startIndex; i < endIndex; i++) {
                const itemData = this._filteredData[i];
                const col = i % this._currentItemsPerRow;
                const row = Math.floor(i / this._currentItemsPerRow);
                const itemButton = this._config.renderGridItemFn(itemData);

                itemButton.connect('clicked', () => {
                    const clickedValue = itemButton.get_label();
                    const recentItem = { ...itemData, value: clickedValue, char: clickedValue };
                    this._recentItemsManager.addItem(recentItem);
                    const payload = this._config.createSignalPayload(recentItem);
                    this.emit('item-selected', JSON.stringify(payload));
                });

                itemButton.connect('key-focus-in', () => {
                    if (this._itemFocusIdleId) {
                        GLib.source_remove(this._itemFocusIdleId);
                        this._itemFocusIdleId = 0;
                    }
                    this._itemFocusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        ensureActorVisibleInScrollView(scrollView, itemButton);
                        this._itemFocusIdleId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                });

                this._gridAllButtons.push(itemButton);
                layout.attach(itemButton, col, row, 1, 1);
            }

            if (endIndex < this._filteredData.length) {
                if (this._renderIdleId) {
                    GLib.source_remove(this._renderIdleId);
                    this._renderIdleId = 0;
                }
                this._renderIdleId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
                    this._renderGridChunk(grid, endIndex, session, scrollView);
                    this._renderIdleId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        /**
         * Renders a generic error message in the content area.
         * @param {string} errorMessage - The message to display.
         * @private
         */
        _renderErrorState(errorMessage) {
            this._contentArea.destroy_all_children();
            this._contentArea.add_child(
                new St.Bin({
                    child: new St.Label({
                        text: errorMessage,
                        style_class: 'error-label',
                    }),
                    x_expand: true,
                    y_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                }),
            );
        }

        /**
         * Cleans up GLib source IDs.
         * @private
         */
        _clearGLibSources() {
            if (this._setActiveCategoryTimeoutId) {
                GLib.source_remove(this._setActiveCategoryTimeoutId);
                this._setActiveCategoryTimeoutId = 0;
            }
            if (this._yieldTimeoutId) {
                GLib.source_remove(this._yieldTimeoutId);
                this._yieldTimeoutId = 0;
            }
            if (this._scrollIdleId) {
                GLib.source_remove(this._scrollIdleId);
                this._scrollIdleId = 0;
            }
            if (this._focusIdleId) {
                GLib.source_remove(this._focusIdleId);
                this._focusIdleId = 0;
            }
            if (this._initIdleId) {
                GLib.source_remove(this._initIdleId);
                this._initIdleId = 0;
            }
            if (this._layoutIdleId) {
                GLib.source_remove(this._layoutIdleId);
                this._layoutIdleId = 0;
            }
            if (this._itemFocusIdleId) {
                GLib.source_remove(this._itemFocusIdleId);
                this._itemFocusIdleId = 0;
            }
            if (this._renderIdleId) {
                GLib.source_remove(this._renderIdleId);
                this._renderIdleId = 0;
            }
        }

        /**
         * Disconnects signal listeners.
         * @private
         */
        _disconnectSignals() {
            if (this._recentsChangedSignalId > 0 && this._recentItemsManager) {
                this._recentItemsManager.disconnect(this._recentsChangedSignalId);
            }
            if (this._extensionWidthSignalId > 0 && this._settings) {
                this._settings.disconnect(this._extensionWidthSignalId);
            }
            if (this._layoutSettingSignalIds.length > 0 && this._settings) {
                this._layoutSettingSignalIds.forEach((id) => this._settings.disconnect(id));
                this._layoutSettingSignalIds = [];
            }
            if (this._tabScrollPolicyWidthSignalId > 0 && this._settings) {
                this._settings.disconnect(this._tabScrollPolicyWidthSignalId);
            }
            if (this._tabScrollPolicyAllocationSignalId > 0 && this._tabContainer && !this._tabContainer.is_destroyed?.()) {
                this._tabContainer.disconnect(this._tabScrollPolicyAllocationSignalId);
                this._tabScrollPolicyAllocationSignalId = 0;
            }
        }

        /**
         * Destroys child objects attached to the component.
         * @private
         */
        _destroyChildObjects() {
            this._searchDebouncer?.destroy();
            this._widthChangeDebouncer?.destroy();
            this._tabScrollPolicyDebouncer?.destroy();
            this._recentItemsManager?.destroy();
            this._searchComponent?.destroy();
            this._categoryTabScrollView?.destroy();
            this._categoryTabScrollView = null;
        }

        /**
         * Cleans up resources when the component is destroyed.
         */
        destroy() {
            this._clearGLibSources();
            this._disconnectSignals();
            this._destroyChildObjects();

            super.destroy();
        }
    },
);
