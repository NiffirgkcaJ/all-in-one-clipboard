import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { FocusUtils } from '../../../shared/utilities/utilityFocus.js';
import { createStaticIconButton, createDynamicIconButton } from '../../../shared/utilities/utilityIcon.js';

import { ClipboardIcons } from '../constants/clipboardConstants.js';

// Spacing Configuration
const BAR_SPACING = 8;
const BUTTON_SPACING = 4;

/**
 * ClipboardActionBar
 *
 * Standalone component for the clipboard selection and control toolbar.
 */
export const ClipboardActionBar = GObject.registerClass(
    {
        Signals: {
            'layout-toggled': {},
            'selection-cleared': {},
            'select-all-requested': {},
            'navigate-up': {},
            'navigate-down': {},
        },
    },
    class ClipboardActionBar extends St.BoxLayout {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the action bar.
         *
         * @param {Gio.Settings} settings Extension settings.
         * @param {ClipboardManager} manager Clipboard manager.
         * @param {Set} selectedIds Set of selected item IDs.
         */
        constructor(settings, manager, selectedIds) {
            super({
                style_class: 'clipboard-selection-bar',
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.spacing = BAR_SPACING;

            this._settings = settings;
            this._manager = manager;
            this._selectedIds = selectedIds;
            this._isPrivateMode = false;

            this._buildUI();
            this._syncVisibility();

            this._settingsSignalId = this._settings.connect('changed::clipboard-show-action-bar', () => {
                this._syncVisibility();
            });
        }

        // ========================================================================
        // Internal Helpers
        // ========================================================================

        /**
         * Construct the action bar UI components.
         *
         * @private
         */
        _buildUI() {
            // Select All
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
            this._selectAllIcon = this._selectAllButton.child;
            this._selectAllButton.connect('clicked', () => this._onSelectAllClicked());
            this.add_child(this._selectAllButton);

            const actionButtonsBox = new St.BoxLayout({
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
            });
            actionButtonsBox.spacing = BUTTON_SPACING;
            this.add_child(actionButtonsBox);

            // Layout Toggle
            const layoutMode = this._settings.get_string('clipboard-layout-mode') || 'list';
            this._layoutToggleButton = createDynamicIconButton(
                {
                    list: ClipboardIcons.LAYOUT_LIST || 'view-list-symbolic',
                    grid: ClipboardIcons.LAYOUT_GRID || 'view-grid-symbolic',
                },
                {
                    initial: layoutMode,
                    style_class: 'button clipboard-icon-button',
                    tooltip_text: layoutMode === 'list' ? _('Switch to Grid View') : _('Switch to List View'),
                },
            );
            this._layoutToggleButton.connect('clicked', () => this.emit('layout-toggled'));
            actionButtonsBox.add_child(this._layoutToggleButton);

            // Private Mode
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

            // Selection Actions
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

            this.set_reactive(true);
            this.connect('key-press-event', this._onKeyPress.bind(this));
        }

        /**
         * Synchronize visibility based on user preferences.
         *
         * @private
         */
        _syncVisibility() {
            if (this._settings.get_boolean('clipboard-show-action-bar')) {
                this.show();
            } else {
                if (this.contains(global.stage.get_key_focus())) {
                    this.emit('layout-toggled');
                }
                this._selectedIds.clear();
                this.emit('selection-cleared');
                this.hide();
            }
        }

        /**
         * Get all focusable buttons in the action bar.
         *
         * @returns {Array<St.Button>} List of focusable buttons.
         * @private
         */
        _getHeaderButtons() {
            return [this._selectAllButton, this._layoutToggleButton, this._privateModeButton, this._pinSelectedButton, this._deleteSelectedButton].filter((b) => b.can_focus && b.visible);
        }

        /**
         * Update the tooltip for the pin button based on current selection.
         *
         * @private
         */
        _updatePinTooltip() {
            if (this._selectedIds.size === 0) {
                this._pinSelectedButton.tooltip_text = _('Pin/Unpin Selected');
                return;
            }

            const historyItems = this._manager.getHistoryItems();
            const hasUnpinned = [...this._selectedIds].some((id) => historyItems.some((item) => item.id === id));
            this._pinSelectedButton.tooltip_text = hasUnpinned ? _('Pin Selected') : _('Unpin Selected');
        }

        // ========================================================================
        // Public API
        // ========================================================================

        /**
         * Update the selection state of the bar.
         *
         * @param {number} totalItemCount Total number of items in the current view.
         */
        updateSelectionState(totalItemCount) {
            const numSelected = this._selectedIds.size;
            const hasSelection = numSelected > 0;
            const canSelect = totalItemCount > 0;

            const currentFocus = global.stage.get_key_focus();
            if (!hasSelection && (currentFocus === this._pinSelectedButton || currentFocus === this._deleteSelectedButton)) {
                this._selectAllButton.grab_key_focus();
            }

            this._pinSelectedButton.set_reactive(hasSelection);
            this._pinSelectedButton.set_can_focus(hasSelection);
            this._deleteSelectedButton.set_reactive(hasSelection);
            this._deleteSelectedButton.set_can_focus(hasSelection);

            this._selectAllButton.set_reactive(canSelect);

            if (!canSelect || numSelected === 0) {
                this._selectAllIcon.state = 'unchecked';
                this._selectAllButton.tooltip_text = _('Select All');
            } else if (numSelected === totalItemCount) {
                this._selectAllIcon.state = 'checked';
                this._selectAllButton.tooltip_text = _('Deselect All');
            } else {
                this._selectAllIcon.state = 'mixed';
                this._selectAllButton.tooltip_text = _('Select All');
            }

            this._updatePinTooltip();
        }

        /**
         * Update the layout toggle icon.
         *
         * @param {string} mode Current layout mode.
         */
        updateLayoutIcon(mode) {
            this._layoutToggleButton.child.state = mode;
            this._layoutToggleButton.tooltip_text = mode === 'list' ? _('Switch to Grid View') : _('Switch to List View');
        }

        /**
         * Grab focus on the primary action button.
         */
        grabFocus() {
            this._selectAllButton.grab_key_focus();
        }

        // ========================================================================
        // Event Handlers
        // ========================================================================

        /**
         * Handle clicks on the Select All button.
         *
         * @private
         */
        _onSelectAllClicked() {
            this.emit('select-all-requested');
        }

        /**
         * Handle toggle between private and public monitoring mode.
         *
         * @private
         */
        _onPrivateModeToggled() {
            this._isPrivateMode = !this._isPrivateMode;
            this._manager.setPaused(this._isPrivateMode);
            this._privateModeButton.child.state = this._isPrivateMode ? 'active' : 'inactive';
            this._privateModeButton.tooltip_text = this._isPrivateMode ? _('Stop Private Mode (Resume Recording)') : _('Start Private Mode (Pause Recording)');
        }

        /**
         * Handle bulk pin or unpin of selected items.
         *
         * @private
         */
        _onPinSelected() {
            const selectedIds = [...this._selectedIds];
            if (selectedIds.length === 0) return;

            const pinnedItems = this._manager.getPinnedItems();
            const historyItems = this._manager.getHistoryItems();

            const unpinnedSelected = selectedIds.filter((id) => historyItems.some((item) => item.id === id));
            const pinnedSelected = selectedIds.filter((id) => pinnedItems.some((item) => item.id === id));

            if (unpinnedSelected.length > 0) {
                this._manager.pinItems(unpinnedSelected);
            } else if (pinnedSelected.length > 0) {
                this._manager.unpinItems(pinnedSelected);
            }
        }

        /**
         * Handle bulk deletion of selected items.
         *
         * @private
         */
        _onDeleteSelected() {
            const ids = [...this._selectedIds];
            if (ids.length === 0) return;
            this._manager.deleteItems(ids);
            this._selectedIds.clear();
            this.emit('selection-cleared');
        }

        /**
         * Handle keyboard navigation within the action bar.
         *
         * @param {Clutter.Actor} actor Source actor.
         * @param {Clutter.Event} event Key event.
         * @returns {number} Clutter event result.
         * @private
         */
        _onKeyPress(actor, event) {
            const symbol = event.get_key_symbol();
            const headerButtons = this._getHeaderButtons();
            const currentIndex = headerButtons.indexOf(global.stage.get_key_focus());

            if (currentIndex === -1) return Clutter.EVENT_PROPAGATE;

            if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
                return FocusUtils.handleLinearNavigation(event, headerButtons, currentIndex);
            }

            if (symbol === Clutter.KEY_Up) {
                this.emit('navigate-up');
                return Clutter.EVENT_STOP;
            }

            if (symbol === Clutter.KEY_Down) {
                this.emit('navigate-down');
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up settings listeners and destroy the component.
         */
        destroy() {
            if (this._settingsSignalId) this._settings.disconnect(this._settingsSignalId);
            super.destroy();
        }
    },
);
