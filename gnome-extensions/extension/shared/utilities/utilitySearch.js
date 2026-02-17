import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { createStaticIcon, createLogo } from './utilityIcon.js';

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
                visible: false,
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
         * Sets the search hint content. Accepts text, a logo config, or both.
         * Text-only hints use the native `set_hint_text()` for perfect theme colors.
         * When a logo is present, an St.Label with `hint-text` class is used for
         * theme-consistent coloring, and the logo auto-resolves its color to match.
         *
         * @param {Object} [config]
         * @param {string} [config.text] - Hint text (e.g. "Search Tenor...")
         * @param {Object} [config.logo] - Logo config for createLogo (e.g. { icon, height, basePath })
         * @param {number} [config.spacing=4] - Spacing in px between text and logo
         */
        setHint(config) {
            if (this._hintWrapper) {
                this._entry.hint_actor = null;
                this._hintWrapper.destroy();
                this._hintWrapper = null;
            }

            if (!config?.text && !config?.logo) {
                this._entry.set_hint_text('');
                return;
            }

            if (config.logo) {
                this._entry.set_hint_text('');
                this._hintWrapper = new St.BoxLayout({
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `spacing: ${config.spacing ?? 4}px;`,
                });

                let hintLabel = null;
                if (config.text) {
                    // Uses the theme's StEntry StLabel.hint-text selector for native hint color
                    hintLabel = new St.Label({
                        text: config.text,
                        style_class: 'hint-text',
                    });
                    this._hintWrapper.add_child(hintLabel);
                }

                const logo = createLogo(config.logo);
                if (logo) {
                    logo.y_align = Clutter.ActorAlign.CENTER;
                    logo.y_expand = false;
                    this._hintWrapper.add_child(logo);
                }

                this._entry.hint_actor = this._hintWrapper;

                if (hintLabel) {
                    hintLabel.connect('style-changed', () => {
                        try {
                            const c = hintLabel.get_theme_node().get_color('color');
                            this._hintWrapper.style = `spacing: ${config.spacing ?? 4}px; color: rgba(${c.red},${c.green},${c.blue},${c.alpha / 255});`;
                        } catch {
                            // Ignore
                        }
                    });
                }
            } else {
                // Text-only hints use the native hint_text for theme-consistent color
                this._entry.set_hint_text(config.text);
            }
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
