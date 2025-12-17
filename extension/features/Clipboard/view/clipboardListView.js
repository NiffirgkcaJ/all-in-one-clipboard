import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { FocusUtils } from '../../../shared/utilities/utilityFocus.js';

import { ClipboardListItemFactory } from './clipboardListItemFactory.js';

/**
 * Number of focusable UI elements per clipboard item row
 * Visual Order: Checkbox, Row Button (spans middle), Pin Button, Delete Button
 */
const NUM_FOCUSABLE_ITEMS_PER_ROW = 4;

/**
 * ClipboardListView - Linear list layout for clipboard items.
 *
 * Renders clipboard items as a vertical list with checkboxes, content preview,
 * and action buttons per row.
 */
export const ClipboardListView = GObject.registerClass(
    {
        Signals: {
            'navigate-up': {},
        },
    },
    class ClipboardListView extends St.BoxLayout {
        /**
         * Initialize the list view.
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
                style_class: 'clipboard-item-box',
                reactive: true,
            });

            this._manager = options.manager;
            this._imagePreviewSize = options.imagePreviewSize;
            this._onItemCopy = options.onItemCopy;
            this._onSelectionChanged = options.onSelectionChanged;
            this._selectedIds = options.selectedIds;
            this._scrollView = options.scrollView;
            this._settings = options.settings;

            this._focusableItems = [];
            this._currentlyFocusedRow = null;
            this._checkboxIconsMap = new Map();
            this._allItems = [];

            // Pinned section
            this._pinnedHeader = new St.Label({
                text: _('Pinned'),
                style_class: 'clipboard-section-header',
            });
            this.add_child(this._pinnedHeader);

            this._pinnedContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });
            this.add_child(this._pinnedContainer);

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

            this._historyContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });
            this.add_child(this._historyContainer);

            // Empty state label
            this._emptyLabel = new St.Label({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            this.add_child(this._emptyLabel);

            // Hide all sections by default
            this._pinnedHeader.hide();
            this._pinnedContainer.hide();
            this._separator.hide();
            this._historyHeader.hide();
            this._historyContainer.hide();
            this._emptyLabel.hide();

            this.connect('key-press-event', this._onKeyPress.bind(this));
        }

        // ========================================================================
        // Public Interface
        // ========================================================================

        /**
         * Render items into the list.
         *
         * @param {Object[]} pinnedItems - Array of pinned items
         * @param {Object[]} historyItems - Array of history items
         * @param {boolean} isSearching - Whether a search filter is active
         */
        render(pinnedItems, historyItems, isSearching) {
            const focusInfo = this._captureFocusState();

            this._focusableItems = [];
            this._currentlyFocusedRow = null;
            this._checkboxIconsMap.clear();

            this._pinnedContainer.destroy_all_children();
            this._historyContainer.destroy_all_children();

            this._pinnedHeader.hide();
            this._pinnedContainer.hide();
            this._separator.hide();
            this._historyHeader.hide();
            this._historyContainer.hide();
            this._emptyLabel.hide();

            this._allItems = [...pinnedItems, ...historyItems];

            // Empty state
            if (this._allItems.length === 0) {
                this._emptyLabel.text = isSearching ? _('No results found.') : _('Clipboard history is empty.');
                this._emptyLabel.show();
                return;
            }

            // Pinned section
            if (pinnedItems.length > 0) {
                this._pinnedHeader.show();
                this._pinnedContainer.show();
                pinnedItems.forEach((item) => {
                    this._pinnedContainer.add_child(this._createItemWidget(item, true));
                });
            }

            // Separator shown only if both sections have items
            if (pinnedItems.length > 0 && historyItems.length > 0) {
                this._separator.show();
            }

            // History section
            if (historyItems.length > 0) {
                this._historyHeader.show();
                this._historyContainer.show();
                historyItems.forEach((item) => {
                    this._historyContainer.add_child(this._createItemWidget(item, false));
                });
            }

            this._restoreFocusState(focusInfo);
        }

        /**
         * Clear all items from the list.
         */
        clear() {
            this._focusableItems = [];
            this._currentlyFocusedRow = null;
            this._checkboxIconsMap.clear();
            this._allItems = [];

            this._pinnedContainer.destroy_all_children();
            this._historyContainer.destroy_all_children();

            this._pinnedHeader.hide();
            this._pinnedContainer.hide();
            this._separator.hide();
            this._historyHeader.hide();
            this._historyContainer.hide();
            this._emptyLabel.hide();
        }

        /**
         * Get all focusable buttons in the list.
         *
         * @returns {St.Button[]} Array of focusable buttons
         */
        getFocusables() {
            return this._focusableItems;
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
         * Get the checkbox icon map for updating checkbox states externally.
         *
         * @returns {Map} Map of item ID to checkbox icon widget
         */
        getCheckboxIconsMap() {
            return this._checkboxIconsMap;
        }

        /**
         * Update the image preview size and trigger re-render if needed.
         *
         * @param {number} size - New preview size
         */
        setImagePreviewSize(size) {
            this._imagePreviewSize = size;
        }

        // ========================================================================
        // Keyboard Navigation
        // ========================================================================

        /**
         * Handle keyboard navigation within the list.
         *
         * @param {St.Widget} actor - The actor that received the event
         * @param {Clutter.Event} event - The key press event
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         */
        _onKeyPress(actor, event) {
            const symbol = event.get_key_symbol();
            const isArrowKey = [Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Up, Clutter.KEY_Down].includes(symbol);
            if (!isArrowKey || this._focusableItems.length === 0) return Clutter.EVENT_PROPAGATE;

            const currentFocus = global.stage.get_key_focus();
            const currentIndex = this._focusableItems.indexOf(currentFocus);

            if (currentIndex === -1) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return FocusUtils.handleRowNavigation(event, this._focusableItems, currentIndex, NUM_FOCUSABLE_ITEMS_PER_ROW);
            }

            if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down) {
                return FocusUtils.handleColumnNavigation(event, this._focusableItems, currentIndex, NUM_FOCUSABLE_ITEMS_PER_ROW, (side) => {
                    if (side === 'up') {
                        // Signal to parent that we're at the top edge
                        this.emit('navigate-up');
                        return Clutter.EVENT_STOP;
                    }
                    return undefined;
                });
            }

            return Clutter.EVENT_PROPAGATE;
        }

        // ========================================================================
        // Item Widget Creation
        // ========================================================================

        /**
         * Create a UI widget for a clipboard item.
         *
         * @param {Object} itemData - The clipboard item data
         * @param {boolean} isPinned - Whether the item is pinned
         * @returns {St.Button} The row button widget
         * @private
         */
        _createItemWidget(itemData, isPinned) {
            // Delegate to factory for full item creation
            const rowButton = ClipboardListItemFactory.createListItem(itemData, {
                isPinned: isPinned,
                imagesDir: this._manager._imagesDir,
                linkPreviewsDir: this._manager._linkPreviewsDir,
                imagePreviewSize: this._imagePreviewSize,
                onItemCopy: this._onItemCopy,
                manager: this._manager,
                selectedIds: this._selectedIds,
                onSelectionChanged: this._onSelectionChanged,
                checkboxIconsMap: this._checkboxIconsMap,
                settings: this._settings,
            });

            // Register focusable buttons from factory
            const rowItems = rowButton._focusableItems;
            this._focusableItems.push(...rowItems);

            // Setup focus styling for all buttons in the row as view-specific concern
            for (const item of rowItems) {
                item.connect('key-focus-in', () => {
                    if (this._currentlyFocusedRow) this._currentlyFocusedRow.remove_style_class_name('focused');
                    rowButton.add_style_class_name('focused');
                    this._currentlyFocusedRow = rowButton;
                    ensureActorVisibleInScrollView(this._scrollView, rowButton);
                });
                item.connect('key-focus-out', () => rowButton.remove_style_class_name('focused'));
            }

            return rowButton;
        }

        // ========================================================================
        // Focus State Management
        // ========================================================================

        /**
         * Capture the current focus state before re-rendering.
         *
         * @returns {Object|null} Focus info or null
         * @private
         */
        _captureFocusState() {
            const currentFocus = global.stage.get_key_focus();
            if (!this._focusableItems.includes(currentFocus)) return null;

            const buttonIndex = this._focusableItems.indexOf(currentFocus);
            const itemIndex = Math.floor(buttonIndex / NUM_FOCUSABLE_ITEMS_PER_ROW);
            const buttonPosition = buttonIndex % NUM_FOCUSABLE_ITEMS_PER_ROW;

            if (itemIndex < this._allItems.length) {
                return {
                    itemId: this._allItems[itemIndex].id,
                    itemIndex,
                    buttonType: buttonPosition,
                };
            }
            return null;
        }

        /**
         * Restore focus state after re-rendering.
         * Falls back to adjacent item if original was deleted.
         *
         * @param {Object|null} focusInfo - Previously captured focus info
         * @private
         */
        _restoreFocusState(focusInfo) {
            if (!focusInfo) return;

            // Try to find the exact item first
            let newItemIndex = this._allItems.findIndex((item) => item.id === focusInfo.itemId);

            // If item was deleted, fall back to same position or previous item
            if (newItemIndex === -1 && this._allItems.length > 0) {
                newItemIndex = Math.min(focusInfo.itemIndex, this._allItems.length - 1);
            }

            if (newItemIndex !== -1) {
                const targetButtonIndex = newItemIndex * NUM_FOCUSABLE_ITEMS_PER_ROW + (focusInfo.buttonType || 1);
                if (targetButtonIndex < this._focusableItems.length) {
                    this._focusableItems[targetButtonIndex].grab_key_focus();
                }
            }
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        destroy() {
            // Clear all references before destruction
            this._focusableItems = [];
            this._currentlyFocusedRow = null;
            this._checkboxIconsMap.clear();
            this._allItems = [];
            this._manager = null;
            this._onItemCopy = null;
            this._onSelectionChanged = null;
            this._selectedIds = null;
            this._scrollView = null;
            this._pinnedHeader = null;
            this._pinnedContainer = null;
            this._separator = null;
            this._historyHeader = null;
            this._historyContainer = null;
            this._emptyLabel = null;
            super.destroy();
        }
    },
);
