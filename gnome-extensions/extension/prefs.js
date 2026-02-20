import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getGifCacheManager } from './features/GIF/logic/gifCacheManager.js';
import { GifProviderRegistry } from './features/GIF/logic/gifProviderRegistry.js';
import { initStorage } from './shared/constants/storagePaths.js';

export default class AllInOneClipboardPreferences extends ExtensionPreferences {
    /**
     * Populate the preferences window with the settings UI.
     *
     * @param {Adw.PreferencesWindow} window - The preferences window to populate.
     */
    fillPreferencesWindow(window) {
        // Initialize translations
        this.initTranslations('all-in-one-clipboard');

        // Initialize storage paths
        initStorage(this.uuid);

        // Load GResource for the prefs process
        let extensionDir = this.dir;
        if (!extensionDir && this.path) {
            extensionDir = Gio.File.new_for_path(this.path);
        }

        if (extensionDir) {
            const resourceFile = extensionDir.get_child('resources.gresource');

            try {
                if (resourceFile.query_exists(null)) {
                    const resource = Gio.Resource.load(resourceFile.get_path());
                    Gio.resources_register(resource);
                } else {
                    console.warn(`[AIO-Clipboard] GResource not found at: ${resourceFile.get_path()}`);
                }
            } catch (e) {
                console.warn(`[AIO-Clipboard] Failed to register GResource: ${e.message}`);
            }
        }

        // Get the Gio.Settings instance for this extension
        const settings = this.getSettings();

        // Create main preferences page
        const page = new Adw.PreferencesPage({
            title: _('All-in-One Clipboard Settings'),
        });
        window.add(page);

        // Add all preference groups
        this._addGeneralGroup(page, settings);
        this._addTabManagementGroup(page, settings);
        this._addKeyboardShortcutsGroup(page, settings);
        this._addRecentItemsGroup(page, settings);
        this._addAutoPasteGroup(page, settings);
        this._addClipboardSettingsGroup(page, settings);
        this._addEmojiSettingsGroup(page, settings);
        this._addGifSettingsGroup(page, settings);
        this._addExclusionsGroup(page, settings);
        this._addDataManagementGroup(page, settings, window);
    }

    /**
     * Helper to extract the min and max range from a GSettings schema key.
     *
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {string} key - The key to extract the range for.
     * @returns {Object|null} An object with 'min' and 'max' properties, or null if not a range.
     */
    _getRangeFromSchema(settings, key) {
        const schemaSource = settings.settings_schema;
        const schemaKey = schemaSource.get_key(key);
        const rangeVariant = schemaKey.get_range();

        // The range variant has format: ('range', <(min, max)>)
        const rangeType = rangeVariant.get_child_value(0).get_string()[0];

        if (rangeType === 'range') {
            const limits = rangeVariant.get_child_value(1).get_child_value(0);
            const min = limits.get_child_value(0).get_int32();
            const max = limits.get_child_value(1).get_int32();
            return { min, max };
        }

        return null;
    }

    /**
     * Add the "General" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addGeneralGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('General'),
        });
        page.add(group);

        // Hide panel icon
        const hideIconRow = new Adw.SwitchRow({
            title: _('Hide Panel Icon'),
            subtitle: _('The menu can still be opened with shortcuts.'),
        });
        group.add(hideIconRow);

        settings.bind('hide-panel-icon', hideIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Remember last opened tab
        const rememberTabRow = new Adw.SwitchRow({
            title: _('Remember Last Opened Tab'),
            subtitle: _('Re-open the menu to the last used tab.'),
        });
        group.add(rememberTabRow);

        settings.bind('remember-last-tab', rememberTabRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Make the "Remember Last Opened Tab" switch sensitive only when the "Hide Panel Icon" switch is off.
        hideIconRow.bind_property('active', rememberTabRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);

        // Define our options
        const positionOptions = {
            cursor: _('Mouse Cursor'),
            center: _('Screen Center'),
            window: _('Active Window'),
        };
        const optionKeys = Object.keys(positionOptions);
        const optionLabels = Object.values(positionOptions);

        const positionRow = new Adw.ComboRow({
            title: _('Menu Position'),
            model: new Gtk.StringList({ strings: optionLabels }),
        });
        group.add(positionRow);

        // Custom binding for the ComboRow
        const updatePositionFromSettings = () => {
            const currentMode = settings.get_string('hidden-icon-position-mode');
            const newIndex = optionKeys.indexOf(currentMode);
            if (newIndex > -1 && positionRow.selected !== newIndex) {
                positionRow.selected = newIndex;
            }
        };

        positionRow.connect('notify::selected', () => {
            const selectedMode = optionKeys[positionRow.selected];
            if (selectedMode && settings.get_string('hidden-icon-position-mode') !== selectedMode) {
                settings.set_string('hidden-icon-position-mode', selectedMode);
            }
        });

        const settingsSignalId = settings.connect('changed::hidden-icon-position-mode', updatePositionFromSettings);

        // Set the initial value
        updatePositionFromSettings();

        // Ensure this UI element is destroyed properly
        page.connect('unmap', () => {
            if (settings && settingsSignalId > 0) {
                settings.disconnect(settingsSignalId);
            }
        });

        // Make the dropdown sensitive only when the icon is hidden
        hideIconRow.bind_property('active', positionRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
    }

    /**
     * Add the "Tab Management" preferences group to the page.
     * This group allows users to customize tab visibility, order, and the default tab.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addTabManagementGroup(page, settings) {
        // Create a new preferences group with a title and description
        const group = new Adw.PreferencesGroup({
            title: _('Tab Management'),
            description: _('Customize the visibility, order, and default tab.'),
        });
        page.add(group);

        // Clean up signal connections when the page is unmapped
        const signalIds = [];
        page.connect('unmap', () => {
            signalIds.forEach((id) => {
                if (settings) settings.disconnect(id);
            });
            signalIds.length = 0;
        });

        // Define the visibility configuration for each tab
        const TAB_VISIBILITY_CONFIG = {
            'Recently Used': {
                key: 'enable-recents-tab',
                title: _('Recently Used Tab'),
                subtitle: _('Required when Always Show Main Tabs is off.'),
            },
            Emoji: { key: 'enable-emoji-tab', title: _('Emoji Tab') },
            GIF: { key: 'enable-gif-tab', title: _('GIF Tab') },
            Kaomoji: { key: 'enable-kaomoji-tab', title: _('Kaomoji Tab') },
            Symbols: { key: 'enable-symbols-tab', title: _('Symbols Tab') },
            Clipboard: { key: 'enable-clipboard-tab', title: _('Clipboard Tab') },
        };

        // Create an expander row for visible tabs
        const visibleTabsExpander = new Adw.ExpanderRow({
            title: _('Visible Tabs'),
            subtitle: _('Show or hide individual tabs from the main bar.'),
        });
        group.add(visibleTabsExpander);

        // Create rows for each tab visibility configuration
        const tabVisibilityRows = [];
        for (const [name, config] of Object.entries(TAB_VISIBILITY_CONFIG)) {
            const row = new Adw.SwitchRow({
                title: config.title,
                subtitle: config.subtitle || '',
                activatable: true,
            });
            visibleTabsExpander.add_row(row);
            tabVisibilityRows.push({ name, config, row });
            settings.bind(config.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        }

        // Create an expander row for tab bar behavior
        const tabBarExpander = new Adw.ExpanderRow({
            title: _('Tab Bar Behavior'),
            subtitle: _('Configure when the top tab bar is visible.'),
        });
        group.add(tabBarExpander);

        // Create a switch row for always showing the main tabs
        const alwaysShowMainTabsRow = new Adw.SwitchRow({
            title: _('Always Show Main Tabs'),
            subtitle: _('Keep the main tab buttons visible in every tab.'),
        });
        settings.bind('always-show-main-tab', alwaysShowMainTabsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        tabBarExpander.add_row(alwaysShowMainTabsRow); // Add to expander

        // Create a switch row for hiding the last main tab
        const hideLastMainTabRow = new Adw.SwitchRow({
            title: _('Hide Last Main Tab'),
            subtitle: _('Automatically hide the last main tab visible.'),
        });
        settings.bind('hide-last-main-tab', hideLastMainTabRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        tabBarExpander.add_row(hideLastMainTabRow); // Add to expander

        // Create a combo row for the default tab
        const defaultTabRow = new Adw.ComboRow({
            title: _('Default Tab'),
            subtitle: _('The tab that opens when you first open the menu.'),
        });
        group.add(defaultTabRow);

        // Create a combo row for the default tab
        const recentsRowData = tabVisibilityRows.find((r) => r.name === 'Recently Used');
        const recentsRowWidget = recentsRowData?.row;
        const recentsKey = recentsRowData?.config.key;

        // This will hold the currently visible tabs for the default tab model
        let visibleTabsForModel = [];

        // Update the sensitivity of the tabs based on current settings
        const updateTabToggleSensitivity = () => {
            const states = tabVisibilityRows.map((item) => ({
                row: item.row,
                enabled: settings.get_boolean(item.config.key),
                isRecents: item.row === recentsRowWidget,
            }));

            const enabledCount = states.filter((state) => state.enabled).length;

            states.forEach((state) => {
                const isLastOneEnabled = enabledCount === 1 && state.enabled;

                // Special handling for Recents tab
                if (state.isRecents) {
                    // Recents is sensitive only if 'Always Show Tabs' is on and it is not the last remaining enabled tab.
                    const alwaysShowTabs = settings.get_boolean('always-show-main-tab');
                    state.row.set_sensitive(!isLastOneEnabled && alwaysShowTabs);
                } else {
                    // Other tabs are sensitive if they're not the last enabled tab
                    state.row.set_sensitive(!isLastOneEnabled);
                }
            });
        };

        // Update the default tab based on current settings
        const updateDefaultTabModel = () => {
            const currentDefault = settings.get_string('default-tab');
            const tabOrder = settings.get_strv('tab-order');
            visibleTabsForModel = [];

            // Add visible tabs to the model
            tabOrder.forEach((originalTabName) => {
                const config = TAB_VISIBILITY_CONFIG[originalTabName];
                if (!config || settings.get_boolean(config.key)) {
                    visibleTabsForModel.push({
                        original: originalTabName,
                        translated: _(originalTabName),
                    });
                }
            });

            // Update the model
            defaultTabRow.set_model(new Gtk.StringList({ strings: visibleTabsForModel.map((t) => t.translated) }));
            const newIndex = visibleTabsForModel.findIndex((t) => t.original === currentDefault);

            // Update selection
            if (newIndex > -1) {
                defaultTabRow.set_selected(newIndex);
            } else if (visibleTabsForModel.length > 0) {
                const newDefault = visibleTabsForModel[0].original;
                settings.set_string('default-tab', newDefault);
                defaultTabRow.set_selected(0);
            }
        };

        // Handler for when relevant settings change
        const handleSettingsChange = () => {
            // Recents is sensitive only if 'Always Show Tabs' is on
            if (!settings.get_boolean('always-show-main-tab') && recentsKey) {
                settings.set_boolean(recentsKey, true);
            }
            updateTabToggleSensitivity();
            updateDefaultTabModel();
        };

        // Connect signals
        Object.values(TAB_VISIBILITY_CONFIG).forEach((config) => {
            signalIds.push(settings.connect(`changed::${config.key}`, handleSettingsChange));
        });
        signalIds.push(settings.connect('changed::always-show-main-tab', handleSettingsChange));
        signalIds.push(settings.connect('changed::tab-order', updateDefaultTabModel));

        defaultTabRow.connect('notify::selected', () => {
            const selectedIndex = defaultTabRow.get_selected();
            if (selectedIndex >= 0 && selectedIndex < visibleTabsForModel.length) {
                const selectedOriginalName = visibleTabsForModel[selectedIndex].original;
                if (settings.get_string('default-tab') !== selectedOriginalName) {
                    settings.set_string('default-tab', selectedOriginalName);
                }
            }
        });

        // Initial state setup
        handleSettingsChange();

        // Create the tab order expander
        const tabOrderExpander = new Adw.ExpanderRow({
            title: _('Tab Order'),
            subtitle: _('Use the buttons to reorder tabs in the main bar.'),
        });
        group.add(tabOrderExpander);

        // This array will hold references to ALL rows this function manages.
        let managedRows = [];

        // Function to populate the tab order list
        const populateTabOrderList = () => {
            // Remove all previously created rows from the UI.
            managedRows.forEach((row) => tabOrderExpander.remove(row));
            managedRows = []; // Clear the reference array.

            // Create and add the dynamic re-orderable rows.
            const tabOrder = settings.get_strv('tab-order');

            tabOrder.forEach((tabName, index) => {
                // Check if this tab is currently visible
                const config = TAB_VISIBILITY_CONFIG[tabName];
                const isVisible = config ? settings.get_boolean(config.key) : true;

                // Create the rows with appropriate title
                const row = new Adw.ActionRow({
                    // Add a suffix to the title if the tab is hidden
                    title: isVisible ? _(tabName) : `${_(tabName)} (Hidden)`,
                });

                // Dim the label if the tab is hidden
                if (!isVisible) {
                    row.add_css_class('dim-label');
                }

                const buttonBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
                row.add_suffix(buttonBox);

                const upButton = new Gtk.Button({
                    icon_name: 'go-up-symbolic',
                    sensitive: index > 0,
                });
                const downButton = new Gtk.Button({
                    icon_name: 'go-down-symbolic',
                    sensitive: index < tabOrder.length - 1,
                });

                const moveRow = (direction) => {
                    const currentOrder = settings.get_strv('tab-order');
                    const oldIndex = currentOrder.indexOf(tabName);
                    const newIndex = oldIndex + direction;

                    if (newIndex >= 0 && newIndex < currentOrder.length) {
                        [currentOrder[oldIndex], currentOrder[newIndex]] = [currentOrder[newIndex], currentOrder[oldIndex]];
                        settings.set_strv('tab-order', currentOrder);
                    }
                };

                upButton.connect('clicked', () => moveRow(-1));
                downButton.connect('clicked', () => moveRow(1));

                buttonBox.append(upButton);
                buttonBox.append(downButton);

                tabOrderExpander.add_row(row);
                managedRows.push(row); // Add to our reference array.
            });

            // Create and add the static reset row at the very end.
            const resetRow = new Adw.ActionRow({
                title: _('Reset Order'),
                subtitle: _('Restore the original tab order.'),
            });
            tabOrderExpander.add_row(resetRow);
            managedRows.push(resetRow); // Also add to our reference array.

            const resetButton = new Gtk.Button({
                label: _('Reset'),
                valign: Gtk.Align.CENTER,
                css_classes: ['destructive-action'],
            });

            resetButton.connect('clicked', () => {
                const defaultValueVariant = settings.get_default_value('tab-order');
                settings.set_strv('tab-order', defaultValueVariant.get_strv());
            });
            resetRow.add_suffix(resetButton);
        };

        signalIds.push(settings.connect('changed::tab-order', populateTabOrderList));

        // Refresh tab order list when visibility changes
        Object.values(TAB_VISIBILITY_CONFIG).forEach((config) => {
            if (config.key) {
                signalIds.push(settings.connect(`changed::${config.key}`, populateTabOrderList));
            }
        });
        populateTabOrderList(); // Initial population
    }

    /**
     * Add the "Keyboard Shortcuts" preferences group to the page.
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addKeyboardShortcutsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcuts'),
            description: _('Click on a shortcut to change it. Press Backspace to clear.'),
        });
        page.add(group);

        // Global Shortcuts
        const globalExpander = new Adw.ExpanderRow({
            title: _('Global Shortcuts'),
            subtitle: _('These work even when the menu is closed.'),
        });
        group.add(globalExpander);

        const globalShortcuts = [
            { key: 'shortcut-toggle-main', title: _('Toggle Main Menu') },
            { key: 'shortcut-open-emoji', title: _('Open Emoji Tab') },
            { key: 'shortcut-open-gif', title: _('Open GIF Tab') },
            { key: 'shortcut-open-kaomoji', title: _('Open Kaomoji Tab') },
            { key: 'shortcut-open-symbols', title: _('Open Symbols Tab') },
            { key: 'shortcut-open-clipboard', title: _('Open Clipboard Tab') },
        ];

        globalShortcuts.forEach((shortcut) => {
            const row = this._createShortcutRow(settings, shortcut.key, shortcut.title);
            globalExpander.add_row(row);
        });

        // Main Tab Shortcuts
        const mainTabExpander = new Adw.ExpanderRow({
            title: _('Main Tab Navigation'),
            subtitle: _('Switch between the main tabs within the menu.'),
        });
        group.add(mainTabExpander);

        const mainTabShortcuts = [
            { key: 'shortcut-next-tab', title: _('Next Tab') },
            { key: 'shortcut-prev-tab', title: _('Previous Tab') },
        ];

        mainTabShortcuts.forEach((shortcut) => {
            const row = this._createShortcutRow(settings, shortcut.key, shortcut.title);
            mainTabExpander.add_row(row);
        });

        // Full-View Tab Shortcuts
        const categoryExpander = new Adw.ExpanderRow({
            title: _('Category Navigation'),
            subtitle: _('Switch between the categories within the tabs.'),
        });
        group.add(categoryExpander);

        const categoryShortcuts = [
            { key: 'shortcut-next-category', title: _('Next Category') },
            { key: 'shortcut-prev-category', title: _('Previous Category') },
        ];

        categoryShortcuts.forEach((shortcut) => {
            const row = this._createShortcutRow(settings, shortcut.key, shortcut.title);
            categoryExpander.add_row(row);
        });

        // Clipboard Item Shortcuts
        const itemActionExpander = new Adw.ExpanderRow({
            title: _('Clipboard Item Actions'),
            subtitle: _('Shortcuts for items in the grid/list view.'),
        });
        group.add(itemActionExpander);

        const itemActionShortcuts = [
            { key: 'clipboard-key-toggle-select', title: _('Select Item'), isSingle: true },
            { key: 'clipboard-key-toggle-pin', title: _('Pin Item'), isSingle: true },
            { key: 'clipboard-key-delete', title: _('Delete Item'), isSingle: true },
        ];

        itemActionShortcuts.forEach((shortcut) => {
            const row = this._createShortcutRow(settings, shortcut.key, shortcut.title, shortcut.isSingle);
            itemActionExpander.add_row(row);
        });
    }

    /**
     * Create a row for a keyboard shortcut setting.
     *
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {string} key - The GSettings key for the shortcut.
     * @param {string} title - The title to display for the shortcut.
     * @param {boolean} [isSingleString=false] - Whether the key stores a single string (default: array of strings).
     * @returns {Adw.ActionRow} The created action row.
     */
    _createShortcutRow(settings, key, title, isSingleString = false) {
        const row = new Adw.ActionRow({
            title: title,
            activatable: true,
        });

        const getShortcutValue = () => {
            if (isSingleString) {
                return settings.get_string(key);
            }
            const values = settings.get_strv(key);
            return values[0] || '';
        };

        const setShortcutValue = (shortcut) => {
            if (isSingleString) {
                settings.set_string(key, shortcut);
            } else {
                settings.set_strv(key, shortcut ? [shortcut] : []);
            }
        };

        const currentShortcut = getShortcutValue() || _('Disabled');
        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            accelerator: currentShortcut === _('Disabled') ? '' : currentShortcut,
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(shortcutLabel);

        row.connect('activated', () => {
            const dialog = new Gtk.Dialog({
                title: _('Set Shortcut'),
                modal: true,
                transient_for: row.get_root(),
            });

            const content = dialog.get_content_area();
            const label = new Gtk.Label({
                label: _('Press a key combination\nBackspace to Clear, Escape to Cancel'),
                justify: Gtk.Justification.CENTER,
                margin_top: 12,
                margin_bottom: 12,
                margin_start: 12,
                margin_end: 12,
            });
            content.append(label);

            // Create a key event controller to capture key presses
            const widgetController = new Gtk.EventControllerKey({
                propagation_phase: Gtk.PropagationPhase.CAPTURE,
            });
            widgetController.connect('key-pressed', (c, keyval, keycode, state) => {
                // Cancel
                if (keyval === Gdk.KEY_Escape) {
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                // Clear
                if (keyval === Gdk.KEY_BackSpace) {
                    setShortcutValue('');
                    shortcutLabel.set_accelerator('');
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                // Ignore standalone modifiers
                const isModifier =
                    keyval === Gdk.KEY_Control_L ||
                    keyval === Gdk.KEY_Control_R ||
                    keyval === Gdk.KEY_Shift_L ||
                    keyval === Gdk.KEY_Shift_R ||
                    keyval === Gdk.KEY_Alt_L ||
                    keyval === Gdk.KEY_Alt_R ||
                    keyval === Gdk.KEY_Super_L ||
                    keyval === Gdk.KEY_Super_R ||
                    keyval === Gdk.KEY_Meta_L ||
                    keyval === Gdk.KEY_Meta_R;

                if (isModifier) return Gdk.EVENT_PROPAGATE;

                // Fix ISO_Left_Tab -> Tab
                let finalKeyval = keyval;
                if (keyval === Gdk.KEY_ISO_Left_Tab) finalKeyval = Gdk.KEY_Tab;

                // Save
                const mask = state & Gtk.accelerator_get_default_mod_mask();
                const shortcut = Gtk.accelerator_name(finalKeyval, mask);

                if (shortcut) {
                    setShortcutValue(shortcut);
                    shortcutLabel.set_accelerator(shortcut);
                    dialog.close();
                }

                return Gdk.EVENT_STOP;
            });

            dialog.add_controller(widgetController);
            dialog.present();
        });
        return row;
    }

    /**
     * Add the "Recent Items" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addRecentItemsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Recent Items Limits'),
            description: _('Maximum number of items to keep in "Recents" for each feature.'),
        });
        page.add(group);

        const items = [
            { key: 'emoji-recents-max-items', title: _('Maximum Recent Emojis') },
            { key: 'kaomoji-recents-max-items', title: _('Maximum Recent Kaomojis') },
            { key: 'symbols-recents-max-items', title: _('Maximum Recent Symbols') },
            { key: 'gif-recents-max-items', title: _('Maximum Recent GIFs') },
        ];

        items.forEach((item) => {
            // Get the default value dynamically from the GSettings schema.
            const recentDefault = settings.get_default_value(item.key).get_int32();
            const recentRange = this._getRangeFromSchema(settings, item.key);
            const RECENT_INCREMENT_NUMBER = 1;

            const row = new Adw.SpinRow({
                title: item.title,
                subtitle: _('Range: %d-%d. Default: %d.').format(recentRange.min, recentRange.max, recentDefault),
                adjustment: new Gtk.Adjustment({
                    lower: recentRange.min,
                    upper: recentRange.max,
                    step_increment: RECENT_INCREMENT_NUMBER,
                }),
            });
            group.add(row);
            settings.bind(item.key, row.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        });
    }

    /**
     * Add the "Auto-Paste" preferences group to the page.
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addAutoPasteGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Auto-Paste Settings'),
        });
        page.add(group);

        // Create a single ExpanderRow with a built-in switch.
        const autoPasteExpander = new Adw.ExpanderRow({
            title: _('Enable Auto-Paste'),
            subtitle: _('Automatically paste selected items instead of just copying to clipboard.'),
            show_enable_switch: true,
        });
        group.add(autoPasteExpander);

        // Bind the expander's switch to the master GSettings key.
        settings.bind(
            'enable-auto-paste',
            autoPasteExpander,
            'enable-expansion', // This property controls the built-in switch
            Gio.SettingsBindFlags.DEFAULT,
        );

        // Define the individual toggles that will go inside the expander.
        const features = [
            { key: 'auto-paste-emoji', title: _('Auto-Paste Emojis') },
            { key: 'auto-paste-gif', title: _('Auto-Paste GIFs') },
            { key: 'auto-paste-kaomoji', title: _('Auto-Paste Kaomojis') },
            { key: 'auto-paste-symbols', title: _('Auto-Paste Symbols') },
            { key: 'auto-paste-clipboard', title: _('Auto-Paste from Clipboard History') },
        ];

        // Create and add each individual SwitchRow inside the expander.
        features.forEach((feature) => {
            const row = new Adw.SwitchRow({
                title: feature.title,
                // Initially sensitive only if the master switch is on.
            });
            autoPasteExpander.add_row(row);
            settings.bind(feature.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });
    }

    /**
     * Add the "Clipboard Settings" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addClipboardSettingsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Clipboard Settings'),
        });
        page.add(group);

        // Get the default value dynamically from the GSettings schema.
        const key = 'clipboard-history-max-items';
        const historyDefault = settings.get_default_value(key).get_int32();
        const historyRange = this._getRangeFromSchema(settings, key);
        const HISTORY_INCREMENT_NUMBER = 5;

        const maxItemsRow = new Adw.SpinRow({
            title: _('Maximum Clipboard History'),
            subtitle: _('Number of items to keep in history (%d-%d). Default: %d.').format(historyRange.min, historyRange.max, historyDefault),
            adjustment: new Gtk.Adjustment({
                lower: historyRange.min,
                upper: historyRange.max,
                step_increment: HISTORY_INCREMENT_NUMBER,
            }),
        });
        group.add(maxItemsRow);
        settings.bind(key, maxItemsRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Move to top on copy
        const updateRecencyRow = new Adw.SwitchRow({
            title: _('Move Item to Top on Copy'),
            subtitle: _('When copying an item from history, make it the most recent.'),
        });
        group.add(updateRecencyRow);
        settings.bind('update-recency-on-copy', updateRecencyRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Unpin on paste
        const unpinOnPasteRow = new Adw.SwitchRow({
            title: _('Unpin Item on Paste'),
            subtitle: _('Automatically unpin an item when it is pasted.'),
        });
        group.add(unpinOnPasteRow);
        settings.bind('unpin-on-paste', unpinOnPasteRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Clipboard image preview sizing
        const previewKey = 'clipboard-image-preview-size';
        const previewDefault = settings.get_default_value(previewKey).get_int32();
        const previewRange = this._getRangeFromSchema(settings, previewKey);

        const previewRow = new Adw.SpinRow({
            title: _('Image Preview Size'),
            subtitle: _('Pixel size for clipboard image thumbnails (%d-%d). Default: %d.').format(previewRange.min, previewRange.max, previewDefault),
            adjustment: new Gtk.Adjustment({
                lower: previewRange.min,
                upper: previewRange.max,
                step_increment: 8,
            }),
        });
        group.add(previewRow);
        settings.bind(previewKey, previewRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    }

    /**
     * Add the "Emoji Settings" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addEmojiSettingsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Emoji Settings'),
            description: _('Configure emoji appearance and behavior.'),
        });
        page.add(group);

        const enableCustomTonesRow = new Adw.SwitchRow({
            title: _('Enable Custom Skin Tones'),
            subtitle: _('If off, skinnable emojis are neutral. If on, use the settings below.'),
        });
        group.add(enableCustomTonesRow);
        settings.bind('enable-custom-skin-tones', enableCustomTonesRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Skin tone choices
        const skinTones = [
            { id: 'light', value: '🏻', label: _('Light') },
            { id: 'medium-light', value: '🏼', label: _('Medium-Light') },
            { id: 'medium', value: '🏽', label: _('Medium') },
            { id: 'medium-dark', value: '🏾', label: _('Medium-Dark') },
            { id: 'dark', value: '🏿', label: _('Dark') },
        ];

        const toneLabels = skinTones.map((t) => t.label);

        const primaryRow = new Adw.ComboRow({
            title: _('Primary Tone / Single Emoji'),
            subtitle: _('For single emojis and the first person in pairs.'),
            model: new Gtk.StringList({ strings: toneLabels }),
        });
        group.add(primaryRow);

        const secondaryRow = new Adw.ComboRow({
            title: _('Secondary Tone'),
            subtitle: _('For the second person in pairs.'),
            model: new Gtk.StringList({ strings: toneLabels }),
        });
        group.add(secondaryRow);

        // Bind combo rows
        this._bindSkinToneComboRow(settings, primaryRow, 'custom-skin-tone-primary', skinTones);
        this._bindSkinToneComboRow(settings, secondaryRow, 'custom-skin-tone-secondary', skinTones);

        // Bind sensitivity
        enableCustomTonesRow.bind_property('active', primaryRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
        enableCustomTonesRow.bind_property('active', secondaryRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
    }

    /**
     * Bind a ComboRow to a GSettings key.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {Adw.ComboRow} comboRow - The ComboRow to bind.
     * @param {string} settingKey - The GSettings key to bind.
     * @param {Array} skinTones - An array of skin tone objects.
     */
    _bindSkinToneComboRow(settings, comboRow, settingKey, skinTones) {
        const currentValue = settings.get_string(settingKey);
        const currentIndex = skinTones.findIndex((t) => t.value === currentValue);
        comboRow.set_selected(currentIndex > -1 ? currentIndex : 0);

        comboRow.connect('notify::selected', () => {
            const selectedIndex = comboRow.get_selected();
            if (selectedIndex > -1 && selectedIndex < skinTones.length) {
                settings.set_string(settingKey, skinTones[selectedIndex].value);
            }
        });

        settings.connect(`changed::${settingKey}`, () => {
            const newValue = settings.get_string(settingKey);
            const newIndex = skinTones.findIndex((t) => t.value === newValue);
            if (newIndex > -1 && comboRow.get_selected() !== newIndex) {
                comboRow.set_selected(newIndex);
            }
        });
    }

    /**
     * Add the "GIF Settings" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addGifSettingsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('GIF Settings'),
            description: _('To search for GIFs, you must select a provider and provide your own API key.'),
        });
        page.add(group);

        // Load providers dynamically
        let extPath = this.path;
        if (!extPath && this.dir) {
            extPath = this.dir.get_path();
        }

        const registry = new GifProviderRegistry(extPath, null, settings);
        const providers = registry.getAvailableProviders();

        // Build the list with "Disabled" and dynamic providers
        const providerList = [_('Disabled')];
        const providerIds = ['none'];
        const providerMeta = { none: { hasProxy: false } };

        providers.forEach((p) => {
            providerList.push(p.name);
            providerIds.push(p.id);
            providerMeta[p.id] = { hasProxy: p.hasProxy };
        });

        const providerRow = new Adw.ComboRow({
            title: _('GIF Provider'),
            subtitle: _('Select the service to use for fetching GIFs.'),
            model: new Gtk.StringList({ strings: providerList }),
        });
        group.add(providerRow);

        // Bind selection manually since we map IDs to indices
        const currentProviderId = settings.get_string('gif-provider');
        let initialIndex = providerIds.indexOf(currentProviderId);
        if (initialIndex === -1) initialIndex = 0; // Default to Disabled if not found
        providerRow.set_selected(initialIndex);

        providerRow.connect('notify::selected', () => {
            const index = providerRow.get_selected();
            if (index >= 0 && index < providerIds.length) {
                const newId = providerIds[index];
                if (settings.get_string('gif-provider') !== newId) {
                    settings.set_string('gif-provider', newId);
                }
            }
        });

        // Generic API Key Row
        const apiKeyRow = new Adw.PasswordEntryRow({
            title: _('API Key'),
        });
        group.add(apiKeyRow);

        // Bind to the generic manual key
        settings.bind('gif-custom-api-key', apiKeyRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Update API Key row visibility and text based on provider
        const updateProviderUI = () => {
            const index = providerRow.get_selected();
            const providerId = providerIds[index];
            const isNone = providerId === 'none';
            const hasProxy = providerMeta[providerId]?.hasProxy;

            apiKeyRow.set_visible(!isNone);

            if (hasProxy) {
                apiKeyRow.set_title(_('API Key (Optional)'));
                apiKeyRow.set_tooltip_text(_('Leave blank to use the built-in default key.'));
            } else {
                apiKeyRow.set_title(_('API Key (Required)'));
                apiKeyRow.set_tooltip_text(_('You must provide an API key to use this provider.'));
            }
        };

        providerRow.connect('notify::selected', updateProviderUI);
        updateProviderUI(); // Initial

        // GIF Paste Behavior
        const pasteBehaviorRow = new Adw.ComboRow({
            title: _('Paste Behavior'),
            subtitle: _('Choose how GIFs are pasted.'),
            model: new Gtk.StringList({ strings: [_('Paste Link'), _('Paste Image')] }),
        });
        group.add(pasteBehaviorRow);

        // Bind the setting
        // 0 = Link, 1 = Image
        settings.bind('gif-paste-behavior', pasteBehaviorRow, 'selected', Gio.SettingsBindFlags.DEFAULT);

        // Cache size limit expander
        const cacheLimitExpander = new Adw.ExpanderRow({
            title: _('Limit GIF Preview Cache Size'),
            subtitle: _('Turn off for an unlimited cache size.'),
            // This property adds the switch to the row itself.
            show_enable_switch: true,
        });
        group.add(cacheLimitExpander);

        // Get the default value dynamically from the GSettings schema.
        const cacheKey = 'gif-cache-limit-mb';
        const cacheDefault = settings.get_default_value(cacheKey).get_int32();
        const cacheRange = this._getRangeFromSchema(settings, cacheKey);
        const CACHE_MINIMUM_NUMBER = 25;
        const CACHE_INCREMENT_NUMBER = 25;

        const cacheLimitRow = new Adw.SpinRow({
            title: _('Cache Size Limit (MB)'),
            subtitle: _('Range: %d-%d MB. Default: %d MB.').format(CACHE_MINIMUM_NUMBER, cacheRange.max, cacheDefault),
            adjustment: new Gtk.Adjustment({
                lower: CACHE_MINIMUM_NUMBER,
                upper: cacheRange.max,
                step_increment: CACHE_INCREMENT_NUMBER,
            }),
        });
        // Add the SpinRow inside the expander
        cacheLimitExpander.add_row(cacheLimitRow);

        // Flag to prevent recursive updates
        let isUpdatingFromSettings = false;

        const updateUIFromSettings = () => {
            isUpdatingFromSettings = true;
            const limit = settings.get_int('gif-cache-limit-mb');

            // The 'enable_expansion' property controls the built-in switch.
            cacheLimitExpander.set_enable_expansion(limit > 0);

            // The 'adjustment' property controls the SpinRow.
            if (limit > 0) {
                cacheLimitRow.adjustment.set_value(limit);
            }

            isUpdatingFromSettings = false;
        };

        // When the user toggles the built-in switch on the expander
        cacheLimitExpander.connect('notify::enable-expansion', () => {
            if (isUpdatingFromSettings) return;

            let newLimit;
            if (cacheLimitExpander.enable_expansion) {
                // User toggled it on. Use the spinner's current value.
                newLimit = cacheLimitRow.adjustment.get_value();
            } else {
                // User toggled it off. Use 0 for unlimited.
                newLimit = 0;
            }
            settings.set_int('gif-cache-limit-mb', newLimit);

            // Trigger cleanup immediately.
            const uuid = this.dir.get_parent().get_basename();

            // Initialize the manager if it hasn't been already
            const gifCacheManager = getGifCacheManager(uuid, settings);

            // Trigger the cleanup immediately
            gifCacheManager.runCleanupImmediately();
        });

        // When the user changes the spinner's value.
        cacheLimitRow.adjustment.connect('value-changed', () => {
            if (isUpdatingFromSettings) return;
            // Only update the setting if the main switch is active.
            if (cacheLimitExpander.enable_expansion) {
                const newLimit = cacheLimitRow.adjustment.get_value();
                settings.set_int('gif-cache-limit-mb', newLimit);

                // Use the manager for a consistent, immediate cleanup.
                const uuid = this.dir.get_parent().get_basename();
                getGifCacheManager(uuid, settings).runCleanupImmediately();
            }
        });

        // The handler for the settings signal triggers the cleanup.
        const settingsSignalId = settings.connect('changed::gif-cache-limit-mb', () => {
            // When the setting changes, update the UI.
            updateUIFromSettings();

            // Trigger cleanup immediately.
            const uuid = this.dir.get_parent().get_basename();
            getGifCacheManager(uuid, settings).runCleanupImmediately();
        });

        // Ensure this UI element is destroyed properly
        page.connect('unmap', () => {
            if (settings && settingsSignalId > 0) settings.disconnect(settingsSignalId);
        });

        // Set the initial UI state from settings.
        updateUIFromSettings();
    }

    /**
     * Add the "Excluded Apps" preferences group to the page.
     *
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     */
    _addExclusionsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Excluded Applications'),
            description: _('Manage applications that should be ignored by the clipboard manager.'),
        });
        page.add(group);

        // Enhanced exclusion detection toggle with AT-SPI
        const atspiRow = new Adw.SwitchRow({
            title: _('Enhanced Exclusion Detection'),
            subtitle: _('Detects excluded applications inside browser windows and enables the system accessibility service if needed.'),
        });
        group.add(atspiRow);
        settings.bind('enable-atspi-exclusion', atspiRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Enable or disable the system accessibility service when the toggle changes
        atspiRow.connect('notify::active', () => {
            const a11ySettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            a11ySettings.set_boolean('toolkit-accessibility', atspiRow.active);
        });

        const exclusionExpander = new Adw.ExpanderRow({
            title: _('Ignored Applications'),
            subtitle: _('Prevent specific applications from saving content to the clipboard history.'),
        });
        group.add(exclusionExpander);

        // Function to create a row for an excluded app
        const createExcludedAppRow = (appClassName) => {
            const row = new Adw.ActionRow({
                title: appClassName,
            });

            const removeButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                css_classes: ['destructive-action', 'flat'],
                valign: Gtk.Align.CENTER,
            });

            removeButton.connect('clicked', () => {
                const currentList = settings.get_strv('exclusion-list');
                const newList = currentList.filter((c) => c !== appClassName);
                settings.set_strv('exclusion-list', newList);
            });

            row.add_suffix(removeButton);
            return row;
        };

        // We'll use a helper to manage the rows
        const exclusionRows = [];
        const refreshList = () => {
            exclusionRows.forEach((row) => exclusionExpander.remove(row));
            exclusionRows.length = 0;

            const list = settings.get_strv('exclusion-list');
            list.forEach((appClass) => {
                const row = createExcludedAppRow(appClass);
                exclusionExpander.add_row(row);
                exclusionRows.push(row);
            });
        };

        // Connect to settings change
        settings.connect('changed::exclusion-list', refreshList);

        // Add "Add New" row
        const addRow = new Adw.ActionRow({
            title: _('Add New Exclusion'),
        });

        const entry = new Gtk.Entry({
            placeholder_text: _('Application Name or ID'),
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            css_classes: ['suggested-action', 'flat'],
            valign: Gtk.Align.CENTER,
        });

        const addAction = () => {
            const text = entry.get_text().trim();
            if (text) {
                const currentList = settings.get_strv('exclusion-list');
                if (!currentList.includes(text)) {
                    settings.set_strv('exclusion-list', [...currentList, text]);
                    entry.set_text('');
                }
            }
        };

        addButton.connect('clicked', addAction);
        entry.connect('activate', addAction);

        addRow.add_prefix(entry);
        addRow.add_suffix(addButton);

        // Add the "Add" row to the group, not the expander, so it's always visible
        group.add(addRow);

        // Initial population
        refreshList();
    }

    /**
     * Add the "Data Management" preferences group to the page.
     * @param {Adw.PreferencesPage} page - The preferences page to add the group to.
     * @param {Gio.Settings} settings - The Gio.Settings instance.
     * @param {Adw.PreferencesWindow} window - The preferences window for dialogs.
     */
    _addDataManagementGroup(page, settings, window) {
        const group = new Adw.PreferencesGroup({
            title: _('Data Management'),
            description: _('Manage stored data and configure automatic cleanup. Manual actions cannot be undone.'),
        });
        page.add(group);

        // Clear at login expander
        const clearOnStartupExpander = new Adw.ExpanderRow({
            title: _('Clear Data at Login'),
            subtitle: _('Automatically clear selected data at every login.'),
            show_enable_switch: true,
        });
        group.add(clearOnStartupExpander);

        // Bind the expander's switch to the master GSettings key
        settings.bind(
            'clear-data-at-login',
            clearOnStartupExpander,
            'enable-expansion', // This property controls the built-in switch
            Gio.SettingsBindFlags.DEFAULT,
        );

        // Define the individual toggles that will go inside the expander
        const loginClearToggles = [
            { key: 'clear-clipboard-history-at-login', title: _('Clear Clipboard History') },
            { key: 'clear-recent-emojis-at-login', title: _('Clear Recent Emojis') },
            { key: 'clear-recent-gifs-at-login', title: _('Clear Recent GIFs') },
            { key: 'clear-recent-kaomojis-at-login', title: _('Clear Recent Kaomojis') },
            { key: 'clear-recent-symbols-at-login', title: _('Clear Recent Symbols') },
        ];

        // Create and add each individual SwitchRow to the expander
        loginClearToggles.forEach((toggle) => {
            const row = new Adw.SwitchRow({ title: toggle.title });
            clearOnStartupExpander.add_row(row);
            settings.bind(toggle.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // Helper to create a clear button with confirmation dialog
        const createClearButton = (triggerValue, parentWindow) => {
            // Create the clear button
            const button = new Gtk.Button({
                label: _('Clear'),
                valign: Gtk.Align.CENTER,
            });
            button.add_css_class('destructive-action');
            button.connect('clicked', () => {
                const dialog = new Adw.MessageDialog({
                    heading: _('Are you sure?'),
                    body: _('The selected data will be permanently deleted.'),
                    transient_for: parentWindow,
                    modal: true,
                });
                dialog.add_response('cancel', _('Cancel'));
                dialog.add_response('clear', _('Clear'));
                dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
                dialog.set_default_response('cancel');
                dialog.set_close_response('cancel');
                dialog.connect('response', (self, response) => {
                    if (response === 'clear') {
                        settings.set_string('clear-recents-trigger', triggerValue);
                    }
                });
                dialog.present();
            });
            return button;
        };

        // Recent items expander
        const recentsExpander = new Adw.ExpanderRow({
            title: _('Recent Item History'),
            subtitle: _('Clear lists of recently used items.'),
        });
        group.add(recentsExpander);

        const recentTypes = [
            {
                key: 'emoji',
                title: _('Recent Emojis'),
                subtitle: _('Permanently clears the list of recent emojis.'),
            },
            {
                key: 'gif',
                title: _('Recent GIFs'),
                subtitle: _('Permanently clears the list of recent GIFs.'),
            },
            {
                key: 'kaomoji',
                title: _('Recent Kaomojis'),
                subtitle: _('Permanently clears the list of recent kaomojis.'),
            },
            {
                key: 'symbols',
                title: _('Recent Symbols'),
                subtitle: _('Permanently clears the list of recent symbols.'),
            },
        ];
        recentTypes.forEach((type) => {
            const row = new Adw.ActionRow({ title: type.title, subtitle: type.subtitle });
            row.add_suffix(createClearButton(type.key, window));
            recentsExpander.add_row(row);
        });
        const clearAllRecentsRow = new Adw.ActionRow({
            title: _('All Recent Items'),
            subtitle: _('Permanently clears all of the above lists at once.'),
        });
        clearAllRecentsRow.add_suffix(createClearButton('all', window));
        recentsExpander.add_row(clearAllRecentsRow);

        // Clipboard data expander
        const clipboardExpander = new Adw.ExpanderRow({
            title: _('Clipboard Data'),
            subtitle: _('Permanently delete your saved clipboard history and pinned items.'),
        });
        group.add(clipboardExpander);

        const clearClipboardHistoryRow = new Adw.ActionRow({
            title: _('Clipboard History'),
            subtitle: _('Permanently clears all saved unpinned clipboard items.'),
        });
        clearClipboardHistoryRow.add_suffix(createClearButton('clipboard-history', window));
        clipboardExpander.add_row(clearClipboardHistoryRow);

        const clearPinnedRow = new Adw.ActionRow({
            title: _('Pinned Items'),
            subtitle: _('Permanently clears all saved pinned clipboard items.'),
        });
        clearPinnedRow.add_suffix(createClearButton('clipboard-pinned', window));
        clipboardExpander.add_row(clearPinnedRow);

        // Cache expander
        const cacheExpander = new Adw.ExpanderRow({
            title: _('Performance Caches'),
            subtitle: _('Clear temporary data used to improve loading speed.'),
        });
        group.add(cacheExpander);

        const clearGifCacheRow = new Adw.ActionRow({
            title: _('GIF Preview Cache'),
            subtitle: _('Permanently clears all downloaded GIF preview images.'),
        });
        clearGifCacheRow.add_suffix(createClearButton('gif-cache', window));
        cacheExpander.add_row(clearGifCacheRow);
    }
}
