import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { MasonryLayout } from '../../../shared/utilities/utilityMasonryLayout.js';

import { GifSettings, GifUI } from '../constants/gifConstants.js';

/**
 * GifContentView
 *
 * Component managing the main display area for GIFs.
 * This includes the scroll view, masonry layout for grid display,
 * infinite scrolling detection, and state indicators.
 *
 * @fires load-more Emitted when the user scrolls near the bottom, requesting more results.
 * @fires focus-next-up Emitted when the up arrow key is pressed to move focus out of the grid.
 * @fires item-activated Emitted when a GIF item is selected.
 */
export const GifContentView = GObject.registerClass(
    {
        Signals: {
            'load-more': { param_types: [] },
            'focus-next-up': { param_types: [] },
            'item-activated': { param_types: [GObject.TYPE_JSOBJECT] },
        },
    },
    class GifContentView extends St.BoxLayout {
        // ========================================================================
        // Initialization
        // ========================================================================

        /**
         * Initialize the GIF content view.
         *
         * @param {Gio.Settings} settings Extension settings.
         * @param {GifItemFactory} itemFactory Factory to create individual GIF items.
         */
        constructor(settings, itemFactory) {
            super({
                vertical: true,
                x_expand: true,
                y_expand: true,
            });

            this._settings = settings;
            this._itemFactory = itemFactory;

            this._gridColumnSignalIds = [];

            this._buildSkeleton();
            this._bindGridColumnSettings();
        }

        // ========================================================================
        // UI Construction
        // ========================================================================

        /**
         * Build the content layout skeleton.
         * @private
         */
        _buildSkeleton() {
            this._scrollView = new St.ScrollView({
                style_class: 'menu-scrollview',
                overlay_scrollbars: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                clip_to_allocation: true,
                x_expand: true,
                y_expand: true,
            });

            const vadjustment = this._scrollView.vadjustment;
            vadjustment.connect('notify::value', () => this._onScroll(vadjustment));

            this._scrollableContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            this._scrollView.set_child(this._scrollableContainer);

            this._masonryView = new MasonryLayout({
                targetItemWidth: GifUI.TARGET_ITEM_WIDTH,
                spacing: GifUI.MASONRY_SPACING,
                maxColumns: this._getGridMaxColumnsSetting(),
                scrollView: this._scrollView,
                renderItemFn: (itemData) => {
                    return this._itemFactory.createItem(itemData, this._onItemActivated.bind(this));
                },
                visible: true,
            });

            this._infoBin = new St.Bin({
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            this._infoLabel = new St.Label();
            this._infoBin.set_child(this._infoLabel);

            this._scrollableContainer.add_child(this._masonryView);
            this._scrollableContainer.add_child(this._infoBin);
            this._scrollableContainer.reactive = true;
            this._scrollableContainer.connect('key-press-event', this._onGridKeyPress.bind(this));

            this.add_child(this._scrollView);

            this._spinner = new St.Icon({
                style_class: 'StSpinner',
                style: 'font-size: 24px;',
                visible: false,
            });

            this._spinnerBox = new St.BoxLayout({
                style_class: 'gif-spinner-box',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._spinnerBox.add_child(this._spinner);

            this.add_child(this._spinnerBox);
        }

        // ========================================================================
        // Settings & Data Management
        // ========================================================================

        /**
         * Internal handler for item activation, emits the signal.
         * @param {object} itemData The data of the activated item.
         * @private
         */
        _onItemActivated(itemData) {
            this.emit('item-activated', itemData);
        }

        /**
         * Read the max columns setting when the limit is enabled.
         * @returns {number|null} Max columns or null for auto.
         * @private
         */
        _getGridMaxColumnsSetting() {
            if (!this._settings?.get_boolean(GifSettings.GRID_LIMIT_COLUMNS_KEY)) return null;
            const maxColumns = this._settings.get_int(GifSettings.GRID_MAX_COLUMNS_KEY);
            return maxColumns > 0 ? maxColumns : null;
        }

        /**
         * Bind settings for grid column limits.
         * @private
         */
        _bindGridColumnSettings() {
            const keys = [GifSettings.GRID_LIMIT_COLUMNS_KEY, GifSettings.GRID_MAX_COLUMNS_KEY];
            keys.forEach((key) => {
                const id = this._settings.connect(`changed::${key}`, () => this._applyGridColumnLimit());
                this._gridColumnSignalIds.push(id);
            });
        }

        /**
         * Apply the current column limit to the masonry view.
         * @private
         */
        _applyGridColumnLimit() {
            const maxColumns = this._getGridMaxColumnsSetting();
            this._masonryView?.setMaxColumns?.(maxColumns);
        }

        // ========================================================================
        // State Display Methods
        // ========================================================================

        /**
         * Render the grid with GIF items.
         *
         * @param {Array<object>} results Array of GIF data objects.
         * @param {boolean} [replace=true] Whether to replace existing items or append.
         */
        renderGrid(results, replace = true) {
            if (!this._masonryView) return;

            this._masonryView.visible = true;
            this._infoBin.visible = false;

            if (replace) {
                this._masonryView.clear();
                this._itemFactory.startNewSession();
            }

            this._masonryView.addItems(results);
        }

        /**
         * Show the loading state with spinner and hide the grid.
         */
        showLoadingState() {
            this.showSpinner(true);
            if (this._masonryView) {
                this._masonryView.visible = false;
                this._masonryView.clear();
            }
            if (this._infoBin) {
                this._infoBin.visible = false;
            }
        }

        /**
         * Show an informational message instead of the grid.
         *
         * @param {string} message The message to display.
         */
        showInfoState(message) {
            this.showSpinner(false);
            if (this._masonryView) {
                this._masonryView.visible = false;
            }
            if (this._infoBin) {
                this._infoBin.visible = true;
            }
            if (this._infoLabel) {
                this._infoLabel.set_style_class_name('aio-clipboard-info-label');
                this._infoLabel.set_text(message);
            }
        }

        /**
         * Show an error message instead of the grid.
         *
         * @param {string} errorMessage The error message to display.
         */
        showErrorState(errorMessage) {
            this.showSpinner(false);
            if (this._masonryView) {
                this._masonryView.visible = false;
            }
            if (this._infoBin) {
                this._infoBin.visible = true;
            }
            if (this._infoLabel) {
                this._infoLabel.set_style_class_name('aio-clipboard-error-label');
                this._infoLabel.set_text(_('Error: %s\nPlease check your API key and network connection.').format(errorMessage));
            }
        }

        /**
         * Show or hide the loading spinner at the bottom of the content.
         *
         * @param {boolean} visible Whether the spinner should be visible.
         */
        showSpinner(visible) {
            if (this._spinner) {
                this._spinner.visible = visible;
            }
        }

        /**
         * Checks if the grid is currently empty.
         * @returns {boolean} True if empty.
         */
        isEmpty() {
            return !this._masonryView || this._masonryView.getItemCount() === 0;
        }

        // ========================================================================
        // Scroll & Navigation
        // ========================================================================

        /**
         * Handle scroll events for infinite scroll pagination.
         *
         * @param {St.Adjustment} vadjustment The vertical adjustment of the scroll view.
         * @private
         */
        _onScroll(vadjustment) {
            const threshold = vadjustment.upper - vadjustment.page_size - GifUI.SCROLL_THRESHOLD_PX;

            if (vadjustment.value >= threshold) {
                this.emit('load-more');
            }
        }

        /**
         * Focus the first GIF result using the masonry layout's focus API.
         *
         * @returns {boolean} True if focus was moved and false if no items.
         */
        focusFirstItem() {
            if (this.isEmpty()) {
                return false;
            }
            this._masonryView.focusFirst();
            return true;
        }

        /**
         * Handle boundary cases when MasonryLayout propagates navigation events.
         * This only receives events that MasonryLayout didn't handle internally.
         *
         * @param {St.Widget} actor The actor that received the event.
         * @param {Clutter.Event} event The key press event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        _onGridKeyPress(actor, event) {
            const symbol = event.get_key_symbol();

            if (symbol === Clutter.KEY_Up) {
                this.emit('focus-next-up');
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Returns the internal scroll view component.
         * Needed by the ItemFactory.
         * @returns {St.ScrollView} The scroll view.
         */
        getScrollView() {
            return this._scrollView;
        }

        // ========================================================================
        // Lifecycle
        // ========================================================================

        /**
         * Clean up all resources.
         */
        destroy() {
            if (this._gridColumnSignalIds.length > 0) {
                this._gridColumnSignalIds.forEach((id) => this._settings.disconnect(id));
                this._gridColumnSignalIds = [];
            }

            this._masonryView = null;
            this._spinner = null;

            super.destroy();
        }
    },
);
