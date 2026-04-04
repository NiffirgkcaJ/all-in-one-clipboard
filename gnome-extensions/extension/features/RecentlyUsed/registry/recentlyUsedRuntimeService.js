import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
import { matchesRecentlyUsedSearch, normalizeRecentlyUsedSearchQuery } from '../utilities/recentlyUsedSearch.js';
import { getRecentlyUsedOrderedSections, getRecentlyUsedSectionById, getRecentlyUsedSectionOrder, initializeRecentlyUsedRegistry } from './recentlyUsedRegistry.js';

/**
 * Manages Recently Used section lifecycle, rendering data, and signal wiring.
 */
export class RecentlyUsedRuntimeService {
    /**
     * Creates a runtime service instance.
     *
     * @param {object} scope Initialization options.
     * @param {object} scope.extension Extension instance.
     * @param {Gio.Settings} scope.settings Extension settings object.
     * @param {Function} scope.onRender Callback to trigger UI updates.
     */
    constructor({ extension, settings, onRender }) {
        this._extension = extension;
        this._settings = settings;
        this._onRender = typeof onRender === 'function' ? onRender : null;
        this._signalIds = [];
        this._started = false;
        this._searchRequestSeq = 0;
        this._sectionSearchState = new Map();
    }

    /**
     * Starts the runtime service and initializes all plugins.
     *
     * @returns {Promise<void>} Resolves when startup is complete.
     */
    async start() {
        if (this._started) {
            return;
        }

        await initializeRecentlyUsedRegistry();
        await this._initializePlugins();
        this._connectSignals();
        this._started = true;
    }

    /**
     * Returns ordered section ids.
     *
     * @returns {Array<string>} Ordered section ids.
     */
    getSectionOrder() {
        return getRecentlyUsedSectionOrder();
    }

    /**
     * Builds lightweight section scaffold data.
     *
     * @param {string} sectionId Section id.
     * @returns {object|null} Section scaffold or null.
     */
    getSectionScaffold(sectionId) {
        const sectionConfig = getRecentlyUsedSectionById(sectionId);
        if (!sectionConfig) {
            return null;
        }

        return {
            id: sectionConfig.id,
            title: this._resolveSectionTitle(sectionConfig),
            targetTab: sectionConfig.targetTab || sectionConfig.id,
        };
    }

    /**
     * Returns ordered section definitions.
     *
     * @returns {Array<object>} Ordered section definitions.
     */
    getOrderedSections() {
        return getRecentlyUsedOrderedSections();
    }

    /**
     * Builds the render model for a section.
     *
     * @param {string} sectionId Section id.
     * @param {object} viewRuntimeContext View runtime context.
     * @returns {object|null} Render model or null.
     */
    getSectionRenderModel(sectionId, viewRuntimeContext = {}) {
        const sectionConfig = getRecentlyUsedSectionById(sectionId);
        if (!sectionConfig) {
            return null;
        }

        const searchQuery = normalizeRecentlyUsedSearchQuery(viewRuntimeContext.searchQuery);

        const runtimeContext = {
            settings: this._settings,
            extension: this._extension,
            widgetFactory: viewRuntimeContext.widgetFactory,
            renderSession: viewRuntimeContext.renderSession,
            currentRenderSession: viewRuntimeContext.currentRenderSession,
            searchQuery,
        };

        if (typeof sectionConfig.isEnabled === 'function' && !sectionConfig.isEnabled(runtimeContext)) {
            return {
                visible: false,
                effectiveLayout: sectionConfig.layoutType,
                items: [],
                nestedLayout: this._resolveNestedLayout(sectionConfig),
            };
        }

        const sourceItems = this._resolveSectionSourceItems(sectionConfig, runtimeContext, searchQuery);
        if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
            return {
                visible: false,
                effectiveLayout: sectionConfig.layoutType,
                items: [],
                nestedLayout: this._resolveNestedLayout(sectionConfig),
            };
        }

        const mapItem = typeof sectionConfig.mapItem === 'function' ? sectionConfig.mapItem : (item) => item;
        const mappedItems = sourceItems.map((item) => mapItem(item));
        const filteredItems = searchQuery.length > 0 ? mappedItems.filter((item) => this._matchesSectionSearch(sectionConfig, item, searchQuery, runtimeContext)) : mappedItems;

        if (filteredItems.length === 0) {
            return {
                visible: false,
                effectiveLayout: sectionConfig.layoutType,
                items: [],
                nestedLayout: this._resolveNestedLayout(sectionConfig),
            };
        }

        const effectiveLayout = this._resolveEffectiveLayout(sectionConfig, filteredItems.length);
        const maxDisplay = sectionConfig.source?.maxItems ?? RecentlyUsedUI.MAX_SECTION_DISPLAY_COUNT;
        const items = effectiveLayout === 'nested' ? filteredItems : filteredItems.slice(0, maxDisplay);

        return {
            visible: true,
            effectiveLayout,
            items,
            nestedLayout: this._resolveNestedLayout(sectionConfig),
            listContentRenderer: typeof sectionConfig.renderListContent === 'function' ? (args) => sectionConfig.renderListContent(args) : null,
            gridIconResolver: typeof sectionConfig.resolveGridIcon === 'function' ? (iconKind) => sectionConfig.resolveGridIcon(iconKind) : null,
            onGridItemCreated:
                typeof sectionConfig.onGridItemCreated === 'function'
                    ? ({ item, widget }) =>
                          sectionConfig.onGridItemCreated({
                              item,
                              widget,
                              renderSession: viewRuntimeContext.renderSession,
                              currentRenderSession: viewRuntimeContext.currentRenderSession,
                              widgetFactory: viewRuntimeContext.widgetFactory,
                          })
                    : null,
        };
    }

    /**
     * Delegates item click handling to the section definition.
     *
     * @param {object} itemData Clicked item payload.
     * @param {string} sectionId Section id.
     * @returns {Promise<boolean>} True when click handling succeeds.
     */
    async handleItemClick(itemData, sectionId) {
        const sectionDefinition = getRecentlyUsedSectionById(sectionId);

        if (typeof sectionDefinition?.onClick !== 'function') {
            return false;
        }

        try {
            return Boolean(
                await sectionDefinition.onClick({
                    itemData,
                    settings: this._settings,
                    extension: this._extension,
                }),
            );
        } catch (e) {
            console.error(`[AIO-Clipboard] Failed to process click for ${sectionId}:`, e);
            return false;
        }
    }

    /**
     * Stops the runtime service and disconnects resources.
     */
    stop() {
        const sectionDefinitions = this.getOrderedSections();
        for (const section of sectionDefinitions) {
            if (typeof section.destroy !== 'function') {
                continue;
            }

            try {
                section.destroy();
            } catch {
                // ignore error during destroy
            }
        }

        this._disconnectSignals();
        this._sectionSearchState.clear();
        this._started = false;
    }

    /**
     * Resolves source items for a section using optional async query API.
     *
     * If a section provides `searchItems`, this method starts or reuses a search
     * request for the active query, while returning local items as an immediate
     * fallback until remote results arrive.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {object} runtimeContext Runtime context.
     * @param {string} searchQuery Normalized query string.
     * @returns {Array<object>} Source items for current render pass.
     * @private
     */
    _resolveSectionSourceItems(sectionConfig, runtimeContext, searchQuery) {
        const localItemsRaw = typeof sectionConfig.getItems === 'function' ? sectionConfig.getItems(runtimeContext) : [];
        const localItems = Array.isArray(localItemsRaw) ? localItemsRaw : [];

        if (!searchQuery || typeof sectionConfig.searchItems !== 'function' || !sectionConfig.id) {
            return localItems;
        }

        const sectionId = sectionConfig.id;
        const currentState = this._sectionSearchState.get(sectionId);

        if (currentState?.query === searchQuery) {
            if (currentState.status === 'ready') {
                return currentState.items;
            }

            if (currentState.status === 'pending') {
                return currentState.fallbackItems;
            }
        }

        const requestId = ++this._searchRequestSeq;
        this._sectionSearchState.set(sectionId, {
            query: searchQuery,
            requestId,
            status: 'pending',
            fallbackItems: localItems,
            items: [],
        });

        Promise.resolve(sectionConfig.searchItems({ query: searchQuery, runtimeContext }))
            .then((items) => {
                const latestState = this._sectionSearchState.get(sectionId);
                if (!latestState || latestState.requestId !== requestId) {
                    return;
                }

                this._sectionSearchState.set(sectionId, {
                    ...latestState,
                    status: 'ready',
                    items: Array.isArray(items) ? items : [],
                });

                this._onRender?.();
            })
            .catch(() => {
                const latestState = this._sectionSearchState.get(sectionId);
                if (!latestState || latestState.requestId !== requestId) {
                    return;
                }

                this._sectionSearchState.set(sectionId, {
                    ...latestState,
                    status: 'ready',
                    items: [],
                });

                this._onRender?.();
            });

        return localItems;
    }

    /**
     * Initializes all section plugins.
     *
     * @private
     */
    async _initializePlugins() {
        const sectionDefinitions = this.getOrderedSections();

        await Promise.all(
            sectionDefinitions.map(async (section) => {
                if (typeof section.initialize !== 'function') {
                    return;
                }

                try {
                    await section.initialize({
                        extensionUuid: this._extension.uuid,
                        extensionPath: this._extension.path,
                        settings: this._settings,
                    });
                } catch (e) {
                    console.error(`[AIO-Clipboard] Failed to initialize plugin ${section.id}:`, e);
                }
            }),
        );
    }

    /**
     * Connects plugin-provided signals.
     *
     * @private
     */
    _connectSignals() {
        this._disconnectSignals();

        const sectionDefinitions = this.getOrderedSections();
        for (const section of sectionDefinitions) {
            if (typeof section.getSignals !== 'function') {
                continue;
            }

            const signals =
                section.getSignals({
                    extension: this._extension,
                    settings: this._settings,
                    onRender: this._onRender,
                }) || [];
            this._signalIds.push(...signals);
        }
    }

    /**
     * Resolves effective layout using optional transition rules.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {number} itemCount Number of mapped items.
     * @returns {string} Effective layout id.
     * @private
     */
    _resolveEffectiveLayout(sectionConfig, itemCount) {
        const transition = sectionConfig?.layoutTransition;
        if (transition && transition.above && itemCount > transition.threshold) {
            return transition.above;
        }

        return sectionConfig?.layoutType || 'list';
    }

    /**
     * Resolves the section display title.
     *
     * @param {object} sectionConfig Section configuration.
     * @returns {string} Section title.
     * @private
     */
    _resolveSectionTitle(sectionConfig) {
        if (typeof sectionConfig?.resolveTitle === 'function') {
            return sectionConfig.resolveTitle();
        }

        return sectionConfig?.titleKey || sectionConfig?.id || '';
    }

    /**
     * Resolves nested layout settings for a section.
     *
     * @param {object} sectionConfig Section configuration.
     * @returns {object} Nested layout settings.
     * @private
     */
    _resolveNestedLayout(sectionConfig) {
        return {
            maxVisible: sectionConfig?.layoutPolicy?.maxVisible ?? sectionConfig?.source?.maxItems ?? RecentlyUsedUI.MAX_NESTED_DISPLAY_COUNT,
            itemHeight: sectionConfig?.layoutPolicy?.itemHeight ?? RecentlyUsedUI.NESTED_ITEM_HEIGHT,
        };
    }

    /**
     * Runs section-specific search when available, otherwise falls back to generic matching.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {object|string|number|null|undefined} item Candidate item.
     * @param {string} query Normalized query string.
     * @param {object} runtimeContext Runtime context.
     * @returns {boolean} True when the item matches.
     * @private
     */
    _matchesSectionSearch(sectionConfig, item, query, runtimeContext) {
        if (typeof sectionConfig?.matchesSearch === 'function') {
            try {
                return Boolean(
                    sectionConfig.matchesSearch({
                        item,
                        query,
                        runtimeContext,
                        fallbackMatch: (candidate) => matchesRecentlyUsedSearch({ item: candidate, query }),
                    }),
                );
            } catch {
                // Fall back to generic matching when a custom matcher fails.
            }
        }

        return matchesRecentlyUsedSearch({ item, query });
    }

    /**
     * Disconnects all previously connected plugin signals.
     *
     * @private
     */
    _disconnectSignals() {
        if (!Array.isArray(this._signalIds)) {
            this._signalIds = [];
            return;
        }

        this._signalIds.forEach(({ obj, id }) => {
            if (!obj || !id || typeof obj.disconnect !== 'function') {
                return;
            }

            try {
                if (typeof obj.signal_handler_is_connected === 'function' && !obj.signal_handler_is_connected(id)) {
                    return;
                }
                obj.disconnect(id);
            } catch {
                // ignore error during disconnect
            }
        });

        this._signalIds = [];
    }
}
