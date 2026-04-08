import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Defines the order and configuration of sections in the Recently Used tab.
export const RecentlyUsedOrder = [
    {
        id: 'pinned',
        modulePath: '../definitions/recentlyUsedDefinitionPinned.js',
        exportName: 'RecentlyUsedDefinitionPinned',
        titlePolicy: {
            browseTitle: () => _('Pinned Clipboard'),
            searchTitle: () => _('Pinned Matches'),
            searchCountMode: 'inline',
        },
    },
    {
        id: 'emoji',
        modulePath: '../definitions/recentlyUsedDefinitionEmoji.js',
        exportName: 'RecentlyUsedDefinitionEmoji',
        titlePolicy: {
            browseTitle: () => _('Recent Emojis'),
            searchTitle: () => _('Emoji Results'),
            searchCountMode: 'inline',
        },
    },
    {
        id: 'gif',
        modulePath: '../definitions/recentlyUsedDefinitionGif.js',
        exportName: 'RecentlyUsedDefinitionGif',
        titlePolicy: {
            browseTitle: () => _('Recent GIFs'),
            searchTitle: () => _('GIF Results'),
            searchCountMode: 'inline',
        },
    },
    {
        id: 'kaomoji',
        modulePath: '../definitions/recentlyUsedDefinitionKaomoji.js',
        exportName: 'RecentlyUsedDefinitionKaomoji',
        titlePolicy: {
            browseTitle: () => _('Recent Kaomojis'),
            searchTitle: () => _('Kaomoji Results'),
            searchCountMode: 'inline',
        },
    },
    {
        id: 'symbols',
        modulePath: '../definitions/recentlyUsedDefinitionSymbols.js',
        exportName: 'RecentlyUsedDefinitionSymbols',
        titlePolicy: {
            browseTitle: () => _('Recent Symbols'),
            searchTitle: () => _('Symbol Results'),
            searchCountMode: 'inline',
        },
    },
    {
        id: 'clipboard',
        modulePath: '../definitions/recentlyUsedDefinitionClipboard.js',
        exportName: 'RecentlyUsedDefinitionClipboard',
        titlePolicy: {
            browseTitle: () => _('Recent Clipboard History'),
            searchTitle: () => _('Clipboard Matches'),
            searchCountMode: 'inline',
        },
    },
];
