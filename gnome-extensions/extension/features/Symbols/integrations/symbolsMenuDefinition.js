import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Symbols tab definition
export const MenuDefinitionSymbols = {
    id: 'Symbols',
    name: () => _('Symbols'),
    icon: 'main-symbols-symbolic.svg',
    iconSize: 16,
    isFullView: true,
    settingKey: 'enable-symbols-tab',

    /**
     * Creates the content actor for the symbols tab.
     * @param {Extension} extension Parent extension instance.
     * @param {Gio.Settings} settings Extension settings configuration.
     * @returns {Promise<Clutter.Actor>} The content actor for the symbols tab.
     */
    async createContentActor(extension, settings) {
        const tabModule = await import('../tabSymbols.js');
        return new tabModule.SymbolsTabContent(extension, settings);
    },
};
