import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';

import { SearchComponent } from '../../utilities/utilitySearch.js';
import { AutoPaster, getAutoPaster } from '../../utilities/utilityAutoPaste.js';

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

        // Read the image size setting
        this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size');

        // Listen for changes to the setting
        this._settingSignalId = this._settings.connect('changed::clipboard-image-preview-size', () => {
            this._imagePreviewSize = this._settings.get_int('clipboard-image-preview-size');
            this._redraw();
        });

        // State management
        this._selectedIds = new Set();
        this._currentSearchText = "";
        this._allItems = [];
        this._isPrivateMode = false;
        this._gridAllButtons = [];
        this._currentlyFocusedRow = null;
        this._checkboxIconsMap = new Map();

        // Main container
        this._mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'aio-clipboard-container',
            x_expand: true
        });
        this.set_child(this._mainBox);

        // Build UI components
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
        this._searchComponent = new SearchComponent(searchText => {
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
            y_align: Clutter.ActorAlign.CENTER
        });
        selectionBar.spacing = 8;

        // Select All button
        this._selectAllIcon = new St.Icon({
            style_class: 'popup-menu-icon',
            icon_name: 'checkbox-unchecked-symbolic',
            icon_size: 16
        });

        this._selectAllButton = new St.Button({
            style_class: 'button clipboard-icon-button',
            can_focus: true,
            child: this._selectAllIcon
        });
        this._selectAllButton.tooltip_text = _("Select All");
        this._selectAllButton.connect('clicked', () => this._onSelectAllClicked());
        selectionBar.add_child(this._selectAllButton);

        // Action buttons container (right-aligned)
        const actionButtonsBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.END
        });
        actionButtonsBox.spacing = 4;
        selectionBar.add_child(actionButtonsBox);

        // Private Mode button
        this._privateModeButton = new St.Button({
            style_class: 'button clipboard-icon-button',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'view-reveal-symbolic',
                icon_size: 16
            })
        });
        this._privateModeButton.tooltip_text = _("Start Private Mode (Pause Recording)");
        this._privateModeButton.connect('clicked', () => this._onPrivateModeToggled());
        actionButtonsBox.add_child(this._privateModeButton);

        // Pin Selected button (for pinning/unpinning)
        this._pinSelectedButton = new St.Button({
            style_class: 'button clipboard-icon-button',
            can_focus: false,
            reactive: false,
            child: new St.Icon({
                icon_name: 'view-pin-symbolic',
                icon_size: 16
            })
        });
        this._pinSelectedButton.tooltip_text = _("Pin/Unpin Selected");
        this._pinSelectedButton.connect('clicked', () => this._onPinSelected());

        // Delete Selected button
        this._deleteSelectedButton = new St.Button({
            style_class: 'button clipboard-icon-button',
            can_focus: false,
            reactive: false,
            child: new St.Icon({
                icon_name: 'edit-delete-symbolic',
                icon_size: 16
            })
        });
        this._deleteSelectedButton.tooltip_text = _("Delete Selected");
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
            y_expand: true
        });
        this._mainBox.add_child(this._scrollView);

        this._itemBox = new St.BoxLayout({
            vertical: true,
            style_class: 'clipboard-item-box'
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
        return [
            this._selectAllButton,
            this._privateModeButton,
            this._pinSelectedButton,
            this._deleteSelectedButton
        ].filter(button => button.can_focus && button.visible);
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
        const isArrowKey = symbol === Clutter.KEY_Left ||
                          symbol === Clutter.KEY_Right ||
                          symbol === Clutter.KEY_Down;

        if (!isArrowKey) {
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

        switch (symbol) {
            case Clutter.KEY_Left:
                if (currentIndex > 0) {
                    headerButtons[currentIndex - 1].grab_key_focus();
                }
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Right:
                if (currentIndex < headerButtons.length - 1) {
                    headerButtons[currentIndex + 1].grab_key_focus();
                }
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Down:
                // When navigating down from header, skip checkbox and go straight to row button
                if (this._gridAllButtons.length > 1) {
                    this._gridAllButtons[1].grab_key_focus(); // Index 1 is the row button
                }
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
        const isArrowKey = symbol === Clutter.KEY_Left ||
                          symbol === Clutter.KEY_Right ||
                          symbol === Clutter.KEY_Up ||
                          symbol === Clutter.KEY_Down;

        if (!isArrowKey) {
            return Clutter.EVENT_PROPAGATE;
        }

        if (this._gridAllButtons.length === 0) {
            return Clutter.EVENT_PROPAGATE;
        }

        const currentFocus = global.stage.get_key_focus();
        const currentIndex = this._gridAllButtons.indexOf(currentFocus);

        if (currentIndex === -1) {
            return Clutter.EVENT_PROPAGATE;
        }

        let targetIndex = -1;

        switch (symbol) {
            case Clutter.KEY_Left:
                if (currentIndex % NUM_FOCUSABLE_ITEMS_PER_ROW > 0) {
                    targetIndex = currentIndex - 1;
                }
                break;

            case Clutter.KEY_Right:
                if (currentIndex % NUM_FOCUSABLE_ITEMS_PER_ROW < NUM_FOCUSABLE_ITEMS_PER_ROW - 1) {
                    targetIndex = currentIndex + 1;
                }
                break;

            case Clutter.KEY_Up:
                if (currentIndex >= NUM_FOCUSABLE_ITEMS_PER_ROW) {
                    targetIndex = currentIndex - NUM_FOCUSABLE_ITEMS_PER_ROW;
                } else {
                    // Navigate to header if at top row
                    const headerButtons = this._getHeaderButtons();
                    if (headerButtons.length > 0) {
                        headerButtons[0].grab_key_focus();
                    }
                }
                break;

            case Clutter.KEY_Down:
                if (currentIndex + NUM_FOCUSABLE_ITEMS_PER_ROW < this._gridAllButtons.length) {
                    targetIndex = currentIndex + NUM_FOCUSABLE_ITEMS_PER_ROW;
                }
                break;
        }

        if (targetIndex !== -1) {
            this._gridAllButtons[targetIndex].grab_key_focus();
        }

        return Clutter.EVENT_STOP;
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

        if (this._isPrivateMode) {
            this._privateModeButton.child.icon_name = 'view-conceal-symbolic';
            this._privateModeButton.tooltip_text = _("Stop Private Mode (Resume Recording)");
        } else {
            this._privateModeButton.child.icon_name = 'view-reveal-symbolic';
            this._privateModeButton.tooltip_text = _("Start Private Mode (Pause Recording)");
        }
    }

    /**
     * Handle Select All / Deselect All button click
     */
    _onSelectAllClicked() {
        const shouldSelectAll = this._selectedIds.size < this._allItems.length;

        if (shouldSelectAll) {
            // Select all items
            this._allItems.forEach(item => {
                this._selectedIds.add(item.id);
                const icon = this._checkboxIconsMap.get(item.id);
                if (icon) {
                    icon.icon_name = 'checkbox-checked-symbolic';
                }
            });
        } else {
            // Deselect all items
            this._selectedIds.clear();
            this._allItems.forEach(item => {
                const icon = this._checkboxIconsMap.get(item.id);
                if (icon) {
                    icon.icon_name = 'checkbox-unchecked-symbolic';
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

        const unpinnedSelected = selectedIds.filter(id =>
            historyItems.some(item => item.id === id)
        );
        const pinnedSelected = selectedIds.filter(id =>
            pinnedItems.some(item => item.id === id)
        );

        // Pin unpinned selected items, unpin pinned selected items
        if (unpinnedSelected.length > 0) {
            await Promise.all(unpinnedSelected.map(id => this._manager.pinItem(id)));
        } else if (pinnedSelected.length > 0) {
            await Promise.all(pinnedSelected.map(id => this._manager.unpinItem(id)));
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

        await Promise.all(idsToDelete.map(id => this._manager.deleteItem(id)));
        // Deletion is a final action, so we explicitly clear the selection here.
        this._selectedIds.clear();
    }

    /**
     * Copy a clipboard item to the system clipboard
     *
     * @param {Object} itemData - The clipboard item data
     */
    async _onItemCopyToClipboard(itemData) {
        this._manager.setDebounce();
        let copySuccess = false;

        // Determine clipboard content based on item type
        if (itemData.file_uri) { // File URI
            try {
                const clipboard = St.Clipboard.get_default();
                const uriList = itemData.file_uri + "\r\n";
                const bytes = new GLib.Bytes(new TextEncoder().encode(uriList));

                clipboard.set_content(
                    St.ClipboardType.CLIPBOARD,
                    'text/uri-list',
                    bytes
                );
                copySuccess = true;
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to copy file URI: ${e.message}`);
            }
        } else if (itemData.type === 'url') { // Link
            St.Clipboard.get_default().set_text(
                St.ClipboardType.CLIPBOARD,
                itemData.url
            );
            copySuccess = true;
        } else if (itemData.type === 'color') { // Color
             St.Clipboard.get_default().set_text(
                St.ClipboardType.CLIPBOARD,
                itemData.color_value
            );
            copySuccess = true;
        } else if (itemData.type === 'text') { // Plain Text
            const fullContent = await this._manager.getContent(itemData.id);
            if (fullContent) {
                St.Clipboard.get_default().set_text(
                    St.ClipboardType.CLIPBOARD,
                    fullContent
                );
                copySuccess = true;
            }
        } else if (itemData.type === 'image') { // Raw Image
            try {
                const imagePath = GLib.build_filenamev([
                    this._manager._imagesDir,
                    itemData.image_filename
                ]);
                const file = Gio.File.new_for_path(imagePath);

                // Determine MIME type from filename
                let mimetype = 'image/png';
                const lowerCaseFilename = itemData.image_filename.toLowerCase();

                if (lowerCaseFilename.endsWith('.jpg') || lowerCaseFilename.endsWith('.jpeg')) {
                    mimetype = 'image/jpeg';
                } else if (lowerCaseFilename.endsWith('.gif')) {
                    mimetype = 'image/gif';
                } else if (lowerCaseFilename.endsWith('.webp')) {
                    mimetype = 'image/webp';
                }

                // Load image file contents
                const bytes = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (source, res) => {
                        try {
                            const [ok, contents] = source.load_contents_finish(res);
                            if (ok) {
                                resolve(contents);
                            } else {
                                reject(new Error('Failed to load file contents.'));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                if (bytes) {
                    St.Clipboard.get_default().set_content(
                        St.ClipboardType.CLIPBOARD,
                        mimetype,
                        bytes
                    );
                    copySuccess = true;
                }
            } catch (e) {
                console.error(`[AIO-Clipboard] Failed to copy image to clipboard: ${e.message}`);
            }
        }

        if (copySuccess) {
            // Check if auto-paste is enabled
            if (AutoPaster.shouldAutoPaste(this._settings, 'auto-paste-clipboard')) {
                this._manager.setDebounce(); // Extra debounce for clipboard
                await getAutoPaster().trigger();
            }

            // Promote copied item to top
            this._manager.promoteItemToTop(itemData.id);
        }

        this._extension._indicator.menu.close();
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
        if (!hasSelection &&
            (currentFocus === this._pinSelectedButton ||
             currentFocus === this._deleteSelectedButton)) {
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
            this._selectAllIcon.icon_name = 'checkbox-unchecked-symbolic';
            this._selectAllButton.tooltip_text = _("Select All");
        } else if (numSelected === totalItems) {
            this._selectAllIcon.icon_name = 'checkbox-checked-symbolic';
            this._selectAllButton.tooltip_text = _("Deselect All");
        } else {
            this._selectAllIcon.icon_name = 'checkbox-mixed-symbolic';
            this._selectAllButton.tooltip_text = _("Select All");
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
        this._pinSelectedButton.child.icon_name = 'view-pin-symbolic';

        if (this._selectedIds.size === 0) {
            this._pinSelectedButton.tooltip_text = _("Pin/Unpin Selected");
            return;
        }

        const selectedIds = [...this._selectedIds];
        const historyItems = this._manager.getHistoryItems();

        // Check if any of the selected items are in the unpinned history list.
        const hasUnpinnedSelection = selectedIds.some(id =>
            historyItems.some(item => item.id === id)
        );

        if (hasUnpinnedSelection) {
            // If there's at least one unpinned item, the next action is to pin.
            this._pinSelectedButton.tooltip_text = _("Pin Selected");
        } else {
            // Otherwise, all selected items must be pinned, so the action is to unpin.
            this._pinSelectedButton.tooltip_text = _("Unpin Selected");
        }
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
                focusedButtonType = ['checkbox', 'row', 'pin', 'delete'][buttonPosition];
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
            const filterFn = item => {
                if (item.type === 'text') {
                    return item.preview.toLowerCase().includes(this._currentSearchText);
                }
                if (item.type === 'file') {
                    return item.preview.toLowerCase().includes(this._currentSearchText);
                }
                return false;
            };

            pinnedItems = pinnedItems.filter(filterFn);
            historyItems = historyItems.filter(filterFn);
        }

        this._allItems = [...pinnedItems, ...historyItems];
        this._updateSelectionState();

        // Show empty state if no items
        if (this._allItems.length === 0) {
            const emptyText = isSearching
                ? _("No results found.")
                : _("Clipboard history is empty.");

            this._itemBox.add_child(new St.Label({
                text: emptyText,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true
            }));
            return;
        }

        // Add pinned items section
        if (pinnedItems.length > 0) {
            this._itemBox.add_child(new St.Label({
                text: _("Pinned"),
                style_class: 'clipboard-section-header'
            }));

            pinnedItems.forEach(item => {
                this._itemBox.add_child(this._createItemWidget(item, true));
            });
        }

        // Add separator between sections
        if (pinnedItems.length > 0 && historyItems.length > 0) {
            this._itemBox.add_child(new St.Widget({
                style_class: 'clipboard-separator',
                x_expand: true
            }));
        }

        // Add history items section
        if (historyItems.length > 0) {
            this._itemBox.add_child(new St.Label({
                text: _("History"),
                style_class: 'clipboard-section-header'
            }));

            historyItems.forEach(item => {
                this._itemBox.add_child(this._createItemWidget(item, false));
            });
        }

        // Restore focus to the same item if it still exists
        if (focusedItemId) {
            const newItemIndex = this._allItems.findIndex(item => item.id === focusedItemId);

            if (newItemIndex !== -1) {
                const buttonTypeOffset = {
                    'checkbox': 0,
                    'row': 1,
                    'pin': 2,
                    'delete': 3
                }[focusedButtonType] || 1; // Default to row button

                const targetButtonIndex = (newItemIndex * NUM_FOCUSABLE_ITEMS_PER_ROW) + buttonTypeOffset;

                if (targetButtonIndex < this._gridAllButtons.length) {
                    this._gridAllButtons[targetButtonIndex].grab_key_focus();
                    return;
                }
            }
        }

        // Restore focus to the first item if no previous focused item found
        if (currentFocus && !currentFocus.get_parent() && this._gridAllButtons.length > 1) {
            this._gridAllButtons[1].grab_key_focus(); // Index 1 is the row button
        }
    }

    /**
     * Maps an item's data to a standardized view configuration.
     * This acts as the "Map" to normalize Files, Links, and Text.
     *
     * @param {Object} item - The raw item data
     * @returns {Object} { layoutMode, icon, title, subtitle }
     */
    _getItemViewConfig(item) {
        if (item.type === 'image') return { layoutMode: 'image' };

        if (item.type === 'file') {
            return {
                layoutMode: 'rich',
                icon: 'text-x-generic-symbolic',
                title: item.preview || _("Unknown File"),
                subtitle: item.file_uri
            };
        }

        if (item.type === 'url') {
            const config = {
                layoutMode: 'rich',
                icon: 'web-browser-symbolic',
                title: item.title || item.url,
                subtitle: item.url
            };

            if (item.icon_filename) {
                const iconPath = GLib.build_filenamev([
                    this._manager._linkPreviewsDir,
                    item.icon_filename
                ]);
                const file = Gio.File.new_for_path(iconPath);
                config.gicon = new Gio.FileIcon({ file: file });
            }

            return config;
        }

        if (item.type === 'color') {
            return {
                layoutMode: 'rich',
                icon: 'color-select-symbolic',
                title: item.color_value,
                subtitle: item.format_type,
                cssColor: item.color_value
            };
        }

        return { layoutMode: 'text', text: item.preview || '' };
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
            can_focus: true
        });
        rowButton.connect('clicked', () => this._onItemCopyToClipboard(itemData));

        const mainBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'clipboard-row-content'
        });
        rowButton.set_child(mainBox);

        // Checkbox for selection
        const isChecked = this._selectedIds.has(itemData.id);
        const checkboxIcon = new St.Icon({
            icon_name: isChecked ? 'checkbox-checked-symbolic' : 'checkbox-unchecked-symbolic',
            style_class: 'popup-menu-icon',
            icon_size: 16
        });
        this._checkboxIconsMap.set(itemData.id, checkboxIcon);

        const itemCheckbox = new St.Button({
            style_class: 'button clipboard-item-checkbox',
            child: checkboxIcon,
            can_focus: true,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER
        });

        itemCheckbox.connect('clicked', () => {
             if (rowButton.has_key_focus()) rowButton.remove_style_pseudo_class('focus');
             if (this._selectedIds.has(itemData.id)) {
                 this._selectedIds.delete(itemData.id);
                 checkboxIcon.icon_name = 'checkbox-unchecked-symbolic';
             } else {
                 this._selectedIds.add(itemData.id);
                 checkboxIcon.icon_name = 'checkbox-checked-symbolic';
             }
             this._updateSelectionState();
        });

        mainBox.add_child(itemCheckbox);

        // Content widget based on item type
        const config = this._getItemViewConfig(itemData);
        let contentWidget;

        if (config.layoutMode === 'image') { // Image Layout
            const imagePath = GLib.build_filenamev([this._manager._imagesDir, itemData.image_filename]);

            // Use wrapper bin for proper sizing
            const imageWrapper = new St.Bin({
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });

            const imageActor = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(imagePath) }),
                icon_size: this._imagePreviewSize
            });

            imageWrapper.set_style(`min-height: ${this._imagePreviewSize}px;`);
            imageWrapper.set_child(imageActor);

            // Add image class to button and set dynamic height
            const minHeight = Math.max(this._imagePreviewSize);
            rowButton.set_style(`min-height: ${minHeight}px;`);
            mainBox.y_expand = true;
            mainBox.y_align = Clutter.ActorAlign.FILL;

            contentWidget = imageWrapper;

        } else if (config.layoutMode === 'rich') { // Rich Layout
            contentWidget = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-item-rich-container'
            });

            // Icon Column
            const iconParams = {
                icon_size: 24,
                style_class: 'clipboard-item-icon'
            };

            if (config.gicon) {
                iconParams.gicon = config.gicon;
            } else {
                iconParams.icon_name = config.icon || 'text-x-generic-symbolic';
            }
            contentWidget.add_child(new St.Icon(iconParams));

            // Color Column
            if (config.cssColor) {
                // Color Container
                const swatchContainer = new St.Bin({
                    style_class: 'clipboard-color-container',
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: Clutter.ActorAlign.CENTER
                });

                // Color Swatch
                const swatch = new St.Bin({
                    style_class: 'clipboard-color-swatch',
                    style: `background-color: ${config.cssColor};`
                });

                swatchContainer.set_child(swatch);
                contentWidget.add_child(swatchContainer);
            }

            // Text Column
            const textCol = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER
            });

            const titleLabel = new St.Label({
                text: config.title,
                style_class: 'clipboard-item-title',
                x_expand: true
            });
            titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            textCol.add_child(titleLabel);

            const subLabel = new St.Label({
                text: config.subtitle,
                style_class: 'clipboard-item-subtitle',
                x_expand: true
            });
            subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
            textCol.add_child(subLabel);

            contentWidget.add_child(textCol);
            contentWidget.x_expand = true;

        } else { // Text Layout
            contentWidget = new St.Label({
                text: config.text,
                style_class: 'clipboard-item-text-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER
            });
            contentWidget.get_clutter_text().set_line_wrap(false);
            contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        }

        mainBox.add_child(contentWidget);

        // This button shows the starred state of the item in the row.
        const rowStarButton = new St.Button({
            style_class: 'button clipboard-icon-button',
            child: new St.Icon({ icon_size: 16 }),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        if (isPinned) {
            rowStarButton.child.icon_name = 'starred-symbolic';
            rowStarButton.connect('clicked', () => this._onUnpinItemClicked(itemData));
        } else {
            rowStarButton.child.icon_name = 'non-starred-symbolic';
            rowStarButton.connect('clicked', () => this._onPinItemClicked(itemData));
        }

        // Delete button
        const deleteButton = new St.Button({
            style_class: 'button clipboard-icon-button',
            child: new St.Icon({ icon_name: 'edit-delete-symbolic', icon_size: 16 }),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        deleteButton.connect('clicked', () => this._manager.deleteItem(itemData.id));

        // Buttons container
        const buttonsBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.END,
            style_class: 'clipboard-action-buttons'
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
});