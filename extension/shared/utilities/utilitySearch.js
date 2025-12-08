import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon } from './utilityIcon.js';

const SearchIcons = {
    CLEAR: {
        icon: 'utility-clear-symbolic.svg',
        iconSize: 16,
    },
};

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
        constructor(onSearchChangedCallback) {
            super();
            this._onSearchChangedCallback = onSearchChangedCallback;

            this.actor = new St.BoxLayout({
                style_class: 'aio-search-bar-container',
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            this._entry = new St.Entry({
                style_class: 'aio-search-entry entry',
                hint_text: _('Search...'),
                can_focus: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._entry.connect('notify::text', () => this._onSearchChanged());

            const clutterText = this._entry.get_clutter_text();
            clutterText.connect('activate', () => this._onSearchChanged());

            clutterText.connect('key-focus-in', () => {
                this._entry.add_style_pseudo_class('focus');
            });
            clutterText.connect('key-focus-out', () => {
                this._entry.remove_style_pseudo_class('focus');
            });

            clutterText.connect('key-press-event', (actor, event) => this._onKeyPress(actor, event));

            this._entryWrapper = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._entryWrapper.add_child(this._entry);
            this.actor.add_child(this._entryWrapper);

            this._clearButton = new St.Button({
                style_class: 'aio-search-clear-button button',
                child: createStaticIcon(SearchIcons.CLEAR),
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false, // Initially hidden
            });
            this._clearButton.connect('clicked', () => this.clearSearch());
            this._clearButton.connect('key-press-event', (actor, event) => this._onKeyPress(actor, event));

            this._clearButtonWrapper = new St.BoxLayout({
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._clearButtonWrapper.add_child(this._clearButton);
            this.actor.add_child(this._clearButtonWrapper);
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
         * Handle key press events on the search entry.
         * Allows escaping the entry with Left/Right arrows at text boundaries.
         *
         * @param {Clutter.Actor} actor - The source actor
         * @param {Clutter.Event} event - The key event
         * @returns {boolean} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
         * @private
         */
        _onKeyPress(actor, event) {
            const symbol = event.get_key_symbol();

            if (actor === this._clearButton) {
                if (symbol === Clutter.KEY_Right) return Clutter.EVENT_STOP;
                if (symbol === Clutter.KEY_Left) {
                    this._entry.grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            const text = this._entry.get_text();
            const cursorPosition = this._entry.clutter_text.get_cursor_position();

            if (symbol === Clutter.KEY_Left) {
                const isAtStart = cursorPosition === 0 || (text.length === 0 && cursorPosition === -1);
                if (isAtStart) return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_Right) {
                const isAtEnd = cursorPosition === -1 || cursorPosition === text.length;
                if (isAtEnd) {
                    if (this._clearButton.visible) {
                        this._clearButton.grab_key_focus();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Clears the text in the search entry and restores focus to it.
         */
        clearSearch() {
            if (this._entry.get_text() === '') return;
            this._entry.set_text('');
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
            this._entry = null;
            this._clearButton = null;
            this.actor = null;
            this._onSearchChangedCallback = null;
        }
    },
);
