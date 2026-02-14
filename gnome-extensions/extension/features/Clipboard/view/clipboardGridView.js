import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { MasonryLayout } from '../../../shared/utilities/utilityMasonryLayout.js';

import { ClipboardGridItemFactory } from './clipboardGridItemFactory.js';
import { ClipboardBaseView } from './clipboardBaseView.js';

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

            this._pendingRenderTimeoutId = null;
            this._dimensionCache = new Map();
            this._pendingLoads = new Set();
            this._dimensionRerenderTimeoutId = null;

            this._gridPinnedItems = [];
            this._gridHistoryItems = [];

            this.connect('key-press-event', this._onKeyPress.bind(this));
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
                columns: 3,
                spacing: 8,
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
                columns: 3,
                spacing: 8,
                scrollView: this._scrollView,
                renderItemFn: (item) => this._createItemWidget(item, false),
                updateItemFn: (widget, item) => this._updateItemWidget(widget, item, false),
                prepareItemFn: (item) => this._prepareGridItem(item, false),
            });
        }

        /**
         * Render items into the grid view.
         * @param {Object[]} pinnedItems Array of pinned items
         * @param {Object[]} historyItems Array of history items
         * @param {boolean} isSearching Whether a search filter is active
         * @override
         */
        render(pinnedItems, historyItems, isSearching) {
            this._cancelPendingRender();
            this._gridPinnedItems = pinnedItems;
            this._gridHistoryItems = historyItems;
            super.render(pinnedItems, historyItems, isSearching);
        }

        /**
         * Get all focusable items.
         * @returns {Array} Array of focusable actors
         * @override
         */
        getFocusables() {
            const pinnedFocusables = this._pinnedContainer?.get_children().filter((w) => w.can_focus) || [];
            const historyFocusables = this._historyContainer?.get_children().filter((w) => w.can_focus) || [];
            return [...pinnedFocusables, ...historyFocusables];
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
                    const minHeight = width * (9 / 16);
                    height = Math.max(item.height, minHeight);
                } else {
                    const dims = this._getImageDimensions(item.image_filename);
                    if (dims) {
                        width = dims.width;
                        const minHeight = width * (9 / 16);
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
                    return 1.5;
                case 'text':
                case 'code': {
                    const len = item.preview?.length || 0;
                    if (len > 200) return 1.5;
                    if (len > 100) return 1.2;
                    if (len > 50) return 0.9;
                    return 0.7;
                }
                default:
                    return 1.0;
            }
        }

        /**
         * Get cached dimensions for an image file.
         * If not cached, triggers async load and returns null.
         * @param {string} filename The image filename
         * @returns {Object|null} { width, height } or null
         * @private
         */
        _getImageDimensions(filename) {
            if (this._dimensionCache.has(filename)) {
                return this._dimensionCache.get(filename);
            }

            if (this._dimensionCache.get(filename) === undefined) {
                this._loadDimensionsAsync(filename);
            }

            return null;
        }

        /**
         * Asynchronously load image dimensions using PixbufLoader.
         * @param {string} filename The image filename
         * @private
         */
        async _loadDimensionsAsync(filename) {
            if (!this._pendingLoads) this._pendingLoads = new Set();
            if (this._pendingLoads.has(filename)) return;

            this._pendingLoads.add(filename);

            try {
                const filePath = GLib.build_filenamev([this._manager._imagesDir, filename]);
                const file = Gio.File.new_for_path(filePath);
                const loader = new GdkPixbuf.PixbufLoader();
                let gotDimensions = false;

                const sizePreparedId = loader.connect('size-prepared', (_loader, width, height) => {
                    gotDimensions = true;
                    this._dimensionCache.set(filename, { width, height });
                    loader.close();
                });

                try {
                    const stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
                    const buffer = new Uint8Array(4096);

                    const pumpStream = async () => {
                        const bytesRead = await stream.read_async(buffer, GLib.PRIORITY_DEFAULT, null);
                        if (bytesRead === 0) return;
                        loader.write(buffer.slice(0, bytesRead));
                        if (!gotDimensions) await pumpStream();
                    };

                    await pumpStream();
                } catch (e) {
                    if (!gotDimensions) {
                        console.warn(`[AIO-Clipboard] Failed to load dimensions for ${filename}: ${e.message}`);
                    }
                } finally {
                    if (sizePreparedId) loader.disconnect(sizePreparedId);
                    try {
                        loader.close();
                    } catch {
                        // Ignore
                    }
                }

                if (gotDimensions) {
                    if (this._pendingLoads) {
                        this._scheduleRerender();
                    }
                } else {
                    this._dimensionCache.set(filename, null);
                }
            } catch (e) {
                console.warn(`[AIO-Clipboard] General error loading ${filename}: ${e.message}`);
                this._dimensionCache.set(filename, null);
            } finally {
                this._pendingLoads?.delete(filename);
            }
        }

        /**
         * Schedule a debounced re-render after async dimension loads.
         * @private
         */
        _scheduleRerender() {
            if (this._dimensionRerenderTimeoutId) {
                GLib.source_remove(this._dimensionRerenderTimeoutId);
            }

            this._dimensionRerenderTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                this._dimensionRerenderTimeoutId = null;
                this._doRenderPreservingState();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Re-render while preserving current pagination state.
         * Used after async dimension loads to update layouts with correct sizes.
         * @private
         */
        _doRenderPreservingState() {
            const focusState = this._captureFocusState();

            const pinnedItems = this._gridPinnedItems || [];
            const historyItems = this._gridHistoryItems || [];

            if (pinnedItems.length > 0) {
                this._updatePinnedItems(pinnedItems);
            }

            if (historyItems.length > 0) {
                const previouslyDisplayedCount = this._historyContainer?.getItemCount() || 0;
                if (previouslyDisplayedCount > 0) {
                    const itemsToRestore = historyItems.slice(0, previouslyDisplayedCount);
                    this._updateHistoryItems(itemsToRestore);
                }
            }

            if (focusState && focusState.itemId) {
                this._restoreFocusState(focusState);
            }
        }

        /**
         * Cancel any pending render tasks.
         * @private
         */
        _cancelPendingRender() {
            if (this._pendingRenderTimeoutId) {
                GLib.source_remove(this._pendingRenderTimeoutId);
                this._pendingRenderTimeoutId = null;
            }
            if (this._dimensionRerenderTimeoutId) {
                GLib.source_remove(this._dimensionRerenderTimeoutId);
                this._dimensionRerenderTimeoutId = null;
            }
        }

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
            this._cancelPendingRender();
            if (this._dimensionRerenderTimeoutId) {
                GLib.source_remove(this._dimensionRerenderTimeoutId);
                this._dimensionRerenderTimeoutId = null;
            }
            this._dimensionCache.clear();
            this._gridPinnedItems = [];
            this._gridHistoryItems = [];
            super.clear();
        }

        /**
         * Destroy the view and clean up resources.
         * @override
         */
        destroy() {
            this._cancelPendingRender();
            this._gridPinnedItems = null;
            this._gridHistoryItems = null;
            this._dimensionCache.clear();
            this._pendingLoads.clear();
            super.destroy();
        }
    },
);
