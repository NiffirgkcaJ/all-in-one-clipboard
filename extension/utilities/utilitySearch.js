import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * A self-contained search bar component.
 *
 * Encapsulates an St.Entry with a clear button and provides a simple callback
 * mechanism to notify a listener of search text changes.
 */
export const SearchComponent = GObject.registerClass(
class SearchComponent extends GObject.Object {
    /**
     * @param {Function} onSearchChangedCallback - A function that will be called
     *   with the new search text whenever it changes.
     */
    _init(onSearchChangedCallback) {
        super._init();
        // Use the variable name that was passed in.
        this._onSearchChangedCallback = onSearchChangedCallback;

        // The main actor for this component, containing the entry and clear button.
        this.actor = new St.BoxLayout({
            style_class: 'aio-search-bar-container',
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        this._entry = new St.Entry({
            style_class: 'aio-search-entry entry',
            hint_text: _("Search..."),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._entry.connect('notify::text', () => this._onSearchChanged());

        // Connect to the internal ClutterText's focus signals to maintain visual state
        const clutterText = this._entry.get_clutter_text();
        clutterText.connect('key-focus-in', () => {
            this._entry.add_style_pseudo_class('focus');
        });
        clutterText.connect('key-focus-out', () => {
            this._entry.remove_style_pseudo_class('focus');
        });

        this.actor.add_child(this._entry);

        this._clearButton = new St.Button({
            style_class: 'aio-search-clear-button button',
            child: new St.Icon({
                icon_name: 'edit-clear-symbolic',
                style_class: 'button-symbolic',
                icon_size: 16,
            }),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false, // Initially hidden
        });
        this._clearButton.connect('clicked', () => this.clearSearch());
        this.actor.add_child(this._clearButton);
    }

    /**
     * Internal handler for the search entry's 'notify::text' signal.
     * @private
     */
    _onSearchChanged() {
        const searchText = this._entry.get_text();
        this._clearButton.visible = searchText.length > 0;

        this._onSearchChangedCallback?.(searchText);
    }

    /**
     * Clears the text in the search entry and restores focus to it.
     */
    clearSearch() {
        if (this._entry.get_text() === "") return;
        this._entry.set_text("");
        this._entry.grab_key_focus();
    }

    /**
     * Sets the keyboard focus to the search entry.
     */
    grabFocus() {
        this._entry.grab_key_focus();
    }

    /**
     * Gets the main actor of this component to be added to a parent container.
     * @returns {St.BoxLayout} The actor containing the search bar.
     */
    getWidget() {
        return this.actor;
    }

    /**
     * Cleans up resources and references.
     */
    destroy() {
        this._entry?.destroy();
        this._clearButton?.destroy();
        this.actor?.destroy();

        this._entry = null;
        this._clearButton = null;
        this.actor = null;
        this._onSearchChangedCallback = null;
    }
});