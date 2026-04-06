import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Defines constants related to the Recently Used feature.
export const RecentlyUsedSourceKind = {
    CLIPBOARD_PINNED: 'clipboard-pinned',
    CLIPBOARD_HISTORY: 'clipboard-history',
    RECENT_MANAGER: 'recent-manager',
};

// Defines layout types for sections.
export const RecentlyUsedMappingKind = {
    PREVIEW_FROM_FIELD: 'preview-from-field',
};

// Defines ordering and configuration of sections in the Recently Used tab.
export const RecentlyUsedAsyncActionKind = {
    LOAD_PREVIEW_FROM_URL: 'load-preview-from-url',
};

// Defines payload modes for item click events.
export const RecentlyUsedClickPayloadMode = {
    RAW_ITEM: 'raw-item',
};

// Defines strategies for copying items to the clipboard.
export const RecentlyUsedCopyStrategy = {
    CLIPBOARD_ITEM: 'clipboard-item',
    GIF_SERVICE: 'gif-service',
    PLAIN_TEXT: 'plain-text',
};

// Defines behaviors for promoting items after successful copy actions.
export const RecentlyUsedOnCopySuccess = {
    PROMOTE_CLIPBOARD: 'promote-clipboard',
    PROMOTE_RECENT_MANAGER: 'promote-recent-manager',
};

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
