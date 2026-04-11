import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { addPreferenceAutoPaste } from './shared/preferences/preferenceGroupAutoPaste.js';
import { addPreferenceDataManagement } from './shared/preferences/preferenceGroupDataManagement.js';
import { addPreferenceExclusions } from './shared/preferences/preferenceGroupExclusions.js';
import { addPreferenceGeneral } from './shared/preferences/preferenceGroupGeneral.js';
import { addPreferenceGridLayout } from './shared/preferences/preferenceGroupGridLayout.js';
import { addPreferenceKeyboardShortcuts } from './shared/preferences/preferenceGroupKeyboardShortcuts.js';
import { addPreferenceRecentItems } from './shared/preferences/preferenceGroupRecentItems.js';
import { addPreferenceTabManagement } from './shared/preferences/preferenceGroupTabManagement.js';
import { getIconName } from './shared/preferences/preferenceUtilities.js';
import { initStorage, ExtensionPath } from './shared/constants/storagePaths.js';

import { addPreferenceClipboardSettings } from './features/Clipboard/preferences/clipboardPreferenceGroup.js';
import { addPreferenceEmojiSettings } from './features/Emoji/preferences/emojiPreferenceGroup.js';
import { addPreferenceGifSettings } from './features/GIF/preferences/gifPreferenceGroup.js';
import { addPreferenceRecentlyUsedSettings } from './features/RecentlyUsed/preferences/recentlyUsedPreferenceGroup.js';

export const TabIcons = {
    GENERAL: { icon: 'preferences-general-symbolic.svg' },
    FEATURES: { icon: 'preferences-features-symbolic.svg' },
    ADVANCED: { icon: 'preferences-advanced-symbolic.svg' },
};

/**
 * The preferences window for the extension.
 */
export default class AllInOneClipboardPreferences extends ExtensionPreferences {
    /**
     * Populate the preferences window with the settings UI.
     *
     * @param {Adw.PreferencesWindow} window The preferences window to populate.
     */
    fillPreferencesWindow(window) {
        this.initTranslations('all-in-one-clipboard');

        initStorage(this.uuid);

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

        const display = Gdk.Display.get_default();
        const iconTheme = Gtk.IconTheme.get_for_display(display);
        iconTheme.add_resource_path(ExtensionPath.ICONS);

        const settings = this.getSettings();

        // General Page
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: getIconName(TabIcons.GENERAL),
        });
        window.add(generalPage);

        addPreferenceGeneral({ page: generalPage, settings });
        addPreferenceTabManagement({ page: generalPage, settings });
        addPreferenceKeyboardShortcuts({ page: generalPage, settings });
        addPreferenceGridLayout({ page: generalPage, settings });

        // Features Page
        const featuresPage = new Adw.PreferencesPage({
            title: _('Features'),
            icon_name: getIconName(TabIcons.FEATURES),
        });
        window.add(featuresPage);

        addPreferenceAutoPaste({ page: featuresPage, settings });
        addPreferenceRecentItems({ page: featuresPage, settings });
        addPreferenceRecentlyUsedSettings({ page: featuresPage, settings, window });
        addPreferenceEmojiSettings({ page: featuresPage, settings });
        addPreferenceGifSettings({ page: featuresPage, settings, path: this.path, dir: this.dir });
        addPreferenceClipboardSettings({ page: featuresPage, settings });

        // Advanced Page
        const advancedPage = new Adw.PreferencesPage({
            title: _('Advanced'),
            icon_name: getIconName(TabIcons.ADVANCED),
        });
        window.add(advancedPage);

        addPreferenceExclusions({ page: advancedPage, settings });
        addPreferenceDataManagement({ page: advancedPage, settings, window });
    }
}
