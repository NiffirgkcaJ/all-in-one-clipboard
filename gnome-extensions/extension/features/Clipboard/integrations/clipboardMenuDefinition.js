import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Clipboard tab definition
export const MenuDefinitionClipboard = {
    id: 'Clipboard',
    name: () => _('Clipboard'),
    icon: 'main-clipboard-symbolic.svg',
    iconSize: 16,
    isFullView: false,
    settingKey: 'enable-clipboard-tab',

    /**
     * Creates the content actor for the clipboard tab.
     * @param {Extension} extension Parent extension instance.
     * @param {Gio.Settings} settings Extension settings configuration.
     * @param {object} clipboardManager Global clipboard manager state tracking.
     * @returns {Promise<Clutter.Actor>} The content actor for the clipboard tab.
     */
    async createContentActor(extension, settings, clipboardManager) {
        const tabModule = await import('../tabClipboard.js');
        return new tabModule.ClipboardTabContent(extension, settings, clipboardManager);
    },
};
