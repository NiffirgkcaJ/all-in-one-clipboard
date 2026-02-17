// GSettings Keys
export const GifSettings = {
    PROVIDER_KEY: 'gif-provider',
    RECENTS_MAX_ITEMS_KEY: 'gif-recents-max-items',
};

// Provider Configuration
export const GifProvider = {
    DEFAULT_RESULT_LIMIT: 20,
    MAX_RETRIES: 2,
    RETRY_BASE_DELAY_MS: 500,
    HTTP_ERROR_THRESHOLD: 300,
    SERVER_ERROR_THRESHOLD: 500,
};

// UI Configuration
export const GifUI = {
    ITEMS_PER_ROW: 4,
    SEARCH_DEBOUNCE_TIME_MS: 300,
    SCROLL_THRESHOLD_PX: 100,
    DEFAULT_LOGO_HEIGHT: 16,
    MASONRY_SPACING: 2,
    SEARCH_HINT_SPACING: 3,
    INFO_BAR_SPACER_WIDTH: 8,
};

// Icon Definitions
export const GifIcons = {
    RECENTS: {
        icon: 'utility-recents-symbolic.svg',
        iconSize: 16,
    },
    BACK_BUTTON: {
        icon: 'utility-backwards-symbolic.svg',
        iconSize: 16,
    },
    INFO: {
        icon: 'gif-information-symbolic.svg',
        iconSize: 16,
    },
    ERROR_PLACEHOLDER: {
        icon: 'gif-missing-symbolic.svg',
        iconSize: 64,
        iconOptions: {
            opacity: 0.5,
        },
    },
};
