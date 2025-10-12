import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { createThemedIcon } from '../../utilities/utilityThemedIcon.js';
import { GifManager } from './logic/gifManager.js';
import { MasonryLayout } from '../../utilities/utilityMasonryLayout.js';
import { RecentItemsManager } from '../../utilities/utilityRecents.js';
import { SearchComponent } from '../../utilities/utilitySearch.js';

// Constants
const GIF_PROVIDER_KEY = 'gif-provider';
const GIF_RECENTS_MAX_ITEMS_KEY = 'gif-recents-max-items';
const RECENTS_ICON_FILENAME = 'utility-recents-symbolic.svg';
const SEARCH_DEBOUNCE_TIME_MS = 300;
const ITEMS_PER_ROW = 4;

const _httpSession = new Soup.Session();

/**
 * GIFTabContent - Main UI component for the GIF tab.
 *
 * Displays a grid of GIFs from various providers (Tenor, Imgur) with support for:
 * - Searching GIFs
 * - Browsing by category
 * - Viewing trending GIFs
 * - Recent GIFs history
 * - Infinite scroll pagination
 *
 * @fires set-main-tab-bar-visibility - Emitted to show/hide the main tab bar
 * @fires navigate-to-main-tab - Emitted to navigate back to a main tab
 */
export const GIFTabContent = GObject.registerClass({
    Signals: {
        'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
        'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] }
    },
},
class GIFTabContent extends St.BoxLayout {
    /**
     * Initialize the GIF tab content.
     *
     * @param {object} extension - The extension instance
     * @param {Gio.Settings} settings - Extension settings
     */
    _init(extension, settings) {
        super._init({
            vertical: true,
            style_class: 'gif-tab-content',
            x_expand: true,
            y_expand: true
        });

        this._extension = extension;
        this._settings = settings;
        this._gifManager = new GifManager(settings, extension.uuid);

        // State management
        this._isDestroyed = false;
        this._providerChangedSignalId = 0;
        this._isClearingForCategoryChange = false;
        this._recentItemsManager = null;
        this._recentsSignalId = 0;
        this._searchTimeoutId = 0;
        this._isLoadingMore = false;
        this._nextPos = null;
        this._activeCategory = null;
        this._masonryView = null;
        this._scrollView = null;
        this._gridAllButtons = [];
        this._headerFocusables = [];
        this._renderSession = null;
        this._scrollableContainer = null;
        this._infoBin = null;
        this._infoLabel = null;
        this._infoBar = null;

        this._provider = this._settings.get_string(GIF_PROVIDER_KEY);

        this._buildUISkeleton();
        this._connectProviderChangedSignal();
        this._loadInitialData().catch(e => this._renderErrorState(e.message));
    }

    // ===========================
    // UI Construction Methods
    // ===========================

    /**
     * Build the main UI skeleton with all components.
     *
     * @private
     */
    _buildUISkeleton() {
        this._buildHeaderSkeleton();
        this._buildInfoBar();
        this.add_child(this._infoBar);
        this._buildSearchBar();
        this._buildScrollableContent();
        this._buildSpinner();
    }

    /**
     * Build the header with back button and category tabs.
     *
     * @private
     */
    _buildHeaderSkeleton() {
        const fullHeader = new St.BoxLayout({
            x_expand: true,
            reactive: true
        });
        fullHeader.connect('key-press-event', this._onHeaderKeyPress.bind(this));
        this.add_child(fullHeader);

        const backButton = new St.Button({
            style_class: 'aio-clipboard-back-button button',
            child: new St.Icon({
                icon_name: 'go-previous-symbolic',
                style_class: 'popup-menu-icon'
            }),
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true
        });
        backButton.connect('clicked', () => {
            this.emit('navigate-to-main-tab', _("Recently Used"));
        });
        fullHeader.add_child(backButton);
        this._headerFocusables.push(backButton);

        this.headerScrollView = new St.ScrollView({
            style_class: 'aio-clipboard-tab-scrollview',
            hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            vscrollbar_policy: Gtk.PolicyType.NEVER,
            overlay_scrollbars: true,
            x_expand: true
        });

        this.headerBox = new St.BoxLayout({
            x_expand: false,
            x_align: Clutter.ActorAlign.START
        });

        this.headerScrollView.set_child(this.headerBox);
        fullHeader.add_child(this.headerScrollView);
    }

    /**
     * Build the info bar displayed when online search is disabled.
     *
     * @private
     */
    _buildInfoBar() {
        this._infoBar = new St.BoxLayout({
            style_class: 'gif-info-bar',
            visible: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        const infoIcon = new St.Icon({
            icon_name: 'help-about-symbolic',
            style_class: 'popup-menu-icon',
            icon_size: 16
        });

        const spacer = new St.Widget({ width: 8 });

        const infoLabel = new St.Label({
            text: _("Online search is disabled."),
            y_align: Clutter.ActorAlign.CENTER
        });

        this._infoBar.add_child(infoIcon);
        this._infoBar.add_child(spacer);
        this._infoBar.add_child(infoLabel);
    }

    /**
     * Build the search bar component.
     *
     * @private
     */
    _buildSearchBar() {
        this._searchComponent = new SearchComponent(searchText => {
            this._onSearch(searchText);
        });

        const clutterText = this._searchComponent._entry.get_clutter_text();
        clutterText.connect('key-press-event', this._onSearchKeyPress.bind(this));

        const searchWidget = this._searchComponent.getWidget();
        searchWidget.x_expand = true;
        this.add_child(searchWidget);
    }

    /**
     * Build the scrollable content area with masonry layout.
     *
     * @private
     */
    _buildScrollableContent() {
        this._scrollView = new St.ScrollView({
            style_class: 'menu-scrollview',
            overlay_scrollbars: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            clip_to_allocation: true,
            x_expand: true,
            y_expand: true
        });

        const vadjustment = this._scrollView.vadjustment;
        vadjustment.connect('notify::value', () => this._onScroll(vadjustment));

        this._scrollableContainer = new St.BoxLayout({ vertical: true });
        this._scrollView.set_child(this._scrollableContainer);

        // Create the Masonry view for displaying GIFs
        this._masonryView = new MasonryLayout({
            columns: ITEMS_PER_ROW,
            spacing: 2,
            renderItemFn: this._renderMasonryItem.bind(this),
            visible: true // Start visible
        });
        this._masonryView.reactive = true;
        this._masonryView.connect('key-press-event', this._onGridKeyPress.bind(this));

        // Create the Bin that will hold info/error messages
        this._infoBin = new St.Bin({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false // Start hidden
        });
        this._infoLabel = new St.Label();
        this._infoBin.set_child(this._infoLabel);

        // Add both to the container. We will toggle their visibility.
        this._scrollableContainer.add_child(this._masonryView);
        this._scrollableContainer.add_child(this._infoBin);

        this.add_child(this._scrollView);
    }

    /**
     * Build the loading spinner component.
     *
     * @private
     */
    _buildSpinner() {
        this._spinner = new St.Icon({
            style_class: 'StSpinner',
            style: 'font-size: 24px;',
            visible: false
        });

        this._spinnerBox = new St.BoxLayout({
            style_class: 'gif-spinner-box',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._spinnerBox.add_child(this._spinner);

        this.add_child(this._spinnerBox);
    }

    // ===========================
    // Data Loading Methods
    // ===========================

    /**
     * Connect to the provider changed signal to reload data when provider changes.
     *
     * @private
     */
    _connectProviderChangedSignal() {
        this._providerChangedSignalId = this._settings.connect(
            `changed::${GIF_PROVIDER_KEY}`,
            () => {
                this._provider = this._settings.get_string(GIF_PROVIDER_KEY);
            }
        );
    }

    /**
     * Load initial data including categories and recents.
     *
     * @private
     */
    async _loadInitialData() {
        this.headerBox.destroy_all_children();
        this._tabButtons = {};
        this._headerFocusables.splice(1);

        const searchWidget = this._searchComponent.getWidget();

        this._initializeRecentsManager();
        this._addRecentsButton();

        if (this._provider === 'none') {
            this._setOfflineMode(searchWidget);
            return;
        }

        this._setOnlineMode(searchWidget);
        await this._loadCategories();
        this._setInitialCategory();
    }

    /**
     * Initialize the recents manager if not already initialized.
     *
     * @private
     */
    _initializeRecentsManager() {
        if (!this._recentItemsManager) {
            this._recentItemsManager = new RecentItemsManager(
                this._extension.uuid,
                this._settings,
                'recent_gifs.json',
                GIF_RECENTS_MAX_ITEMS_KEY
            );

            this._recentsSignalId = this._recentItemsManager.connect(
                'recents-changed',
                () => {
                    if (this._activeCategory?.id === 'recents') {
                        this._displayRecents();
                    }
                }
            );
        }
    }

    /**
     * Set the UI to offline mode (provider = 'none').
     *
     * @param {St.Widget} searchWidget - The search widget to hide
     * @private
     */
    _setOfflineMode(searchWidget) {
        this._infoBar.visible = true;
        searchWidget.visible = false;
        searchWidget.can_focus = false;

        this._setActiveCategory({
            id: 'recents',
            name: _("Recents"),
            isSpecial: true
        }, true);
    }

    /**
     * Set the UI to online mode (provider != 'none').
     *
     * @param {St.Widget} searchWidget - The search widget to show
     * @private
     */
    _setOnlineMode(searchWidget) {
        this._infoBar.visible = false;
        searchWidget.visible = true;
        searchWidget.can_focus = true;
    }

    /**
     * Load categories from the GIF provider.
     *
     * @private
     */
    async _loadCategories() {
        this._addTrendingButton();

        try {
            const categories = await this._gifManager.getCategories();
            for (const category of categories) {
                this._addCategoryButton(category);
            }
        } catch (e) {
            console.warn(
                `[AIO-Clipboard] Could not fetch GIF categories: ${e.message}`
            );
        }
    }

    /**
     * Set the initial active category after loading.
     *
     * @private
     */
    _setInitialCategory() {
        const firstCategory = this._tabButtons['trending']?.categoryData;

        if (firstCategory) {
            this._setActiveCategory(firstCategory, true);
        } else {
            this._renderInfoState(_("No categories available."));
        }
    }

    // ===========================
    // Category Button Creation
    // ===========================

    /**
     * Add the recents button to the header.
     *
     * @private
     */
    _addRecentsButton() {
        const category = {
            id: 'recents',
            name: _("Recents"),
            isSpecial: true
        };

        // Use the helper function to create themed icon
        const iconWidget = createThemedIcon(
            this._extension.path,
            RECENTS_ICON_FILENAME,
            16
        );

        const button = new St.Button({
            style_class: 'aio-clipboard-tab-button button',
            child: iconWidget,
            can_focus: true
        });

        button.tooltip_text = _("Recents");
        button.connect('clicked', () => this._setActiveCategory(category));
        button.categoryData = category;

        this._tabButtons[category.id] = button;
        this.headerBox.add_child(button);
        this._headerFocusables.push(button);
    }

    /**
     * Add the trending button to the header.
     *
     * @private
     */
    _addTrendingButton() {
        const category = {
            id: 'trending',
            name: _("Trending"),
            isSpecial: true
        };

        const button = new St.Button({
            style_class: 'gif-category-tab-button button',
            can_focus: true,
            label: _("Trending")
        });

        button.tooltip_text = _("Trending GIFs");
        button.connect('clicked', () => this._setActiveCategory(category));
        button.categoryData = category;

        this._tabButtons[category.id] = button;
        this.headerBox.add_child(button);
        this._headerFocusables.push(button);
    }

    /**
     * Add a category button to the header.
     *
     * @param {object} category - The category data from the provider
     * @param {string} category.name - Display name of the category
     * @param {string} category.searchTerm - Search term for the category
     * @private
     */
    _addCategoryButton(category) {
        const categoryData = {
            id: category.searchTerm,
            name: category.name,
            searchTerm: category.searchTerm
        };

        const button = new St.Button({
            style_class: 'gif-category-tab-button button',
            can_focus: true,
            label: _(category.name)
        });

        button.tooltip_text = _(category.name);
        button.connect('clicked', () => this._setActiveCategory(categoryData));
        button.categoryData = categoryData;

        this._tabButtons[categoryData.id] = button;
        this.headerBox.add_child(button);
        this._headerFocusables.push(button);
    }

    // ===========================
    // Keyboard Navigation Methods
    // ===========================

    /**
     * Handle keyboard navigation in the header (back button and category tabs).
     *
     * @param {St.Widget} actor - The actor that received the event
     * @param {Clutter.Event} event - The key press event
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

        switch (symbol) {
            case Clutter.KEY_Left:
                if (currentIndex > 0) {
                    this._headerFocusables[currentIndex - 1].grab_key_focus();
                }
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Right:
                if (currentIndex < this._headerFocusables.length - 1) {
                    this._headerFocusables[currentIndex + 1].grab_key_focus();
                }
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Down:
                this._focusNextElementDown();
                return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Focus the next element below the header (search bar or first GIF).
     *
     * @private
     */
    _focusNextElementDown() {
        const searchWidget = this._searchComponent.getWidget();

        if (searchWidget.visible) {
            this._searchComponent.grabFocus();
        } else if (this._gridAllButtons.length > 0) {
            this._gridAllButtons[0].grab_key_focus();
        }
    }

    /**
     * Handle keyboard navigation in the search bar.
     *
     * @param {St.Widget} actor - The actor that received the event
     * @param {Clutter.Event} event - The key press event
     * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
     * @private
     */
    _onSearchKeyPress(actor, event) {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Up) {
            if (this._headerFocusables.length > 0) {
                this._headerFocusables[0].grab_key_focus();
            }
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Down) {
            if (this._gridAllButtons.length > 0) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._gridAllButtons[0].grab_key_focus();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Handle keyboard navigation in the GIF grid.
     *
     * @param {St.Widget} actor - The actor that received the event
     * @param {Clutter.Event} event - The key press event
     * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
     * @private
     */
    _onGridKeyPress(actor, event) {
        const symbol = event.get_key_symbol();

        if (this._gridAllButtons.length === 0) {
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
                targetIndex = this._findClosestInDirection(currentIndex, 'left');
                break;

            case Clutter.KEY_Right:
                targetIndex = this._findClosestInDirection(currentIndex, 'right');
                break;

            case Clutter.KEY_Up:
                targetIndex = this._findClosestInDirection(currentIndex, 'up');
                if (targetIndex === -1) {
                    this._focusElementAboveGrid();
                    return Clutter.EVENT_STOP;
                }
                break;

            case Clutter.KEY_Down:
                targetIndex = this._findClosestInDirection(currentIndex, 'down');
                break;

            default:
                return Clutter.EVENT_PROPAGATE;
        }

        if (targetIndex !== -1) {
            this._gridAllButtons[targetIndex].grab_key_focus();
        }

        return Clutter.EVENT_STOP;
    }

    /**
     * Focus the element above the grid (search bar or header).
     *
     * @private
     */
    _focusElementAboveGrid() {
        const searchWidget = this._searchComponent?.getWidget();

        if (searchWidget && searchWidget.visible) {
            this._searchComponent.grabFocus();
        } else if (this._headerFocusables.length > 0) {
            this._headerFocusables[0].grab_key_focus();
        }
    }

    /**
     * Find the closest GIF button in a given direction from the current position.
     *
     * Uses weighted distance calculation to prefer items in the same row/column.
     *
     * @param {number} currentIndex - Index of the currently focused button
     * @param {string} direction - Direction to search: 'up', 'down', 'left', 'right'
     * @returns {number} Index of the closest button, or -1 if none found
     * @private
     */
    _findClosestInDirection(currentIndex, direction) {
        const currentButton = this._gridAllButtons[currentIndex];
        const currentBox = currentButton.get_allocation_box();
        const currentCenterX = currentBox.x1 + currentBox.get_width() / 2;
        const currentCenterY = currentBox.y1 + currentBox.get_height() / 2;

        let bestCandidateIndex = -1;
        let minWeightedDistance = Infinity;

        for (let i = 0; i < this._gridAllButtons.length; i++) {
            if (i === currentIndex) {
                continue;
            }

            const candidate = this._gridAllButtons[i];
            const candidateBox = candidate.get_allocation_box();
            const candidateCenterX = candidateBox.x1 + candidateBox.get_width() / 2;
            const candidateCenterY = candidateBox.y1 + candidateBox.get_height() / 2;

            if (!this._isInDirection(direction, currentCenterX, currentCenterY,
                                     candidateCenterX, candidateCenterY)) {
                continue;
            }

            const weightedDistance = this._calculateWeightedDistance(
                direction,
                currentCenterX,
                currentCenterY,
                candidateCenterX,
                candidateCenterY
            );

            if (weightedDistance < minWeightedDistance) {
                minWeightedDistance = weightedDistance;
                bestCandidateIndex = i;
            }
        }

        return bestCandidateIndex;
    }

    /**
     * Check if a candidate is in the specified direction from the current position.
     *
     * @param {string} direction - The direction to check
     * @param {number} currentX - Current X coordinate
     * @param {number} currentY - Current Y coordinate
     * @param {number} candidateX - Candidate X coordinate
     * @param {number} candidateY - Candidate Y coordinate
     * @returns {boolean} True if candidate is in the specified direction
     * @private
     */
    _isInDirection(direction, currentX, currentY, candidateX, candidateY) {
        switch (direction) {
            case 'up':
                return candidateY < currentY;
            case 'down':
                return candidateY > currentY;
            case 'left':
                return candidateX < currentX;
            case 'right':
                return candidateX > currentX;
            default:
                return false;
        }
    }

    /**
     * Calculate weighted distance for directional navigation.
     *
     * Weights favor items in the same row/column by penalizing perpendicular distance.
     *
     * @param {string} direction - The navigation direction
     * @param {number} currentX - Current X coordinate
     * @param {number} currentY - Current Y coordinate
     * @param {number} candidateX - Candidate X coordinate
     * @param {number} candidateY - Candidate Y coordinate
     * @returns {number} Weighted distance
     * @private
     */
    _calculateWeightedDistance(direction, currentX, currentY, candidateX, candidateY) {
        const dX = Math.abs(candidateX - currentX);
        const dY = Math.abs(candidateY - currentY);

        if (direction === 'up' || direction === 'down') {
            return Math.sqrt(Math.pow(dX * 5, 2) + Math.pow(dY, 2));
        } else {
            return Math.sqrt(Math.pow(dX, 2) + Math.pow(dY * 5, 2));
        }
    }

    // ===========================
    // Category Management Methods
    // ===========================

    /**
     * Set the active category and load its content.
     *
     * @param {object} category - The category to activate
     * @param {string} category.id - Unique category identifier
     * @param {string} category.name - Display name
     * @param {boolean} [category.isSpecial] - Whether this is a special category (recents/trending)
     * @param {string} [category.searchTerm] - Search term for regular categories
     * @param {boolean} [forceRefresh=false] - Force refresh even if already active
     * @private
     */
    _setActiveCategory(category, forceRefresh = false) {
        if (!category || (this._activeCategory?.id === category.id && !forceRefresh)) {
            return;
        }

        this._activeCategory = category;
        this._highlightTab(category.id);
        this._clearSearchBar();
        this._loadCategoryContent(category);
        this._focusSearchOrFirstItem();
    }

    /**
     * Clear the search bar without triggering the search.
     *
     * @private
     */
    _clearSearchBar() {
        this._isClearingForCategoryChange = true;

        if (this._searchComponent) {
            this._searchComponent.clearSearch();
        }

        this._isClearingForCategoryChange = false;
    }

    /**
     * Load content for the given category.
     *
     * @param {object} category - The category to load
     * @private
     */
    _loadCategoryContent(category) {
        if (category.id === 'recents') {
            this._displayRecents();
        } else if (category.id === 'trending') {
            this._fetchAndDisplayTrending().catch(e => {
                this._renderErrorState(e.message);
            });
        } else {
            this._performSearch(category.searchTerm).catch(e => {
                this._renderErrorState(e.message);
            });
        }
    }

    /**
     * Focus the search bar or first item after category change.
     *
     * @private
     */
    _focusSearchOrFirstItem() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._isDestroyed) {
                return GLib.SOURCE_REMOVE;
            }

            const searchWidget = this._searchComponent?.getWidget();

            if (searchWidget && searchWidget.visible) {
                this._searchComponent.grabFocus();
            } else if (this._gridAllButtons.length > 0) {
                this._gridAllButtons[0].grab_key_focus();
            } else if (this._headerFocusables.length > 0) {
                this._headerFocusables[0].grab_key_focus();
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Highlight the active category tab.
     *
     * @param {string|null} categoryId - ID of the category to highlight, or null to clear
     * @private
     */
    _highlightTab(categoryId) {
        for (const [id, button] of Object.entries(this._tabButtons)) {
            button.checked = (id === categoryId);
        }
    }

    // ===========================
    // Content Display Methods
    // ===========================

    /**
     * Display the recents GIFs.
     *
     * @private
     */
    _displayRecents() {
        this._nextPos = null;
        const recents = this._recentItemsManager.getRecents();

        this._renderGrid([], true);

        if (recents.length > 0) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._isDestroyed) {
                    this._renderGrid(recents, false);
                }
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._renderInfoState(_("No recent GIFs."));
        }
    }

    /**
     * Fetch and display trending GIFs.
     *
     * @param {string|null} [nextPos=null] - Pagination token for loading more
     * @private
     */
    async _fetchAndDisplayTrending(nextPos = null) {
        if (!nextPos) {
            this._renderLoadingState();
        } else {
            this._showSpinner(true);
        }

        try {
            const { results, nextPos: newNextPos } = await this._gifManager.getTrending(nextPos);
            this._nextPos = newNextPos;

            if (results.length > 0) {
                this._renderGrid(results, !nextPos);
            } else if (!nextPos) {
                this._renderInfoState(_("No trending GIFs found."));
            }
        } catch (e) {
            this._renderErrorState(e.message);
        } finally {
            this._showSpinner(false);
        }
    }

    /**
     * Perform a search and display results.
     *
     * @param {string} query - The search query
     * @param {string|null} [nextPos=null] - Pagination token for loading more
     * @private
     */
    async _performSearch(query, nextPos = null) {
        if (!nextPos) {
            this._renderLoadingState();
        } else {
            this._showSpinner(true);
        }

        try {
            const { results, nextPos: newNextPos } = await this._gifManager.search(
                query,
                nextPos
            );
            this._nextPos = newNextPos;

            if (results.length > 0) {
                this._renderGrid(results, !nextPos);
            } else if (!nextPos) {
                this._renderInfoState(_("No results found for '%s'.").format(query));
            }
        } catch (e) {
            this._renderErrorState(e.message);
        } finally {
            this._showSpinner(false);
        }
    }

    // ===========================
    // Search and Scroll Handlers
    // ===========================

    /**
     * Handle search text changes.
     *
     * @param {string} searchText - The new search text
     * @private
     */
    _onSearch(searchText) {
        if (this._isClearingForCategoryChange) {
            return;
        }

        if (this._searchTimeoutId > 0) {
            GLib.source_remove(this._searchTimeoutId);
        }

        const query = searchText.trim();

        if (!query) {
            if (this._activeCategory) {
                this._setActiveCategory(this._activeCategory, true);
            }
            return;
        }

        if (query.length < 2) {
            return;
        }

        this._searchTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            SEARCH_DEBOUNCE_TIME_MS,
            () => {
                this._highlightTab(null);
                this._activeCategory = {
                    id: query,
                    name: query,
                    searchTerm: query
                };
                this._performSearch(query).catch(e => {
                    this._renderErrorState(e.message);
                });
                this._searchTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    /**
     * Handle scroll events for infinite scroll pagination.
     *
     * @param {St.Adjustment} vadjustment - The vertical adjustment of the scroll view
     * @private
     */
    _onScroll(vadjustment) {
        if (this._isLoadingMore || !this._nextPos) {
            return;
        }

        const threshold = vadjustment.upper - vadjustment.page_size - 100;

        if (vadjustment.value >= threshold) {
            this._loadMoreResults().catch(e => {
                console.error(`[AIO-Clipboard] Failed to load more GIFs: ${e.message}`);
                this._isLoadingMore = false;
                this._showSpinner(false);
            });
        }
    }

    /**
     * Load more results for the current category (pagination).
     *
     * @private
     */
    async _loadMoreResults() {
        this._isLoadingMore = true;

        if (this._activeCategory?.id === 'trending') {
            await this._fetchAndDisplayTrending(this._nextPos);
        } else if (this._activeCategory?.searchTerm) {
            await this._performSearch(this._activeCategory.searchTerm, this._nextPos);
        }

        this._isLoadingMore = false;
    }

    // ===========================
    // Grid Rendering Methods
    // ===========================

    /**
     * Render a single GIF item in the masonry layout.
     *
     * @param {object} itemData - The GIF data
     * @param {string} itemData.preview_url - URL for the preview image
     * @param {string} itemData.full_url - URL for the full GIF
     * @param {string} [itemData.description] - Description/title of the GIF
     * @param {number} itemData.width - Width of the GIF
     * @param {number} itemData.height - Height of the GIF
     * @param {object} renderSession - Session object for tracking async operations
     * @returns {St.Bin|null} The rendered widget or null if invalid
     * @private
     */
    _renderMasonryItem(itemData, renderSession) {
        if (!this._isValidItemData(itemData)) {
            console.warn('[AIO-Clipboard] Skipping item with invalid data:', itemData);
            return null;
        }

        const bin = new St.Bin({
            style_class: 'gif-grid-button button',
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        bin.tooltip_text = itemData.description || '';

        bin.connect('button-press-event', () => {
            this._onGifSelected(itemData);
            return Clutter.EVENT_STOP;
        });

        bin.connect('key-press-event', (actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._onGifSelected(itemData);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        bin.connect('key-focus-in', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                ensureActorVisibleInScrollView(this._scrollView, bin);
                return GLib.SOURCE_REMOVE;
            });
        });

        this._setIconFromUrl(bin, itemData.preview_url, renderSession);
        this._gridAllButtons.push(bin);

        return bin;
    }

    /**
     * Validate that item data has all required properties.
     *
     * @param {object} itemData - The item data to validate
     * @returns {boolean} True if valid
     * @private
     */
    _isValidItemData(itemData) {
        return itemData &&
               itemData.preview_url &&
               itemData.width &&
               itemData.height;
    }

    /**
     * Load and set the preview image for a GIF item.
     *
     * @param {St.Bin} bin - The container widget
     * @param {string} url - The preview image URL
     * @param {object} renderSession - Session object for tracking async operations
     * @private
     */
    async _setIconFromUrl(bin, url, renderSession) {
        try {
            const bytes = await this._fetchImageBytes(url);

            // Abort if the UI context has changed or the widget is not yet allocated.
            if (this._isDestroyed || renderSession !== this._renderSession || bin.width <= 0 || bin.height <= 0) {
                return;
            }

            const pixbuf = this._createPixbufFromBytes(bytes);

            // Re-check after pixbuf creation.
            if (this._isDestroyed || renderSession !== this._renderSession) {
                return;
            }

            const drawingArea = this._createDrawingArea(bin, pixbuf);
            bin.set_child(drawingArea);

        } catch (e) {
            this._handleImageLoadError(bin, e, renderSession);
        }
    }

    /**
     * Fetch image bytes from a URL.
     *
     * @param {string} url - The image URL
     * @returns {Promise<GLib.Bytes>} The image bytes
     * @private
     */
    async _fetchImageBytes(url) {
        const message = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
        });

        return new Promise((resolve, reject) => {
            _httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, res) => {
                    if (this._isDestroyed) {
                        return reject(new Error('GIF Tab was destroyed.'));
                    }

                    if (message.get_status() >= 300) {
                        return reject(new Error(`HTTP Error ${message.get_status()}`));
                    }

                    try {
                        resolve(session.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * Create a pixbuf from image bytes.
     *
     * @param {GLib.Bytes} bytes - The image bytes
     * @returns {GdkPixbuf.Pixbuf} The pixbuf
     * @private
     */
    _createPixbufFromBytes(bytes) {
        const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
        stream.close(null);
        return pixbuf;
    }

    /**
     * Create a drawing area to display a pixbuf.
     *
     * @param {St.Bin} bin - The container widget
     * @param {GdkPixbuf.Pixbuf} pixbuf - The pixbuf to display
     * @returns {St.DrawingArea} The drawing area
     * @private
     */
    _createDrawingArea(bin, pixbuf) {
        const borderWidth = 2;
        const drawingArea = new St.DrawingArea({
            width: bin.width - (borderWidth * 2),
            height: bin.height - (borderWidth * 2),
            x: borderWidth,
            y: borderWidth
        });

        drawingArea.connect('repaint', () => {
            const cr = drawingArea.get_context();
            const [areaWidth, areaHeight] = drawingArea.get_surface_size();
            const pixbufWidth = pixbuf.get_width();
            const pixbufHeight = pixbuf.get_height();
            const scaleX = areaWidth / pixbufWidth;
            const scaleY = areaHeight / pixbufHeight;

            cr.save();
            cr.scale(scaleX, scaleY);
            Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
            cr.paint();
            cr.restore();
            cr.$dispose();
        });

        return drawingArea;
    }

    /**
     * Handle errors when loading preview images.
     *
     * @param {St.Bin} bin - The container widget
     * @param {Error} error - The error that occurred
     * @param {object} renderSession - Session object for tracking async operations
     * @private
     */
    _handleImageLoadError(bin, error, renderSession) {
        if (this._isDestroyed || renderSession !== this._renderSession) {
            return;
        }

        bin.set_child(new St.Icon({
            icon_name: 'image-missing-symbolic',
            icon_size: 64
        }));

        if (!error.message.startsWith('GIF Tab') &&
            !error.message.startsWith('Render session')) {
            console.warn(`[AIO-Clipboard] Failed to load GIF preview: ${error.message}`);
        }
    }


    /**
     * Render the grid with GIF items.
     *
     * @param {Array<object>} results - Array of GIF data objects
     * @param {boolean} [replace=true] - Whether to replace existing items or append
     * @private
     */
    _renderGrid(results, replace = true) {
        // Show the grid and hide the info message container
        this._masonryView.visible = true;
        this._infoBin.visible = false;

        if (replace) {
            this._gridAllButtons = [];
            this._masonryView.clear();
            this._renderSession = {};
        }

        this._masonryView.addItems(results, this._renderSession);
    }

    // ===========================
    // UI State Methods
    // ===========================

    /**
     * Show the loading state with spinner.
     *
     * @private
     */
    _renderLoadingState() {
        this._showSpinner(true);

        if (this._masonryView) {
            this._masonryView.clear();
        }
    }

    /**
     * Show an informational message.
     *
     * @param {string} message - The message to display
     * @private
     */
    _renderInfoState(message) {
        this._showSpinner(false);

        // Hide the grid and show the info message container
        this._masonryView.visible = false;
        this._infoBin.visible = true;
        this._infoLabel.set_style_class_name('aio-clipboard-info-label');
        this._infoLabel.set_text(message);
    }

    /**
     * Show an error message.
     *
     * @param {string} errorMessage - The error message to display
     * @private
     */
    _renderErrorState(errorMessage) {
        this._showSpinner(false);

        // Hide the grid and show the info message container (styled as an error)
        this._masonryView.visible = false;
        this._infoBin.visible = true;
        this._infoLabel.set_style_class_name('aio-clipboard-error-label');
        this._infoLabel.set_text(
            _("Error: %s\nPlease check your API key and network connection.").format(errorMessage)
        );
    }

    /**
     * Show or hide the loading spinner.
     *
     * @param {boolean} visible - Whether the spinner should be visible
     * @private
     */
    _showSpinner(visible) {
        this._spinner.visible = visible;
    }

    // ===========================
    // GIF Selection Handler
    // ===========================

    /**
     * Handle selection of a GIF item.
     *
     * Copies the GIF URL to clipboard, adds to recents, and optionally triggers paste.
     *
     * @param {object} gifObject - The selected GIF data
     * @param {string} gifObject.full_url - The full GIF URL
     * @param {string} [gifObject.preview_url] - The preview image URL
     * @param {number} [gifObject.width] - The GIF width
     * @param {number} [gifObject.height] - The GIF height
     * @private
     */
    async _onGifSelected(gifObject) {
        if (!gifObject || !gifObject.full_url) {
            console.error(
                '[AIO-Clipboard] Cannot process selected GIF due to invalid data:',
                gifObject
            );
            return;
        }

        St.Clipboard.get_default().set_text(
            St.ClipboardType.CLIPBOARD,
            gifObject.full_url
        );

        if (gifObject.preview_url && gifObject.width && gifObject.height) {
            const recentItem = {
                ...gifObject,
                value: gifObject.full_url
            };
            this._recentItemsManager?.addItem(recentItem);
        }

        const { shouldAutoPaste, triggerPaste } = await import(
            '../../utilities/utilityAutoPaste.js'
        );

        if (shouldAutoPaste(this._settings, 'auto-paste-gif')) {
            await triggerPaste();
        }

        this._extension._indicator.menu?.close();
    }

    // ===========================
    // Lifecycle Methods
    // ===========================

    /**
     * Called when the tab is selected/activated.
     *
     * Reloads data if the provider has changed since last activation.
     */
    onTabSelected() {
        this.emit('set-main-tab-bar-visibility', false);

        const currentProvider = this._settings.get_string(GIF_PROVIDER_KEY);

        if (this._provider !== currentProvider) {
            this._provider = currentProvider;
            this._loadInitialData().catch(e => {
                this._renderErrorState(e.message);
            });
        } else if (this._activeCategory) {
            this._setActiveCategory(this._activeCategory, true);
        }
    }

    /**
     * Clean up resources when the widget is destroyed.
     */
    destroy() {
        this._isDestroyed = true;

        if (this._settings && this._providerChangedSignalId > 0) {
            this._settings.disconnect(this._providerChangedSignalId);
        }

        if (this._searchTimeoutId > 0) {
            GLib.source_remove(this._searchTimeoutId);
        }

        if (this._recentItemsManager && this._recentsSignalId > 0) {
            try {
                this._recentItemsManager.disconnect(this._recentsSignalId);
            } catch (e) {
                // Ignore disconnection errors
            }
        }

        this._searchComponent?.destroy();
        this._recentItemsManager?.destroy();

        super.destroy();
    }
});