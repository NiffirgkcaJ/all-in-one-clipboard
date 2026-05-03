import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * MenuDefinitionEmoji
 *
 * Definition for the emoji tab in the main menu.
 */
export const MenuDefinitionEmoji = {
    id: 'Emoji',
    name: () => _('Emoji'),
    icon: 'main-emoji-symbolic.svg',
    iconSize: 16,
    isFullView: true,
    settingKey: 'enable-emoji-tab',

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Creates the content actor for the emoji tab.
     *
     * @param {Extension} extension Parent extension instance.
     * @param {Gio.Settings} settings Extension settings configuration.
     * @returns {Promise<Clutter.Actor>} The content actor for the emoji tab.
     */
    async createContentActor(extension, settings) {
        const tabModule = await import('../tabEmoji.js');
        return new tabModule.EmojiTabContent(extension, settings);
    },
};
