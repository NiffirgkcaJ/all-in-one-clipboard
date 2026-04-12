import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// GIF tab definition
export const MenuDefinitionGif = {
    id: 'GIF',
    name: () => _('GIF'),
    icon: 'main-gif-symbolic.svg',
    iconSize: 16,
    isFullView: true,
    settingKey: 'enable-gif-tab',

    /**
     * Creates the content actor for the GIF tab.
     * @param {Extension} extension Parent extension instance.
     * @param {Gio.Settings} settings Extension settings configuration.
     * @param {object} clipboardManager Global clipboard manager state tracking.
     * @returns {Promise<Clutter.Actor>} The content actor for the GIF tab.
     */
    async createContentActor(extension, settings, clipboardManager) {
        const tabModule = await import('../tabGIF.js');
        return new tabModule.GIFTabContent(extension, settings, clipboardManager);
    },
};
