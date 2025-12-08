import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Storage } from '../../../shared/constants/storagePaths.js';

// UI Layout Configuration
export const RecentlyUsedUI = {
    PINNED_ITEM_HEIGHT: 48,
    MAX_PINNED_DISPLAY_COUNT: 5,
    GRID_COLUMN_SPACING: 4,
    SECTION_SPACING: 8,
    // Section display order
    SECTION_ORDER: ['pinned', 'emoji', 'gif', 'kaomoji', 'symbols', 'clipboard'],
};

// Section Metadata Configuration
export const RecentlyUsedSections = {
    PINNED: {
        id: 'pinned',
        getTitle: () => _('Pinned Clipboard'),
        targetTab: 'Clipboard',
        layoutType: 'list',
        maxDisplay: RecentlyUsedUI.MAX_PINNED_DISPLAY_COUNT,
        hasNestedScroll: true,
    },
    EMOJI: {
        id: 'emoji',
        getTitle: () => _('Recent Emojis'),
        targetTab: 'Emoji',
        layoutType: 'grid',
        maxDisplay: 5,
    },
    GIF: {
        id: 'gif',
        getTitle: () => _('Recent GIFs'),
        targetTab: 'GIF',
        layoutType: 'grid',
        maxDisplay: 5,
    },
    KAOMOJI: {
        id: 'kaomoji',
        getTitle: () => _('Recent Kaomojis'),
        targetTab: 'Kaomoji',
        layoutType: 'list',
        maxDisplay: 5,
    },
    SYMBOLS: {
        id: 'symbols',
        getTitle: () => _('Recent Symbols'),
        targetTab: 'Symbols',
        layoutType: 'grid',
        maxDisplay: 5,
    },
    CLIPBOARD: {
        id: 'clipboard',
        getTitle: () => _('Recent Clipboard History'),
        targetTab: 'Clipboard',
        layoutType: 'list',
        maxDisplay: 5,
    },
};
// GSettings Keys for Feature Toggles
export const RecentlyUsedSettings = {
    ENABLE_EMOJI_TAB: 'enable-emoji-tab',
    ENABLE_GIF_TAB: 'enable-gif-tab',
    ENABLE_KAOMOJI_TAB: 'enable-kaomoji-tab',
    ENABLE_SYMBOLS_TAB: 'enable-symbols-tab',
    ENABLE_CLIPBOARD_TAB: 'enable-clipboard-tab',
    AUTO_PASTE_EMOJI: 'auto-paste-emoji',
    AUTO_PASTE_GIF: 'auto-paste-gif',
    AUTO_PASTE_KAOMOJI: 'auto-paste-kaomoji',
    AUTO_PASTE_SYMBOLS: 'auto-paste-symbols',
    AUTO_PASTE_CLIPBOARD: 'auto-paste-clipboard',
    CLIPBOARD_IMAGE_PREVIEW_SIZE: 'clipboard-image-preview-size',
};

// Feature Configuration for Recent Managers
export const RecentlyUsedFeatures = {
    EMOJI: {
        id: 'emoji',
        getPath: (uuid) => Storage.getRecentEmojiPath(uuid),
        maxItemsKey: 'emoji-recents-max-items',
        autoPasteKey: RecentlyUsedSettings.AUTO_PASTE_EMOJI,
    },
    KAOMOJI: {
        id: 'kaomoji',
        getPath: (uuid) => Storage.getRecentKaomojiPath(uuid),
        maxItemsKey: 'kaomoji-recents-max-items',
        autoPasteKey: RecentlyUsedSettings.AUTO_PASTE_KAOMOJI,
    },
    SYMBOLS: {
        id: 'symbols',
        getPath: (uuid) => Storage.getRecentSymbolsPath(uuid),
        maxItemsKey: 'symbols-recents-max-items',
        autoPasteKey: RecentlyUsedSettings.AUTO_PASTE_SYMBOLS,
    },
    GIF: {
        id: 'gif',
        getPath: (uuid) => Storage.getRecentGifsPath(uuid),
        maxItemsKey: 'gif-recents-max-items',
        autoPasteKey: RecentlyUsedSettings.AUTO_PASTE_GIF,
    },
};

// UI Style Classes
export const RecentlyUsedStyles = {
    CONTAINER: 'recently-used-container',
    TAB_CONTENT: 'recently-used-tab-content',
    SECTION: 'recently-used-section',
    HEADER: 'recently-used-header',
    TITLE: 'recently-used-title',
    SEPARATOR: 'recently-used-separator',
    SHOW_ALL_BUTTON: 'recently-used-show-all-button button',
    SETTINGS_BUTTON: 'recently-used-settings-button button',
    LIST_ITEM: 'button recently-used-list-item',
    BOLD_ITEM: 'recently-used-bold-item',
    NORMAL_ITEM: 'recently-used-normal-item',
    GRID_ITEM: 'button recently-used-grid-item',
    GIF_ICON: 'recently-used-gif-icon',
};

// Icon Names
export const RecentlyUsedIcons = {
    SETTINGS: {
        icon: 'recently-used-settings-symbolic.svg',
        iconSize: 16,
    },
    GIF_PLACEHOLDER: {
        icon: 'clipboard-type-image-symbolic.svg',
        iconSize: 64,
    },
};

// Messages
export const RecentlyUsedMessages = {
    EMPTY_STATE: () => _('No recent items yet.'),
    SHOW_ALL: () => _('Show All'),
    GIF_TOOLTIP_FALLBACK: () => _('GIF'),
};
