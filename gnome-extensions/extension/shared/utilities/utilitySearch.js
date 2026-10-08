import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { FocusUtils } from './utilityFocus.js';
import { mapLayout } from './utilityLayout.js';
import { createLogo, createStaticIcon } from './utilityIcon.js';

const SearchIcons = {
    CLEAR: {
        icon: 'utility-clear-symbolic.svg',
        iconSize: 16,
    },
};

/**
 * A self-contained search bar component.
 * Encapsulates an St.Entry with a clear button and provides a simple callback mechanism to notify a listener of search text changes.
 */
export const SearchComponent = GObject.registerClass(
    {
        Signals: {
            'search-changed': { param_types: [GObject.TYPE_STRING] },
        },
    },
    class SearchComponent extends GObject.Object {
        /**
         * Initialize the search component.
         *
         * @param {Function} onSearchChangedCallback A function called with the new search text whenever it changes.
         * @param {Object} [options] Optional configuration.
         * @param {Function} [options.onNavigateDown] Callback when down navigation is requested.
         * @param {Function} [options.onNavigateUp] Callback when up navigation is requested.
         * @param {Function} [options.onNavigateTab] Callback when tab navigation is requested.
         */
        constructor(onSearchChangedCallback, { onNavigateDown, onNavigateUp, onNavigateTab } = {}) {
            super();
            this._onSearchChangedCallback = onSearchChangedCallback;
            this._onNavigateDown = onNavigateDown ?? null;
            this._onNavigateUp = onNavigateUp ?? null;
            this._onNavigateTab = onNavigateTab ?? null;
            this._mappedSignalId = 0;
            this._capturedEventId = 0;

            this.actor = new St.BoxLayout({
                ...mapLayout({
                    horizontal: true,
                    x_expand: true,
                    y_align: 'center',
                }),
                style_class: 'aio-search-bar-container',
            });

            this._entry = new St.Entry({
                style_class: 'aio-search-entry entry',
                hint_text: _('Search...'),
                can_focus: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._clutterText = this._entry.get_clutter_text();
            this._entry.connect('notify::text', () => this._onSearchChanged());
            this._clutterText.connect('activate', () => this._onSearchChanged());

            this._clutterText.connect('key-focus-in', () => {
                this._entry.add_style_pseudo_class('focus');
            });
            this._clutterText.connect('key-focus-out', () => {
                this._entry.remove_style_pseudo_class('focus');
            });

            // captured-event runs in the capture phase and exists on every supported Shell version, unlike Clutter.KeyController.
            this._capturedEventId = this._entry.connect('captured-event', (_actor, event) => {
                if (event.type() !== Clutter.EventType.KEY_PRESS) {
                    return Clutter.EVENT_PROPAGATE;
                }
                return this._onKeyPress(this._entry, event);
            });

            this._entryWrapper = new St.BoxLayout({
                ...mapLayout({
                    horizontal: true,
                    x_expand: true,
                    y_align: 'center',
                }),
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
                ...mapLayout({
                    horizontal: true,
                    y_align: 'center',
                }),
            });
            this._clearButtonWrapper.add_child(this._clearButton);
            this.actor.add_child(this._clearButtonWrapper);
        }

        /**
         * Internal handler for the search entry text notification signal.
         *
         * @private
         */
        _onSearchChanged() {
            const searchText = this._entry.get_text();
            this._clearButton.visible = searchText.length > 0;
            this.emit('search-changed', searchText);
            if (this._onSearchChangedCallback) {
                this._onSearchChangedCallback(searchText);
            }
        }

        /**
         * Handle key press events for the clear button.
         *
         * @param {Clutter.Event} event The key event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _handleClearButtonKeyPress(event) {
            if (FocusUtils.isKey(event, 'Right')) {
                return Clutter.EVENT_STOP;
            }

            const tabNav = FocusUtils.getTabNavigation(event);
            if (FocusUtils.isKey(event, 'Left') || tabNav.isBackward) {
                this._entry.grab_key_focus();
                this._clutterText.set_cursor_position(-1);
                return Clutter.EVENT_STOP;
            }

            if (tabNav.isForward) {
                return this._handleTabNavigation(false);
            }

            if (FocusUtils.isKey(event, 'Down')) {
                if (this._onNavigateDown) {
                    return this._onNavigateDown() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_STOP;
            }

            if (FocusUtils.isKey(event, 'Up')) {
                if (this._onNavigateUp) {
                    return this._onNavigateUp() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Handle forward or backward tab navigation from the search entry.
         *
         * @param {boolean} isBackward Whether navigating backward.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _handleTabNavigation(isBackward) {
            if (this._onNavigateTab) {
                return this._onNavigateTab(isBackward) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            }
            if (isBackward) {
                if (this._onNavigateUp) {
                    return this._onNavigateUp() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_STOP;
            }
            if (this._onNavigateDown) {
                return this._onNavigateDown() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
            }
            return Clutter.EVENT_STOP;
        }

        /**
         * Handle vertical arrow key navigation inside the entry.
         *
         * @param {Clutter.Event} event The key event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _handleVerticalNavigation(event) {
            if (FocusUtils.isKey(event, 'Down')) {
                if (this._onNavigateDown) {
                    return this._onNavigateDown() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (FocusUtils.isKey(event, 'Up')) {
                if (this._onNavigateUp) {
                    return this._onNavigateUp() ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                }
                return Clutter.EVENT_PROPAGATE;
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Handle horizontal arrow key navigation inside the entry.
         *
         * @param {Clutter.Event} event The key event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _handleHorizontalArrowPress(event) {
            const text = this._entry.get_text();
            const cursorPosition = this._clutterText.get_cursor_position();

            if (FocusUtils.isKey(event, 'Left')) {
                const isAtStart = cursorPosition === 0 || (text.length === 0 && cursorPosition === -1);
                if (isAtStart) {
                    return Clutter.EVENT_STOP;
                }
            } else if (FocusUtils.isKey(event, 'Right')) {
                const isAtEnd = cursorPosition === -1 || cursorPosition >= text.length;
                if (isAtEnd) {
                    if (this._clearButton.visible) {
                        this._clearButton.grab_key_focus();
                    }
                    return Clutter.EVENT_STOP;
                }
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Handle key press events on the search entry to allow escaping with arrow keys and tab cycling.
         *
         * @param {Clutter.Actor} actor The source actor.
         * @param {Clutter.Event} [event] The key event.
         * @returns {number} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
         * @private
         */
        _onKeyPress(actor, event) {
            if (actor === this._clearButton) {
                return this._handleClearButtonKeyPress(event);
            }

            const keyEvent = event ?? Clutter.get_current_event();
            const tabNav = FocusUtils.getTabNavigation(keyEvent);

            if (tabNav.isTab) {
                if (tabNav.isForward && this._clearButton.visible) {
                    this._clearButton.grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
                return this._handleTabNavigation(tabNav.isBackward);
            }

            const verticalResult = this._handleVerticalNavigation(keyEvent);
            if (verticalResult === Clutter.EVENT_STOP) {
                return Clutter.EVENT_STOP;
            }

            if (FocusUtils.isKey(keyEvent, 'Left') || FocusUtils.isKey(keyEvent, 'Right')) {
                return this._handleHorizontalArrowPress(keyEvent);
            }

            return Clutter.EVENT_PROPAGATE;
        }

        /**
         * Clears the text in the search entry and restores focus to it.
         */
        clearSearch() {
            this.setSearchText('', { focus: true });
        }

        /**
         * Sets the current search text.
         *
         * @param {string} searchText Text to apply to the search field.
         * @param {Object} [options] Additional options.
         * @param {boolean} [options.focus=false] Whether to focus the entry after update.
         */
        setSearchText(searchText, { focus = false } = {}) {
            const normalizedText = typeof searchText === 'string' ? searchText : '';

            if (this._entry.get_text() !== normalizedText) {
                this._entry.set_text(normalizedText);
            }

            if (focus) {
                this.grabFocus();
            }
        }

        /**
         * Returns the current search text.
         * @returns {string} Current entry text.
         */
        getSearchText() {
            return this._entry.get_text();
        }

        /**
         * Sets the search hint content using text or a logo configuration or both.
         *
         * @param {Object} [config] Configuration object.
         * @param {string} [config.text] Hint text such as Search...
         * @param {Object} [config.logo] Logo configuration for createLogo.
         * @param {number} [config.spacing=4] Spacing in pixels between text and logo.
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
                    ...mapLayout({
                        horizontal: true,
                        y_align: 'center',
                    }),
                });

                let hintLabel = null;
                if (config.text) {
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
                    if (hintLabel) {
                        logo.add_style_class_name('aio-search-logo');
                    }
                    this._hintWrapper.add_child(logo);
                }

                this._entry.hint_actor = this._hintWrapper;

                if (hintLabel) {
                    hintLabel.connect('style-changed', () => {
                        try {
                            const c = hintLabel.get_theme_node().get_color('color');
                            this._hintWrapper.style = `color: rgba(${c.red},${c.green},${c.blue},${c.alpha / 255});`;
                        } catch {
                            // Ignore theme node error.
                        }
                    });
                }
            } else {
                this._entry.set_hint_text(config.text);
            }
        }

        /**
         * Sets the keyboard focus to the search entry.
         *
         * @returns {boolean} True if focus was grabbed or scheduled.
         */
        grabFocus() {
            if (!this.actor.visible || !this._entry.can_focus) {
                return false;
            }

            if (this._entry.mapped && this._entry.visible) {
                this._entry.grab_key_focus();
                return true;
            }

            if (this._mappedSignalId) {
                this._entry.disconnect(this._mappedSignalId);
            }
            this._mappedSignalId = this._entry.connect('notify::mapped', () => {
                if (this._entry.mapped && this._entry.visible) {
                    if (this._mappedSignalId) {
                        this._entry.disconnect(this._mappedSignalId);
                        this._mappedSignalId = 0;
                    }
                    this._entry.grab_key_focus();
                }
            });
            return true;
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
            if (this._mappedSignalId) {
                this._entry.disconnect(this._mappedSignalId);
                this._mappedSignalId = 0;
            }
            if (this._capturedEventId) {
                this._entry.disconnect(this._capturedEventId);
                this._capturedEventId = 0;
            }
            if (this._hintWrapper) {
                this._hintWrapper.destroy();
                this._hintWrapper = null;
            }
            this._clutterText = null;
            this._entry = null;
            this._clearButton = null;
            this.actor = null;
            this._onSearchChangedCallback = null;
            this._onNavigateDown = null;
            this._onNavigateUp = null;
            this._onNavigateTab = null;
        }
    },
);
