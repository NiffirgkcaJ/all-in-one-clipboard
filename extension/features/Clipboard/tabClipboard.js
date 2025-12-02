import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClipboardItemFactory } from './view/clipboardItemFactory.js';
import { FocusUtils } from '../../utilities/utilityFocus.js';
import { SearchComponent } from '../../utilities/utilitySearch.js';
import { AutoPaster, getAutoPaster } from '../../utilities/utilityAutoPaste.js';
import { ClipboardType, ClipboardIcons } from './constants/clipboardConstants.js';
import { createStaticIconButton, createDynamicIconButton, setIcon } from '../../utilities/utilityIcon.js';

/**
 * Number of focusable UI elements per clipboard item row
 * Visual Order: Checkbox, Row Button (spans middle), Pin Button, Delete Button
 */
const NUM_FOCUSABLE_ITEMS_PER_ROW = 4;

/**
 * ClipboardTabContent
 *
 * Main UI component for the clipboard tab, displaying clipboard history
 * with search, selection, pinning, and deletion capabilities.
 */
export const ClipboardTabContent = GObject.registerClass(
    class ClipboardTabContent extends St.Bin {
        /**
         * Initialize the clipboard tab content
         *
         * @param {Object} extension - The extension instance
         * @param {Gio.Settings} settings - Extension settings
         * @param {ClipboardManager} manager - Clipboard manager instance
         */
        constructor(extension, settings, manager) {
            super({
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
            });

            this._extension = extension;
            this._settings = settings;
            this._manager = manager;

            this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size');

            this._settingSignalId = this._settings.connect('changed::clipboard-image-preview-size', () => {
                this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size');
                this._redraw();
            });

            this._selectedIds = new Set();
            this._currentSearchText = '';
            this._allItems = [];
            this._isPrivateMode = false;
            this._gridAllButtons = [];
            this._currentlyFocusedRow = null;
            this._checkboxIconsMap = new Map();

            this._mainBox = new St.BoxLayout({
                vertical: true,
                style_class: 'aio-clipboard-container',
                x_expand: true,
            });
            this.set_child(this._mainBox);

            this._buildSearchComponent();
            this._buildSelectionBar();
            this._buildScrollableList();
            this._setupKeyboardNavigation();
            this._connectManagerSignals();
        }

        // ===========================
        // UI Construction Methods
        // ===========================

        /**
         * Build and add the search component to the UI
         */
        _buildSearchComponent() {
            this._searchComponent = new SearchComponent((searchText) => {
                this._currentSearchText = searchText.toLowerCase().trim();
                this._redraw();
            });

            const searchWidget = this._searchComponent.getWidget();
            searchWidget.x_expand = true;
            this._mainBox.add_child(searchWidget);
        }

        /**
         * Build the selection action bar with control buttons
         */
        _buildSelectionBar() {
            const selectionBar = new St.BoxLayout({
                style_class: 'clipboard-selection-bar',
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
            });
            selectionBar.spacing = 8;

            // Select All button
            this._selectAllButton = createDynamicIconButton(ClipboardIcons.CHECKBOX_UNCHECKED.icon, ClipboardIcons.CHECKBOX_UNCHECKED.iconSize, {
                style_class: 'button clipboard-icon-button',
                tooltip_text: _('Select All'),
            });
            // Store icon reference for updates
            this._selectAllIcon = this._selectAllButton.child;

            this._selectAllButton.connect('clicked', () => this._onSelectAllClicked());
            selectionBar.add_child(this._selectAllButton);

            const actionButtonsBox = new St.BoxLayout({
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
            });
            actionButtonsBox.spacing = 4;
            selectionBar.add_child(actionButtonsBox);

            // Private Mode button
            this._privateModeButton = createDynamicIconButton(ClipboardIcons.ACTION_PRIVATE.icon, ClipboardIcons.ACTION_PRIVATE.iconSize, {
                style_class: 'button clipboard-icon-button',
                tooltip_text: _('Start Private Mode (Pause Recording)'),
            });
            this._privateModeButton.connect('clicked', () => this._onPrivateModeToggled());
            actionButtonsBox.add_child(this._privateModeButton);

            this._pinSelectedButton = createStaticIconButton(ClipboardIcons.ACTION_PIN.icon, ClipboardIcons.ACTION_PIN.iconSize, {
                style_class: 'button clipboard-icon-button',
                can_focus: false,
                reactive: false,
                tooltip_text: _('Pin/Unpin Selected'),
            });
            this._pinSelectedButton.connect('clicked', () => this._onPinSelected());

            this._deleteSelectedButton = createStaticIconButton(ClipboardIcons.DELETE.icon, ClipboardIcons.DELETE.iconSize, {
                style_class: 'button clipboard-icon-button',
                can_focus: false,
                reactive: false,
                tooltip_text: _('Delete Selected'),
            });
            this._deleteSelectedButton.connect('clicked', () => this._onDeleteSelected());

            actionButtonsBox.add_child(this._pinSelectedButton);
            actionButtonsBox.add_child(this._deleteSelectedButton);
            this._mainBox.add_child(selectionBar);
        }

        /**
         * Build the scrollable list container for clipboard items
         */
        _buildScrollableList() {
            this._scrollView = new St.ScrollView({
                style_class: 'menu-scrollview',
                overlay_scrollbars: true,
                x_expand: true,
                y_expand: true,
            });
            this._mainBox.add_child(this._scrollView);

            this._itemBox = new St.BoxLayout({
                vertical: true,
                style_class: 'clipboard-item-box',
            });
            this._scrollView.set_child(this._itemBox);
        }

        /**
         * Setup keyboard navigation handlers for the UI
         */
        _setupKeyboardNavigation() {
            // Header navigation
            const selectionBar = this._mainBox.get_child_at_index(1);
            selectionBar.set_reactive(true);
            selectionBar.connect('key-press-event', this._onHeaderKeyPress.bind(this));

            // Grid navigation
            this._itemBox.set_reactive(true);
            this._itemBox.connect('key-press-event', this._onGridKeyPress.bind(this));
        }

        /**
         * Connect to clipboard manager signals
         */
        _connectManagerSignals() {
            this._historyChangedId = this._manager.connect('history-changed', () => {
                this._redraw();
            });

            this._pinnedChangedId = this._manager.connect('pinned-list-changed', () => {
                this._redraw();
            });
        }

        // ===========================
        // Keyboard Navigation Methods
        // ===========================

        /**
         * Get all focusable header buttons
         *
         * @returns {St.Button[]} Array of focusable header buttons
         */
        _getHeaderButtons() {
            return [this._selectAllButton, this._privateModeButton, this._pinSelectedButton, this._deleteSelectedButton].filter((button) => button.can_focus && button.visible);
        }

        /**
         * Handle keyboard navigation in the header bar
         *
         * @param {St.Widget} actor - The actor that received the event
         * @param {Clutter.Event} event - The key press event
         * @returns {boolean} EVENT_STOP if handled, EVENT_PROPAGATE otherwise
         */
        _onHeaderKeyPress(actor, event) {
            const symbol = event.get_key_symbol();
            if (symbol !== Clutter.KEY_Left && symbol !== Clutter.KEY_Right && symbol !== Clutter.KEY_Down) {
                return Clutter.EVENT_PROPAGATE;
            }

            const headerButtons = this._getHeaderButtons();
            if (headerButtons.length === 0) {
                return Clutter.EVENT_PROPAGATE;
            }

            const currentFocus = global.stage.get_key_focus();
            const currentIndex = headerButtons.indexOf(currentFocus);

            if (currentIndex === -1) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return FocusUtils.handleLinearNavigation(event, headerButtons, currentIndex);
            }
            if (symbol === Clutter.KEY_Down && this._gridAllButtons.length > 1) {
                this._gridAllButtons[1].grab_key_focus();
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Handle keyboard navigation in the grid of clipboard items
         *
         * @param {St.Widget} actor - The actor that received the event
         * @param {Clutter.Event} event - The key press event
         * @returns {boolean} EVENT_STOP if handled, EVENT_PROPAGATE otherwise
         */
        _onGridKeyPress(actor, event) {
            const symbol = event.get_key_symbol();
            const isArrowKey = [Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Up, Clutter.KEY_Down].includes(symbol);
            if (!isArrowKey || this._gridAllButtons.length === 0) return Clutter.EVENT_PROPAGATE;

            const currentFocus = global.stage.get_key_focus();
            const currentIndex = this._gridAllButtons.indexOf(currentFocus);

            if (currentIndex === -1) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return FocusUtils.handleRowNavigation(event, this._gridAllButtons, currentIndex, NUM_FOCUSABLE_ITEMS_PER_ROW);
            }

            if (symbol === Clutter.KEY_Up || symbol === Clutter.KEY_Down) {
                return FocusUtils.handleColumnNavigation(event, this._gridAllButtons, currentIndex, NUM_FOCUSABLE_ITEMS_PER_ROW, (side) => {
                    if (side === 'up') {
                        // Navigate to header if at top row
                        const headerButtons = this._getHeaderButtons();
                        if (headerButtons.length > 0) {
                            headerButtons[0].grab_key_focus();
                        }
                        return Clutter.EVENT_STOP;
                    }
                    return undefined;
                });
            }

            return Clutter.EVENT_PROPAGATE;
        }

        // ===========================
        // Action Handler Methods
        // ===========================

        /**
         * Toggle private mode (pause/resume clipboard recording)
         */
        _onPrivateModeToggled() {
            this._isPrivateMode = !this._isPrivateMode;
            this._manager.setPaused(this._isPrivateMode);
            setIcon(this._privateModeButton.child, this._isPrivateMode ? ClipboardIcons.ACTION_PUBLIC.icon : ClipboardIcons.ACTION_PRIVATE.icon);
            this._privateModeButton.tooltip_text = this._isPrivateMode ? _('Stop Private Mode (Resume Recording)') : _('Start Private Mode (Pause Recording)');
        }

        /**
         * Handle Select All / Deselect All button click
         */
        _onSelectAllClicked() {
            const shouldSelectAll = this._selectedIds.size < this._allItems.length;

            if (shouldSelectAll) {
                this._allItems.forEach((item) => {
                    this._selectedIds.add(item.id);
                    const icon = this._checkboxIconsMap.get(item.id);
                    if (icon) {
                        setIcon(icon, ClipboardIcons.CHECKBOX_CHECKED.icon);
                    }
                });
            } else {
                this._selectedIds.clear();
                this._allItems.forEach((item) => {
                    const icon = this._checkboxIconsMap.get(item.id);
                    if (icon) {
                        setIcon(icon, ClipboardIcons.CHECKBOX_UNCHECKED.icon);
                    }
                });
            }

            this._updateSelectionState();
        }

        /**
         * Pin all selected items
         */
        async _onPinSelected() {
            const selectedIds = [...this._selectedIds];
            if (selectedIds.length === 0) {
                return;
            }

            const pinnedItems = this._manager.getPinnedItems();
            const historyItems = this._manager.getHistoryItems();

            const unpinnedSelected = selectedIds.filter((id) => historyItems.some((item) => item.id === id));
            const pinnedSelected = selectedIds.filter((id) => pinnedItems.some((item) => item.id === id));

            // Pin unpinned selected items, unpin pinned selected items
            if (unpinnedSelected.length > 0) {
                await Promise.all(unpinnedSelected.map((id) => this._manager.pinItem(id)));
            } else if (pinnedSelected.length > 0) {
                await Promise.all(pinnedSelected.map((id) => this._manager.unpinItem(id)));
            }
        }

        /**
         * Delete all selected items
         */
        async _onDeleteSelected() {
            const idsToDelete = [...this._selectedIds];

            if (idsToDelete.length === 0) {
                return;
            }

            await Promise.all(idsToDelete.map((id) => this._manager.deleteItem(id)));
            // Deletion is a final action, so we explicitly clear the selection here.
            this._selectedIds.clear();
        }

        /**
         * Copy a clipboard item to the system clipboard
         *
         * @param {Object} itemData - The clipboard item data
         */
        async _onItemCopyToClipboard(itemData) {
            let copySuccess = false;

            switch (itemData.type) {
                case ClipboardType.FILE:
                    copySuccess = await this._copyFileItem(itemData);
                    break;
                case ClipboardType.URL:
                case ClipboardType.COLOR: {
                    const text = itemData.type === ClipboardType.URL ? itemData.url : itemData.color_value;
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                    copySuccess = true;
                    break;
                }
                case ClipboardType.TEXT:
                case ClipboardType.CODE:
                    copySuccess = await this._copyTextItem(itemData);
                    break;
                case ClipboardType.IMAGE:
                    copySuccess = await this._copyImageItem(itemData);
                    break;
            }

            if (copySuccess) {
                if (AutoPaster.shouldAutoPaste(this._settings, 'auto-paste-clipboard')) {
                    await getAutoPaster().trigger();
                }

                this._manager.promoteItemToTop(itemData.id);
            }

            this._extension._indicator.menu.close();
        }

        /**
         * Copy a file item to the clipboard
         * @param {Object} itemData - The file item data
         * @returns {Promise<boolean>} True if successful
         * @private
         */
        async _copyFileItem(itemData) {
            try {
                const clipboard = St.Clipboard.get_default();
                const uriList = itemData.file_uri + '\r\n';
                const bytes = new GLib.Bytes(new TextEncoder().encode(uriList));
                clipboard.set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', bytes);
                return true;
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to copy file URI: ${e.message}`);
                return false;
            }
        }

        /**
         * Copy a text or code item to the clipboard
         * @param {Object} itemData - The text/code item data
         * @returns {Promise<boolean>} True if successful
         * @private
         */
        async _copyTextItem(itemData) {
            let content = itemData.text;
            if (!content) {
                content = await this._manager.getContent(itemData.id);
            }

            // For CODE type, never use preview as it contains HTML markup
            // For TEXT type, use preview as fallback only if text is not available
            if (!content && itemData.preview && itemData.type !== ClipboardType.CODE) {
                content = itemData.preview;
            } else if (!content && itemData.type === ClipboardType.CODE) {
                // CODE type missing content, refusing to use preview
            }

            if (content) {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, content);
                return true;
            }
            return false;
        }

        /**
         * Copy an image item to the clipboard
         * @param {Object} itemData - The image item data
         * @returns {Promise<boolean>} True if successful
         * @private
         */
        async _copyImageItem(itemData) {
            try {
                // If this image was originally copied from a file, paste it as a file URI
                if (itemData.file_uri) {
                    const clipboard = St.Clipboard.get_default();
                    const uriList = itemData.file_uri + '\r\n';
                    const bytes = new GLib.Bytes(new TextEncoder().encode(uriList));
                    clipboard.set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', bytes);
                    return true;
                }

                // Otherwise, paste the image bytes
                const imagePath = GLib.build_filenamev([this._manager._imagesDir, itemData.image_filename]);
                const file = Gio.File.new_for_path(imagePath);

                // Determine MIME type from filename
                let mimetype = 'image/png';
                const lower = itemData.image_filename.toLowerCase();
                if (lower.endsWith('jpg') || lower.endsWith('jpeg')) mimetype = 'image/jpeg';
                else if (lower.endsWith('gif')) mimetype = 'image/gif';
                else if (lower.endsWith('webp')) mimetype = 'image/webp';

                const bytes = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (source, res) => {
                        try {
                            const [ok, contents] = source.load_contents_finish(res);
                            resolve(ok ? contents : null);
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                if (bytes) {
                    St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, mimetype, bytes);
                    return true;
                }
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to copy image: ${e.message}`);
            }
            return false;
        }

        /**
         * Handles the click event for a row's pin button when the item is unpinned.
         * @param {object} itemData - The data for the specific item to pin.
         * @private
         */
        _onPinItemClicked(itemData) {
            this._manager.pinItem(itemData.id);
        }

        /**
         * Handles the click event for a row's star button when the item is pinned.
         * @param {object} itemData - The data for the specific item to unpin.
         * @private
         */
        _onUnpinItemClicked(itemData) {
            this._manager.unpinItem(itemData.id);
        }

        // ===========================
        // UI State Methods
        // ===========================

        /**
         * Update the UI state based on current selection
         */
        _updateSelectionState() {
            const numSelected = this._selectedIds.size;
            const totalItems = this._allItems.length;
            const canSelect = totalItems > 0;
            const hasSelection = numSelected > 0;

            // Move focus away from disabled buttons
            const currentFocus = global.stage.get_key_focus();
            if (!hasSelection && (currentFocus === this._pinSelectedButton || currentFocus === this._deleteSelectedButton)) {
                this._selectAllButton.grab_key_focus();
            }

            // Enable/disable action buttons based on selection
            this._pinSelectedButton.set_reactive(hasSelection);
            this._pinSelectedButton.set_can_focus(hasSelection);
            this._deleteSelectedButton.set_reactive(hasSelection);
            this._deleteSelectedButton.set_can_focus(hasSelection);

            // Update Select All button state
            this._selectAllButton.set_reactive(canSelect);

            if (!canSelect || numSelected === 0) {
                setIcon(this._selectAllIcon, ClipboardIcons.CHECKBOX_UNCHECKED.icon);
                this._selectAllButton.tooltip_text = _('Select All');
            } else if (numSelected === totalItems) {
                setIcon(this._selectAllIcon, ClipboardIcons.CHECKBOX_CHECKED.icon);
                this._selectAllButton.tooltip_text = _('Deselect All');
            } else {
                setIcon(this._selectAllIcon, ClipboardIcons.CHECKBOX_MIXED.icon);
                this._selectAllButton.tooltip_text = _('Select All');
            }

            // Update the pin button's appearance based on the selection context
            this._updatePinButtonState();
        }

        /**
         * Updates the pin button's icon and tooltip based on the current selection.
         * - If any selected item is unpinned, the action is to "Pin".
         * - If all selected items are already pinned, the action is to "Unpin".
         */
        _updatePinButtonState() {
            // The icon for the action button should always be the generic 'pin' icon.
            setIcon(this._pinSelectedButton.child, ClipboardIcons.ACTION_PIN.icon);
            if (this._selectedIds.size === 0) {
                this._pinSelectedButton.tooltip_text = _('Pin/Unpin Selected');
                return;
            }

            const selectedIds = [...this._selectedIds];
            const historyItems = this._manager.getHistoryItems();
            const hasUnpinnedSelection = selectedIds.some((id) => historyItems.some((item) => item.id === id));
            this._pinSelectedButton.tooltip_text = hasUnpinnedSelection ? _('Pin Selected') : _('Unpin Selected');
        }

        /**
         * Redraw the entire clipboard list
         * Preserves focus on the same item if it still exists after redraw
         */
        _redraw() {
            // Track which item and button type had focus before redraw
            const currentFocus = global.stage.get_key_focus();
            let focusedItemId = null;
            let focusedButtonType = null; // 'checkbox', 'row', 'pin', 'delete'

            if (this._gridAllButtons.includes(currentFocus)) {
                const buttonIndex = this._gridAllButtons.indexOf(currentFocus);
                const itemIndex = Math.floor(buttonIndex / NUM_FOCUSABLE_ITEMS_PER_ROW);
                const buttonPosition = buttonIndex % NUM_FOCUSABLE_ITEMS_PER_ROW;

                if (itemIndex < this._allItems.length) {
                    focusedItemId = this._allItems[itemIndex].id;
                    focusedButtonType = buttonPosition;
                }
            }

            // Clear existing items
            this._itemBox.destroy_all_children();
            this._gridAllButtons = [];
            this._currentlyFocusedRow = null;
            this._checkboxIconsMap.clear();

            // Get items from manager
            let pinnedItems = this._manager.getPinnedItems();
            let historyItems = this._manager.getHistoryItems();
            const isSearching = this._currentSearchText.length > 0;

            // Apply search filter if active
            if (isSearching) {
                const filterFn = (item) => {
                    const searchTarget = item.type === ClipboardType.TEXT || item.type === ClipboardType.FILE || item.type === ClipboardType.COLOR ? item.preview : item.title || item.url;
                    return searchTarget && searchTarget.toLowerCase().includes(this._currentSearchText);
                };
                pinnedItems = pinnedItems.filter(filterFn);
                historyItems = historyItems.filter(filterFn);
            }

            this._allItems = [...pinnedItems, ...historyItems];
            this._updateSelectionState();

            // Show empty state if no items
            if (this._allItems.length === 0) {
                this._itemBox.add_child(
                    new St.Label({
                        text: isSearching ? _('No results found.') : _('Clipboard history is empty.'),
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                        y_expand: true,
                    }),
                );
                return;
            }

            // Add pinned items section
            if (pinnedItems.length > 0) {
                this._itemBox.add_child(
                    new St.Label({
                        text: _('Pinned'),
                        style_class: 'clipboard-section-header',
                    }),
                );

                pinnedItems.forEach((item) => {
                    this._itemBox.add_child(this._createItemWidget(item, true));
                });
            }

            // Add separator between sections
            if (pinnedItems.length > 0 && historyItems.length > 0) {
                this._itemBox.add_child(
                    new St.Widget({
                        style_class: 'clipboard-separator',
                        x_expand: true,
                    }),
                );
            }

            // Add history items section
            if (historyItems.length > 0) {
                this._itemBox.add_child(
                    new St.Label({
                        text: _('History'),
                        style_class: 'clipboard-section-header',
                    }),
                );

                historyItems.forEach((item) => {
                    this._itemBox.add_child(this._createItemWidget(item, false));
                });
            }

            // Restore focus to the same item if it still exists
            if (focusedItemId) {
                const newItemIndex = this._allItems.findIndex((item) => item.id === focusedItemId);

                if (newItemIndex !== -1) {
                    const targetButtonIndex = newItemIndex * NUM_FOCUSABLE_ITEMS_PER_ROW + (focusedButtonType || 1);
                    if (targetButtonIndex < this._gridAllButtons.length) this._gridAllButtons[targetButtonIndex].grab_key_focus();
                }
            } else if (currentFocus && !currentFocus.get_parent() && this._gridAllButtons.length > 1) {
                this._gridAllButtons[1].grab_key_focus();
            }
        }

        /**
         * Create a UI widget for a clipboard item.
         *
         * @param {Object} itemData - The clipboard item data.
         * @param {boolean} isPinned - Whether the item is pinned.
         * @returns {St.Button} The row button widget.
         */
        _createItemWidget(itemData, isPinned) {
            // Main row button
            const rowButton = new St.Button({
                style_class: 'button clipboard-item-button',
                can_focus: true,
            });
            rowButton.connect('clicked', () => this._onItemCopyToClipboard(itemData));

            const mainBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-row-content',
            });
            rowButton.set_child(mainBox);

            // Checkbox for selection
            const isChecked = this._selectedIds.has(itemData.id);
            const itemCheckbox = createDynamicIconButton(isChecked ? ClipboardIcons.CHECKBOX_CHECKED.icon : ClipboardIcons.CHECKBOX_UNCHECKED.icon, ClipboardIcons.CHECKBOX_CHECKED.iconSize, {
                style_class: 'button clipboard-item-checkbox',
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const checkboxIcon = itemCheckbox.child;
            this._checkboxIconsMap.set(itemData.id, checkboxIcon);

            itemCheckbox.connect('clicked', () => {
                if (rowButton.has_key_focus()) rowButton.remove_style_pseudo_class('focus');
                if (this._selectedIds.has(itemData.id)) {
                    this._selectedIds.delete(itemData.id);
                    setIcon(checkboxIcon, ClipboardIcons.CHECKBOX_UNCHECKED.icon);
                } else {
                    this._selectedIds.add(itemData.id);
                    setIcon(checkboxIcon, ClipboardIcons.CHECKBOX_CHECKED.icon);
                }
                this._updateSelectionState();
            });

            mainBox.add_child(itemCheckbox);

            // Content widget based on item type
            const config = ClipboardItemFactory.getItemViewConfig(itemData, this._manager._imagesDir, this._manager._linkPreviewsDir);
            const contentWidget = ClipboardItemFactory.createContentWidget(config, itemData, {
                imagesDir: this._manager._imagesDir,
                imagePreviewSize: this._imagePreviewSize,
            });
            mainBox.add_child(contentWidget);

            const rowStarButton = createDynamicIconButton(
                '', // Empty initially, set below
                ClipboardIcons.STAR_FILLED.iconSize,
                {
                    style_class: 'button clipboard-icon-button',
                    y_align: Clutter.ActorAlign.CENTER,
                },
            );
            if (isPinned) {
                setIcon(rowStarButton.child, ClipboardIcons.STAR_FILLED.icon);
                rowStarButton.connect('clicked', () => this._onUnpinItemClicked(itemData));
            } else {
                setIcon(rowStarButton.child, ClipboardIcons.STAR_UNFILLED.icon);
                rowStarButton.connect('clicked', () => this._onPinItemClicked(itemData));
            }

            const deleteButton = createDynamicIconButton(ClipboardIcons.DELETE.icon, ClipboardIcons.DELETE.iconSize, {
                style_class: 'button clipboard-icon-button',
                y_align: Clutter.ActorAlign.CENTER,
            });
            deleteButton.connect('clicked', () => this._manager.deleteItem(itemData.id));

            const buttonsBox = new St.BoxLayout({
                x_align: Clutter.ActorAlign.END,
                style_class: 'clipboard-action-buttons',
            });
            buttonsBox.add_child(rowStarButton);
            buttonsBox.add_child(deleteButton);
            mainBox.add_child(buttonsBox);

            // Register focus
            const rowItems = [itemCheckbox, rowButton, rowStarButton, deleteButton];
            this._gridAllButtons.push(...rowItems);

            // Setup focus styling for all buttons in the row
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

        // ===========================
        // Lifecycle Methods
        // ===========================

        /**
         * Called when the tab is selected/activated
         */
        onTabSelected() {
            this._redraw();
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._searchComponent?.grabFocus();
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Called by the parent when the main menu is closed.
         * Resets the tab's state, such as clearing the search field.
         */
        onMenuClosed() {
            // Clear search text and redraw the list without the filter
            this._searchComponent?.clearSearch();
        }

        /**
         * Cleanup when the widget is destroyed
         */
        destroy() {
            // Tell it to stop listening for our image size setting changes
            if (this._settings && this._settingSignalId > 0) {
                this._settings.disconnect(this._settingSignalId);
            }

            if (this._manager) {
                if (this._historyChangedId) {
                    this._manager.disconnect(this._historyChangedId);
                }
                if (this._pinnedChangedId) {
                    this._manager.disconnect(this._pinnedChangedId);
                }
            }

            this._searchComponent?.destroy();
            this._manager = null;
            super.destroy();
        }
    },
);
