// Limit Mode
export const RecentlyUsedLimitMode = {
    LIMITED: 'limited',
    UNLIMITED: 'unlimited',
};

// Display Mode
export const RecentlyUsedDisplayMode = {
    FIXED_WINDOW: 'fixed-window',
    SCROLL_WINDOW: 'scroll-window',
};

// Default Policy Values
export const RecentlyUsedDefaultPolicy = {
    GLOBAL_VISIBLE_ITEMS: 5,
    LIST_VISIBLE_ITEMS: 5,
    GRID_VISIBLE_ITEMS: 5,
    GLOBAL_WINDOW_ROWS: 5,
    LIST_WINDOW_ROWS: 5,
    GRID_WINDOW_ROWS: 5,
    GRID_WINDOW_COLUMNS: 5,
    DEFAULT_LIMIT_MODE: RecentlyUsedLimitMode.LIMITED,
    HISTORY_LIMIT_MODE: RecentlyUsedLimitMode.LIMITED,
    SEARCH_LIMIT_MODE: RecentlyUsedLimitMode.UNLIMITED,
    DISPLAY_MODE: RecentlyUsedDisplayMode.SCROLL_WINDOW,
    LIST_DISPLAY_MODE: RecentlyUsedDisplayMode.SCROLL_WINDOW,
    GRID_DISPLAY_MODE: RecentlyUsedDisplayMode.SCROLL_WINDOW,
    CUSTOM_DISPLAY_BY_VIEW: false,
    CUSTOM_LIMIT_BY_CONTEXT: true,
    CUSTOM_VISIBLE_BY_VIEW: false,
    CUSTOM_WINDOW_BY_VIEW: false,
    UNLIMITED_SAFETY_CAP: 1000,
};

// Canonical GSettings keys used by Recently Used policy resolution and change tracking.
export const RecentlyUsedPolicySettings = {
    EXTENSION_WIDTH: 'extension-width',
    DEFAULT_LIMIT_MODE: 'recently-used-default-limit-mode',
    ENABLE_CUSTOM_LIMIT_POLICY: 'recently-used-enable-custom-limit-policy',
    HISTORY_LIMIT_MODE: 'recently-used-history-limit-mode',
    SEARCH_LIMIT_MODE: 'recently-used-search-limit-mode',
    DEFAULT_DISPLAY_MODE: 'recently-used-default-display-mode',
    ENABLE_CUSTOM_DISPLAY_MODE: 'recently-used-enable-custom-display-mode',
    LIST_DISPLAY_MODE: 'recently-used-list-display-mode',
    GRID_DISPLAY_MODE: 'recently-used-grid-display-mode',
    GLOBAL_VISIBLE_ITEMS: 'recently-used-global-visible-items',
    ENABLE_CUSTOM_VISIBLE_ITEMS: 'recently-used-enable-custom-visible-items',
    LIST_VISIBLE_ITEMS: 'recently-used-list-visible-items',
    GRID_VISIBLE_ITEMS: 'recently-used-grid-visible-items',
    GLOBAL_WINDOW_ROWS: 'recently-used-global-window-rows',
    ENABLE_CUSTOM_WINDOW_LIMITS: 'recently-used-enable-custom-window-limits',
    LIST_WINDOW_ROWS: 'recently-used-list-window-rows',
    GRID_WINDOW_ROWS: 'recently-used-grid-window-rows',
    GRID_WINDOW_COLUMNS: 'recently-used-grid-window-columns',
    UNLIMITED_SAFETY_CAP: 'recently-used-unlimited-safety-cap',
};

// GSettings keys monitored for policy changes.
export const RecentlyUsedPolicySettingKeys = Object.values(RecentlyUsedPolicySettings);
