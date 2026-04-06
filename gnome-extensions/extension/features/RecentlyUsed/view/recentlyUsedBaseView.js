import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { Debouncer } from '../../../shared/utilities/utilityDebouncer.js';
import { FocusUtils } from '../../../shared/utilities/utilityFocus.js';
import { SearchComponent } from '../../../shared/utilities/utilitySearch.js';

import { RecentlyUsedBaseWidgetFactory } from './recentlyUsedBaseWidgetFactory.js';
import { RecentlyUsedScrollLockController } from '../utilities/recentlyUsedScrollLockController.js';
import { renderRecentlyUsedGridSection } from './recentlyUsedGridSectionView.js';
import { renderRecentlyUsedListSection } from './recentlyUsedListSectionView.js';
import { renderRecentlyUsedNestedSection } from './recentlyUsedNestedSectionView.js';
import { queueSearchHandoff } from '../../../shared/services/serviceSearchHub.js';
import { RecentlyUsedUI, RecentlyUsedStyles } from '../constants/recentlyUsedConstants.js';

/**
 * RecentlyUsedBaseView
 *
 * Owns the Recently Used UI surface and delegates section rendering
 * to dedicated layout-specific section view modules.
 *
 * @fires navigate-to-main-tab Emitted when a section "Show All" is clicked
 */
export const RecentlyUsedBaseView = GObject.registerClass(
    {
        Signals: {
            'navigate-to-main-tab': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class RecentlyUsedBaseView extends St.BoxLayout {
        /**
         * @param {object} options
         * @param {Gio.Settings} options.settings
         * @param {object} options.extension
         * @param {object} options.sectionProvider
         * @param {Function} options.sectionProvider.getSectionOrder
         * @param {Function} options.sectionProvider.getSectionScaffold
         * @param {Function} options.sectionProvider.getSectionRenderModel
         * @param {Function} options.onItemClicked
         * @param {Function} options.onOpenPreferences
         */
        constructor({ settings, extension, sectionProvider, onItemClicked, onOpenPreferences }) {
            super({
                vertical: true,
                style_class: RecentlyUsedStyles.TAB_CONTENT,
                x_expand: true,
                y_expand: true,
            });

            this._settings = settings;
            this._extension = extension;
            this._sectionProvider = {
                getSectionOrder: sectionProvider?.getSectionOrder || (() => []),
                getSectionScaffold: sectionProvider?.getSectionScaffold || (() => null),
                getSectionRenderModel: sectionProvider?.getSectionRenderModel || (() => null),
            };
            this._onItemClicked = onItemClicked;
            this._onOpenPreferences = onOpenPreferences;

            this._sections = {};
            this._focusGrid = [];
            this._renderSession = null;
            this._nestedSectionWidgets = new Set();
            this._previousFocus = null;
            this._scrollIntoViewIdleId = 0;
            this._lockTimeoutId = null;
            this._settingsBtnFocusTimeoutId = 0;
            this._focusIdleId = 0;
            this._restoreFocusTimeoutId = 0;
            this._scrollLockController = null;
            this._searchComponent = null;
            this._searchDebouncer = null;
            this._searchQuery = '';
            this._searchSettingsSignalId = 0;
            this._ignoreSearchChange = false;

            this._searchDebouncer = new Debouncer(() => this.render(), RecentlyUsedUI.SEARCH_DEBOUNCE_MS);

            this._buildUI();
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Render the entire view.
         * Resolves visibility, recreates section layouts, and calculates the focus grid.
         */
        render() {
            this._syncSearchVisibility();

            this._renderSession = {};
            this._focusGrid = [];
            this._nestedSectionWidgets.clear();

            for (const id in this._sections) {
                this._sections[id].separator.visible = false;
            }

            const sectionOrder = this._getSectionOrder();
            sectionOrder.forEach((id) => this._renderSection(id));

            const visibleSections = sectionOrder.map((id) => this._sections[id]).filter((entry) => entry && entry.section.visible);

            if (visibleSections.length === 0) {
                this._scrollView.visible = false;
                this._emptyView.visible = true;
            } else {
                this._scrollView.visible = true;
                this._emptyView.visible = false;

                for (let i = 1; i < visibleSections.length; i++) {
                    visibleSections[i].separator.visible = true;
                }
            }

            this._focusGrid.push([this._settingsBtn]);
        }

        /**
         * Refresh the view layout and forcefully restore tab focus.
         * Called when the tab is actively selected.
         */
        onActivated() {
            this.render();
            this._unlockOuterScroll();

            if (this._restoreFocusTimeoutId) {
                GLib.source_remove(this._restoreFocusTimeoutId);
                this._restoreFocusTimeoutId = 0;
            }
            this._restoreFocusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._restoreFocus();
                this._restoreFocusTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Attempt to intelligently focus the best widget upon rendering or activation.
         * Prioritizes section headers, then items, then any focusable element.
         */
        focusBestCandidate() {
            const showAllButtons = new Set();
            for (const section of Object.values(this._sections)) {
                if (section.showAllBtn) {
                    showAllButtons.add(section.showAllBtn);
                }
            }

            if (this._tryFocusShowAllButton(showAllButtons)) return;
            if (this._tryFocusContentItem(showAllButtons)) return;
            this._tryFocusAnyWidget();
        }

        // ========================================================================
        // UI Construction
        // ========================================================================

        /**
         * Construct the initial outer layout, empty view, and section structure.
         * @private
         */
        _buildUI() {
            this._searchComponent = new SearchComponent((searchText) => this._onSearchChanged(searchText), {
                onNavigateDown: () => this._focusFirstFocusableInGrid(),
            });
            this._searchComponent.getWidget().visible = this._isSearchEnabled();
            this.add_child(this._searchComponent.getWidget());

            const wrapper = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            this.add_child(wrapper);

            this._scrollView = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true,
                overlay_scrollbars: true,
                visible: false,
            });
            this._scrollLockController = new RecentlyUsedScrollLockController(this._scrollView);

            this._scrollView.connect('scroll-event', () => {
                this._unlockOuterScroll();
                return Clutter.EVENT_PROPAGATE;
            });

            wrapper.add_child(this._scrollView);

            this._mainContainer = new St.BoxLayout({
                vertical: true,
                style_class: RecentlyUsedStyles.CONTAINER,
            });
            this._scrollView.set_child(this._mainContainer);

            this._emptyView = RecentlyUsedBaseWidgetFactory.createEmptyView();
            wrapper.add_child(this._emptyView);

            this._settingsBtn = RecentlyUsedBaseWidgetFactory.createSettingsButton();
            this._settingsBtn.connect('clicked', () => {
                this._onOpenPreferences?.();
            });
            wrapper.add_child(this._settingsBtn);

            this._getSectionOrder().forEach((id) => {
                const sectionScaffold = this._getSectionScaffold(id);
                if (sectionScaffold) {
                    this._addSection(sectionScaffold);
                }
            });

            this.reactive = true;
            this.connect('key-press-event', this._onKeyPress.bind(this));

            this._connectSettingsSignals();
        }

        /**
         * Dynamically create and append a section body to the main container.
         *
         * @param {object} sectionScaffold Defines layout target and header title
         * @private
         */
        _addSection(sectionScaffold) {
            const separator = RecentlyUsedBaseWidgetFactory.createSectionSeparator();
            this._mainContainer.add_child(separator);

            const section = new St.BoxLayout({
                vertical: true,
                style_class: RecentlyUsedStyles.SECTION,
                x_expand: true,
            });

            const baseTitle = sectionScaffold.title || '';
            const { header, showAllBtn, titleLabel } = RecentlyUsedBaseWidgetFactory.createSectionHeader(baseTitle);
            showAllBtn.connect('clicked', () => {
                const targetTab = sectionScaffold.targetTab || sectionScaffold.id;
                queueSearchHandoff({
                    targetTab,
                    query: this._searchQuery,
                    sourceTab: 'Recently Used',
                    sourceSection: sectionScaffold.id,
                });
                this.emit('navigate-to-main-tab', targetTab);
            });

            showAllBtn.connect('key-focus-in', () => {
                this._unlockOuterScroll();
                this._previousFocus = showAllBtn;
                this._clearScrollIntoViewIdle();
                this._scrollIntoViewIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._scrollIntoViewIdleId = 0;
                    ensureActorVisibleInScrollView(this._scrollView, showAllBtn);
                    return GLib.SOURCE_REMOVE;
                });
            });

            section.add_child(header);

            const bodyContainer = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            section.add_child(bodyContainer);
            this._mainContainer.add_child(section);

            this._sections[sectionScaffold.id] = { section, showAllBtn, titleLabel, baseTitle, bodyContainer, separator };
        }

        // ========================================================================
        // Section Rendering
        // ========================================================================

        /**
         * Fetch section data and dynamically render its content based on effective layout strategy.
         *
         * @param {string} id The section id
         * @private
         */
        _renderSection(id) {
            if (!this._sections[id]) {
                return;
            }

            const sectionData = this._sections[id];
            const runtimeContext = this._createSectionRuntimeContext();
            const renderModel = this._getSectionRenderModel(id, runtimeContext);
            this._updateSectionTitle(sectionData, renderModel);

            if (!renderModel?.visible) {
                sectionData.section.hide();
                return;
            }

            const effectiveLayout = renderModel.effectiveLayout;
            const items = renderModel.items;

            if (effectiveLayout === 'nested') {
                const result = renderRecentlyUsedNestedSection({
                    id,
                    nestedLayout: renderModel.nestedLayout,
                    sections: this._sections,
                    items,
                    focusGrid: this._focusGrid,
                    createItemWidget: (itemData, sectionId = id) => this._createNestedItemWidget(itemData, sectionId, renderModel),
                    scrollLockController: this._scrollLockController,
                });

                if (result) {
                    this._bindNestedSectionFocus(result);
                }
                return;
            }

            if (effectiveLayout === 'grid') {
                renderRecentlyUsedGridSection({
                    id,
                    sections: this._sections,
                    items,
                    focusGrid: this._focusGrid,
                    createItemWidget: (itemData, sectionId = id) => this._createGridItemWidget(itemData, sectionId, renderModel),
                });
                return;
            }

            if (effectiveLayout === 'list') {
                renderRecentlyUsedListSection({
                    id,
                    sections: this._sections,
                    items,
                    focusGrid: this._focusGrid,
                    createItemWidget: (itemData, sectionId = id) => this._createListItemWidget(itemData, sectionId, renderModel),
                });
                return;
            }
        }

        /**
         * Updates a section header title based on active search context.
         *
         * @param {object} sectionData Internal section state.
         * @param {object|null} renderModel Section render model.
         * @private
         */
        _updateSectionTitle(sectionData, renderModel) {
            const titleLabel = sectionData?.titleLabel;
            if (!titleLabel) {
                return;
            }

            const baseTitle = sectionData?.baseTitle || '';
            const displayTitle = typeof renderModel?.sectionTitle === 'string' && renderModel.sectionTitle.length > 0 ? renderModel.sectionTitle : baseTitle;
            titleLabel.text = displayTitle;
        }

        /**
         * Construct the context payload passed to external layout renderers and widgets.
         *
         * @returns {object} Settings, factory, and session info
         * @private
         */
        _createSectionRuntimeContext() {
            return {
                settings: this._settings,
                extension: this._extension,
                widgetFactory: RecentlyUsedBaseWidgetFactory,
                renderSession: this._renderSession,
                currentRenderSession: () => this._renderSession,
                searchQuery: this._searchQuery,
            };
        }

        /**
         * Determines if global search should be shown for the Recently Used tab.
         *
         * @returns {boolean} True when search is enabled.
         * @private
         */
        _isSearchEnabled() {
            return this._settings?.get_boolean('enable-recently-used-search') ?? true;
        }

        /**
         * Handles user search query changes and triggers a re-render.
         *
         * @param {string} searchText Search text entered by the user.
         * @private
         */
        _onSearchChanged(searchText) {
            if (this._ignoreSearchChange) {
                return;
            }

            const normalizedQuery = typeof searchText === 'string' ? searchText.trim() : '';
            if (normalizedQuery === this._searchQuery) {
                return;
            }

            this._searchQuery = normalizedQuery;
            this._searchDebouncer?.trigger();
        }

        /**
         * Syncs the search actor visibility with settings and clears stale query when disabled.
         *
         * @private
         */
        _syncSearchVisibility() {
            const searchWidget = this._searchComponent?.getWidget();
            if (!searchWidget) {
                return;
            }

            const isSearchEnabled = this._isSearchEnabled();
            searchWidget.visible = isSearchEnabled;

            if (!isSearchEnabled && this._searchQuery.length > 0) {
                this._searchDebouncer?.cancel?.();
                this._searchQuery = '';
                this._ignoreSearchChange = true;
                this._searchComponent.clearSearch();
                this._ignoreSearchChange = false;
            }
        }

        /**
         * Focuses the first available item in the internal focus grid.
         *
         * @returns {boolean} True when focus was moved.
         * @private
         */
        _focusFirstFocusableInGrid() {
            for (const row of this._focusGrid) {
                if (!row || row.length === 0) {
                    continue;
                }

                const target = row[0];
                if (this._focusWidgetSafely(target)) {
                    return true;
                }
            }

            return false;
        }

        /**
         * Connects settings updates relevant to the Recently Used view.
         *
         * @private
         */
        _connectSettingsSignals() {
            if (!this._settings || this._searchSettingsSignalId) {
                return;
            }

            this._searchSettingsSignalId = this._settings.connect('changed::enable-recently-used-search', () => {
                this._syncSearchVisibility();
                this.render();
            });
        }

        /**
         * Disconnects settings updates previously connected for this view.
         *
         * @private
         */
        _disconnectSettingsSignals() {
            if (!this._settings || !this._searchSettingsSignalId) {
                return;
            }

            this._settings.disconnect(this._searchSettingsSignalId);
            this._searchSettingsSignalId = 0;
        }

        /**
         * Retrieve sorted section IDs to display from the registry.
         *
         * @returns {string[]} Collection of ordered section IDs
         * @private
         */
        _getSectionOrder() {
            const order = this._sectionProvider.getSectionOrder?.();
            return Array.isArray(order) ? order : [];
        }

        /**
         * Fetch section definition from the provider for the specified section instance.
         *
         * @param {string} sectionId The ID of the loaded section
         * @returns {object|null} A predefined scaffold
         * @private
         */
        _getSectionScaffold(sectionId) {
            return this._sectionProvider.getSectionScaffold?.(sectionId) || null;
        }

        /**
         * Construct the fully configured render model matching the specified section layout.
         *
         * @param {string} sectionId The mapped section ID
         * @param {object} runtimeContext Dependencies to inject in rendering models
         * @returns {object|null} Render parameters mapped by layout rules
         * @private
         */
        _getSectionRenderModel(sectionId, runtimeContext) {
            return this._sectionProvider.getSectionRenderModel?.(sectionId, runtimeContext) || null;
        }

        // ========================================================================
        // Widget Creation
        // ========================================================================

        /**
         * Create a standard list item widget spanning the section width.
         *
         * @param {object} itemData Data to render
         * @param {string} sectionId The parent section ID mapped for telemetry
         * @param {object} renderModel Model providing internal string formatting methods
         * @returns {Clutter.Actor} The interactive widget
         * @private
         */
        _createListItemWidget(itemData, sectionId, renderModel) {
            const runtimeContext = this._createSectionRuntimeContext();
            const context = {
                runtimeContext,
                renderListContent: renderModel?.listContentRenderer || undefined,
            };

            const button = RecentlyUsedBaseWidgetFactory.createFullWidthListItem(itemData, context);

            button.connect('clicked', () => {
                const payload = itemData.__recentlyUsedClickPayload ?? itemData;
                Promise.resolve(this._onItemClicked(payload, sectionId)).catch((e) => {
                    const message = e?.message ?? String(e);
                    console.error(`[AIO-Clipboard] Recently Used item click failed: ${message}`);
                });
            });

            this._connectStandardFocusHandler(button);

            return button;
        }

        /**
         * Create a structured grid item widget spanning one column index.
         *
         * @param {object} itemData Data to render
         * @param {string} sectionId The parent section ID
         * @param {object} renderModel Defines internal icon resolutions
         * @returns {Clutter.Actor} The formatted grid button
         * @private
         */
        _createGridItemWidget(itemData, sectionId, renderModel) {
            const context = {
                resolveGridIcon: renderModel?.gridIconResolver || undefined,
            };

            const button = RecentlyUsedBaseWidgetFactory.createGridItem(itemData, context);

            if (typeof renderModel?.onGridItemCreated === 'function') {
                renderModel.onGridItemCreated({
                    item: itemData,
                    widget: button,
                });
            }

            button.connect('clicked', () => {
                const payload = itemData.__recentlyUsedClickPayload ?? itemData;
                Promise.resolve(this._onItemClicked(payload, sectionId)).catch((e) => {
                    const message = e?.message ?? String(e);
                    console.error(`[AIO-Clipboard] Recently Used item click failed: ${message}`);
                });
            });

            this._connectStandardFocusHandler(button);

            return button;
        }

        /**
         * Create a standard block list item specifically mapped for nesting bounds.
         *
         * @param {object} itemData Data to render
         * @param {string} sectionId Target section mapped to event handling
         * @param {object} renderModel Context formatting rules
         * @returns {Clutter.Actor} Bare widget not yet bound to standard scroll focus
         * @private
         */
        _createNestedItemWidget(itemData, sectionId, renderModel) {
            const runtimeContext = this._createSectionRuntimeContext();
            const context = {
                runtimeContext,
                renderListContent: renderModel?.listContentRenderer || undefined,
            };

            const button = RecentlyUsedBaseWidgetFactory.createFullWidthListItem(itemData, context);

            button.connect('clicked', () => {
                const payload = itemData.__recentlyUsedClickPayload ?? itemData;
                Promise.resolve(this._onItemClicked(payload, sectionId)).catch((e) => {
                    const message = e?.message ?? String(e);
                    console.error(`[AIO-Clipboard] Recently Used item click failed: ${message}`);
                });
            });

            return button;
        }

        // ========================================================================
        // Focus Management
        // ========================================================================

        /**
         * Iterate over all instantiated nest view widgets appending dynamic layout locks.
         *
         * @param {object} scope Focus mapping structure
         * @param {Clutter.Actor[]} scope.widgets Target widgets directly below scroll lock
         * @param {St.ScrollView} scope.nestedScrollView The internally isolated scroller reference
         * @param {Clutter.Actor} scope.showAllBtn Navigational sibling control for visibility locks
         * @private
         */
        _bindNestedSectionFocus({ widgets, nestedScrollView, showAllBtn }) {
            this._nestedSectionWidgets.add(showAllBtn);

            widgets.forEach((widget) => {
                this._nestedSectionWidgets.add(widget);
                this._connectNestedFocusHandler(widget, nestedScrollView, showAllBtn);
            });
        }

        /**
         * Focuses a widget while safely handling settings button focus toggling.
         *
         * @param {Clutter.Actor} widget Candidate focus target.
         * @returns {boolean} True when focus succeeds.
         * @private
         */
        _focusWidgetSafely(widget) {
            if (!widget || !widget.visible || !widget.get_stage()) {
                return false;
            }

            const isSettingsButtonFocus = widget === this._settingsBtn && this._settingsBtn?.can_focus === false;
            if (isSettingsButtonFocus) {
                this._settingsBtn.can_focus = true;
            }

            try {
                widget.grab_key_focus();
            } catch {
                if (isSettingsButtonFocus) {
                    this._settingsBtn.can_focus = false;
                }
                return false;
            }

            if (isSettingsButtonFocus) {
                if (this._settingsBtnFocusTimeoutId) {
                    GLib.source_remove(this._settingsBtnFocusTimeoutId);
                }

                this._settingsBtnFocusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                    this._settingsBtn.can_focus = false;
                    this._settingsBtnFocusTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            }

            return true;
        }

        /**
         * Enforce basic outer scroll visibility ensuring the element centers into view on focus.
         *
         * @param {Clutter.Actor} widget The interacted control taking keyboard focus
         * @private
         */
        _connectStandardFocusHandler(widget) {
            widget.connect('key-focus-in', () => {
                this._unlockOuterScroll();
                this._clearScrollIntoViewIdle();
                this._scrollIntoViewIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._scrollIntoViewIdleId = 0;
                    if (widget.get_stage()) {
                        ensureActorVisibleInScrollView(this._scrollView, widget);
                    }
                    return GLib.SOURCE_REMOVE;
                });
                this._previousFocus = widget;
            });
        }

        /**
         * Dynamically lock standard scroll policies resolving visible focus across bounds seamlessly.
         *
         * @param {Clutter.Actor} widget The interacted nested child widget taking focus
         * @param {St.ScrollView} nestedScrollView Scrolling parent container
         * @param {Clutter.Actor} showAllBtn Target control above container
         * @private
         */
        _connectNestedFocusHandler(widget, nestedScrollView, showAllBtn) {
            widget.connect('key-focus-in', () => {
                const isEnteringFromOutside = !this._nestedSectionWidgets.has(this._previousFocus);

                if (isEnteringFromOutside) {
                    this._unlockOuterScroll();
                    this._clearScrollIntoViewIdle();
                    this._scrollIntoViewIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._scrollIntoViewIdleId = 0;
                        if (widget.get_stage()) {
                            ensureActorVisibleInScrollView(this._scrollView, showAllBtn);
                            ensureActorVisibleInScrollView(nestedScrollView, widget);

                            if (this._lockTimeoutId) {
                                GLib.source_remove(this._lockTimeoutId);
                                this._lockTimeoutId = null;
                            }

                            this._lockTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RecentlyUsedUI.OUTER_SCROLL_LOCK_DELAY_MS, () => {
                                this._lockTimeoutId = null;
                                this._lockOuterScroll();
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    this._lockOuterScroll();
                    this._clearScrollIntoViewIdle();
                    this._scrollIntoViewIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._scrollIntoViewIdleId = 0;
                        if (widget.get_stage()) {
                            ensureActorVisibleInScrollView(nestedScrollView, widget);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }

                this._previousFocus = widget;
            });
        }

        /**
         * Wait until UI idle completely flushing geometry trees to focus best fallback logic.
         * @private
         */
        _restoreFocus() {
            if (this._focusIdleId) {
                GLib.source_remove(this._focusIdleId);
                this._focusIdleId = 0;
            }

            this._focusIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._focusIdleId = 0;
                if (this._focusGrid.length === 0) {
                    return GLib.SOURCE_REMOVE;
                }

                this.focusBestCandidate();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Safely fallback focus attempts into section headings as initial user interaction surface.
         *
         * @param {Set<Clutter.Actor>} showAllButtons Target iterable reference widgets array
         * @returns {boolean} Whether focus operation passed or failed visually
         * @private
         */
        _tryFocusShowAllButton(showAllButtons) {
            for (const button of showAllButtons) {
                if (this._focusWidgetSafely(button)) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Test the array of loaded layout arrays determining closest safe child widget to assign.
         *
         * @param {Set<Clutter.Actor>} showAllButtons Fallback headers preventing overlaps
         * @returns {boolean} Outcome of focus logic check mapping
         * @private
         */
        _tryFocusContentItem(showAllButtons) {
            for (const row of this._focusGrid) {
                if (!row || row.length === 0) continue;

                const firstItem = row[0];
                if (!firstItem || !firstItem.visible || !firstItem.get_stage()) continue;
                if (firstItem === this._settingsBtn) continue;
                if (showAllButtons.has(firstItem)) continue;

                if (this._focusWidgetSafely(firstItem)) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Iterate the whole component array returning truthy for any available nested or regular element mapping.
         *
         * @returns {boolean} Indicator of successful focus acquisition
         * @private
         */
        _tryFocusAnyWidget() {
            for (const row of this._focusGrid) {
                if (this._focusWidgetSafely(row?.[0])) {
                    return true;
                }
            }
            return false;
        }

        // ========================================================================
        // Scroll Lock
        // ========================================================================

        /**
         * Isolate keyboard scroll logic mapping events strictly into nested viewport containers.
         * @private
         */
        _lockOuterScroll() {
            if (this._lockTimeoutId) {
                GLib.source_remove(this._lockTimeoutId);
                this._lockTimeoutId = null;
            }

            this._scrollLockController?.lock();
        }

        /**
         * Restore main scrolling behaviors mapping interactions outwardly again.
         * @private
         */
        _unlockOuterScroll() {
            if (this._lockTimeoutId) {
                GLib.source_remove(this._lockTimeoutId);
                this._lockTimeoutId = null;
            }

            this._scrollLockController?.unlock();
        }

        /**
         * Reset internal view tracking events resolving visible target offsets sequentially.
         * @private
         */
        _clearScrollIntoViewIdle() {
            if (!this._scrollIntoViewIdleId) {
                return;
            }

            GLib.source_remove(this._scrollIntoViewIdleId);
            this._scrollIntoViewIdleId = 0;
        }

        // ========================================================================
        // Keyboard Navigation
        // ========================================================================

        /**
         * Intercept main keyboard arrays interpreting focus geometry and visual bounds routing logic safely.
         *
         * @param {Clutter.Actor} _actor Key capture bounds parent
         * @param {Clutter.Event} event Trapped event signaling keys
         * @returns {boolean} Indication whether mapping stops processing
         * @private
         */
        _onKeyPress(_actor, event) {
            const symbol = event.get_key_symbol();
            const currentFocus = global.stage.get_key_focus();
            const allFocusable = this._focusGrid.flat();

            if (!allFocusable.includes(currentFocus)) {
                if (symbol === Clutter.KEY_Down && this._focusGrid.length > 0) {
                    if (this._focusWidgetSafely(this._focusGrid[0][0])) {
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            }

            let rowIndex = -1;
            let colIndex = -1;
            for (let r = 0; r < this._focusGrid.length; r++) {
                const c = this._focusGrid[r].indexOf(currentFocus);
                if (c !== -1) {
                    rowIndex = r;
                    colIndex = c;
                    break;
                }
            }

            if (rowIndex === -1) {
                return Clutter.EVENT_PROPAGATE;
            }

            let nextRow = rowIndex;
            let nextCol = colIndex;

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                const currentRow = this._focusGrid[rowIndex];
                const currentRowIndex = currentRow.indexOf(currentFocus);

                if (currentRowIndex !== -1) {
                    const result = FocusUtils.handleRowNavigation(event, currentRow, currentRowIndex, currentRow.length);
                    if (result === Clutter.EVENT_STOP) {
                        return Clutter.EVENT_STOP;
                    }
                }

                return Clutter.EVENT_PROPAGATE;
            }

            if (symbol === Clutter.KEY_Up) {
                if (rowIndex > 0) {
                    nextRow--;
                } else {
                    this._unlockOuterScroll();
                    return Clutter.EVENT_PROPAGATE;
                }
            } else if (symbol === Clutter.KEY_Down) {
                if (rowIndex < this._focusGrid.length - 1) {
                    nextRow++;
                } else {
                    return Clutter.EVENT_STOP;
                }
            } else {
                return Clutter.EVENT_PROPAGATE;
            }

            if (this._focusGrid[nextRow].length === 1) {
                nextCol = 0;
            } else {
                nextCol = Math.min(nextCol, this._focusGrid[nextRow].length - 1);
            }

            const targetWidget = this._focusGrid[nextRow][nextCol];

            if (!this._focusWidgetSafely(targetWidget)) {
                return Clutter.EVENT_PROPAGATE;
            }

            return Clutter.EVENT_STOP;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        destroy() {
            this._disconnectSettingsSignals();

            if (this._settingsBtnFocusTimeoutId) {
                GLib.source_remove(this._settingsBtnFocusTimeoutId);
                this._settingsBtnFocusTimeoutId = 0;
            }
            if (this._lockTimeoutId) {
                GLib.source_remove(this._lockTimeoutId);
                this._lockTimeoutId = null;
            }
            if (this._focusIdleId) {
                GLib.source_remove(this._focusIdleId);
                this._focusIdleId = 0;
            }
            if (this._scrollIntoViewIdleId) {
                GLib.source_remove(this._scrollIntoViewIdleId);
                this._scrollIntoViewIdleId = 0;
            }
            if (this._restoreFocusTimeoutId) {
                GLib.source_remove(this._restoreFocusTimeoutId);
                this._restoreFocusTimeoutId = 0;
            }

            if (this._scrollLockController) {
                this._scrollLockController.destroy();
                this._scrollLockController = null;
            }

            if (this._searchComponent) {
                this._searchComponent.destroy();
                this._searchComponent = null;
            }

            if (this._searchDebouncer) {
                this._searchDebouncer.destroy();
                this._searchDebouncer = null;
            }

            this._renderSession = null;
            this._mainContainer = null;
            this._nestedSectionWidgets = null;

            super.destroy();
        }
    },
);
