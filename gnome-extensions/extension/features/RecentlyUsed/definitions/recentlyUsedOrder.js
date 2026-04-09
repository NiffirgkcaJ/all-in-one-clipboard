/**
 * Defines the order and configuration of sections using dependency injection for translations.
 *
 * @param {*} _ Translation function.
 * @returns {Array} Array of section definitions.
 */
export function getRecentlyUsedOrder(_) {
    return [
        {
            id: 'pinned',
            modulePath: '../definitions/recentlyUsedDefinitionPinned.js',
            exportName: 'RecentlyUsedDefinitionPinned',
            layoutFamily: 'list',
            title: _('Pinned Clipboard'),
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
            layoutFamily: 'grid',
            title: _('Recent Emojis'),
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
            layoutFamily: 'grid',
            title: _('Recent GIFs'),
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
            layoutFamily: 'list',
            title: _('Recent Kaomojis'),
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
            layoutFamily: 'grid',
            title: _('Recent Symbols'),
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
            layoutFamily: 'list',
            title: _('Recent Clipboard History'),
            titlePolicy: {
                browseTitle: () => _('Recent Clipboard History'),
                searchTitle: () => _('Clipboard Matches'),
                searchCountMode: 'inline',
            },
        },
    ];
}
