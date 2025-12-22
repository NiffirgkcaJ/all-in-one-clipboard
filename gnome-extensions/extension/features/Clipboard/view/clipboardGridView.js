import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { MasonryLayout } from '../../../shared/utilities/utilityMasonryLayout.js';

import { ClipboardGridItemFactory } from './clipboardGridItemFactory.js';

/**
 * ClipboardGridView - Masonry grid layout for clipboard items.
 *
 * Renders clipboard items as cards in a Pinterest-style masonry grid.
 * Each card contains the content preview and action buttons.
 *
 * Extends St.BoxLayout to be compatible with St.ScrollView (StScrollable).
 * The MasonryLayout is added as a child and handles absolute positioning internally.
 */
export const ClipboardGridView = GObject.registerClass(
    {
        Signals: {
            'navigate-up': {},
        },
    },
    class ClipboardGridView extends St.BoxLayout {
        /**
         * Initialize the grid view.
         *
         * @param {Object} options - Configuration options
         * @param {ClipboardManager} options.manager - The clipboard manager
         * @param {number} options.imagePreviewSize - Size for image previews
         * @param {Function} options.onItemCopy - Callback when item is clicked/copied
         * @param {Function} options.onSelectionChanged - Callback when selection changes
         * @param {Set} options.selectedIds - Set of selected item IDs (shared state)
         * @param {St.ScrollView} options.scrollView - Parent scroll view for focus scrolling
         */
        constructor(options) {
            super({
                vertical: true,
                style_class: 'clipboard-grid-container',
                x_expand: true,
                y_expand: true,
                reactive: true,
            });

            this._manager = options.manager;
            this._imagePreviewSize = options.imagePreviewSize;
            this._onItemCopy = options.onItemCopy;
            this._onSelectionChanged = options.onSelectionChanged;
            this._selectedIds = options.selectedIds;
            this._scrollView = options.scrollView;
            this._settings = options.settings;

            this._allItems = [];
            this._pendingPinnedItems = [];
            this._pendingHistoryItems = [];

            // Pagination state for history section
            this._batchSize = 12;
            this._isLoadingMore = false;

            this._renderSession = null;
            this._pendingRenderTimeoutId = null;
            this._isDestroyed = false;
            this._checkboxIconsMap = new Map();
            this._dimensionCache = new Map();

            // Pinned section
            this._pinnedHeader = new St.Label({
                text: _('Pinned'),
                style_class: 'clipboard-section-header',
            });
            this.add_child(this._pinnedHeader);

            this._pinnedMasonry = new MasonryLayout({
                columns: 3,
                spacing: 8,
                scrollView: this._scrollView,
                renderItemFn: this._renderCard.bind(this),
            });
            this.add_child(this._pinnedMasonry);

            // Separator
            this._separator = new St.Widget({
                style_class: 'clipboard-separator',
                x_expand: true,
            });
            this.add_child(this._separator);

            // History section
            this._historyHeader = new St.Label({
                text: _('History'),
                style_class: 'clipboard-section-header',
            });
            this.add_child(this._historyHeader);

            this._historyMasonry = new MasonryLayout({
                columns: 3,
                spacing: 8,
                scrollView: this._scrollView,
                renderItemFn: this._renderCard.bind(this),
            });
            this.add_child(this._historyMasonry);

            // Empty state label
            this._emptyLabel = new St.Label({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            this.add_child(this._emptyLabel);

            // Hide headers/separator/emptyLabel by default, masonries stay visible for allocation
            this._pinnedHeader.hide();
            this._separator.hide();
            this._historyHeader.hide();
            this._emptyLabel.hide();

            // Keyboard navigation delegated to section masonries
            this.connect('key-press-event', this._onKeyPress.bind(this));

            // Setup scroll listener for history pagination
            if (this._scrollView) {
                const vadjustment = this._scrollView.vadjustment;
                vadjustment.connect('notify::value', () => this._onScroll(vadjustment));
            }
        }

        // ========================================================================
        // Public Interface
        // ========================================================================

        /**
         * Render items into the grid.
         *
         * @param {Object[]} pinnedItems - Array of pinned items
         * @param {Object[]} historyItems - Array of history items
         * @param {boolean} isSearching - Whether a search filter is active
         */
        render(pinnedItems, historyItems, isSearching) {
            this._cancelPendingRender();

            this._pendingPinnedItems = pinnedItems;
            this._pendingHistoryItems = historyItems;
            this._allItems = [...pinnedItems, ...historyItems];
            this._pendingIsSearching = isSearching;

            this._doRender();
        }

        /**
         * Clear all items from the grid.
         */
        clear() {
            this._pinnedMasonry.clear();
            this._historyMasonry.clear();
            this._pinnedHeader.hide();
            this._separator.hide();
            this._historyHeader.hide();
            this._emptyLabel.hide();
            this._allItems = [];
            this._checkboxIconsMap.clear();
        }

        /**
         * Get all focusable buttons in the grid.
         *
         * @returns {St.Widget[]} Array of focusable widgets
         */
        getFocusables() {
            const pinnedFocusables = this._pinnedMasonry?.get_children().filter((w) => w.can_focus) || [];
            const historyFocusables = this._historyMasonry?.get_children().filter((w) => w.can_focus) || [];
            return [...pinnedFocusables, ...historyFocusables];
        }

        /**
         * Get all items currently rendered.
         *
         * @returns {Object[]} Array of item data objects
         */
        getAllItems() {
            return this._allItems;
        }

        /**
         * Get the checkbox icon map (not used in grid view but required for interface).
         *
         * @returns {Map} Empty map (grid view doesn't use checkboxes)
         */
        getCheckboxIconsMap() {
            return this._checkboxIconsMap;
        }

        /**
         * Update the image preview size.
         *
         * @param {number} size - New preview size
         */
        setImagePreviewSize(size) {
            this._imagePreviewSize = size;
        }

        // ========================================================================
        // Rendering
        // ========================================================================

        /**
         * Actually perform the render operation.
         * @private
         */
        _doRender() {
            const pinnedItems = this._pendingPinnedItems || [];
            const historyItems = this._pendingHistoryItems || [];
            const isSearching = this._pendingIsSearching || false;

            // Reset state
            this._checkboxIconsMap.clear();
            this._isLoadingMore = false;

            // Clear existing masonry content, masonries stay visible for allocation
            this._pinnedMasonry.clear();
            this._historyMasonry.clear();

            // Hide headers/separator/empty label first
            this._pinnedHeader.hide();
            this._separator.hide();
            this._historyHeader.hide();
            this._emptyLabel.hide();

            // Empty state
            if (this._allItems.length === 0) {
                this._emptyLabel.text = isSearching ? _('No results found.') : _('Clipboard history is empty.');
                this._emptyLabel.show();
                return;
            }

            // Pinned section
            if (pinnedItems.length > 0) {
                this._pinnedHeader.show();

                const preparedPinned = this._prepareItemsForGrid(pinnedItems, true);
                this._pinnedMasonry.addItems(preparedPinned);
                this._pinnedMasonry.queue_relayout();
            }

            // Separator shown only if both sections have items
            if (pinnedItems.length > 0 && historyItems.length > 0) {
                this._separator.show();
            }

            // History section with lazy batch loading
            if (historyItems.length > 0) {
                this._historyHeader.show();

                const firstBatch = historyItems.slice(0, this._batchSize);
                const preparedBatch = this._prepareItemsForGrid(firstBatch, false);
                this._historyMasonry.addItems(preparedBatch);
                this._historyMasonry.queue_relayout();
            }
        }

        /**
         * Handle scroll events to trigger loading more history items.
         * @param {St.Adjustment} vadjustment
         * @private
         */
        _onScroll(vadjustment) {
            const historyItems = this._pendingHistoryItems || [];
            const actualRenderedCount = this._historyMasonry?.getItemCount() || 0;
            if (this._isLoadingMore || actualRenderedCount >= historyItems.length) {
                return;
            }

            // Load more when within 500px of bottom
            const threshold = vadjustment.upper - vadjustment.page_size - 500;
            if (vadjustment.value >= threshold) {
                // Defer to idle to ensure scroll handling happens in clean allocation state
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (!this._isDestroyed) {
                        this._loadNextHistoryBatch();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        /**
         * Load the next batch of history items.
         * @private
         */
        _loadNextHistoryBatch() {
            const historyItems = this._pendingHistoryItems || [];
            const actualRenderedCount = this._historyMasonry?.getItemCount() || 0;

            if (this._isLoadingMore || actualRenderedCount >= historyItems.length || !this._historyMasonry) {
                return;
            }

            // Skip if masonry width is invalid, items would just be deferred
            if (!this._historyMasonry.hasValidWidth()) {
                return;
            }

            // Skip while pending deferred items to prevent duplicates
            if (this._historyMasonry.hasPendingItems()) {
                return;
            }

            this._isLoadingMore = true;

            try {
                const batch = historyItems.slice(actualRenderedCount, actualRenderedCount + this._batchSize);
                if (batch.length === 0) {
                    return;
                }

                const preparedBatch = this._prepareItemsForGrid(batch, false);
                this._historyMasonry.addItems(preparedBatch);
                this._historyMasonry.queue_relayout();
            } finally {
                this._isLoadingMore = false;
            }
        }

        /**
         * Calculate dimensions and prepare items for the grid.
         * @param {Array} items - Items to process
         * @param {boolean} isPinned - Whether these items are pinned
         * @returns {Array} Processed items with width/height
         * @private
         */
        _prepareItemsForGrid(items, isPinned) {
            return items.map((item) => {
                let width = 1;
                let height = this._estimateCardHeight(item); // Default to estimated height

                if (item.type === 'image' && item.image_filename) {
                    // Check stored dimensions from item data for new images
                    if (item.width && item.height) {
                        width = item.width;
                        const minHeight = width * (9 / 16);
                        height = Math.max(item.height, minHeight);
                    } else {
                        // Legacy items try cache or trigger async load
                        const dims = this._getImageDimensions(item.image_filename);
                        if (dims) {
                            width = dims.width;
                            const minHeight = width * (9 / 16);
                            height = Math.max(dims.height, minHeight);
                        }
                        // If no dims, keep the estimated height from default
                    }
                }

                return {
                    ...item,
                    _isPinned: isPinned,
                    width,
                    height,
                };
            });
        }

        /**
         * Cancel pending render timeout.
         * @private
         */
        _cancelPendingRender() {
            if (this._pendingRenderTimeoutId) {
                GLib.source_remove(this._pendingRenderTimeoutId);
                this._pendingRenderTimeoutId = null;
            }
        }

        // ========================================================================
        // Keyboard Navigation
        // ========================================================================

        /**
         * Handle keyboard navigation within the grid.
         *
         * @param {St.Widget} _actor - The actor that received the event (unused)
         * @param {Clutter.Event} event - The key press event
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        _onKeyPress(_actor, event) {
            const symbol = event.get_key_symbol();
            const currentFocus = global.stage.get_key_focus();
            const pinnedHasItems = this._pinnedMasonry.get_n_children() > 0;
            const historyHasItems = this._historyMasonry.get_n_children() > 0;

            const getCurrentCenterX = () => {
                if (!currentFocus?._masonryData) return undefined;
                const data = currentFocus._masonryData;
                return data.x + data.width / 2;
            };

            // Check if focus is in pinned section
            if (pinnedHasItems && this._pinnedMasonry.contains(currentFocus)) {
                const result = this._pinnedMasonry.handleKeyPress(this._pinnedMasonry, event);
                if (result === Clutter.EVENT_STOP) return result;

                // Cross-section navigation from pinned
                if (symbol === Clutter.KEY_Down && historyHasItems) {
                    this._historyMasonry.focusFirst(getCurrentCenterX());
                    return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Up) {
                    this.emit('navigate-up');
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            // Check if focus is in history section
            if (historyHasItems && this._historyMasonry.contains(currentFocus)) {
                const result = this._historyMasonry.handleKeyPress(this._historyMasonry, event);
                if (result === Clutter.EVENT_STOP) return result;

                // Cross-section navigation from history
                if (symbol === Clutter.KEY_Up && pinnedHasItems) {
                    this._pinnedMasonry.focusLast(getCurrentCenterX());
                    return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Up) {
                    this.emit('navigate-up');
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        // ========================================================================
        // Image Dimensions
        // ========================================================================

        /**
         * Get dimensions for an image file from cache.
         * If not in cache, returns null and triggers async load.
         *
         * @param {string} filename - The image filename
         * @returns {Object|null} { width, height } or null if not yet loaded
         * @private
         */
        _getImageDimensions(filename) {
            if (this._dimensionCache.has(filename)) {
                return this._dimensionCache.get(filename);
            }

            // Trigger async load if not already loading, null means failed, undefined means new
            if (this._dimensionCache.get(filename) === undefined) {
                this._loadDimensionsAsync(filename);
            }

            return null;
        }

        /**
         * Asynchronously load image dimensions using PixbufLoader.
         * Only reads the header to be efficient.
         *
         * @param {string} filename - The image filename
         * @private
         */
        async _loadDimensionsAsync(filename) {
            // Mark as loading to prevent duplicate requests
            if (!this._pendingLoads) this._pendingLoads = new Set();
            if (this._pendingLoads.has(filename)) return;

            this._pendingLoads.add(filename);

            try {
                const filePath = GLib.build_filenamev([this._manager._imagesDir, filename]);
                const file = Gio.File.new_for_path(filePath);

                // Use PixbufLoader to read only the header
                const loader = new GdkPixbuf.PixbufLoader();
                let gotDimensions = false;

                const sizePreparedId = loader.connect('size-prepared', (_loader, width, height) => {
                    gotDimensions = true;
                    this._dimensionCache.set(filename, { width, height });
                    loader.close(); // Stop processing once we have dimensions
                });

                try {
                    // Read stream
                    const stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
                    const buffer = new Uint8Array(4096);

                    // Recursive function to pump data until dimensions are found or EOF
                    const pumpStream = async () => {
                        const bytesRead = await stream.read_async(buffer, GLib.PRIORITY_DEFAULT, null);
                        if (bytesRead === 0) return; // EOF

                        loader.write(buffer.slice(0, bytesRead));

                        // Continue only if we still need dimensions
                        if (!gotDimensions) {
                            await pumpStream();
                        }
                    };

                    await pumpStream();
                } catch (e) {
                    // Loader closed expectedly?
                    if (!gotDimensions) {
                        // Real error
                        console.warn(`[AIO-Clipboard] Failed to load dimensions for ${filename}: ${e.message}`);
                    }
                } finally {
                    if (sizePreparedId) loader.disconnect(sizePreparedId);
                    // Ensure loader is closed if not already
                    try {
                        loader.close();
                    } catch {
                        // Ignore already closed error
                    }
                }

                if (gotDimensions) {
                    // Schedule a debounced re-render to update card sizes
                    this._scheduleRerender();
                } else {
                    this._dimensionCache.set(filename, null); // Failed
                }
            } catch (e) {
                console.warn(`[AIO-Clipboard] General error loading ${filename}: ${e.message}`);
                this._dimensionCache.set(filename, null);
            } finally {
                this._pendingLoads.delete(filename);
            }
        }

        /**
         * Schedule a debounced re-render after async dimension loads complete.
         * Batches multiple dimension loads into a single render pass.
         * Preserves current scroll/pagination state.
         * @private
         */
        _scheduleRerender() {
            if (this._isDestroyed) return;

            // Cancel any pending scheduled re-render
            if (this._dimensionRerenderTimeoutId) {
                GLib.source_remove(this._dimensionRerenderTimeoutId);
            }

            // Debounce 50ms for more dimension loads to complete
            this._dimensionRerenderTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                this._dimensionRerenderTimeoutId = null;
                if (!this._isDestroyed) {
                    this._doRenderPreservingState();
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Re-render while preserving current pagination state.
         * Used after async dimension loads to update layouts without losing scroll position.
         * @private
         */
        _doRenderPreservingState() {
            const pinnedItems = this._pendingPinnedItems || [];
            const historyItems = this._pendingHistoryItems || [];
            const previouslyDisplayedCount = this._historyMasonry?.getItemCount() || 0;

            // Clear and re-render
            this._checkboxIconsMap.clear();
            this._pinnedMasonry.clear();
            this._historyMasonry.clear();

            // Pinned section
            if (pinnedItems.length > 0) {
                const preparedPinned = this._prepareItemsForGrid(pinnedItems, true);
                this._pinnedMasonry.addItems(preparedPinned);
                this._pinnedMasonry.queue_relayout();
            }

            // History section restoring all previously displayed items
            if (historyItems.length > 0 && previouslyDisplayedCount > 0) {
                const itemsToRestore = historyItems.slice(0, previouslyDisplayedCount);
                const preparedHistory = this._prepareItemsForGrid(itemsToRestore, false);
                this._historyMasonry.addItems(preparedHistory);
                this._historyMasonry.queue_relayout();
            }
        }

        // ========================================================================
        // Item Widget Creation
        // ========================================================================

        /**
         * Estimate the height of a card based on item type.
         *
         * @param {Object} item - The clipboard item
         * @returns {number} Estimated relative height
         * @private
         */
        _estimateCardHeight(item) {
            // Return a relative height for masonry layout
            switch (item.type) {
                case 'image':
                    return 1.5; // Images are taller
                case 'text':
                case 'code': {
                    // Scale height based on content length
                    const len = item.preview?.length || 0;
                    if (len > 200) return 1.5;
                    if (len > 100) return 1.2;
                    if (len > 50) return 0.9;
                    return 0.7; // Short text gets compact card
                }
                default:
                    return 1.0; // Other types like URL, contact, file, color
            }
        }

        /**
         * Render a single card for the masonry layout.
         * Delegates to ClipboardGridItemFactory.
         *
         * @param {Object} itemData - The item data with _isPinned flag
         * @param {Object} _session - Render session (unused)
         * @returns {St.Widget} The card widget
         * @private
         */
        _renderCard(itemData, _session) {
            return ClipboardGridItemFactory.createGridItem(itemData, {
                imagesDir: this._manager._imagesDir,
                linkPreviewsDir: this._manager._linkPreviewsDir,
                imagePreviewSize: this._imagePreviewSize * 2, // Larger for grid
                onItemCopy: this._onItemCopy,
                manager: this._manager,
                selectedIds: this._selectedIds,
                onSelectionChanged: this._onSelectionChanged,
                checkboxIconsMap: this._checkboxIconsMap,
                settings: this._settings,
            });
        }

        // ========================================================================
        // Focus State Management
        // ========================================================================

        /**
         * Capture the current focus state before re-rendering.
         *
         * @returns {Object|null} Focus info with item ID and index, or null if not focused
         * @private
         */
        _captureFocusState() {
            const currentFocus = global.stage.get_key_focus();
            if (!currentFocus) return null;

            // Check if focus is on a card in pinned masonry
            const pinnedChildren = this._pinnedMasonry?.get_children() || [];
            for (let i = 0; i < pinnedChildren.length; i++) {
                const card = pinnedChildren[i];
                if (card === currentFocus && card._masonryData?.id) {
                    return { itemId: card._masonryData.id, section: 'pinned', sectionIndex: i };
                }
            }

            // Check if focus is on a card in history masonry
            const historyChildren = this._historyMasonry?.get_children() || [];
            for (let i = 0; i < historyChildren.length; i++) {
                const card = historyChildren[i];
                if (card === currentFocus && card._masonryData?.id) {
                    return { itemId: card._masonryData.id, section: 'history', sectionIndex: i };
                }
            }

            return null;
        }

        /**
         * Restore focus state after re-rendering.
         * Falls back to adjacent item in the same section if original was deleted.
         *
         * @param {Object|null} focusInfo - Previously captured focus info
         * @private
         */
        _restoreFocusState(focusInfo) {
            if (!focusInfo) return;

            // Search for the card with the same item ID
            const findAndFocus = (masonry) => {
                const children = masonry?.get_children() || [];
                for (const card of children) {
                    if (card._masonryData?.id === focusInfo.itemId && card.can_focus) {
                        card.grab_key_focus();
                        return true;
                    }
                }
                return false;
            };

            // Try to find exact item first
            if (findAndFocus(this._pinnedMasonry) || findAndFocus(this._historyMasonry)) {
                return;
            }

            // Item deleted, fallback to adjacent item in same section
            const masonry = focusInfo.section === 'pinned' ? this._pinnedMasonry : this._historyMasonry;
            const children = masonry?.get_children() || [];
            if (children.length > 0) {
                const targetIndex = Math.min(focusInfo.sectionIndex, children.length - 1);
                const targetCard = children[targetIndex];
                if (targetCard?.can_focus) {
                    targetCard.grab_key_focus();
                }
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        destroy() {
            // Mark as destroyed to prevent pending callbacks
            this._isDestroyed = true;
            this._cancelPendingRender();

            // Cancel dimension re-render timer
            if (this._dimensionRerenderTimeoutId) {
                GLib.source_remove(this._dimensionRerenderTimeoutId);
                this._dimensionRerenderTimeoutId = null;
            }

            // Clear all references before destruction
            this._allItems = [];
            this._renderSession = null;
            this._pendingPinnedItems = null;
            this._pendingHistoryItems = null;
            this._pendingIsSearching = null;
            this._dimensionCache.clear();

            this._pinnedMasonry?.destroy();
            this._historyMasonry?.destroy();
            this._pinnedMasonry = null;
            this._historyMasonry = null;
            this._manager = null;
            this._onItemCopy = null;
            this._onSelectionChanged = null;
            this._selectedIds = null;
            this._scrollView = null;
            super.destroy();
        }
    },
);
