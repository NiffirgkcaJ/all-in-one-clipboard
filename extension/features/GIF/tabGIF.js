import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from '../../shared/utilities/utilityIcon.js';
import { Debouncer } from '../../shared/utilities/utilityDebouncer.js';
import { eventMatchesShortcut } from '../../shared/utilities/utilityShortcutMatcher.js';
import { IOFile } from '../../shared/utilities/utilityIO.js';
import { FocusUtils } from '../../shared/utilities/utilityFocus.js';
import { MasonryLayout } from '../../shared/utilities/utilityMasonryLayout.js';
import { RecentItemsManager } from '../../shared/utilities/utilityRecents.js';
import { SearchComponent } from '../../shared/utilities/utilitySearch.js';
import { AutoPaster, getAutoPaster } from '../../shared/utilities/utilityAutoPaste.js';
import { FilePath, FileItem } from '../../shared/constants/storagePaths.js';
import { HorizontalScrollView, scrollToItemCentered } from '../../shared/utilities/utilityHorizontalScrollView.js';

import { GifDownloadService } from './logic/gifDownloadService.js';
import { GifItemFactory } from './view/gifItemFactory.js';
import { GifManager } from './logic/gifManager.js';
import { GifSettings, GifUI, GifIcons } from './constants/gifConstants.js';

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
export const GIFTabContent = GObject.registerClass(
    {
        Signals: {
            'set-main-tab-bar-visibility': { param_types: [GObject.TYPE_BOOLEAN] },
            'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class GIFTabContent extends St.BoxLayout {
        /**
         * Initialize the GIF tab content.
         *
         * @param {object} extension - The extension instance
         * @param {Gio.Settings} settings - Extension settings
         * @param {ClipboardManager} clipboardManager - The clipboard manager instance
         */
        constructor(extension, settings, clipboardManager) {
            super({
                vertical: true,
                style_class: 'gif-tab-content',
                x_expand: true,
                y_expand: true,
                reactive: true,
            });

            this.connect('captured-event', this._onGlobalKeyPress.bind(this));
            this._httpSession = new Soup.Session();
            this._extension = extension;
            this._clipboardManager = clipboardManager;

            this._cacheDir = FilePath.GIF_PREVIEWS;

            IOFile.mkdir(this._cacheDir);

            this._settings = settings;
            this._gifManager = new GifManager(settings, extension.uuid);
            this._downloadService = new GifDownloadService(this._httpSession, clipboardManager);

            this._isDestroyed = false;
            this._providerChangedSignalId = 0;
            this._isClearingForCategoryChange = false;
            this._recentsManager = null;
            this._recentsSignalId = 0;
            this._isLoadingMore = false;
            this._nextPos = null;
            this._activeCategory = null;
            this._masonryView = null;
            this._scrollView = null;
            this._gridAllButtons = [];
            this._headerFocusables = [];
            this._backButton = null;
            this._alwaysShowTabsSignalId = 0;
            this._renderSession = null;
            this._scrollableContainer = null;
            this._infoBin = null;
            this._infoLabel = null;
            this._infoBar = null;
            this._currentSearchQuery = null;
            this._currentLoadingSession = null;
            this._provider = this._settings.get_string(GifSettings.PROVIDER_KEY);

            this._searchDebouncer = new Debouncer((query) => {
                this._performSearch(query).catch((e) => {
                    this._renderErrorState(e.message);
                });
            }, GifUI.SEARCH_DEBOUNCE_TIME_MS);

            this._buildUISkeleton();

            this._itemFactory = new GifItemFactory(this._downloadService, this._cacheDir, this._scrollView);

            this._alwaysShowTabsSignalId = this._settings.connect('changed::always-show-main-tab', () => this._updateBackButtonPreference());
            this._connectProviderChangedSignal();
            this._loadInitialData().catch((e) => this._renderErrorState(e.message));
        }

        // ========================================================================
        // UI Construction Methods
        // ========================================================================

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
                reactive: true,
            });
            fullHeader.connect('key-press-event', this._onHeaderKeyPress.bind(this));
            this.add_child(fullHeader);

            const backButton = new St.Button({
                style_class: 'aio-clipboard-back-button button',
                child: createStaticIcon(GifIcons.BACK_BUTTON),
                y_align: Clutter.ActorAlign.CENTER,
                can_focus: true,
            });
            backButton.connect('clicked', () => {
                this.emit('navigate-to-main-tab', _('Recently Used'));
            });
            fullHeader.add_child(backButton);
            this._backButton = backButton;
            this._initializeHeaderFocusables();

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
            fullHeader.add_child(this.headerScrollView);
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

        /**
         * Initialize the list of focusable actors in the header.
         * @private
         */
        _initializeHeaderFocusables() {
            this._headerFocusables = [];
            this._updateBackButtonPreference();
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
                y_align: Clutter.ActorAlign.CENTER,
            });

            const infoIcon = createStaticIcon(GifIcons.INFO);

            const spacer = new St.Widget({ width: 8 });

            const infoLabel = new St.Label({
                text: _('Online search is disabled.'),
                y_align: Clutter.ActorAlign.CENTER,
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
            this._searchComponent = new SearchComponent((searchText) => {
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
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                clip_to_allocation: true,
                x_expand: true,
                y_expand: true,
            });

            const vadjustment = this._scrollView.vadjustment;
            vadjustment.connect('notify::value', () => this._onScroll(vadjustment));

            this._scrollableContainer = new St.BoxLayout({ vertical: true });
            this._scrollView.set_child(this._scrollableContainer);

            // Create the Masonry view for displaying GIFs
            this._masonryView = new MasonryLayout({
                columns: GifUI.ITEMS_PER_ROW,
                spacing: 2,
                renderItemFn: (itemData) => {
                    const bin = this._itemFactory.createItem(itemData, this._onGifSelected.bind(this));
                    if (bin) {
                        this._gridAllButtons.push(bin);
                    }
                    return bin;
                },
                visible: true, // Start visible
            });

            this._infoBin = new St.Bin({
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false, // Start hidden
            });
            this._infoLabel = new St.Label();
            this._infoBin.set_child(this._infoLabel);

            this._scrollableContainer.add_child(this._masonryView);
            this._scrollableContainer.add_child(this._infoBin);

            // Make the container reactive to handle key events
            this._scrollableContainer.reactive = true;
            this._scrollableContainer.connect('key-press-event', this._onGridKeyPress.bind(this));

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
                visible: false,
            });

            this._spinnerBox = new St.BoxLayout({
                style_class: 'gif-spinner-box',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._spinnerBox.add_child(this._spinner);

            this.add_child(this._spinnerBox);
        }

        // ========================================================================
        // Data Loading Methods
        // ========================================================================

        /**
         * Connect to the provider changed signal to reload data when provider changes.
         *
         * @private
         */
        _connectProviderChangedSignal() {
            this._providerChangedSignalId = this._settings.connect(`changed::${GifSettings.PROVIDER_KEY}`, () => {
                this._provider = this._settings.get_string(GifSettings.PROVIDER_KEY);
            });
        }

        /**
         * Load initial data including categories and recents.
         *
         * @private
         */
        async _loadInitialData() {
            this.headerBox.destroy_all_children();
            this._tabButtons = {};
            this._initializeHeaderFocusables();

            const searchWidget = this._searchComponent.getWidget();

            this._initializeRecentsManager();
            this._addRecentsButton();

            if (this._provider === 'none') {
                this._setOfflineMode(searchWidget);
                return;
            }

            this._setOnlineMode(searchWidget);
            this._addTrendingButton();
            this._setInitialCategory();

            this._loadCategories().catch((e) => {
                console.warn(`[AIO-Clipboard] Could not fetch GIF categories: ${e.message}`);
            });
        }

        /**
         * Initialize the recents manager if not already initialized.
         *
         * @private
         */
        _initializeRecentsManager() {
            if (!this._recentsManager) {
                this._recentsManager = new RecentItemsManager(this._extension.uuid, this._settings, FileItem.RECENT_GIFS, GifSettings.RECENTS_MAX_ITEMS_KEY);

                this._recentsSignalId = this._recentsManager.connect('recents-changed', () => {
                    if (this._activeCategory?.id === 'recents') {
                        this._displayRecents();
                    }
                });
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

            this._setActiveCategory(
                {
                    id: 'recents',
                    name: _('Recents'),
                    isSpecial: true,
                },
                true,
            );
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
            try {
                const categories = await this._gifManager.getCategories();
                for (const category of categories) {
                    this._addCategoryButton(category);
                }
            } catch (e) {
                console.warn(`[AIO-Clipboard] Could not fetch GIF categories: ${e.message}`);
            }
        }

        /**
         * Set the initial active category after loading.
         *
         * @private
         */
        _setInitialCategory() {
            const trendingCategory = this._tabButtons['trending']?.categoryData;

            if (trendingCategory) {
                this._setActiveCategory(trendingCategory, true);
            } else {
                this._renderInfoState(_('No categories available.'));
            }
        }

        // ========================================================================
        // Category Button Creation
        // ========================================================================

        /**
         * Helper to create, configure, and register a header tab button.
         * @param {object} categoryData - The category data object used for logic
         * @param {object} params - St.Button configuration
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

            button.connect('clicked', () => this._setActiveCategory(categoryData));

            this._tabButtons[categoryData.id] = button;
            this.headerBox.add_child(button);
            this._headerFocusables.push(button);

            return button;
        }

        /**
         * Add the recents button to the header.
         * @private
         */
        _addRecentsButton() {
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
         * @private
         */
        _addTrendingButton() {
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
         * @param {object} category - The category data
         * @private
         */
        _addCategoryButton(category) {
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

        // ========================================================================
        // Keyboard Navigation Methods
        // ========================================================================

        /**
         * Handles key presses on the main container to cycle categories.
         */
        _onGlobalKeyPress(actor, event) {
            // Only handle key press events
            if (event.type() !== Clutter.EventType.KEY_PRESS) {
                return Clutter.EVENT_PROPAGATE;
            }

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

            this._setActiveCategory(categories[newIndex]);

            const button = this._tabButtons[categories[newIndex].id];
            if (button) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    scrollToItemCentered(this.headerScrollView, button);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

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

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return FocusUtils.handleLinearNavigation(event, this._headerFocusables, currentIndex);
            }

            if (symbol === Clutter.KEY_Down) {
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
         * Focus the next element up (search bar or header).
         *
         * @private
         */
        _focusNextElementUp() {
            const searchWidget = this._searchComponent?.getWidget();

            if (searchWidget && searchWidget.visible) {
                this._searchComponent.grabFocus();
            } else if (this._headerFocusables.length > 0) {
                this._headerFocusables[0].grab_key_focus();
            }
        }

        /**
         * Handle boundary cases when MasonryLayout propagates navigation events.
         * This only receives events that MasonryLayout didn't handle internally.
         *
         * @param {St.Widget} actor - The actor that received the event
         * @param {Clutter.Event} event - The key press event
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        _onGridKeyPress(actor, event) {
            const symbol = event.get_key_symbol();

            // MasonryLayout propagates up when at the top edge
            if (symbol === Clutter.KEY_Up) {
                this._focusNextElementUp();
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
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

        // ========================================================================
        // Category Management Methods
        // ========================================================================

        /**
         * Set the active category and load its content.
         *
         * @param {object} category - The category to activate
         * @param {string} category.id - Unique category identifier
         * @param {string} category.name - Display name
         * @param {boolean} [category.isSpecial] - Whether this is a special category like recents or trending
         * @param {string} [category.searchTerm] - Search term for regular categories
         * @param {boolean} [forceRefresh=false] - Force refresh even if already active
         * @private
         */
        _setActiveCategory(category) {
            this._activeCategory = category;
            this._highlightTab(category.id);

            this._isClearingForCategoryChange = true;
            this._searchComponent.clearSearch();
            this._isClearingForCategoryChange = false;

            // Defer loading until tab is visible to prevent allocation errors
            if (this.mapped) {
                this._loadCategoryContent(category);
                this._focusSearchOrFirstItem();
            }
        }

        /**
         * Load content for the given category.
         *
         * @param {object} category - The category to load
         * @private
         */
        _loadCategoryContent(category) {
            const sessionId = Symbol('loading-session');
            this._currentLoadingSession = sessionId;

            if (category.id === 'recents') {
                this._displayRecents();
            } else if (category.id === 'trending') {
                this._fetchAndDisplayTrending(null, sessionId).catch((e) => {
                    if (this._currentLoadingSession === sessionId) {
                        this._renderErrorState(e.message);
                    }
                });
            } else {
                this._performSearch(category.searchTerm, null, sessionId).catch((e) => {
                    if (this._currentLoadingSession === sessionId) {
                        this._renderErrorState(e.message);
                    }
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
                button.checked = id === categoryId;
            }
        }

        // ========================================================================
        // Content Display Methods
        // ========================================================================

        /**
         * Display the recents GIFs.
         *
         * @private
         */
        _displayRecents() {
            this._nextPos = null;
            const recents = this._recentsManager.getRecents();
            this._showSpinner(false);

            if (recents.length > 0) {
                // Render immediately to avoid empty state
                this._renderGrid(recents, true);
            } else {
                this._renderInfoState(_('No recent GIFs.'));
            }
        }

        /**
         * Fetch and display trending GIFs.
         *
         * @param {string|null} [nextPos=null] - Pagination token for loading more
         * @param {Symbol|null} [sessionId=null] - The session ID to validate against
         * @private
         */
        async _fetchAndDisplayTrending(nextPos = null, sessionId = null) {
            if (sessionId && sessionId !== this._currentLoadingSession) {
                return;
            }

            if (!nextPos) {
                this._renderLoadingState();
            } else {
                this._showSpinner(true);
            }

            try {
                const { results, nextPos: newNextPos } = await this._gifManager.getTrending(nextPos);

                // Check session again after await
                if (sessionId && sessionId !== this._currentLoadingSession) {
                    return;
                }

                this._nextPos = newNextPos;

                if (results.length > 0) {
                    this._renderGrid(results, !nextPos);
                } else if (!nextPos) {
                    this._renderInfoState(_('No trending GIFs found.'));
                }
            } catch (e) {
                // Check session before rendering error
                if (!sessionId || sessionId === this._currentLoadingSession) {
                    this._renderErrorState(e.message);
                }
            } finally {
                // Only hide spinner if we're still in the same session
                if (!sessionId || sessionId === this._currentLoadingSession) {
                    this._showSpinner(false);
                }
            }
        }

        /**
         * Perform a search and display results.
         *
         * @param {string} query - The search query
         * @param {string|null} [nextPos=null] - Pagination token for loading more
         * @param {Symbol|null} [sessionId=null] - The session ID to validate against
         * @private
         */
        async _performSearch(query, nextPos = null, sessionId = null) {
            if (sessionId && sessionId !== this._currentLoadingSession) {
                return;
            }

            if (!nextPos) {
                this._renderLoadingState();
            } else {
                this._showSpinner(true);
            }

            try {
                const { results, nextPos: newNextPos } = await this._gifManager.search(query, nextPos);

                // Check session again after await
                if (sessionId && sessionId !== this._currentLoadingSession) {
                    return;
                }

                this._nextPos = newNextPos;

                if (results.length > 0) {
                    this._renderGrid(results, !nextPos);
                } else if (!nextPos) {
                    this._renderInfoState(_("No results found for '%s'.").format(query));
                }
            } catch (e) {
                if (!sessionId || sessionId === this._currentLoadingSession) {
                    this._renderErrorState(e.message);
                }
            } finally {
                if (!sessionId || sessionId === this._currentLoadingSession) {
                    this._showSpinner(false);
                }
            }
        }

        // ========================================================================
        // Search and Scroll Handlers
        // ========================================================================

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

            // Trim leading/trailing whitespace
            const query = searchText.trim();

            // Only perform a search if the query is non-empty
            if (query.length >= 1) {
                this._currentSearchQuery = query;
                this._searchDebouncer.trigger(query);
            } else if (query.length === 0) {
                // If the query is empty, clear the current search
                this._currentSearchQuery = null;
                this._searchDebouncer.cancel(); // Cancel any pending search

                // Reload the active category content
                if (this._activeCategory) {
                    this._loadCategoryContent(this._activeCategory);
                }
            }
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
                this._loadMoreResults().catch((e) => {
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

            // If we're in search mode, use the search query
            if (this._currentSearchQuery) {
                await this._performSearch(this._currentSearchQuery, this._nextPos, this._currentLoadingSession);
            } else if (this._activeCategory?.id === 'trending') {
                await this._fetchAndDisplayTrending(this._nextPos, this._currentLoadingSession);
            } else if (this._activeCategory?.searchTerm) {
                await this._performSearch(this._activeCategory.searchTerm, this._nextPos, this._currentLoadingSession);
            }

            this._isLoadingMore = false;
        }

        // ========================================================================
        // Grid Rendering Methods
        // ========================================================================

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
                this._itemFactory.startNewSession();
            }

            this._masonryView.addItems(results);
        }

        // ========================================================================
        // UI State Methods
        // ========================================================================

        /**
         * Show the loading state with spinner.
         *
         * @private
         */
        _renderLoadingState() {
            this._showSpinner(true);
            this._masonryView.visible = false;
            this._infoBin.visible = false;

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
            this._masonryView.visible = false;
            this._infoBin.visible = true;
            this._infoLabel.set_style_class_name('aio-clipboard-error-label');
            this._infoLabel.set_text(_('Error: %s\nPlease check your API key and network connection.').format(errorMessage));
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

        // ========================================================================
        // GIF Selection Handler
        // ========================================================================

        /**
         * Handle GIF selection: copy to clipboard and optionally add to recents.
         *
         * @param {Object} gifObject - The selected GIF data
         * @param {string} gifObject.full_url - The full GIF URL
         * @param {string} [gifObject.preview_url] - The preview image URL
         * @param {number} [gifObject.width] - The GIF width
         * @param {number} [gifObject.height] - The GIF height
         * @private
         */
        async _onGifSelected(gifObject) {
            if (!gifObject || !gifObject.full_url) {
                console.error('[AIO-Clipboard] Cannot process selected GIF due to invalid data:', gifObject);
                return;
            }

            await this._downloadService.copyToClipboard(gifObject, this._settings, this._clipboardManager);

            if (gifObject.preview_url && gifObject.width && gifObject.height) {
                const recentItem = {
                    ...gifObject,
                    value: gifObject.full_url,
                };
                this._recentsManager?.addItem(recentItem);
            }

            if (AutoPaster.shouldAutoPaste(this._settings, 'auto-paste-gif')) {
                await getAutoPaster().trigger();
            }

            this._extension._indicator.menu?.close();
        }

        // ========================================================================
        // Lifecycle Methods
        // ========================================================================

        /**
         * Called when the tab is selected/activated.
         *
         * Reloads data if the provider has changed since last activation.
         */
        onTabSelected() {
            this.emit('set-main-tab-bar-visibility', false);

            const currentProvider = this._settings.get_string(GifSettings.PROVIDER_KEY);

            if (this._provider !== currentProvider) {
                this._provider = currentProvider;
                this._loadInitialData().catch((e) => {
                    this._renderErrorState(e.message);
                });
            } else if (this._activeCategory) {
                // Set the active category to ensure content is loaded
                this._setActiveCategory(this._activeCategory);
            }
        }

        /**
         * Clean up all resources.
         */
        destroy() {
            this._isDestroyed = true;

            if (this._httpSession) {
                this._httpSession.abort();
                this._httpSession = null;
            }

            if (this._downloadService) {
                this._downloadService.destroy();
                this._downloadService = null;
            }

            if (this._searchDebouncer) {
                this._searchDebouncer.destroy();
                this._searchDebouncer = null;
            }

            // Clean up signals
            if (this._providerChangedSignalId) {
                this._settings.disconnect(this._providerChangedSignalId);
                this._providerChangedSignalId = 0;
            }

            if (this._alwaysShowTabsSignalId) {
                this._settings.disconnect(this._alwaysShowTabsSignalId);
                this._alwaysShowTabsSignalId = 0;
            }

            if (this._recentsSignalId && this._recentsManager) {
                this._recentsManager.disconnect(this._recentsSignalId);
                this._recentsSignalId = 0;
            }

            if (this._recentsManager) {
                this._recentsManager.destroy();
                this._recentsManager = null;
            }

            this._searchComponent?.destroy();
            this._itemFactory?.destroy();

            super.destroy();
        }
    },
);
