import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Kaomoji tab definition
export const MenuDefinitionKaomoji = {
    id: 'Kaomoji',
    name: () => _('Kaomoji'),
    icon: 'main-kaomoji-symbolic.svg',
    iconSize: 16,
    isFullView: true,
    settingKey: 'enable-kaomoji-tab',

    /**
     * Creates the content actor for the kaomoji tab.
     * @param {Extension} extension Parent extension instance.
     * @param {Gio.Settings} settings Extension settings configuration.
     * @returns {Promise<Clutter.Actor>} The content actor for the kaomoji tab.
     */
    async createContentActor(extension, settings) {
        const tabModule = await import('../tabKaomoji.js');
        return new tabModule.KaomojiTabContent(extension, settings);
    },
};
