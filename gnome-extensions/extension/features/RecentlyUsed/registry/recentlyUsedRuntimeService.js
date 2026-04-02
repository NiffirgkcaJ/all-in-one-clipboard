import { RecentlyUsedUI } from '../constants/recentlyUsedConstants.js';
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

        const runtimeContext = {
            settings: this._settings,
            extension: this._extension,
            widgetFactory: viewRuntimeContext.widgetFactory,
            renderSession: viewRuntimeContext.renderSession,
            currentRenderSession: viewRuntimeContext.currentRenderSession,
        };

        if (typeof sectionConfig.isEnabled === 'function' && !sectionConfig.isEnabled(runtimeContext)) {
            return {
                visible: false,
                effectiveLayout: sectionConfig.layoutType,
                items: [],
                nestedLayout: this._resolveNestedLayout(sectionConfig),
            };
        }

        const sourceItems = typeof sectionConfig.getItems === 'function' ? sectionConfig.getItems(runtimeContext) : [];
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
        const effectiveLayout = this._resolveEffectiveLayout(sectionConfig, mappedItems.length);
        const maxDisplay = sectionConfig.source?.maxItems ?? RecentlyUsedUI.MAX_SECTION_DISPLAY_COUNT;
        const items = effectiveLayout === 'nested' ? mappedItems : mappedItems.slice(0, maxDisplay);

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
        this._started = false;
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
