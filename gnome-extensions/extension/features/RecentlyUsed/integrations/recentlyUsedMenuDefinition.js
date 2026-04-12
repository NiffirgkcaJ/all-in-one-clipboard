import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Recently used tab definition
export const MenuDefinitionRecentlyUsed = {
    id: 'RecentlyUsed',
    name: () => _('Recently Used'),
    icon: 'utility-recents-symbolic.svg',
    iconSize: 16,
    isFullView: false,
    settingKey: 'enable-recents-tab',

    /**
     * Creates the content actor for the recently used tab.
     * @param {Extension} extension Parent extension instance.
     * @param {Gio.Settings} settings Extension settings configuration.
     * @returns {Promise<Clutter.Actor>} The content actor for the recently used tab.
     */
    async createContentActor(extension, settings) {
        const tabModule = await import('../tabRecentlyUsed.js');
        const newContentActor = new tabModule.RecentlyUsedTabContent(extension, settings);

        if (newContentActor.initializationPromise) {
            await newContentActor.initializationPromise;
        }
        return newContentActor;
    },
};
