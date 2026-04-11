import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { getRangeFromSchema } from '../../../shared/preferences/preferenceUtilities.js';

import { getGifCacheManager } from '../logic/gifCacheManager.js';
import { GifProviderRegistry } from '../logic/gifProviderRegistry.js';

/**
 * Adds the "GIF Settings" preferences group to the page.
 *
 * @param {Object} params
 * @param {Adw.PreferencesPage} params.page The preferences page to add the group to.
 * @param {Gio.Settings} params.settings The Gio.Settings instance.
 * @param {string} params.path The extension path.
 * @param {Gio.File} params.dir The extension directory file object.
 */
export function addPreferenceGifSettings({ page, settings, path, dir }) {
    const group = new Adw.PreferencesGroup({
        title: _('GIF Settings'),
        description: _('To search for GIFs, you must select a provider and provide your own API key.'),
    });
    page.add(group);

    // GIF Provider
    let extPath = path;
    if (!extPath && dir) {
        extPath = dir.get_path();
    }

    const registry = new GifProviderRegistry(extPath, null, settings);
    const providers = registry.getAvailableProviders();

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

    // API Key
    const apiKeyRow = new Adw.PasswordEntryRow({
        title: _('API Key'),
    });
    group.add(apiKeyRow);

    settings.bind('gif-custom-api-key', apiKeyRow, 'text', Gio.SettingsBindFlags.DEFAULT);

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

    // Paste Behavior
    const pasteBehaviorRow = new Adw.ComboRow({
        title: _('Paste Behavior'),
        subtitle: _('Choose how GIFs are pasted.'),
        model: new Gtk.StringList({ strings: [_('Paste Link'), _('Paste Image')] }),
    });
    group.add(pasteBehaviorRow);

    settings.bind('gif-paste-behavior', pasteBehaviorRow, 'selected', Gio.SettingsBindFlags.DEFAULT);

    // GIF Preview Cache Limit
    const cacheLimitExpander = new Adw.ExpanderRow({
        title: _('Limit GIF Preview Cache Size'),
        subtitle: _('Turn off for an unlimited cache size.'),
        show_enable_switch: true,
    });
    group.add(cacheLimitExpander);

    const cacheKey = 'gif-cache-limit-mb';
    const cacheDefault = settings.get_default_value(cacheKey).get_int32();
    const cacheRange = getRangeFromSchema(settings, cacheKey);
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

    cacheLimitExpander.add_row(cacheLimitRow);

    let isUpdatingFromSettings = false;

    const updateUIFromSettings = () => {
        isUpdatingFromSettings = true;
        const limit = settings.get_int('gif-cache-limit-mb');

        cacheLimitExpander.set_enable_expansion(limit > 0);

        if (limit > 0) {
            cacheLimitRow.adjustment.set_value(limit);
        }

        isUpdatingFromSettings = false;
    };

    cacheLimitExpander.connect('notify::enable-expansion', () => {
        if (isUpdatingFromSettings) return;

        let newLimit;
        if (cacheLimitExpander.enable_expansion) {
            newLimit = cacheLimitRow.adjustment.get_value();
        } else {
            newLimit = 0;
        }
        settings.set_int('gif-cache-limit-mb', newLimit);

        const uuid = dir.get_parent().get_basename();
        const gifCacheManager = getGifCacheManager(uuid, settings);
        gifCacheManager.runCleanupImmediately();
    });

    cacheLimitRow.adjustment.connect('value-changed', () => {
        if (isUpdatingFromSettings) return;
        if (cacheLimitExpander.enable_expansion) {
            const newLimit = cacheLimitRow.adjustment.get_value();
            settings.set_int('gif-cache-limit-mb', newLimit);

            const uuid = dir.get_parent().get_basename();
            getGifCacheManager(uuid, settings).runCleanupImmediately();
        }
    });

    const settingsSignalId = settings.connect('changed::gif-cache-limit-mb', () => {
        updateUIFromSettings();

        const uuid = dir.get_parent().get_basename();
        getGifCacheManager(uuid, settings).runCleanupImmediately();
    });

    page.connect('unmap', () => {
        if (settings && settingsSignalId > 0) settings.disconnect(settingsSignalId);
    });

    updateUIFromSettings();
}
