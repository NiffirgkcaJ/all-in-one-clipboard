import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { GlobalActionService } from '../../shared/services/serviceAction.js';
import { SearchComponent } from '../../shared/utilities/utilitySearch.js';

import { ClipboardActionBar } from './view/clipboardActionBar.js';
import { ClipboardCopyService } from './services/clipboardCopyService.js';
import { ClipboardGridView } from './view/clipboardGridView.js';
import { ClipboardListView } from './view/clipboardListView.js';
import { ClipboardSearchService } from './services/clipboardSearchService.js';
import { ClipboardSelectionService } from './services/clipboardSelectionService.js';
import { ensureClipboardSearchProviderRegistered } from './integrations/clipboardSearchProvider.js';

// Configuration
const RETRY_INTERVAL_MS = 16;

/**
 * ClipboardTabContent
 *
 * Main UI container for the clipboard feature.
 * Delegates search orchestration to ClipboardSearchService and selection management to ClipboardSelectionService.
 */
export const ClipboardTabContent = GObject.registerClass(
    class ClipboardTabContent extends St.Bin {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the clipboard tab content.
         *
         * @param {Object} extension Extension instance.
         * @param {Gio.Settings} settings Extension settings.
         * @param {ClipboardManager} manager Clipboard manager.
         */
        constructor(extension, settings, manager) {
            super({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
            });

            this._extension = extension;
            this._settings = settings;
            this._manager = manager;
            ensureClipboardSearchProviderRegistered();

            this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size');
            this._layoutMode = this._settings.get_string('clipboard-layout-mode') || 'list';
            this._hasRenderedOnce = false;
            this._deferredRedrawPending = false;
            this._redrawIdleId = 0;
            this._redrawScheduled = false;
            this._retryId = 0;
            this._settingSignalIds = [];
            this._managerSignalIds = [];

            this._copyService = new ClipboardCopyService();
            this._selectionService = new ClipboardSelectionService();

            this._mainBox = new St.BoxLayout({
                vertical: true,
                style_class: 'aio-clipboard-container',
                x_expand: true,
            });
            this.set_child(this._mainBox);

            this._searchService = new ClipboardSearchService({
                onSearchChanged: () => this._scheduleRedraw(true),
            });

            this._buildSearchComponent();
            this._buildActionBar();
            this._buildScrollableList();

            this._setupSettingsSignals();
            this._connectManagerSignals();
            this.connectObject(
                'notify::mapped',
                () => this._flushDeferredRedraw(),
                'notify::visible',
                () => this._flushDeferredRedraw(),
                this,
            );
        }

        // ========================================================================
        // UI Construction
        // ========================================================================

        /**
         * Set up listeners for settings changes.
         *
         * @private
         */
        _setupSettingsSignals() {
            this._settingSignalIds = [
                this._settings.connect('changed::clipboard-image-preview-size', () => {
                    this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size');
                    this._currentView?.setImagePreviewSize(this._imagePreviewSize);
                    this._scheduleRedraw();
                }),
                this._settings.connect('changed::clipboard-layout-mode', () => {
                    this._applyLayoutMode(this._settings.get_string('clipboard-layout-mode') || 'list');
                }),
                this._settings.connect('changed::extension-width', () => {
                    this._currentView?.resetScrollAndPagination?.();
                    this._scheduleRedraw();
                }),
                this._settings.connect('changed::extension-height', () => this._scheduleRedraw()),
            ];
        }

        /**
         * Create the search component for filtering items.
         *
         * @private
         */
        _buildSearchComponent() {
            this._searchComponent = new SearchComponent((text) => this._searchService?.handleSearchInput(text), {
                onNavigateDown: () => {
                    if (this._actionBar?.visible) {
                        this._actionBar.grabFocus();
                        return true;
                    }
                    return this._focusFirstContentItem();
                },
            });

            this._mainBox.add_child(this._searchComponent.getWidget());
        }

        /**
         * Create the action bar for bulk operations and layout switching.
         *
         * @private
         */
        _buildActionBar() {
            this._actionBar = new ClipboardActionBar(this._settings, this._manager, this._selectionService.selectedIds);

            this._actionBar.connect('layout-toggled', () => {
                const next = this._layoutMode === 'list' ? 'grid' : 'list';
                this._settings.set_string('clipboard-layout-mode', next);
            });

            this._actionBar.connect('selection-cleared', () => this._scheduleRedraw());
            this._actionBar.connect('select-all-requested', () => this._onSelectAllClicked());
            this._actionBar.connect('merge-selected-requested', () => this._onMergeSelectedRequested());
            this._actionBar.connect('navigate-up', () => this._searchComponent?.grabFocus());
            this._actionBar.connect('navigate-down', () => this._focusFirstContentItem());

            this._mainBox.add_child(this._actionBar);
        }

        /**
         * Create the scrollable container for clipboard items.
         *
         * @private
         */
        _buildScrollableList() {
            this._scrollView = new St.ScrollView({
                style_class: 'menu-scrollview',
                overlay_scrollbars: true,
                x_expand: true,
                y_expand: true,
            });

            this._mainBox.add_child(this._scrollView);
            this._createView(this._layoutMode);
        }

        /**
         * Create the appropriate view based on the layout mode.
         *
         * @param {string} mode Layout mode.
         * @private
         */
        _createView(mode) {
            if (this._currentView) {
                this._scrollView.set_child(null);
                this._currentView.destroy();
            }

            const options = {
                manager: this._manager,
                imagePreviewSize: this._imagePreviewSize,
                onItemCopy: (data) => this._onItemCopyToClipboard(data),
                onSelectionChanged: () => this._updateSelectionState(),
                selectedIds: this._selectionService.selectedIds,
                scrollView: this._scrollView,
                settings: this._settings,
            };

            this._currentView = mode === 'grid' ? new ClipboardGridView(options) : new ClipboardListView(options);

            this._currentView.connect('navigate-up', () => {
                if (this._actionBar?.visible) this._actionBar.grabFocus();
                else this._searchComponent?.grabFocus();
            });

            this._scrollView.set_child(this._currentView);
        }

        /**
         * Switch between list and grid layout modes.
         *
         * @param {string} mode Layout mode.
         * @private
         */
        _applyLayoutMode(mode) {
            if (mode === this._layoutMode) return;

            this._layoutMode = mode;
            this._actionBar.updateLayoutIcon(mode);
            this._scrollView.vadjustment.value = 0;

            this._createView(mode);
            this._scheduleRedraw(true);

            if (this._extension?._indicator?.menu?.isOpen) this._searchComponent?.grabFocus();
        }

        // ========================================================================
        // Event Handling
        // ========================================================================

        /**
         * Handle selection or deselection of all items in the current view.
         *
         * @private
         */
        _onSelectAllClicked() {
            this._selectionService.toggleSelectAll(
                () => this._currentView?.getAllItems() || [],
                () => this._currentView?.getCheckboxIconsMap() || new Map(),
            );
            this._updateSelectionState();
        }

        /**
         * Update the action bar state based on the current selection.
         *
         * @private
         */
        _updateSelectionState() {
            this._selectionService.updateSelectionState(() => this._currentView?.getAllItems() || [], this._actionBar);
        }

        /**
         * Handle copying an item to the system clipboard.
         *
         * @param {Object} itemData Data of the item to copy.
         * @private
         */
        async _onItemCopyToClipboard(itemData) {
            await GlobalActionService.executeCopyAction({
                onCopy: async () => await this._manager.copyToSystemClipboard(itemData),
                onPostCopy: () => this._manager.promoteItemToTop(itemData.id),
                settings: this._settings,
                autoPasteKey: 'auto-paste-clipboard',
                menu: this._extension._indicator?.menu,
            });
        }

        /**
         * Handle merging of selected items.
         *
         * @private
         */
        async _onMergeSelectedRequested() {
            const selectedIds = [...this._selectionService.selectedIds];
            if (selectedIds.length === 0) return;

            const mergeSuccess = await this._copyService.mergeMultiple(selectedIds, this._manager, {
                settings: this._settings,
                menu: this._extension._indicator?.menu,
            });
            if (!mergeSuccess) return;

            this._selectionService.clearSelection(() => this._currentView?.getCheckboxIconsMap() || new Map());
            this._updateSelectionState();
            this._scheduleRedraw();
        }

        /**
         * Connect to signals from the clipboard manager.
         *
         * @private
         */
        _connectManagerSignals() {
            this._managerSignalIds = [this._manager.connect('history-changed', () => this._scheduleRedraw()), this._manager.connect('pinned-list-changed', () => this._scheduleRedraw())];
        }

        // ========================================================================
        // Rendering
        // ========================================================================

        /**
         * Schedule a redraw of the content area.
         *
         * @param {boolean} immediate Whether to redraw immediately.
         * @private
         */
        _scheduleRedraw(immediate = false) {
            if (!this._currentView || !this._scrollView) return;

            if (!this._canRenderNow()) {
                this._deferredRedrawPending = true;
                if (this._shouldRetryRender()) this._ensureRetry();
                return;
            }

            this._deferredRedrawPending = false;

            if (immediate) {
                if (this._redrawIdleId) {
                    GLib.source_remove(this._redrawIdleId);
                    this._redrawIdleId = 0;
                    this._redrawScheduled = false;
                }
                this._redraw();
                return;
            }

            if (this._redrawScheduled) return;

            this._redrawScheduled = true;
            this._redrawIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._redrawIdleId = 0;
                this._redrawScheduled = false;
                this._redraw();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Determine if the content can currently be rendered.
         *
         * @returns {boolean} True if rendering is possible.
         * @private
         */
        _canRenderNow() {
            if (!this._shouldRetryRender()) return false;
            const box = this._scrollView.get_allocation_box();
            return box && box.get_width() > 1 && box.get_height() > 1;
        }

        /**
         * Determine if a pending render should wait for allocation.
         *
         * @returns {boolean} True if the actor is alive and visible.
         * @private
         */
        _shouldRetryRender() {
            return !!this._currentView && !!this._scrollView && this.mapped && this.visible;
        }

        /**
         * Ensure redraw is retried when rendering becomes possible again.
         *
         * @private
         */
        _ensureRetry() {
            if (!this._currentView || !this._scrollView || this._retryId) return;

            this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_INTERVAL_MS, () => {
                if (!this._deferredRedrawPending || !this._currentView || !this._scrollView) {
                    this._retryId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                if (!this._shouldRetryRender()) {
                    this._retryId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                if (this._canRenderNow()) {
                    this._scheduleRedraw(true);
                    this._retryId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                return GLib.SOURCE_CONTINUE;
            });
        }

        /**
         * Render pending content when a cached tab becomes visible.
         *
         * @private
         */
        _flushDeferredRedraw() {
            if (!this._deferredRedrawPending || !this._shouldRetryRender()) return;
            this._scheduleRedraw(true);
        }

        /**
         * Perform the actual redraw of the current view.
         *
         * @private
         */
        _redraw() {
            if (!this._currentView || !this._searchService || !this._manager) return;

            if (!this._canRenderNow()) {
                this._deferredRedrawPending = true;
                if (this._shouldRetryRender()) this._ensureRetry();
                return;
            }

            const pinned = this._searchService.filterItems(this._manager.getPinnedItems());
            const history = this._searchService.filterItems(this._manager.getHistoryItems());

            this._currentView.render(pinned, history, this._searchService.isSearching);
            this._hasRenderedOnce = true;
        }

        /**
         * Move focus to the first item in the content list.
         *
         * @returns {boolean} True if focus was successfully moved.
         * @private
         */
        _focusFirstContentItem() {
            return this._currentView?.focusFirstContentItem?.() ?? false;
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Handle the event when the clipboard tab is selected.
         */
        onTabSelected() {
            if (!this._searchService) return;

            const needs = this._deferredRedrawPending || this._searchService.pendingReset || !this._hasRenderedOnce;

            this._searchService.onTabSelected(this._searchComponent);

            if (needs) {
                this._currentView?.resetScrollAndPagination?.();
                this._scheduleRedraw(true);
            }

            this._manager?.scheduleImagePreviewWarmup?.();
            this._searchComponent?.grabFocus();
        }

        /**
         * Apply an external search query to filter clipboard items.
         *
         * @param {string} query Search query string.
         * @returns {Promise<boolean>} True if the search was applied successfully.
         */
        async applyExternalSearch(query) {
            return this._searchService ? await this._searchService.applyExternalSearch(this._searchComponent, query) : false;
        }

        /**
         * Clear any active external search query.
         *
         * @returns {Promise<boolean>} True if the search was cleared successfully.
         */
        async clearExternalSearch() {
            return this._searchService ? await this._searchService.clearExternalSearch(this._searchComponent) : false;
        }

        /**
         * Handle the event when the extension menu is closed.
         */
        onMenuClosed() {
            if (!this._searchService) return;

            this._searchService.onMenuClosed();
            this._clearRedrawSources();

            const currentFocus = global.stage.get_key_focus();
            if (currentFocus && (currentFocus === this || this.contains(currentFocus))) {
                global.stage.set_key_focus(null);
            }
        }

        /**
         * Remove pending redraw sources.
         *
         * @private
         */
        _clearRedrawSources() {
            if (this._redrawIdleId) {
                GLib.source_remove(this._redrawIdleId);
                this._redrawIdleId = 0;
            }
            if (this._retryId) {
                GLib.source_remove(this._retryId);
                this._retryId = 0;
            }
            this._redrawScheduled = false;
            this._deferredRedrawPending = false;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources and disconnect signals before destruction.
         */
        destroy() {
            this._clearRedrawSources();

            this._settingSignalIds.forEach((id) => this._settings?.disconnect(id));
            this._managerSignalIds?.forEach((id) => this._manager?.disconnect(id));
            this.disconnectObject(this);
            this._settingSignalIds = [];
            this._managerSignalIds = [];

            this._searchComponent?.destroy();
            this._actionBar?.destroy();
            this._currentView?.destroy();
            this._copyService?.destroy();
            this._searchService?.destroy();
            this._selectionService?.destroy();

            this._searchComponent = null;
            this._actionBar = null;
            this._currentView = null;
            this._scrollView = null;
            this._mainBox = null;
            this._copyService = null;
            this._searchService = null;
            this._selectionService = null;
            this._manager = null;
            this._settings = null;
            this._extension = null;

            super.destroy();
        }
    },
);
