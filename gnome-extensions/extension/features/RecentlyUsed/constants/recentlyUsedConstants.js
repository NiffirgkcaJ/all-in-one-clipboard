import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// UI Layout Configuration
export const RecentlyUsedUI = {
    NESTED_ITEM_HEIGHT: 48,
    MAX_NESTED_DISPLAY_COUNT: 5,
    MAX_SECTION_DISPLAY_COUNT: 5,
    SEARCH_DEBOUNCE_MS: 250,
    OUTER_SCROLL_LOCK_DELAY_MS: 150,
    GRID_COLUMN_SPACING: 4,
    SECTION_SPACING: 8,
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
    GRID_ICON: 'recently-used-grid-icon',
};

// Icon Definitions
export const RecentlyUsedIcons = {
    SETTINGS: {
        icon: 'recently-used-settings-symbolic.svg',
        iconSize: 16,
    },
};

// Messages
export const RecentlyUsedMessages = {
    EMPTY_STATE: () => _('No recent items yet.'),
    SHOW_ALL: () => _('Show All'),
};
