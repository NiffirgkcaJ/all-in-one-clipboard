// GSettings Keys
export const GifSettings = {
    PROVIDER_KEY: 'gif-provider',
    RECENTS_MAX_ITEMS_KEY: 'gif-recents-max-items',
};

// UI Configuration
export const GifUI = {
    ITEMS_PER_ROW: 4,
    SEARCH_DEBOUNCE_TIME_MS: 300,
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
