/**
 * Defines the order and location of all main menu tab definitions.
 *
 * @returns {Array} Array of menu section configurations.
 */
export function getMenuOrder() {
    return [
        {
            id: 'RecentlyUsed',
            modulePath: '../../features/RecentlyUsed/integrations/recentlyUsedMenuDefinition.js',
            exportName: 'MenuDefinitionRecentlyUsed',
        },
        {
            id: 'Emoji',
            modulePath: '../../features/Emoji/integrations/emojiMenuDefinition.js',
            exportName: 'MenuDefinitionEmoji',
        },
        {
            id: 'GIF',
            modulePath: '../../features/GIF/integrations/gifMenuDefinition.js',
            exportName: 'MenuDefinitionGif',
        },
        {
            id: 'Kaomoji',
            modulePath: '../../features/Kaomoji/integrations/kaomojiMenuDefinition.js',
            exportName: 'MenuDefinitionKaomoji',
        },
        {
            id: 'Symbols',
            modulePath: '../../features/Symbols/integrations/symbolsMenuDefinition.js',
            exportName: 'MenuDefinitionSymbols',
        },
        {
            id: 'Clipboard',
            modulePath: '../../features/Clipboard/integrations/clipboardMenuDefinition.js',
            exportName: 'MenuDefinitionClipboard',
        },
    ];
}
