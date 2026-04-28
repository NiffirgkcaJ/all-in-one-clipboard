import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Debouncer } from '../../shared/utilities/utilityDebouncer.js';
import { GlobalActionService } from '../../shared/services/serviceAction.js';
import { SearchComponent } from '../../shared/utilities/utilitySearch.js';

import { ClipboardActionBar } from './view/clipboardActionBar.js';
import { ClipboardConfig } from './constants/clipboardConstants.js';
import { ClipboardGridView } from './view/clipboardGridView.js';
import { ClipboardListView } from './view/clipboardListView.js';
import { ClipboardSearchUtils } from './utilities/clipboardSearchUtils.js';
import { ensureClipboardSearchProviderRegistered } from './integrations/clipboardSearchProvider.js';

// Configuration
const RETRY_INTERVAL_MS = 16;

/**
 * ClipboardTabContent
 *
 * Main UI container for the clipboard feature.
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
            this._selectedIds = new Set();
            this._currentSearchText = '';
            this._hasRenderedOnce = false;

            this._setupSettingsSignals();
            this._searchDebouncer = new Debouncer(() => this._redraw(), ClipboardConfig.SEARCH_DEBOUNCE_MS);

            this._mainBox = new St.BoxLayout({
                vertical: true,
                style_class: 'aio-clipboard-container',
                x_expand: true,
            });
            this.set_child(this._mainBox);

            this._buildSearchComponent();
            this._buildActionBar();
            this._buildScrollableList();
            this._connectManagerSignals();
        }

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
            this._searchComponent = new SearchComponent(
                (text) => {
                    this._currentSearchText = text.toLowerCase().trim();
                    if (this._suppressSearchEffects) return;
                    this._searchDebouncer?.trigger();
                },
                {
                    onNavigateDown: () => {
                        if (this._actionBar?.visible) {
                            this._actionBar.grabFocus();
                            return true;
                        }
                        return this._focusFirstContentItem();
                    },
                },
            );

            this._mainBox.add_child(this._searchComponent.getWidget());
        }

        /**
         * Create the action bar for bulk operations and layout switching.
         *
         * @private
         */
        _buildActionBar() {
            this._actionBar = new ClipboardActionBar(this._settings, this._manager, this._selectedIds);

            this._actionBar.connect('layout-toggled', () => {
                const next = this._layoutMode === 'list' ? 'grid' : 'list';
                this._settings.set_string('clipboard-layout-mode', next);
            });

            this._actionBar.connect('selection-cleared', () => this._scheduleRedraw());
            this._actionBar.connect('select-all-requested', () => this._onSelectAllClicked());
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
                selectedIds: this._selectedIds,
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
            const allItems = this._currentView?.getAllItems() || [];
            const iconsMap = this._currentView?.getCheckboxIconsMap() || new Map();
            const shouldSelectAll = this._selectedIds.size < allItems.length;

            if (shouldSelectAll) {
                allItems.forEach((item) => {
                    this._selectedIds.add(item.id);
                    const icon = iconsMap.get(item.id);
                    if (icon) icon.state = 'checked';
                });
            } else {
                this._selectedIds.clear();
                allItems.forEach((item) => {
                    const icon = iconsMap.get(item.id);
                    if (icon) icon.state = 'unchecked';
                });
            }

            this._updateSelectionState();
        }

        /**
         * Update the action bar state based on the current selection.
         *
         * @private
         */
        _updateSelectionState() {
            const allItems = this._currentView?.getAllItems() || [];
            const validIds = new Set(allItems.map((i) => i.id));

            for (const id of this._selectedIds) {
                if (!validIds.has(id)) {
                    this._selectedIds.delete(id);
                }
            }

            this._actionBar.updateSelectionState(allItems.length);
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
            if (!this._canRenderNow()) {
                this._deferredRedrawPending = true;
                this._ensureRetry();
                return;
            }

            this._deferredRedrawPending = false;

            if (immediate) {
                if (this._redrawIdleId) GLib.source_remove(this._redrawIdleId);
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
            if (!this._currentView || !this._scrollView || !this.mapped || !this.visible) return false;
            const box = this._scrollView.get_allocation_box();
            return box && box.get_width() > 1 && box.get_height() > 1;
        }

        /**
         * Ensure redraw is retried when rendering becomes possible again.
         *
         * @private
         */
        _ensureRetry() {
            if (this._retryId) return;

            this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RETRY_INTERVAL_MS, () => {
                if (!this._deferredRedrawPending || !this._currentView) {
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
         * Perform the actual redraw of the current view.
         *
         * @private
         */
        _redraw() {
            if (!this._canRenderNow()) {
                this._deferredRedrawPending = true;
                this._ensureRetry();
                return;
            }

            let pinned = this._manager.getPinnedItems();
            let history = this._manager.getHistoryItems();
            const searching = this._currentSearchText.length > 0;

            if (searching) {
                const match = (i) => ClipboardSearchUtils.isMatch(i, this._currentSearchText);
                pinned = pinned.filter(match);
                history = history.filter(match);
            }

            this._currentView.render(pinned, history, searching);
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
            const needs = this._deferredRedrawPending || this._pendingReset || !this._hasRenderedOnce;

            if (this._pendingReset) {
                this._suppressSearchEffects = true;
                this._searchComponent?.clearSearch();
                this._suppressSearchEffects = false;
                this._pendingReset = false;
                this._currentSearchText = '';
            }

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
            const q = typeof query === 'string' ? query.trim() : '';

            this._pendingReset = false;
            this._searchDebouncer?.cancel();

            this._suppressSearchEffects = true;
            this._searchComponent?.setSearchText(q, { focus: false });
            this._suppressSearchEffects = false;

            this._currentSearchText = q.toLowerCase();
            this._scheduleRedraw(true);

            return true;
        }

        /**
         * Clear any active external search query.
         *
         * @returns {Promise<boolean>} True if the search was cleared successfully.
         */
        async clearExternalSearch() {
            return this.applyExternalSearch('');
        }

        /**
         * Handle the event when the extension menu is closed.
         */
        onMenuClosed() {
            this._deferredRedrawPending = false;
            this._searchDebouncer?.cancel();

            if (this._redrawIdleId) {
                GLib.source_remove(this._redrawIdleId);
                this._redrawIdleId = 0;
                this._redrawScheduled = false;
            }

            this._pendingReset = this._currentSearchText.length > 0;
            if (!this._pendingReset) this._currentSearchText = '';
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up resources and disconnect signals before destruction.
         */
        destroy() {
            if (this._redrawIdleId) GLib.source_remove(this._redrawIdleId);
            if (this._retryId) GLib.source_remove(this._retryId);

            this._searchDebouncer?.destroy();
            this._settingSignalIds.forEach((id) => this._settings.disconnect(id));
            this._managerSignalIds?.forEach((id) => this._manager.disconnect(id));

            this._searchComponent?.destroy();
            this._actionBar?.destroy();
            this._currentView?.destroy();

            super.destroy();
        }
    },
);
