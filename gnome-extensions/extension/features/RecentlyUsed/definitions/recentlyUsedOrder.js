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
        resolveTitle: () => _('Pinned Clipboard'),
    },
    {
        id: 'emoji',
        modulePath: '../definitions/recentlyUsedDefinitionEmoji.js',
        exportName: 'RecentlyUsedDefinitionEmoji',
        resolveTitle: () => _('Recent Emojis'),
    },
    {
        id: 'gif',
        modulePath: '../definitions/recentlyUsedDefinitionGif.js',
        exportName: 'RecentlyUsedDefinitionGif',
        resolveTitle: () => _('Recent GIFs'),
    },
    {
        id: 'kaomoji',
        modulePath: '../definitions/recentlyUsedDefinitionKaomoji.js',
        exportName: 'RecentlyUsedDefinitionKaomoji',
        resolveTitle: () => _('Recent Kaomojis'),
    },
    {
        id: 'symbols',
        modulePath: '../definitions/recentlyUsedDefinitionSymbols.js',
        exportName: 'RecentlyUsedDefinitionSymbols',
        resolveTitle: () => _('Recent Symbols'),
    },
    {
        id: 'clipboard',
        modulePath: '../definitions/recentlyUsedDefinitionClipboard.js',
        exportName: 'RecentlyUsedDefinitionClipboard',
        resolveTitle: () => _('Recent Clipboard History'),
    },
];
