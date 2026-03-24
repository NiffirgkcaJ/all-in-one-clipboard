import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { MasonryLayout } from '../../../shared/utilities/utilityMasonryLayout.js';

import { ClipboardBaseView } from './clipboardBaseView.js';
import { ClipboardGridItemFactory } from './clipboardGridItemFactory.js';
import { ClipboardConfig, ClipboardSettings } from '../constants/clipboardConstants.js';
import { GridMetrics, GridVirtualization } from '../constants/clipboardLayoutConstants.js';
/**
 * ClipboardGridView
 * Masonry grid layout for clipboard items.
 *
 * Renders clipboard items as cards in a Pinterest-style masonry grid.
 * Each card contains the content preview and action buttons.
 *
 * Extends ClipboardBaseView for shared scaffolding like headers, pagination, etc.
 * The MasonryLayout children handle absolute positioning internally.
 */
export const ClipboardGridView = GObject.registerClass(
    class ClipboardGridView extends ClipboardBaseView {
        /**
         * Initialize the grid view.
         * @param {Object} options Configuration options
         */
        constructor(options) {
            super(options, {
                style_class: 'clipboard-grid-view',
            });

            // Dimensions are cached incrementally and refined in the background as real image sizes arrive.
            this._dimensionCache = new Map();

            this._gridPinnedItems = [];
            this._gridHistoryItems = [];
            this._gridColumnSignalIds = [];

            this.connect('key-press-event', this._onKeyPress.bind(this));
            this._bindGridColumnSettings();
        }

        // ========================================================================
        // Abstract Method Implementation
        // ========================================================================

        /**
         * Create the container for pinned items.
         * @returns {MasonryLayout} The masonry layout container
         * @override
         */
        _createPinnedContainer() {
            return new MasonryLayout({
                targetItemWidth: ClipboardConfig.TARGET_ITEM_WIDTH,
                spacing: 8,
                maxColumns: this._getMaxColumnsSetting(),
                virtualization: true,
                virtualMinItems: GridVirtualization.PINNED_MIN_ITEMS,
                virtualOverscanPx: GridVirtualization.OVERSCAN_PX,
                scrollView: this._scrollView,
                renderItemFn: (item) => this._createItemWidget(item, true),
                updateItemFn: (widget, item) => this._updateItemWidget(widget, item, true),
                prepareItemFn: (item) => this._prepareGridItem(item, true),
            });
        }

        /**
         * Create the container for history items.
         * @returns {MasonryLayout} The masonry layout container
         * @override
         */
        _createHistoryContainer() {
            return new MasonryLayout({
                targetItemWidth: ClipboardConfig.TARGET_ITEM_WIDTH,
                spacing: 8,
                maxColumns: this._getMaxColumnsSetting(),
                virtualization: true,
                virtualMinItems: GridVirtualization.HISTORY_MIN_ITEMS,
                virtualOverscanPx: GridVirtualization.OVERSCAN_PX,
                scrollView: this._scrollView,
                renderItemFn: (item) => this._createItemWidget(item, false),
                updateItemFn: (widget, item) => this._updateItemWidget(widget, item, false),
                prepareItemFn: (item) => this._prepareGridItem(item, false),
            });
        }

        /**
         * Get the item factory class.
         * @returns {Class} ClipboardGridItemFactory
         * @override
         */
        _getItemFactory() {
            return ClipboardGridItemFactory;
        }

        /**
         * Get item options.
         * @param {boolean} isPinned
         * @returns {Object}
         * @override
         */
        _getItemOptions(isPinned) {
            return {
                isPinned: isPinned,
                imagesDir: this._manager._imagesDir,
                imagePreviewsDir: this._manager._imagePreviewsDir,
                linkPreviewsDir: this._manager._linkPreviewsDir,
                imagePreviewSize: this._imagePreviewSize * 2,
                onItemCopy: this._onItemCopy,
                manager: this._manager,
                selectedIds: this._selectedIds,
                onSelectionChanged: this._onSelectionChanged,
                checkboxIconsMap: this._checkboxIconsMap,
                settings: this._settings,
            };
        }

        // ========================================================================
        // Overrides
        // ========================================================================

        /**
         * Render items into the grid view.
         * Paint immediately using estimated dimensions, then refine the first viewport
         * asynchronously once image metadata is available.
         * @param {Object[]} pinnedItems Array of pinned items
         * @param {Object[]} historyItems Array of history items
         * @param {boolean} isSearching Whether a search filter is active
         * @override
         */
        render(pinnedItems, historyItems, isSearching) {
            this._gridRenderGeneration = (this._gridRenderGeneration || 0) + 1;
            const currentGeneration = this._gridRenderGeneration;

            this._gridPinnedItems = pinnedItems;
            this._gridHistoryItems = historyItems;
            this._gridIsSearching = isSearching;

            super.render(pinnedItems, historyItems, isSearching);

            const initialHistoryBatch = historyItems.slice(0, GridMetrics.FAST_PAINT_BATCH_SIZE);
            const initialItems = [...pinnedItems.slice(0, GridMetrics.FAST_PAINT_BATCH_SIZE), ...initialHistoryBatch];

            const hasUncachedImage = initialItems.some((item) => item && item.type === 'image' && item.image_filename && !this._dimensionCache?.has(item.image_filename));
            if (!hasUncachedImage) return;

            this._prepareBatchAsync(initialItems).then(() => {
                // Prevent race conditions if the view was reset during async loading.
                if (!this._dimensionCache) return;
                if (this._gridRenderGeneration !== currentGeneration) return;

                super.render(this._gridPinnedItems || [], this._gridHistoryItems || [], this._gridIsSearching || false);
            });
        }

        /**
         * Get all focusable items.
         * @returns {Array} Array of focusable actors
         * @override
         */
        getFocusables() {
            const pinnedFocusables = this._pinnedContainer?.get_children().filter((w) => w._itemId && w.can_focus) || [];
            const historyFocusables = this._historyContainer?.get_children().filter((w) => w._itemId && w.can_focus) || [];
            return [...pinnedFocusables, ...historyFocusables];
        }

        /**
         * Hook for BaseView to resolve metrics before feeding masonry layout.
         * @param {Array} batch The batch of items to prepare
         * @returns {Promise<void>}
         * @protected
         * @override
         */
        async _prepareBatchAsync(batch) {
            const imagesToResolve = batch.filter((item) => item && item.type === 'image' && item.image_filename && !this._dimensionCache.has(item.image_filename));

            if (imagesToResolve.length === 0) return;

            const promises = imagesToResolve.map((item) => this._resolveImageDimensionsAsync(item.image_filename));
            await Promise.all(promises);
        }

        // ========================================================================
        // Private Helpers
        // ========================================================================

        /**
         * Render a single card widget for the masonry layout.
         * @param {Object} itemData The item data with _isPinned flag
         * @param {Object} _session Render session is unused
         * @returns {St.Widget} The card widget
         * @private
         */
        _createItemWidget(itemData, _session) {
            const isPinned = _session === true;
            const options = this._getItemOptions(isPinned);
            return ClipboardGridItemFactory.createItem(itemData, options);
        }

        /**
         * Read the max columns setting when the limit is enabled.
         * @returns {number|null} max columns or null for auto
         * @private
         */
        _getMaxColumnsSetting() {
            if (!this._settings?.get_boolean(ClipboardSettings.GRID_LIMIT_COLUMNS_KEY)) return null;
            const maxColumns = this._settings.get_int(ClipboardSettings.GRID_MAX_COLUMNS_KEY);
            return maxColumns > 0 ? maxColumns : null;
        }

        /**
         * Bind settings for grid column limits.
         * @private
         */
        _bindGridColumnSettings() {
            if (!this._settings) return;
            const keys = [ClipboardSettings.GRID_LIMIT_COLUMNS_KEY, ClipboardSettings.GRID_MAX_COLUMNS_KEY];
            keys.forEach((key) => {
                const id = this._settings.connect(`changed::${key}`, () => this._applyColumnLimit());
                this._gridColumnSignalIds.push(id);
            });
        }

        /**
         * Apply the current column limit to masonry containers.
         * @private
         */
        _applyColumnLimit() {
            const maxColumns = this._getMaxColumnsSetting();
            this._pinnedContainer?.setMaxColumns?.(maxColumns);
            this._historyContainer?.setMaxColumns?.(maxColumns);
        }

        /**
         * Calculate dimensions and prepare a single item for the masonry grid.
         * @param {Object} item Item to process
         * @param {boolean} isPinned Whether this item is pinned
         * @returns {Object} Processed item
         * @private
         */
        _prepareGridItem(item, isPinned) {
            let width = 1;
            let height = this._estimateCardHeight(item);

            if (item.type === 'image' && item.image_filename) {
                if (item.width && item.height) {
                    width = item.width;
                    const minHeight = width * GridMetrics.MIN_ASPECT_RATIO;
                    height = Math.max(item.height, minHeight);
                } else {
                    const dims = this._dimensionCache.get(item.image_filename);
                    if (dims) {
                        width = dims.width;
                        const minHeight = width * GridMetrics.MIN_ASPECT_RATIO;
                        height = Math.max(dims.height, minHeight);
                    }
                }
            }

            return {
                ...item,
                _isPinned: isPinned,
                width,
                height,
            };
        }

        /**
         * Estimate the relative height of a card based on item type.
         * @param {Object} item The clipboard item
         * @returns {number} Estimated relative height
         * @private
         */
        _estimateCardHeight(item) {
            switch (item.type) {
                case 'image':
                    return GridMetrics.HEIGHT_IMAGE;
                case 'text':
                case 'code': {
                    const len = item.preview?.length || 0;
                    if (len > GridMetrics.TEXT_WEIGHTS.LONG.threshold) return GridMetrics.TEXT_WEIGHTS.LONG.height;
                    if (len > GridMetrics.TEXT_WEIGHTS.MEDIUM.threshold) return GridMetrics.TEXT_WEIGHTS.MEDIUM.height;
                    if (len > GridMetrics.TEXT_WEIGHTS.SHORT.threshold) return GridMetrics.TEXT_WEIGHTS.SHORT.height;
                    return GridMetrics.TEXT_WEIGHTS.TINY.height;
                }
                default:
                    return GridMetrics.HEIGHT_DEFAULT;
            }
        }

        /**
         * Fetch image dimensions asynchronously in the background.
         * Allows the main thread to stay responsive without triggering massive layout recalculations.
         * @param {string} filename The image filename
         * @returns {Promise<void>} Resolves when cached
         * @private
         */
        _resolveImageDimensionsAsync(filename) {
            return new Promise((resolve) => {
                if (!this._dimensionCache || this._dimensionCache.has(filename)) {
                    resolve();
                    return;
                }

                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (!this._dimensionCache) {
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    }

                    try {
                        const filePath = GLib.build_filenamev([this._manager._imagesDir, filename]);
                        const [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(filePath);

                        if (format) {
                            this._dimensionCache.set(filename, { width, height });
                        } else {
                            this._dimensionCache.set(filename, null);
                        }
                    } catch (e) {
                        console.warn(`[AIO-Clipboard] Failed to read dimensions for ${filename}: ${e.message}`);
                        this._dimensionCache.set(filename, null);
                    }
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
            });
        }

        /**
         * Cancel any pending render tasks.
         * @private
         */
        _cancelPendingRender() {}

        // ========================================================================
        // Event Handlers
        // ========================================================================

        /**
         * Handle key press events for grid navigation.
         * @param {Clutter.Actor} _actor The source actor
         * @param {Clutter.Event} event The key event
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        _onKeyPress(_actor, event) {
            const symbol = event.get_key_symbol();
            const currentFocus = global.stage.get_key_focus();
            const pinnedHasItems = this._pinnedContainer && this._pinnedContainer.getItemCount() > 0;
            const historyHasItems = this._historyContainer && this._historyContainer.getItemCount() > 0;
            const isArrowKey = [Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Up, Clutter.KEY_Down].includes(symbol);
            if (!isArrowKey) return Clutter.EVENT_PROPAGATE;

            const getCurrentCenterX = () => {
                if (!currentFocus?._masonryData) return undefined;
                const data = currentFocus._masonryData;
                return data.x + data.width / 2;
            };

            if (pinnedHasItems && this._pinnedContainer.contains(currentFocus)) {
                const result = this._pinnedContainer.handleKeyPress(this._pinnedContainer, event);
                if (result === Clutter.EVENT_STOP) return result;

                if (symbol === Clutter.KEY_Down && historyHasItems) {
                    this._historyContainer.focusFirst(getCurrentCenterX());
                    return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Up) {
                    this.emit('navigate-up');
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (historyHasItems && this._historyContainer.contains(currentFocus)) {
                const result = this._historyContainer.handleKeyPress(this._historyContainer, event);
                if (result === Clutter.EVENT_STOP) return result;

                if (symbol === Clutter.KEY_Up && pinnedHasItems) {
                    this._pinnedContainer.focusLast(getCurrentCenterX());
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
        // Lifecycle
        // ========================================================================

        /**
         * Clear the view and caches.
         * @override
         */
        clear() {
            this._gridRenderGeneration = (this._gridRenderGeneration || 0) + 1;
            this._gridPinnedItems = [];
            this._gridHistoryItems = [];
            this._gridIsSearching = false;
            this._dimensionCache?.clear();
            super.clear();
        }

        /**
         * Destroy the view and clean up resources.
         * @override
         */
        destroy() {
            this._cancelPendingRender();
            this._gridRenderGeneration = (this._gridRenderGeneration || 0) + 1;
            this._gridPinnedItems = null;
            this._gridHistoryItems = null;
            this._gridIsSearching = false;
            this._dimensionCache?.clear();
            this._dimensionCache = null;
            if (this._gridColumnSignalIds.length > 0 && this._settings) {
                this._gridColumnSignalIds.forEach((id) => this._settings.disconnect(id));
                this._gridColumnSignalIds = [];
            }
            super.destroy();
        }
    },
);
