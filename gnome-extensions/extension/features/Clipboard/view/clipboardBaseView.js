import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Abstract base class for clipboard views.
 *
 * Handles common functionality:
 * - UI scaffolding, like headers, separator, empty state
 * - Pagination / Lazy loading logic
 * - Common state management
 */
export const ClipboardBaseView = GObject.registerClass(
    {
        Signals: {
            'navigate-up': {},
        },
    },
    class ClipboardBaseView extends St.BoxLayout {
        /**
         * Initialize the base view.
         *
         * @param {Object} options Configuration options
         * @param {ClipboardManager} options.manager The clipboard manager
         * @param {number} options.imagePreviewSize Size for image previews
         * @param {Function} options.onItemCopy Callback when item is clicked/copied
         * @param {Function} options.onSelectionChanged Callback when selection changes
         * @param {Set} options.selectedIds Set of selected item IDs
         * @param {St.ScrollView} options.scrollView Parent scroll view for focus scrolling
         * @param {Gio.Settings} options.settings Extension settings
         * @param {Object} styleOptions St.BoxLayout style options
         */
        constructor(options, styleOptions = {}) {
            super({
                vertical: true,
                x_expand: true,
                y_expand: true,
                reactive: true,
                ...styleOptions,
            });

            this._manager = options.manager;
            this._imagePreviewSize = options.imagePreviewSize;
            this._onItemCopy = options.onItemCopy;
            this._onSelectionChanged = options.onSelectionChanged;
            this._selectedIds = options.selectedIds;
            this._scrollView = options.scrollView;
            this._settings = options.settings;

            this._allItems = [];
            this._pendingHistoryItems = [];
            this._batchSize = 15; // Default batch size
            this._isLoadingMore = false;
            this._restoreFocusTimeoutId = 0;
            this._scrollIdleId = 0;
            this._checkboxIconsMap = new Map();

            this._buildCommonUI();
            this._setupScrollListener();
        }

        // ========================================================================
        // Abstract Methods
        // ========================================================================

        /**
         * Create the container for pinned items. Must be implemented by subclass.
         * @abstract
         * @returns {St.Widget} The container widget
         */
        _createPinnedContainer() {
            throw new Error('Method _createPinnedContainer must be implemented by subclass');
        }

        /**
         * Create the container for history items. Must be implemented by subclass.
         * @abstract
         * @returns {St.Widget} The container widget
         */
        _createHistoryContainer() {
            throw new Error('Method _createHistoryContainer must be implemented by subclass');
        }

        /**
         * Get the item factory class for this view.
         * @abstract
         * @returns {Class} The factory class
         */
        _getItemFactory() {
            throw new Error('Method _getItemFactory must be implemented by subclass');
        }

        /**
         * Get options for creating/updating items.
         * @abstract
         * @param {boolean} isPinned Whether the item is pinned
         * @returns {Object} Options object
         */
        _getItemOptions(_isPinned) {
            throw new Error('Method _getItemOptions must be implemented by subclass');
        }

        /**
         * Update an existing item widget.
         * @param {St.Widget} widget The existing widget
         * @param {Object} itemData The new item data
         * @param {Object} [session] Render session
         * @protected
         */
        _updateItemWidget(widget, itemData, session) {
            const isPinned = session === true;
            const Factory = this._getItemFactory();
            const options = this._getItemOptions(isPinned);
            Factory.updateItem(widget, itemData, options);
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Render items into the view.
         *
         * @param {Object[]} pinnedItems Array of pinned items
         * @param {Object[]} historyItems Array of history items
         * @param {boolean} isSearching Whether a search filter is active
         */
        render(pinnedItems, historyItems, isSearching) {
            const focusState = this._captureFocusState();

            this._renderSession = {};

            this._allItems = [...pinnedItems, ...historyItems];
            this._pendingHistoryItems = historyItems;
            this._checkboxIconsMap.clear();

            if (this._allItems.length === 0) {
                this._hideAllSections();
                this._emptyLabel.text = isSearching ? _('No results found.') : _('Clipboard history is empty.');
                this._emptyLabel.show();
                return;
            } else {
                this._emptyLabel.hide();
            }

            if (pinnedItems.length > 0) {
                this._pinnedHeader.show();
                this._showPinnedContainer(true);
                this._updatePinnedItems(pinnedItems);
            } else {
                this._pinnedHeader.hide();
                this._clearPinnedContainer();
                this._showPinnedContainer(false);
            }

            if (pinnedItems.length > 0 && historyItems.length > 0) {
                this._separator.show();
            } else {
                this._separator.hide();
            }

            if (historyItems.length > 0) {
                this._historyHeader.show();
                this._showHistoryContainer(true);

                const currentCount = this._getHistoryItemCount();
                const countToRender = Math.max(this._batchSize, currentCount);
                const firstBatch = historyItems.slice(0, countToRender);

                this._updateHistoryItems(firstBatch);
            } else {
                this._historyHeader.hide();
                this._clearHistoryContainer();
                this._showHistoryContainer(false);
            }

            this._rebuildCheckboxMap();
            this._restoreFocusState(focusState);
            this._onSelectionChanged?.();
        }

        /**
         * Rebuild the checkbox map from existing widgets.
         * Crucial for maintaining state sync when widgets are reused by the layout.
         * @private
         */
        _rebuildCheckboxMap() {
            const showCheckboxes = this._settings.get_boolean('clipboard-show-action-bar');

            const registerCheckboxes = (container) => {
                if (!container) return;
                const children = container.get_children();
                for (const child of children) {
                    if (child._itemId && child._itemCheckbox) {
                        child._itemCheckbox.visible = showCheckboxes;
                        this._checkboxIconsMap.set(child._itemId, child._itemCheckbox.child);
                        if (this._selectedIds.has(child._itemId)) {
                            child._itemCheckbox.child.state = 'checked';
                        } else {
                            child._itemCheckbox.child.state = 'unchecked';
                        }
                    }
                }
            };

            registerCheckboxes(this._pinnedContainer);
            registerCheckboxes(this._historyContainer);
        }

        /**
         * Get all items.
         */
        getAllItems() {
            return this._allItems;
        }

        /**
         * Get focusable items.
         * @returns {Array} Array of focusable actors
         */
        getFocusables() {
            return [];
        }

        /**
         * Get checkbox icons map.
         */
        getCheckboxIconsMap() {
            return this._checkboxIconsMap;
        }

        /**
         * Update image preview size.
         * @param {number} size
         */
        setImagePreviewSize(size) {
            this._imagePreviewSize = size;
        }

        // ========================================================================
        // Private Helpers
        // ========================================================================

        /**
         * Build common UI components.
         * @private
         */
        _buildCommonUI() {
            this._pinnedHeader = new St.Label({
                text: _('Pinned'),
                style_class: 'clipboard-section-header',
            });
            this.add_child(this._pinnedHeader);

            this._pinnedContainer = this._createPinnedContainer();
            if (this._pinnedContainer) {
                this.add_child(this._pinnedContainer);
            }

            this._separator = new St.Widget({
                style_class: 'clipboard-separator',
                x_expand: true,
            });
            this.add_child(this._separator);

            this._historyHeader = new St.Label({
                text: _('History'),
                style_class: 'clipboard-section-header',
            });
            this.add_child(this._historyHeader);

            this._historyContainer = this._createHistoryContainer();
            if (this._historyContainer) {
                this.add_child(this._historyContainer);
            }

            this._emptyLabel = new St.Label({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            this.add_child(this._emptyLabel);

            this._hideAllSections();
        }

        /**
         * Setup scroll listener for pagination.
         * @private
         */
        _setupScrollListener() {
            if (this._scrollView) {
                const vadjustment = this._scrollView.vadjustment;
                this._scrollId = vadjustment.connect('notify::value', () => this._onScroll(vadjustment));
            }
        }

        /**
         * Hide all section headers and containers.
         * @private
         */
        _hideAllSections() {
            this._pinnedHeader.hide();
            if (this._pinnedContainer) this._pinnedContainer.hide();
            this._separator.hide();
            this._historyHeader.hide();
            if (this._historyContainer) this._historyContainer.hide();
            this._emptyLabel.hide();
        }

        /**
         * Show or hide the pinned items container.
         * @param {boolean} visible Whether to show the container
         * @private
         */
        _showPinnedContainer(visible) {
            if (this._pinnedContainer) visible ? this._pinnedContainer.show() : this._pinnedContainer.hide();
        }

        /**
         * Show or hide the history items container.
         * @param {boolean} visible Whether to show the container
         * @private
         */
        _showHistoryContainer(visible) {
            if (this._historyContainer) visible ? this._historyContainer.show() : this._historyContainer.hide();
        }

        /**
         * Get the number of items currently in the history container.
         * @returns {number} Number of items
         * @private
         */
        _getHistoryItemCount() {
            if (this._historyContainer && typeof this._historyContainer.getItemCount === 'function') {
                return this._historyContainer.getItemCount();
            }
            return 0; // Default fallback
        }

        /**
         * Update pinned items in the container.
         * @param {Array} items
         */
        _updatePinnedItems(items) {
            this._pinnedContainer.reconcile(items);
        }

        /**
         * Update history items in the container.
         * @param {Array} items
         */
        _updateHistoryItems(items) {
            this._historyContainer.reconcile(items);
        }

        /**
         * Append batch to history container.
         * @param {Array} newBatch Just the new items
         */
        _appendHistoryBatch(newBatch) {
            this._historyContainer.addItems(newBatch);
        }

        /**
         * Clear pinned container content.
         * @abstract
         */
        _clearPinnedContainer() {
            if (this._pinnedContainer && typeof this._pinnedContainer.clear === 'function') {
                this._pinnedContainer.clear();
            }
        }

        /**
         * Clear history container content.
         * @abstract
         */
        _clearHistoryContainer() {
            if (this._historyContainer && typeof this._historyContainer.clear === 'function') {
                this._historyContainer.clear();
            }
        }

        /**
         * Capture the current focus state.
         * @returns {Object|null} The captured focus state including itemId
         * @private
         */
        _captureFocusState() {
            const currentFocus = global.stage.get_key_focus();
            if (!currentFocus) return null;

            const inPinned = this._pinnedContainer && this._pinnedContainer.contains(currentFocus);
            const inHistory = this._historyContainer && this._historyContainer.contains(currentFocus);

            if (inPinned || inHistory) {
                let itemWidget = currentFocus;
                while (itemWidget && !itemWidget._itemId) {
                    itemWidget = itemWidget.get_parent();
                }

                if (itemWidget && itemWidget._itemId) {
                    return { itemId: itemWidget._itemId };
                }
            }
            return null;
        }

        /**
         * Restore focus to the previously focused item.
         * @param {Object|null} focusState The state to restore
         * @private
         */
        _restoreFocusState(focusState) {
            if (!focusState || !focusState.itemId) return;

            const findWidget = (container) => {
                if (!container) return null;
                return container.get_children().find((w) => w._itemId === focusState.itemId);
            };

            const performFocus = () => {
                const widget = findWidget(this._pinnedContainer) || findWidget(this._historyContainer);
                if (widget) {
                    const container = widget.get_parent();
                    if (container && typeof container.focusItem === 'function') {
                        container.focusItem(widget);
                        return true;
                    } else if (widget.can_focus) {
                        widget.grab_key_focus();
                        return true;
                    }
                }
                return false;
            };

            if (performFocus()) {
                return;
            }

            const pinnedPending = this._pinnedContainer?.hasPendingItems?.() ?? false;
            const historyPending = this._historyContainer?.hasPendingItems?.() ?? false;

            if (pinnedPending || historyPending) {
                if (this._restoreFocusTimeoutId) {
                    GLib.source_remove(this._restoreFocusTimeoutId);
                    this._restoreFocusTimeoutId = 0;
                }

                let attempts = 0;
                this._restoreFocusTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    attempts++;

                    if (performFocus()) {
                        this._restoreFocusTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }

                    if (attempts > 10) {
                        const stillPending = (this._pinnedContainer?.hasPendingItems?.() ?? false) || (this._historyContainer?.hasPendingItems?.() ?? false);
                        if (!stillPending) {
                            this.emit('navigate-up');
                        }
                        this._restoreFocusTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }

                    return GLib.SOURCE_CONTINUE;
                });
            } else {
                this.emit('navigate-up');
            }
        }

        /**
         * Load next batch of history items.
         * @private
         */
        async _loadNextHistoryBatch() {
            const historyItems = this._pendingHistoryItems || [];
            const actualRenderedCount = this._getHistoryItemCount();

            if (this._isLoadingMore || actualRenderedCount >= historyItems.length) {
                return;
            }

            this._isLoadingMore = true;
            const currentSession = this._renderSession;

            try {
                if (this._shouldDeferLoading()) return;

                const batch = historyItems.slice(actualRenderedCount, actualRenderedCount + this._batchSize);
                if (batch.length === 0) return;

                const SUBC_SIZE = 6;
                const processSubBatches = async (startIndex) => {
                    if (this._renderSession !== currentSession) return;
                    if (startIndex >= batch.length || !this._historyContainer) return;

                    const subBatch = batch.slice(startIndex, startIndex + SUBC_SIZE);
                    await this._prepareBatchAsync(subBatch);

                    if (this._renderSession !== currentSession) return;
                    if (!this._historyContainer) return;

                    // Yield frame to prevent UI freeze during heavy renders
                    await new Promise((resolve) => {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            resolve();
                            return GLib.SOURCE_REMOVE;
                        });
                    });

                    if (this._renderSession !== currentSession) return;
                    if (!this._historyContainer) return;
                    this._appendHistoryBatch(subBatch);

                    await processSubBatches(startIndex + SUBC_SIZE);
                };

                await processSubBatches(0);
            } finally {
                this._isLoadingMore = false;
            }
        }

        /**
         * Hook for subclasses to prepare items asynchronously before rendering.
         * Default implementation is a no-op.
         * @param {Array} _batch The batch to prepare
         * @returns {Promise<void>}
         * @protected
         */
        async _prepareBatchAsync(_batch) {
            // No-op in base class
        }

        /**
         * Check if loading should be deferred.
         * @returns {boolean} True if loading should be deferred
         * @private
         */
        _shouldDeferLoading() {
            return this._historyContainer?.shouldDeferLoading?.() ?? false;
        }

        // ========================================================================
        // Event Handlers
        // ========================================================================

        /**
         * Handle scroll events.
         * @param {St.Adjustment} vadjustment
         * @private
         */
        _onScroll(vadjustment) {
            const historyItems = this._pendingHistoryItems || [];
            const actualRenderedCount = this._getHistoryItemCount();

            if (this._isLoadingMore || actualRenderedCount >= historyItems.length) {
                return;
            }

            const threshold = vadjustment.upper - vadjustment.page_size - 500;
            if (vadjustment.value >= threshold) {
                if (this._scrollIdleId) return;

                this._scrollIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._scrollIdleId = 0;
                    this._loadNextHistoryBatch();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clear the view and reset pagination properties before a structural redraw.
         */
        resetScrollAndPagination() {
            if (this._scrollView) {
                this._scrollView.vadjustment.value = 0;
            }
            this._isLoadingMore = false;
            if (this._pinnedContainer) this._pinnedContainer.clear();
            if (this._historyContainer) this._historyContainer.clear();
        }

        /**
         * Clear all items and reset state.
         */
        clear() {
            this._allItems = [];
            this._pendingHistoryItems = [];
            this._isLoadingMore = false;
            this._checkboxIconsMap.clear();

            this._hideAllSections();
            this._clearPinnedContainer();
            this._clearHistoryContainer();
        }

        /**
         * Destroy the view and clean up resources.
         */
        destroy() {
            this._renderSession = {}; // invalidate session instantly

            if (this._restoreFocusTimeoutId) {
                GLib.source_remove(this._restoreFocusTimeoutId);
                this._restoreFocusTimeoutId = 0;
            }
            if (this._scrollIdleId) {
                GLib.source_remove(this._scrollIdleId);
                this._scrollIdleId = 0;
            }

            this._allItems = null;
            this._pendingHistoryItems = null;
            this._manager = null;
            this._onItemCopy = null;
            this._onSelectionChanged = null;
            this._selectedIds = null;
            this._checkboxIconsMap.clear();

            if (this._scrollView && this._scrollId) {
                this._scrollView.vadjustment.disconnect(this._scrollId);
                this._scrollId = null;
            }
            this._scrollView = null;

            // Detach heavy containers to prevent synchronous recursive destruction
            const pinnedContainer = this._pinnedContainer;
            const historyContainer = this._historyContainer;

            this._pinnedContainer = null;
            this._historyContainer = null;

            if (pinnedContainer) {
                const parent = pinnedContainer.get_parent();
                if (parent) parent.remove_child(pinnedContainer);
            }
            if (historyContainer) {
                const parent = historyContainer.get_parent();
                if (parent) parent.remove_child(historyContainer);
            }

            super.destroy();

            // Destroy detached containers asynchronously in chunks
            const destroyAsync = (container) => {
                if (!container) return;

                // Cancel all pending layout work before async teardown
                container.clear();

                const children = container.get_children();
                if (children.length === 0) {
                    container.destroy();
                    return;
                }

                let i = 0;
                const CHUNK_SIZE = 15;

                GLib.idle_add(GLib.PRIORITY_LOW, () => {
                    const chunk = children.slice(i, i + CHUNK_SIZE);
                    chunk.forEach((c) => {
                        if (c) c.destroy();
                    });

                    i += CHUNK_SIZE;
                    if (i >= children.length) {
                        try {
                            container.destroy();
                        } catch {
                            // Already destroyed or invalid
                        }
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            };

            destroyAsync(pinnedContainer);
            destroyAsync(historyContainer);
        }
    },
);
