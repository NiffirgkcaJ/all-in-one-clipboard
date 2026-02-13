import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * ClipboardBaseView
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
            this._isDestroyed = false;
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
        }

        /**
         * Rebuild the checkbox map from existing widgets.
         * Crucial for maintaining state sync when widgets are reused by the layout.
         * @private
         */
        _rebuildCheckboxMap() {
            const registerCheckboxes = (container) => {
                if (!container) return;
                const children = container.get_children();
                for (const child of children) {
                    if (child._itemId && child._itemCheckbox) {
                        // Ensure we have the latest state from the widget
                        this._checkboxIconsMap.set(child._itemId, child._itemCheckbox.child);

                        // Ensure visual state matches
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
         * Build common UI components (Headers, Separator, Empty Label).
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
            // Subclass must implement if container provides count, otherwise default 0
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
         * @param {Array} newBatch - Just the new items
         */
        _appendHistoryBatch(newBatch) {
            this._historyContainer.addItems(newBatch);
        }

        /**
         * Clear pinned container content.
         * @abstract
         */
        _clearPinnedContainer() {
            // Optional override
            if (this._pinnedContainer && typeof this._pinnedContainer.clear === 'function') {
                this._pinnedContainer.clear();
            }
        }

        /**
         * Clear history container content.
         * @abstract
         */
        _clearHistoryContainer() {
            // Optional override
            if (this._historyContainer && typeof this._historyContainer.clear === 'function') {
                this._historyContainer.clear();
            }
        }

        /**
         * Capture the current focus state.
         * @returns {Object|null}
         */
        _captureFocusState() {
            const currentFocus = global.stage.get_key_focus();
            if (!currentFocus) return null;

            // Check if focus is inside one of our containers
            const inPinned = this._pinnedContainer && this._pinnedContainer.contains(currentFocus);
            const inHistory = this._historyContainer && this._historyContainer.contains(currentFocus);

            if (inPinned || inHistory) {
                // Walk up to find the item (which checks the _itemId)
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
         * @param {Object|null} focusState
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
                let attempts = 0;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    attempts++;

                    if (this._isDestroyed) return GLib.SOURCE_REMOVE;

                    if (performFocus()) {
                        return GLib.SOURCE_REMOVE;
                    }

                    if (attempts > 10) {
                        const stillPending = (this._pinnedContainer?.hasPendingItems?.() ?? false) || (this._historyContainer?.hasPendingItems?.() ?? false);

                        if (!stillPending) {
                            this.emit('navigate-up');
                        }
                        return GLib.SOURCE_REMOVE;
                    }

                    return GLib.SOURCE_CONTINUE;
                });
            } else {
                this.emit('navigate-up');
            }
        }

        /**
         * Load next batch.
         * @private
         */
        _loadNextHistoryBatch() {
            const historyItems = this._pendingHistoryItems || [];
            const actualRenderedCount = this._getHistoryItemCount();

            if (this._isLoadingMore || actualRenderedCount >= historyItems.length) {
                return;
            }

            this._isLoadingMore = true;

            try {
                // Subclasses can implement hooks to validate before loading
                if (this._shouldDeferLoading()) return;

                const batch = historyItems.slice(actualRenderedCount, actualRenderedCount + this._batchSize);
                if (batch.length === 0) return;

                this._appendHistoryBatch(batch);
            } finally {
                this._isLoadingMore = false;
            }
        }

        /**
         * Check if loading should be deferred.
         * @returns {boolean} True if loading should be deferred
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
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (!this._isDestroyed) {
                        this._loadNextHistoryBatch();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clear all items.
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
         * Destroy the view.
         */
        destroy() {
            this._isDestroyed = true;
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

            super.destroy();
        }
    },
);
