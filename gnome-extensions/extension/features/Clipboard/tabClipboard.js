import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { GlobalActionService } from '../../shared/services/serviceAction.js';
import { MenuNavigationService } from '../../shared/services/serviceNavigation.js';
import { FocusUtils } from '../../shared/utilities/utilityFocus.js';
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

            this._copyService = new ClipboardCopyService();
            this._selectionService = new ClipboardSelectionService();

            this._mainBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'aio-clipboard-container',
                x_expand: true,
            });
            this.set_child(this._mainBox);

            this._searchService = new ClipboardSearchService({
                onSearchChanged: () => {
                    if (this._currentView) {
                        this._currentView.resetScrollAndPagination();
                    }
                    this._scheduleRedraw(true);
                },
                clipboardRegistry: this._manager._clipboardRegistry,
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
            this._settings.connectObject(
                'changed::clipboard-image-preview-size',
                () => {
                    this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size');
                    this._currentView.setImagePreviewSize(this._imagePreviewSize);
                    this._scheduleRedraw();
                },
                'changed::clipboard-layout-mode',
                () => {
                    this._applyLayoutMode(this._settings.get_string('clipboard-layout-mode') || 'list');
                },
                'changed::extension-width',
                () => {
                    this._currentView.resetScrollAndPagination();
                    this._scheduleRedraw();
                },
                'changed::extension-height',
                () => this._scheduleRedraw(),
                'changed::clipboard-paste-accessibility',
                () => this._scheduleRedraw(),
                'changed::clipboard-paste-format',
                () => this._scheduleRedraw(),
                'changed::clipboard-show-format-paste-button',
                () => this._scheduleRedraw(),
                'changed::clipboard-show-image-paste-button',
                () => this._scheduleRedraw(),
                this,
            );
        }

        /**
         * Create the search component for filtering items.
         *
         * @private
         */
        _buildSearchComponent() {
            this._searchComponent = new SearchComponent((text) => this._searchService.handleSearchInput(text), {
                onNavigateDown: () => {
                    return FocusUtils.tryFocusChain([() => this._actionBar?.visible && this._actionBar.focusFirst(), () => this._focusFirstContentItem()]);
                },
                onNavigateUp: () => {
                    return MenuNavigationService.focusTabBar('active');
                },
                onNavigateTab: (isBackward) => {
                    if (isBackward) {
                        return MenuNavigationService.focusTabBar('last');
                    }
                    const focused = FocusUtils.tryFocusChain([() => this._actionBar?.visible && this._actionBar.focusFirst(), () => this._focusFirstContentItem()]);
                    if (!focused) {
                        MenuNavigationService.focusTabBar('first');
                    }
                    return true;
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

            this._actionBar.connectObject(
                'layout-toggled',
                () => {
                    const next = this._layoutMode === 'list' ? 'grid' : 'list';
                    this._settings.set_string('clipboard-layout-mode', next);
                },
                'selection-cleared',
                () => this._scheduleRedraw(),
                'select-all-requested',
                () => this._onSelectAllClicked(),
                'merge-selected-requested',
                () => this._onMergeSelectedRequested(),
                'navigate-up',
                () => {
                    if (!this._searchComponent.grabFocus()) {
                        MenuNavigationService.focusTabBar('active');
                    }
                },
                'navigate-previous',
                () => {
                    if (!this._searchComponent.grabFocus()) {
                        MenuNavigationService.focusTabBar('last');
                    }
                },
                'navigate-down',
                () => {
                    this._focusFirstContentItem();
                },
                'navigate-next',
                () => {
                    if (!this._focusFirstContentItem()) {
                        MenuNavigationService.focusTabBar('first');
                    }
                },
                this,
            );

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
                this._currentView.disconnectObject(this);
                this._scrollView.set_child(null);
                this._currentView.destroy();
            }

            const options = {
                manager: this._manager,
                imagePreviewSize: this._imagePreviewSize,
                onItemCopy: (data, copyOptions) => this._onItemCopyToClipboard(data, copyOptions),
                onSelectionChanged: () => this._updateSelectionState(),
                selectedIds: this._selectionService.selectedIds,
                scrollView: this._scrollView,
                settings: this._settings,
            };

            this._currentView = mode === 'grid' ? new ClipboardGridView(options) : new ClipboardListView(options);

            this._currentView.connectObject(
                'navigate-up',
                () => {
                    const focused = FocusUtils.tryFocusChain([() => this._actionBar?.visible && this._actionBar.focusFirst(), () => this._searchComponent.grabFocus()]);
                    if (!focused) {
                        MenuNavigationService.focusTabBar('active');
                    }
                },
                'navigate-previous',
                () => {
                    const focused = FocusUtils.tryFocusChain([() => this._actionBar?.visible && this._actionBar.focusLast(), () => this._searchComponent.grabFocus()]);
                    if (!focused) {
                        MenuNavigationService.focusTabBar('last');
                    }
                },
                'navigate-next',
                () => {
                    MenuNavigationService.focusTabBar('first');
                },
                this,
            );

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

            if (this._extension?._indicator?.menu?.isOpen) this._searchComponent.grabFocus();
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
                () => this._currentView.getAllItems(),
                () => this._currentView.getCheckboxIconsMap(),
            );
            this._updateSelectionState();
        }

        /**
         * Update the action bar state based on the current selection.
         *
         * @private
         */
        _updateSelectionState() {
            this._selectionService.updateSelectionState(() => this._currentView.getAllItems(), this._actionBar);
        }

        /**
         * Handle copying an item to the system clipboard.
         *
         * @param {Object} itemData Data of the item to copy.
         * @param {Object} [copyOptions] Copy options.
         * @private
         */
        async _onItemCopyToClipboard(itemData, copyOptions = {}) {
            let asRichText = copyOptions.asRichText;
            let asImages = copyOptions.asImages;

            if (asRichText === undefined && asImages === undefined) {
                const switchMode = this._settings.get_string('clipboard-paste-accessibility') || 'per-item';
                if (switchMode === 'action-bar' && this._actionBar) {
                    if (this._actionBar.pasteMode === 'image') {
                        if (itemData.has_images) {
                            asImages = true;
                        } else {
                            asRichText = this._settings.get_string('clipboard-paste-format') === 'rich';
                        }
                    } else {
                        asRichText = this._actionBar.pasteMode === 'rich';
                    }
                } else {
                    asRichText = this._settings.get_string('clipboard-paste-format') === 'rich';
                }
            }

            if (asImages) {
                await this._copyService.pasteImagesFromItem(itemData, this._manager.storage, this._manager, {
                    settings: this._settings,
                    menu: this._extension._indicator?.menu,
                });
                return;
            }

            await GlobalActionService.executeCopyAction({
                onCopy: async () => await this._manager.copyToSystemClipboard(itemData, { asRichText }),
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

            this._selectionService.clearSelection(() => this._currentView.getCheckboxIconsMap());
            this._updateSelectionState();
            this._scheduleRedraw();
        }

        /**
         * Connect to signals from the clipboard manager.
         *
         * @private
         */
        _connectManagerSignals() {
            this._manager.connectObject(
                'history-changed',
                () => this._scheduleRedraw(),
                'pinned-changed',
                () => this._scheduleRedraw(),
                this,
            );
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
            return this._currentView.focusFirstContentItem();
        }

        /**
         * Move focus to the last item in the content list.
         *
         * @returns {boolean} True if focus was successfully moved.
         * @private
         */
        _focusLastContentItem() {
            return this._currentView?.focusLastContentItem ? this._currentView.focusLastContentItem() : false;
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Focuses the top-most content element when navigating from the main tab bar.
         *
         * @returns {boolean} True if focus was successfully moved.
         */
        focusTopContent() {
            return FocusUtils.tryFocusChain([() => this._searchComponent.grabFocus(), () => this._actionBar?.visible && this._actionBar.focusFirst(), () => this._focusFirstContentItem()]);
        }

        /**
         * Focuses the bottom-most content element when navigating backward from the main tab bar.
         *
         * @returns {boolean} True if focus was successfully moved.
         */
        focusBottomContent() {
            return FocusUtils.tryFocusChain([() => this._focusLastContentItem(), () => this._actionBar?.visible && this._actionBar.focusLast(), () => this._searchComponent.grabFocus()]);
        }

        /**
         * Handle the event when the clipboard tab is selected.
         */
        onTabSelected() {
            if (!this._searchService) return;

            const needs = this._deferredRedrawPending || this._searchService.pendingReset || !this._hasRenderedOnce;

            this._searchService.onTabSelected(this._searchComponent);

            if (needs) {
                this._currentView.resetScrollAndPagination();
                this._scheduleRedraw(true);
            }

            this._manager.scheduleImagePreviewWarmup();
            this._searchComponent.grabFocus();
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

            this._settings?.disconnectObject(this);
            this._manager?.disconnectObject(this);
            this._actionBar?.disconnectObject(this);
            this._currentView?.disconnectObject(this);
            this.disconnectObject(this);

            if (this._searchComponent) {
                this._searchComponent.destroy();
                this._searchComponent = null;
            }
            if (this._actionBar) {
                this._actionBar.destroy();
                this._actionBar = null;
            }
            if (this._currentView) {
                this._currentView.destroy();
                this._currentView = null;
            }
            if (this._copyService) {
                this._copyService.destroy();
                this._copyService = null;
            }
            if (this._searchService) {
                this._searchService.destroy();
                this._searchService = null;
            }
            if (this._selectionService) {
                this._selectionService.destroy();
                this._selectionService = null;
            }

            this._scrollView = null;
            this._mainBox = null;
            this._manager = null;
            this._settings = null;
            this._extension = null;

            super.destroy();
        }
    },
);
