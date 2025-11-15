import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { createThemedIcon } from './utilityThemedIcon.js';
import { Debouncer } from './utilityDebouncer.js';
import { RecentItemsManager } from './utilityRecents.js';
import { SearchComponent } from './utilitySearch.js';

const RECENTS_TAB_ID = '##RECENTS##';
const RECENTS_CUSTOM_ICON_FILENAME = 'utility-recents-symbolic.svg';

/**
 * @typedef {object} ViewerConfig
 * @property {string} jsonPath - The path to the main JSON data file, relative to the extension root.
 * @property {Function} parserClass - The constructor for the class that will parse the JSON data.
 * @property {string} recentsFilename - The filename for storing recent items (e.g., 'recent_emojis.json').
 * @property {string} recentsMaxItemsKey - The GSettings key for the maximum number of recent items.
 * @property {number} itemsPerRow - The number of items to display in each row of the grid.
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
export const CategorizedItemViewer = GObject.registerClass({
    Signals: {
        'back-requested': {},
        'item-selected': { param_types: [GObject.TYPE_STRING] }
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
            this._renderErrorState(_("Component configuration is invalid. Check logs."));
            return;
        }

        this._parser = new this._config.parserClass(extension.uuid);
        this._recentItemsManager = new RecentItemsManager(
            extension.uuid,
            settings,
            this._config.recentsFilename,
            this._config.recentsMaxItemsKey
        );

        this._recentsChangedSignalId = 0;
        this._mainData = null;
        this._filteredData = null;
        this._allDisplayableTabs = [];
        this._categoriesFromJSON = [];
        this._activeCategory = null;
        this._categoryButtons = {};
        this._isLoading = false;
        this._isContentLoaded = false;
        this._currentSearchText = "";
        this._lastActiveTabBeforeSearch = null;
        this._gridAllButtons = [];
        this._setActiveCategoryTimeoutId = 0;
        this._searchDebouncer = new Debouncer(() => this._applyFiltersAndRenderGrid(), 250);

        this._buildUI();

        this._recentsChangedSignalId = this._recentItemsManager.connect('recents-changed', () => {
            // If the recents list changes while we are viewing it, re-render.
            if (this._currentSearchText === "" && this._activeCategory === RECENTS_TAB_ID) {
                this._applyFiltersAndRenderGrid();
            }
        });
    }

    /**
     * Validates that all required keys are present in the configuration object.
     * @param {ViewerConfig} config - The configuration object.
     * @returns {boolean} True if the configuration is valid.
     * @private
     */
    _validateConfig(config) {
        const requiredKeys = [
            'jsonPath', 'parserClass', 'recentsFilename', 'recentsMaxItemsKey',
            'itemsPerRow', 'categoryPropertyName', 'searchFilterFn',
            'renderGridItemFn', 'renderCategoryButtonFn', 'createSignalPayload'
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
        // Header contains the back button and category tabs
        this._header = new St.BoxLayout({
            style_class: 'internal-header',
            vertical: false,
            x_expand: true
        });

        this._backButton = new St.Button({
            style_class: 'aio-clipboard-back-button button',
            child: new St.Icon({ icon_name: 'go-previous-symbolic', style_class: 'popup-menu-icon' }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true
        });
        this._backButton.connect('clicked', () => this.emit('back-requested'));
        this._header.add_child(this._backButton);

        // This is the bar that will hold the buttons.
        this._categoryTabBar = new St.BoxLayout({});

        // Enable tab scrolling for categories if configured, otherwise center non-scrolling tabs
        if (this._config.enableTabScrolling) {
            // Scrolling Tabs
            const scrollView = new St.ScrollView({
                style_class: 'aio-clipboard-tab-scrollview',
                hscrollbar_policy: St.PolicyType.AUTOMATIC,
                vscrollbar_policy: St.PolicyType.NEVER,
                x_expand: false, // Shrink-to-fit is essential
                overlay_scrollbars: true,
                clip_to_allocation: true
            });
            scrollView.set_child(this._categoryTabBar);

            // Store reference for cleanup
            this._categoryTabScrollView = scrollView;

            const tabContainer = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                child: scrollView
            });
            this._header.add_child(tabContainer);
        } else {
            // Non-scrolling Tabs
            this._categoryTabScrollView = null;  // Explicitly set to null
            const tabContainer = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                child: this._categoryTabBar
            });
            this._header.add_child(tabContainer);
        }

        this.add_child(this._header);

        // Connect key press events for keyboard navigation of the header
        this._backButton.connect('key-press-event', this._onFocusRingKeyPress.bind(this));
        this._categoryTabBar.connect('key-press-event', this._onFocusRingKeyPress.bind(this));
        this._categoryTabBar.set_reactive(true);

        // Search component
        this._searchComponent = new SearchComponent(searchText => this._onSearchTextChanged(searchText));
        this.add_child(this._searchComponent.getWidget());

        // Main content area for the grid
        this._contentArea = new St.BoxLayout({
            style_class: 'content-grid-area',
            vertical: true,
            y_expand: true,
            x_expand: true
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
     * Handles Left/Right arrow key presses for navigating between the back button and category tabs.
     * @param {Clutter.Actor} actor - The actor that received the event.
     * @param {Clutter.Event} event - The key press event.
     * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
     * @private
     */
    _onFocusRingKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        const children = this._categoryTabBar.get_children();
        if (children.length === 0) return Clutter.EVENT_PROPAGATE;

        const currentFocus = global.stage.get_key_focus();
        const firstTab = children[0];
        const lastTab = children[children.length - 1];
        const isBackButtonVisible = this._backButton?.visible;

        if (symbol === Clutter.KEY_Left) {
            if (isBackButtonVisible && currentFocus === this._backButton) {
                return Clutter.EVENT_STOP; // Trap focus at the start
            }
            if (currentFocus === firstTab) {
                if (isBackButtonVisible) {
                    this._backButton.grab_key_focus();
                }
                return Clutter.EVENT_STOP;
            }
        } else if (symbol === Clutter.KEY_Right) {
            if (isBackButtonVisible && currentFocus === this._backButton) {
                firstTab.grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            if (currentFocus === lastTab) {
                return Clutter.EVENT_STOP; // Trap focus at the end
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Handles arrow key presses for navigating the grid of items.
     * @param {Clutter.Actor} actor - The actor that received the event.
     * @param {Clutter.Event} event - The key press event.
     * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
     * @private
     */
    _onGridKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        const itemsPerRow = this._config.itemsPerRow;

        if (!this._gridAllButtons || this._gridAllButtons.length === 0) {
            return Clutter.EVENT_PROPAGATE;
        }

        const currentFocus = global.stage.get_key_focus();
        const currentIndex = this._gridAllButtons.indexOf(currentFocus);

        if (currentIndex === -1) {
            return Clutter.EVENT_PROPAGATE;
        }

        let targetIndex = -1;

        switch (symbol) {
            case Clutter.KEY_Left:
                if (currentIndex > 0) {
                    targetIndex = currentIndex - 1;
                }
                break;
            case Clutter.KEY_Right:
                if (currentIndex < this._gridAllButtons.length - 1) {
                    targetIndex = currentIndex + 1;
                }
                break;
            case Clutter.KEY_Up:
                if (currentIndex >= itemsPerRow) {
                    targetIndex = currentIndex - itemsPerRow;
                } else {
                    // In the top row, so focus moves up to the search bar
                    this._searchComponent?.grabFocus();
                    return Clutter.EVENT_STOP;
                }
                break;
            case Clutter.KEY_Down:
                if (currentIndex + itemsPerRow < this._gridAllButtons.length) {
                    targetIndex = currentIndex + itemsPerRow;
                }
                break;
        }

        if (targetIndex !== -1) {
            this._gridAllButtons[targetIndex].grab_key_focus();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_STOP;
    }

    /**
     * Public method called by the parent when this view becomes visible.
     * Triggers data loading if necessary and sets initial focus.
     */
    onSelected() {
        // Focus the search bar when the view is shown.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._searchComponent?.grabFocus();
            return GLib.SOURCE_REMOVE;
        });

        if (!this._isContentLoaded && !this._isLoading) {
            this._contentArea.destroy_all_children();
            this._loadAndParseData().catch(e => {
                console.error(`[AIO-Clipboard] Async load from onSelected failed in CategorizedItemViewer: ${e}`);
            });
        }
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
     * Asynchronously loads and parses the main data file from the path specified in the config.
     * @private
     */
    async _loadAndParseData() {
        if (this._isLoading) return;
        this._isLoading = true;
        this._contentArea.add_child(new St.Label({
            text: _("Loading..."),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true
        }));

        try {
            // Construct the special URI for a file inside the GResource bundle.
            const resourceUri = `resource:///org/gnome/shell/extensions/all-in-one-clipboard/${this._config.jsonPath}`;
            const file = Gio.File.new_for_uri(resourceUri);

            // Wrap the callback-based function in a native Promise
            const bytes = await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, res) => {
                    try {
                        const [ok, contents] = source.load_contents_finish(res);
                        if (ok) {
                            resolve(contents); // contents is a Uint8Array
                        } else {
                            reject(new Error(`Failed to load resource contents from ${resourceUri}`));
                        }
                    } catch (e) {
                        reject(e); // Propagate errors, e.g., if resource is not found
                    }
                });
            });

            // Check if the file is empty
            if (!bytes) {
                throw new Error(`Loaded resource was empty at ${resourceUri}`);
            }

            const jsonString = new TextDecoder('utf-8').decode(bytes);
            const rawData = JSON.parse(jsonString);

            this._mainData = this._parser.parse(rawData);
            if (!this._mainData) throw new Error("Parser returned invalid data.");

            const categoryProp = this._config.categoryPropertyName;

            // Get unique categories while preserving their original order of appearance.
            const uniqueCategoriesInOrder = [];
            const seenCategories = new Set();
            for (const item of this._mainData) {
                const category = item[categoryProp];
                if (category && !seenCategories.has(category)) {
                    seenCategories.add(category);
                    uniqueCategoriesInOrder.push(category);
                }
            }

            // Sort categories alphabetically only if the config specifies it.
            if (this._config.sortCategories) {
                this._categoriesFromJSON = uniqueCategoriesInOrder.sort();
            } else {
                this._categoriesFromJSON = uniqueCategoriesInOrder;
            }

            this._allDisplayableTabs = [RECENTS_TAB_ID, ...this._categoriesFromJSON];
            this._buildCategoryTabs();
            this._isContentLoaded = true;

            // Set the initial active category to Recents, or the first available category.
            const targetCategory = this._allDisplayableTabs.includes(RECENTS_TAB_ID)
                ? RECENTS_TAB_ID
                : (this._allDisplayableTabs[0] || null);
            this._setActiveCategory(targetCategory);

        } catch (e) {
            console.error(`[AIO-Clipboard] Critical error loading or parsing data in CategorizedItemViewer: ${e.message}`);
            this._isContentLoaded = false;
            this._renderErrorState(_("Error loading data. Check logs."));
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
        const newSearchText = searchText.toLowerCase().trim();
        if (this._currentSearchText === newSearchText) return;

        const oldSearchText = this._currentSearchText;
        this._currentSearchText = newSearchText;

        // Remember the last active tab when starting a search
        if (newSearchText.length > 0 && oldSearchText.length === 0) {
            this._lastActiveTabBeforeSearch = this._activeCategory;
        } else if (newSearchText.length === 0 && oldSearchText.length > 0) {
            // Restore the last active tab when clearing a search
            this._activeCategory = this._lastActiveTabBeforeSearch;
        }

        // Instead of rendering immediately, trigger the debouncer.
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
            itemsToDisplay = this._mainData.filter(item => this._config.searchFilterFn(item, this._currentSearchText));
        } else {
            if (!this._activeCategory && this._allDisplayableTabs.length > 0) {
                this._setActiveCategory(this._allDisplayableTabs[0]);
                return;
            }
            if (this._activeCategory === RECENTS_TAB_ID) {
                itemsToDisplay = this._recentItemsManager.getRecents();
            } else if (this._activeCategory) {
                const categoryProp = this._config.categoryPropertyName;
                itemsToDisplay = this._mainData.filter(item => item[categoryProp] === this._activeCategory);
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
                // Use the helper function to create themed icon
                const iconWidget = createThemedIcon(RECENTS_CUSTOM_ICON_FILENAME, 16);

                button = new St.Button({
                    style_class: 'aio-clipboard-tab-button button',
                    child: iconWidget,
                    can_focus: true,
                    x_expand: false,
                    x_align: Clutter.ActorAlign.CENTER
                });
                button.tooltip_text = _("Recents");
            } else {
                button = this._config.renderCategoryButtonFn(tabId, this._extension.path);
            }
            button.connect('clicked', () => this._setActiveCategory(tabId));
            this._categoryTabBar.add_child(button);
            this._categoryButtons[tabId] = button;
        }

        // Queue relayout for tab bar when scrolling is enabled to ensure proper layout
        if (this._config.enableTabScrolling) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._categoryTabBar.queue_relayout();
                return GLib.SOURCE_REMOVE;
            });
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

        // After re-rendering, restore focus to the search bar for a smooth user experience.
        if (this._setActiveCategoryTimeoutId) {
            GLib.source_remove(this._setActiveCategoryTimeoutId);
        }
        this._setActiveCategoryTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
            this._searchComponent?.grabFocus();
            this._setActiveCategoryTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Renders the grid of items based on the currently filtered data.
     * @private
     */
    _renderGrid() {
        this._contentArea.destroy_all_children();
        this._gridAllButtons = [];
        this._renderSession = {}; // Create a new session for this render pass

        // This is the scroll view we need a reference to.
        let scrollView = new St.ScrollView({
            style_class: 'menu-scrollview',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });

        // Create a single, stable container that will be the direct child of the ScrollView.
        let scrollableContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL
        });
        scrollView.set_child(scrollableContainer);

        if (!this._filteredData || this._filteredData.length === 0) {
            let msg = _("No items available.");
            if (this._currentSearchText) msg = _("No items match your search.");
            else if (this._activeCategory === RECENTS_TAB_ID) msg = _("No recent items yet.");

            // Put the "empty" message inside the stable container, not the ScrollView.
            let bin = new St.Bin({
                child: new St.Label({ text: msg, style_class: 'info-label' }),
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });
            scrollableContainer.add_child(bin);
        } else {
            // This is the "grid view" path.
            let grid = new St.Widget({
                style_class: 'grid-layout',
                layout_manager: new Clutter.GridLayout({ column_homogeneous: true }),
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            scrollableContainer.add_child(grid);

            // Kick off the incremental rendering process
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
        // Abort if a new render has started or the component is destroyed.
        if (session !== this._renderSession || !this.get_stage()) {
            return;
        }

        const itemsPerChunk = 36; // Render in batches of 36 to avoid blocking the UI.
        const endIndex = Math.min(startIndex + itemsPerChunk, this._filteredData.length);
        const layout = grid.get_layout_manager();

        for (let i = startIndex; i < endIndex; i++) {
            const itemData = this._filteredData[i];
            const col = i % this._config.itemsPerRow;
            const row = Math.floor(i / this._config.itemsPerRow);
            const itemButton = this._config.renderGridItemFn(itemData);

            itemButton.connect('clicked', () => {
                const clickedValue = itemButton.get_label();
                const recentItem = { ...itemData, value: clickedValue, char: clickedValue };
                this._recentItemsManager.addItem(recentItem);
                const payload = this._config.createSignalPayload(recentItem);
                this.emit('item-selected', JSON.stringify(payload));
            });

            itemButton.connect('key-focus-in', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    ensureActorVisibleInScrollView(scrollView, itemButton);
                    return GLib.SOURCE_REMOVE;
                });
            });

            this._gridAllButtons.push(itemButton);
            layout.attach(itemButton, col, row, 1, 1);
        }

        // If there are more items to render, schedule the next chunk.
        if (endIndex < this._filteredData.length) {
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                this._renderGridChunk(grid, endIndex, session, scrollView);
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
        this._contentArea.add_child(new St.Bin({
            child: new St.Label({
                text: errorMessage,
                style_class: 'error-label'
            }),
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        }));
    }

    /**
     * Cleans up resources when the component is destroyed.
     */
    destroy() {
        if (this._setActiveCategoryTimeoutId) {
            GLib.source_remove(this._setActiveCategoryTimeoutId);
            this._setActiveCategoryTimeoutId = 0;
        }
        if(this._recentsChangedSignalId > 0) {
            try { this._recentItemsManager.disconnect(this._recentsChangedSignalId); } catch(e) { /* Ignore */ }
        }
        this._searchDebouncer?.destroy();
        this._recentItemsManager?.destroy();
        this._searchComponent?.destroy();

        // Clean up the scrollview if it exists
        this._categoryTabScrollView?.destroy();
        this._categoryTabScrollView = null;

        super.destroy();
    }
});