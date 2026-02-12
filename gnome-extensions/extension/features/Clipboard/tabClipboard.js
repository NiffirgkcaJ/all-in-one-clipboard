import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { FocusUtils } from '../../shared/utilities/utilityFocus.js';
import { SearchComponent } from '../../shared/utilities/utilitySearch.js';
import { AutoPaster, getAutoPaster } from '../../shared/utilities/utilityAutoPaste.js';
import { createStaticIconButton, createDynamicIconButton } from '../../shared/utilities/utilityIcon.js';

import { ClipboardListView } from './view/clipboardListView.js';
import { ClipboardGridView } from './view/clipboardGridView.js';
import { ClipboardType, ClipboardIcons } from './constants/clipboardConstants.js';

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
                if (this._currentView) {
                    this._currentView.setImagePreviewSize(this._imagePreviewSize);
                }
                this._redraw();
            });

            this._selectedIds = new Set();
            this._currentSearchText = '';
            this._isPrivateMode = false;
            this._currentView = null;
            this._layoutMode = this._settings.get_string('clipboard-layout-mode') || 'list';

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

        // ========================================================================
        // UI Construction Methods
        // ========================================================================

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

            // Select All button with unchecked/checked/mixed states
            this._selectAllButton = createDynamicIconButton(
                {
                    unchecked: ClipboardIcons.CHECKBOX_UNCHECKED,
                    checked: ClipboardIcons.CHECKBOX_CHECKED,
                    mixed: ClipboardIcons.CHECKBOX_MIXED,
                },
                {
                    initial: 'unchecked',
                    style_class: 'button clipboard-icon-button',
                    tooltip_text: _('Select All'),
                },
            );
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

            // Layout toggle button
            this._layoutToggleButton = createDynamicIconButton(
                {
                    list: ClipboardIcons.LAYOUT_LIST || 'view-list-symbolic',
                    grid: ClipboardIcons.LAYOUT_GRID || 'view-grid-symbolic',
                },
                {
                    initial: this._layoutMode,
                    style_class: 'button clipboard-icon-button',
                    tooltip_text: this._layoutMode === 'list' ? _('Switch to Grid View') : _('Switch to List View'),
                },
            );
            this._layoutToggleButton.connect('clicked', () => this._onLayoutToggle());
            actionButtonsBox.add_child(this._layoutToggleButton);

            // Private Mode button with inactive/active states
            this._privateModeButton = createDynamicIconButton(
                {
                    inactive: ClipboardIcons.ACTION_PRIVATE,
                    active: ClipboardIcons.ACTION_PUBLIC,
                },
                {
                    initial: 'inactive',
                    style_class: 'button clipboard-icon-button',
                    tooltip_text: _('Start Private Mode (Pause Recording)'),
                },
            );
            this._privateModeButton.connect('clicked', () => this._onPrivateModeToggled());
            actionButtonsBox.add_child(this._privateModeButton);

            this._pinSelectedButton = createStaticIconButton(ClipboardIcons.ACTION_PIN, {
                style_class: 'button clipboard-icon-button',
                can_focus: false,
                reactive: false,
                tooltip_text: _('Pin/Unpin Selected'),
            });
            this._pinSelectedButton.connect('clicked', () => this._onPinSelected());

            this._deleteSelectedButton = createStaticIconButton(ClipboardIcons.DELETE, {
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

            // Create the appropriate view based on layout mode
            this._createView(this._layoutMode);
        }

        /**
         * Create or switch to a specific view type
         * @param {string} mode - 'list' or 'grid'
         * @private
         */
        _createView(mode) {
            // Disconnect and destroy existing view
            if (this._currentView) {
                if (this._navigateUpSignalId) {
                    this._currentView.disconnect(this._navigateUpSignalId);
                    this._navigateUpSignalId = null;
                }
                // Remove from scroll view BEFORE destroying to prevent leftover references
                this._scrollView.set_child(null);
                this._currentView.destroy();
                this._currentView = null;
            }

            const viewOptions = {
                manager: this._manager,
                imagePreviewSize: this._imagePreviewSize,
                onItemCopy: this._onItemCopyToClipboard.bind(this),
                onSelectionChanged: this._updateSelectionState.bind(this),
                selectedIds: this._selectedIds,
                scrollView: this._scrollView,
                settings: this._settings,
            };

            if (mode === 'grid') {
                this._currentView = new ClipboardGridView(viewOptions);
            } else {
                this._currentView = new ClipboardListView(viewOptions);
            }

            this._navigateUpSignalId = this._currentView.connect('navigate-up', () => {
                this._searchComponent?.grabFocus();
            });

            this._scrollView.set_child(this._currentView);
        }

        /**
         * Handle layout toggle button click
         * @private
         */
        _onLayoutToggle() {
            this._layoutMode = this._layoutMode === 'list' ? 'grid' : 'list';
            this._settings.set_string('clipboard-layout-mode', this._layoutMode);

            // Update button state and tooltip
            this._layoutToggleButton.child.state = this._layoutMode;
            this._layoutToggleButton.tooltip_text = this._layoutMode === 'list' ? _('Switch to Grid View') : _('Switch to List View');

            // Recreate view and redraw
            this._createView(this._layoutMode);
            this._redraw();

            // Restore focus to search field to keep keyboard navigation working
            this._searchComponent?.grabFocus();
        }

        /**
         * Setup keyboard navigation handlers for the UI
         */
        _setupKeyboardNavigation() {
            // Header navigation
            const selectionBar = this._mainBox.get_child_at_index(1);
            selectionBar.set_reactive(true);
            selectionBar.connect('key-press-event', this._onHeaderKeyPress.bind(this));
        }

        /**
         * Connect to clipboard manager signals
         */
        _connectManagerSignals() {
            this._historyChangedId = this._manager.connect('history-changed', () => {
                this._scheduleRedraw();
            });

            this._pinnedChangedId = this._manager.connect('pinned-list-changed', () => {
                this._scheduleRedraw();
            });
        }

        /**
         * Schedule a redraw, debouncing multiple rapid calls into one
         * @private
         */
        _scheduleRedraw() {
            if (this._redrawScheduled) {
                return;
            }
            this._redrawScheduled = true;
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._redrawScheduled = false;
                if (!this._isDestroyed) {
                    this._redraw();
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        // ========================================================================
        // Keyboard Navigation Methods
        // ========================================================================

        /**
         * Get all focusable header buttons
         *
         * @returns {St.Button[]} Array of focusable header buttons
         */
        _getHeaderButtons() {
            return [this._selectAllButton, this._layoutToggleButton, this._privateModeButton, this._pinSelectedButton, this._deleteSelectedButton].filter(
                (button) => button.can_focus && button.visible,
            );
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
            if (symbol === Clutter.KEY_Down) {
                const viewFocusables = this._currentView?.getFocusables() || [];
                if (viewFocusables.length > 0) {
                    viewFocusables[0].grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        // ========================================================================
        // Action Handler Methods
        // ========================================================================

        /**
         * Toggle private mode to pause or resume clipboard recording
         */
        _onPrivateModeToggled() {
            this._isPrivateMode = !this._isPrivateMode;
            this._manager.setPaused(this._isPrivateMode);
            this._privateModeButton.child.state = this._isPrivateMode ? 'active' : 'inactive';
            this._privateModeButton.tooltip_text = this._isPrivateMode ? _('Stop Private Mode (Resume Recording)') : _('Start Private Mode (Pause Recording)');
        }

        /**
         * Handle Select All / Deselect All button click
         */
        _onSelectAllClicked() {
            const allItems = this._currentView?.getAllItems() || [];
            const checkboxIconsMap = this._currentView?.getCheckboxIconsMap() || new Map();
            const shouldSelectAll = this._selectedIds.size < allItems.length;

            if (shouldSelectAll) {
                allItems.forEach((item) => {
                    this._selectedIds.add(item.id);
                    const icon = checkboxIconsMap.get(item.id);
                    if (icon) {
                        icon.state = 'checked';
                    }
                });
            } else {
                this._selectedIds.clear();
                allItems.forEach((item) => {
                    const icon = checkboxIconsMap.get(item.id);
                    if (icon) {
                        icon.state = 'unchecked';
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
            const copySuccess = await this._manager.copyToSystemClipboard(itemData);

            if (copySuccess) {
                if (AutoPaster.shouldAutoPaste(this._settings, 'auto-paste-clipboard')) {
                    await getAutoPaster().trigger();
                }

                this._manager.promoteItemToTop(itemData.id);
            }

            this._extension._indicator.menu.close();
        }

        // ========================================================================
        // UI State Methods
        // ========================================================================

        /**
         * Update the UI state based on current selection
         */
        _updateSelectionState() {
            const allItems = this._currentView?.getAllItems() || [];
            const numSelected = this._selectedIds.size;
            const totalItems = allItems.length;
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
                this._selectAllIcon.state = 'unchecked';
                this._selectAllButton.tooltip_text = _('Select All');
            } else if (numSelected === allItems.length) {
                this._selectAllIcon.state = 'checked';
                this._selectAllButton.tooltip_text = _('Deselect All');
            } else {
                this._selectAllIcon.state = 'mixed';
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
            // Pin icon is static, no state update needed
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
         */
        _redraw() {
            // Check if grid view focus is on a card before render destroys them
            const isGridView = this._layoutMode === 'grid';
            let hadGridFocus = false;
            if (isGridView && this._currentView) {
                const currentFocus = global.stage.get_key_focus();
                const focusables = this._currentView.getFocusables?.() || [];
                hadGridFocus = focusables.includes(currentFocus);
            }

            // Get items from manager
            let pinnedItems = this._manager.getPinnedItems();
            let historyItems = this._manager.getHistoryItems();
            const isSearching = this._currentSearchText.length > 0;

            // Apply search filter if active
            if (isSearching) {
                const filterFn = (item) => {
                    let searchTarget;
                    switch (item.type) {
                        case ClipboardType.IMAGE:
                            searchTarget = item.source_url || item.image_filename;
                            break;
                        case ClipboardType.URL:
                            searchTarget = item.title || item.url;
                            break;
                        case ClipboardType.COLOR:
                            searchTarget = item.color_value;
                            break;
                        default:
                            searchTarget = item.preview;
                    }
                    return searchTarget && searchTarget.toLowerCase().includes(this._currentSearchText);
                };
                pinnedItems = pinnedItems.filter(filterFn);
                historyItems = historyItems.filter(filterFn);
            }

            // Delegate rendering to the list view
            this._currentView.render(pinnedItems, historyItems, isSearching);

            // Update selection state based on new items
            this._updateSelectionState();

            // If grid view had card focus, fall back to search field
            if (hadGridFocus) {
                this._searchComponent?.grabFocus();
            }
        }

        // ========================================================================
        // Lifecycle Methods
        // ========================================================================

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
            this._currentView?.destroy();
            this._currentView = null;
            this._manager = null;
            super.destroy();
        }
    },
);
