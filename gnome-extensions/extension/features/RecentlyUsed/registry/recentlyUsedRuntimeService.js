import { normalizeRecentlyUsedSearchQuery } from '../utilities/recentlyUsedSearch.js';
import { resolveRecentlyUsedSectionPolicy } from '../utilities/recentlyUsedDisplayPolicyResolver.js';
import { RecentlyUsedDisplayMode } from '../constants/recentlyUsedPolicyConstants.js';
import { resolveRecentlyUsedBaseLayout, resolveRecentlyUsedDisplayLayout, resolveRecentlyUsedSectionLayouts } from './recentlyUsedLayoutResolver.js';
import { RecentlyUsedSearchStateManager } from './recentlyUsedSearchStateManager.js';
import { RecentlyUsedSignalManager } from './recentlyUsedSignalManager.js';
import { getRecentlyUsedOrderedSections, getRecentlyUsedSectionOrder, initializeRecentlyUsedRegistry } from './recentlyUsedRegistry.js';

/**
 * Normalizes a value to a positive integer, returning fallback when invalid.
 *
 * @param {*} value Input value.
 * @param {number} fallback Fallback value.
 * @returns {number} Positive integer or fallback.
 */
function resolvePositiveInt(value, fallback) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Manages Recently Used section lifecycle, rendering data, and signal wiring.
 */
export class RecentlyUsedRuntimeService {
    // ========================================================================
    // Lifecycle
    // ========================================================================

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
        this._started = false;
        this._orderedSections = [];
        this._sectionsById = new Map();
        this._searchStateManager = new RecentlyUsedSearchStateManager({
            onRender: () => this._onRender?.(),
        });
        this._signalManager = new RecentlyUsedSignalManager({
            getOrderedSections: () => this.getOrderedSections(),
            extension: this._extension,
            settings: this._settings,
            onRender: () => this._onRender?.(),
        });
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
        this._materializeSectionDefinitions();
        await this._initializePlugins();
        this._signalManager.connect();
        this._started = true;
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

        this._signalManager.disconnect();
        this._searchStateManager.clear();
        this._orderedSections = [];
        this._sectionsById = new Map();
        this._started = false;
    }

    /**
     * Builds runtime-scoped section definitions from registry templates.
     *
     * @private
     */
    _materializeSectionDefinitions() {
        const orderedTemplates = getRecentlyUsedOrderedSections();
        const materializedSections = orderedTemplates
            .map((sectionDefinition) => this._instantiateSectionDefinition(sectionDefinition))
            .filter((sectionDefinition) => sectionDefinition && typeof sectionDefinition.id === 'string');

        this._orderedSections = materializedSections;
        this._sectionsById = new Map(materializedSections.map((sectionDefinition) => [sectionDefinition.id, sectionDefinition]));
    }

    /**
     * Instantiates a section definition when a section factory is available.
     *
     * @param {object} sectionDefinition Section definition template.
     * @returns {object|null} Runtime section definition.
     * @private
     */
    _instantiateSectionDefinition(sectionDefinition) {
        if (!sectionDefinition || typeof sectionDefinition !== 'object') {
            return null;
        }

        if (typeof sectionDefinition.createInstance !== 'function') {
            return sectionDefinition;
        }

        try {
            const instance = sectionDefinition.createInstance();
            if (!instance || typeof instance !== 'object') {
                console.warn(`[AIO-Clipboard] Recently Used section '${sectionDefinition.id || '<unknown>'}' createInstance() returned a non-object value.`);
                return sectionDefinition;
            }

            const instanceId = typeof instance.id === 'string' && instance.id.length > 0 ? instance.id : sectionDefinition.id;
            if (instanceId !== sectionDefinition.id) {
                console.warn(`[AIO-Clipboard] Recently Used section '${sectionDefinition.id || '<unknown>'}' createInstance() returned mismatched id '${instanceId}'. Using template id.`);
            }

            return {
                ...sectionDefinition,
                ...instance,
                id: sectionDefinition.id,
            };
        } catch (e) {
            const message = e?.message ?? String(e);
            console.warn(`[AIO-Clipboard] Failed to instantiate Recently Used section '${sectionDefinition.id || '<unknown>'}': ${message}`);
            return sectionDefinition;
        }
    }

    /**
     * Retrieves a runtime section definition by ID.
     *
     * @param {string} sectionId Section id.
     * @returns {object|null} Section definition.
     * @private
     */
    _getSectionById(sectionId) {
        return this._sectionsById.get(sectionId) || null;
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

    // ========================================================================
    // Public API
    // ========================================================================

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
        const sectionConfig = this._getSectionById(sectionId);
        if (!sectionConfig) {
            return null;
        }

        return {
            id: sectionConfig.id,
            title: this._resolveSectionBrowseTitle(sectionConfig),
            targetTab: sectionConfig.targetTab || sectionConfig.id,
        };
    }

    /**
     * Returns ordered section definitions.
     *
     * @returns {Array<object>} Ordered section definitions.
     */
    getOrderedSections() {
        return this._orderedSections;
    }

    /**
     * Builds the render model for a section.
     *
     * @param {string} sectionId Section id.
     * @param {object} viewRuntimeContext View runtime context.
     * @returns {object|null} Render model or null.
     */
    getSectionRenderModel(sectionId, viewRuntimeContext = {}) {
        const sectionConfig = this._getSectionById(sectionId);
        if (!sectionConfig) {
            return null;
        }

        const baseSectionTitle = this._resolveSectionBrowseTitle(sectionConfig);
        const searchQuery = normalizeRecentlyUsedSearchQuery(viewRuntimeContext.searchQuery);
        const baseLayout = resolveRecentlyUsedBaseLayout(sectionConfig);
        const invisibleModel = { visible: false, items: [], totalMatchCount: 0, sectionTitle: baseSectionTitle };

        const runtimeContext = {
            settings: this._settings,
            extension: this._extension,
            widgetFactory: viewRuntimeContext.widgetFactory,
            renderSession: viewRuntimeContext.renderSession,
            currentRenderSession: viewRuntimeContext.currentRenderSession,
            searchQuery,
        };

        if (typeof sectionConfig.isEnabled === 'function' && !sectionConfig.isEnabled(runtimeContext)) {
            return invisibleModel;
        }

        const sourceItems = this._searchStateManager.resolveSectionSourceItems(sectionConfig, runtimeContext, searchQuery);
        if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
            return invisibleModel;
        }

        const mapItem = typeof sectionConfig.mapItem === 'function' ? sectionConfig.mapItem : (item) => item;
        const mappedItems = sourceItems.map((item) => mapItem(item));
        const filteredItems = searchQuery.length > 0 ? mappedItems.filter((item) => this._searchStateManager.matchesSectionSearch(sectionConfig, item, searchQuery, runtimeContext)) : mappedItems;

        if (filteredItems.length === 0) {
            return invisibleModel;
        }

        return this._buildVisibleRenderModel(sectionConfig, filteredItems, {
            searchQuery,
            baseLayout,
            baseSectionTitle,
            viewRuntimeContext,
        });
    }

    /**
     * Delegates item click handling to the section definition.
     *
     * @param {object} itemData Clicked item payload.
     * @param {string} sectionId Section id.
     * @returns {Promise<boolean>} True when click handling succeeds.
     */
    async handleItemClick(itemData, sectionId) {
        const sectionDefinition = this._getSectionById(sectionId);

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

    // ========================================================================
    // Render Model
    // ========================================================================

    /**
     * Builds the visible render model after items have passed filtering.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {Array<object>} filteredItems Items that passed search filtering.
     * @param {object} context Build context.
     * @param {string} context.searchQuery Normalized search query.
     * @param {string} context.baseLayout Base layout type.
     * @param {string} context.baseSectionTitle Browse-mode section title.
     * @param {object} context.viewRuntimeContext Original view runtime context.
     * @returns {object} Visible render model.
     * @private
     */
    _buildVisibleRenderModel(sectionConfig, filteredItems, { searchQuery, baseLayout, baseSectionTitle, viewRuntimeContext }) {
        const totalMatchCount = filteredItems.length;
        const resolvedPolicy = this._resolveSectionPolicy(sectionConfig, {
            searchQuery,
            effectiveLayout: baseLayout,
        });
        const effectiveLayout = resolveRecentlyUsedDisplayLayout(sectionConfig, baseLayout, resolvedPolicy);
        const effectiveCap = resolvePositiveInt(resolvedPolicy?.limits?.effectiveCap, filteredItems.length);
        const windowLimit = resolvePositiveInt(resolvedPolicy?.limits?.windowLimit, filteredItems.length);
        const cappedItems = filteredItems.slice(0, effectiveCap);
        const items = resolvedPolicy?.displayMode === RecentlyUsedDisplayMode.FIXED_WINDOW ? cappedItems.slice(0, windowLimit) : cappedItems;
        const { gridLayout, listLayout, nestedLayout } = resolveRecentlyUsedSectionLayouts(sectionConfig, resolvedPolicy);

        return {
            visible: true,
            effectiveLayout,
            items,
            totalMatchCount,
            sectionTitle: this._resolveSectionDisplayTitle(sectionConfig, {
                searchQuery,
                totalMatchCount,
                baseTitle: baseSectionTitle,
            }),
            resolvedPolicy,
            gridLayout,
            listLayout,
            nestedLayout,
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

    // ========================================================================
    // Policy Resolution
    // ========================================================================

    /**
     * Resolves policy for a section and context using the centralized resolver.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {object} context Resolver context.
     * @param {string} context.searchQuery Normalized search query.
     * @param {string} context.effectiveLayout Effective layout type.
     * @returns {object} Resolved policy model.
     * @private
     */
    _resolveSectionPolicy(sectionConfig, { searchQuery, effectiveLayout }) {
        const contextMode = typeof searchQuery === 'string' && searchQuery.length > 0 ? 'search' : 'history';

        return resolveRecentlyUsedSectionPolicy({
            settings: this._settings,
            sectionId: sectionConfig?.id,
            sectionConfig,
            contextMode,
            effectiveLayout,
        });
    }

    // ========================================================================
    // Title Resolution
    // ========================================================================

    /**
     * Resolves a section title for browse mode (no active search query).
     *
     * @param {object} sectionConfig Section configuration.
     * @returns {string} Section browse title.
     * @private
     */
    _resolveSectionBrowseTitle(sectionConfig) {
        const browseTitleResolver = sectionConfig?.titlePolicy?.browseTitle;
        if (typeof browseTitleResolver === 'function') {
            return browseTitleResolver();
        }

        return sectionConfig?.title || sectionConfig?.id || '';
    }

    /**
     * Resolves a section title for search mode.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {string} fallbackTitle Fallback title when no search resolver is defined.
     * @returns {string} Section search title.
     * @private
     */
    _resolveSectionSearchTitle(sectionConfig, fallbackTitle) {
        const searchTitleResolver = sectionConfig?.titlePolicy?.searchTitle;
        if (typeof searchTitleResolver === 'function') {
            return searchTitleResolver();
        }

        return fallbackTitle;
    }

    /**
     * Resolves the section display title based on browse/search mode and count formatting policy.
     *
     * @param {object} sectionConfig Section configuration.
     * @param {object} context Title resolution context.
     * @param {string} context.searchQuery Normalized search query.
     * @param {number} context.totalMatchCount Match count before display truncation.
     * @param {string} context.baseTitle Browse-mode fallback title.
     * @returns {string} Section display title.
     * @private
     */
    _resolveSectionDisplayTitle(sectionConfig, { searchQuery, totalMatchCount, baseTitle }) {
        const hasActiveSearch = typeof searchQuery === 'string' && searchQuery.length > 0;
        if (!hasActiveSearch) {
            return baseTitle;
        }

        const searchTitle = this._resolveSectionSearchTitle(sectionConfig, baseTitle);
        const searchCountMode = sectionConfig?.titlePolicy?.searchCountMode || 'inline';

        if (searchCountMode !== 'inline') {
            return searchTitle;
        }

        const safeTotalMatchCount = Number.isFinite(totalMatchCount) && totalMatchCount >= 0 ? Math.floor(totalMatchCount) : 0;
        return `${searchTitle} (${safeTotalMatchCount})`;
    }
}
