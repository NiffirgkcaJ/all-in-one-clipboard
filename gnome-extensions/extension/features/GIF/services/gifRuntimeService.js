import Clutter from 'gi://Clutter';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ResourcePath } from '../../../shared/constants/storagePaths.js';

import { GifSettings, GifUI } from '../constants/gifConstants.js';

/**
 * GifRuntimeService
 *
 * The main orchestrator for the GIF module lifecycle.
 * It manages initialization, category switching between trending and categories, provider branding, and online or offline mode.
 * It delegates search operations to GifSearchService and selection to GifSelectionService.
 */
export class GifRuntimeService {
    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * @param {Gio.Settings} settings Extension settings.
     * @param {object} components UI components and services.
     * @param {GifHeaderView} components.headerView The header view.
     * @param {GifContentView} components.contentView The main content view.
     * @param {SearchComponent} components.searchComponent The search component.
     * @param {St.BoxLayout} components.infoBar The info bar for offline mode.
     * @param {GifManager} components.gifManager The data manager.
     * @param {GifFetchService} components.fetchService The data fetching bus.
     * @param {GifSearchService} components.searchService The search service.
     * @param {GifSelectionService} components.selectionService The selection service.
     */
    constructor(settings, components) {
        this._settings = settings;

        this._headerView = components.headerView;
        this._contentView = components.contentView;
        this._searchComponent = components.searchComponent;
        this._infoBar = components.infoBar;
        this._gifManager = components.gifManager;
        this._fetchService = components.fetchService;
        this._searchService = components.searchService;
        this._selectionService = components.selectionService;

        this._providerChangedSignalId = 0;
        this._provider = this._settings.get_string(GifSettings.PROVIDER_KEY);

        this._setupConnections();
        this._connectProviderChangedSignal();
    }

    // ========================================================================
    // Connections
    // ========================================================================

    /**
     * Bind core UI and Data signals.
     * @private
     */
    _setupConnections() {
        // Category Changes
        this._headerView.connect('category-changed', (header, categoryData) => {
            const category = categoryData.get_properties ? Object.fromEntries(categoryData.list_properties().map((p) => [p.name, categoryData[p.name]])) : categoryData;
            this._onCategoryChanged(category);
        });

        // Results from Trending and Category Fetches
        this._fetchService.connect('results-loaded', (emitter, data) => {
            if (!this._searchService.isActive()) {
                this._onDataLoaded(data);
            }
        });

        this._fetchService.connect('loading-state-changed', (emitter, isLoading, isAppending) => {
            this._onLoadingStateChange(isLoading, isAppending);
        });

        this._fetchService.connect('error-occurred', (emitter, errorMsg) => {
            this._contentView.showErrorState(errorMsg);
        });

        // Item Selection
        this._contentView.connect('item-activated', (emitter, itemData) => {
            this._selectionService.handleSelection(itemData);
        });

        // Infinite Scroll
        this._contentView.connect('load-more', () => {
            const activeCat = this._headerView.getActiveCategory();
            if (activeCat?.id === 'recents') return;

            const sessionId = this._fetchService.getCurrentSession();
            this._fetchService.fetchMore(sessionId);
        });
    }

    // ========================================================================
    // Module Lifecycle
    // ========================================================================

    /**
     * Start the initial data load process.
     */
    async loadInitialData() {
        try {
            await this._loadInitialDataInternal();
        } catch (e) {
            this._contentView.showErrorState(e.message);
        }
    }

    /**
     * Connect to the provider changed signal.
     * @private
     */
    _connectProviderChangedSignal() {
        this._providerChangedSignalId = this._settings.connect(`changed::${GifSettings.PROVIDER_KEY}`, () => {
            if (this._contentView.mapped) {
                this._provider = this._settings.get_string(GifSettings.PROVIDER_KEY);
                this._loadInitialDataInternal().catch((e) => this._contentView.showErrorState(e.message));
            }
        });
    }

    // ========================================================================
    // Branding & Offline Logic
    // ========================================================================

    /**
     * Updates provider branding elements on the search bar.
     * @private
     */
    _updateProviderBranding() {
        const attribution = this._gifManager.getActiveProviderAttribution();
        const providerName = this._gifManager.getActiveProviderName();
        const brandPath = `${ResourcePath.LOGOS}/${this._provider}`;

        if (attribution?.search_icon) {
            this._searchComponent.setHint({
                text: _('Search'),
                logo: { icon: attribution.search_icon, height: attribution.search_icon_height ?? GifUI.DEFAULT_LOGO_HEIGHT, basePath: brandPath },
                spacing: GifUI.SEARCH_HINT_SPACING,
            });
        } else {
            this._searchComponent.setHint({
                text: providerName ? _('Search %s...').format(providerName) : _('Search...'),
            });
        }
    }

    /**
     * Set the UI to offline mode.
     * @private
     */
    _setOfflineMode() {
        this._infoBar.visible = true;
        this._setSearchVisibility(false);

        const recentsData = this._headerView.getCategoryData('recents');
        if (recentsData) {
            this._headerView.setActiveCategory(recentsData);
        }
    }

    /**
     * Set the UI to online mode.
     * @private
     */
    _setOnlineMode() {
        this._infoBar.visible = false;
        this._setSearchVisibility(true);
    }

    /**
     * Sets visibility of the search bar.
     * @param {boolean} isVisible Whether the search bar should be visible.
     * @private
     */
    _setSearchVisibility(isVisible) {
        const widget = this._searchComponent.getWidget();
        if (widget) {
            widget.visible = !!isVisible;
            widget.can_focus = !!isVisible;
        }
    }

    // ========================================================================
    // Action Handlers
    // ========================================================================

    /**
     * Handle category changed event.
     * @param {object} category The selected category data.
     * @private
     */
    _onCategoryChanged(category) {
        this._searchService.setClearingForCategory(true);
        this._searchService.clearSearch();
        this._searchService.setClearingForCategory(false);

        const sessionId = this._fetchService.startNewSession();

        if (category.id === 'recents') {
            this._displayRecents();
        } else if (category.id === 'trending') {
            this._fetchService.fetchTrending(sessionId);
        } else {
            this._fetchService.fetchSearch(category.searchTerm, sessionId);
        }

        if (this._contentView.mapped) {
            this._focusSearchOrFirstItem();
        }
    }

    /**
     * Focus search bar or grid content.
     * @private
     */
    _focusSearchOrFirstItem() {
        const searchWidget = this._searchComponent.getWidget();
        if (searchWidget?.visible) {
            this._searchComponent.grabFocus();
        } else if (!this._contentView.focusFirstItem()) {
            this._headerView.focusFirst();
        }
    }

    // ========================================================================
    // Data Management
    // ========================================================================

    /**
     * Displays recents from the selection service.
     * @private
     */
    _displayRecents() {
        this._fetchService.cancelPendingRequests();

        const recents = this._selectionService.getRecents();

        if (recents.length > 0) {
            this._contentView.renderGrid(recents, true);
            this._contentView.showSpinner(false);
        } else {
            this._contentView.showInfoState(_('No recent GIFs.'));
        }
    }

    /**
     * Internal load initial data logic.
     * @private
     */
    async _loadInitialDataInternal() {
        await this._gifManager.ensureReady();

        this._updateProviderBranding();
        this._headerView.clearCategories();

        this._selectionService.initializeRecents(() => {
            const activeCat = this._headerView.getActiveCategory();
            if (activeCat?.id === 'recents') {
                this._displayRecents();
            }
        });
        this._headerView.addRecentsButton();

        if (this._provider === 'none') {
            this._setOfflineMode();
            return;
        }

        this._setOnlineMode();
        this._headerView.addTrendingButton();

        const trendingData = this._headerView.getCategoryData('trending');
        if (trendingData) {
            this._headerView.setActiveCategory(trendingData);
        } else {
            this._contentView.showInfoState(_('No categories available.'));
        }

        const categories = await this._fetchService.fetchCategories();
        if (categories) {
            for (const category of categories) {
                this._headerView.addCategoryButton(category);
            }
        }
    }

    /**
     * Callback for successful category fetches.
     * @param {object} data The loaded data.
     * @private
     */
    _onDataLoaded({ results, isAppend }) {
        if (results.length > 0) {
            this._contentView.renderGrid(results, !isAppend);
        } else if (!isAppend) {
            this._contentView.showInfoState(_('No trending GIFs found.'));
        }
    }

    /**
     * Callback for loading state changes.
     * @param {boolean} isLoading Whether data is loading.
     * @param {boolean} isAppending Whether this is a pagination append.
     * @private
     */
    _onLoadingStateChange(isLoading, isAppending) {
        if (isLoading) {
            if (!isAppending) {
                this._contentView.showLoadingState();
            } else {
                this._contentView.showSpinner(true);
            }
        } else {
            this._contentView.showSpinner(false);
        }
    }

    // ========================================================================
    // Public API & External Integrations
    // ========================================================================

    /**
     * Tab activation lifecycle.
     */
    onTabSelected() {
        const currentProvider = this._settings.get_string(GifSettings.PROVIDER_KEY);

        if (this._provider !== currentProvider) {
            this._provider = currentProvider;
            this._loadInitialDataInternal().catch((e) => this._contentView.showErrorState(e.message));
        } else {
            const activeCat = this._headerView.getActiveCategory();
            if (activeCat && !this._searchService.isActive()) {
                this._headerView.setActiveCategory(activeCat);
            }
        }

        this._focusSearchOrFirstItem();
    }

    /**
     * Global key event routing.
     * @param {Clutter.Event} event The key press event.
     * @returns {number} Clutter event propagation flag.
     */
    handleGlobalEvent(event) {
        if (this._headerView && this._headerView.handleGlobalCategoryCycle(event)) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Cleanup.
     */
    destroy() {
        if (this._providerChangedSignalId) {
            this._settings.disconnect(this._providerChangedSignalId);
            this._providerChangedSignalId = 0;
        }
    }
}
