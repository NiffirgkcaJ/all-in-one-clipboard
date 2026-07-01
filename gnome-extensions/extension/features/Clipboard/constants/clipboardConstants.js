// Provider Configuration
export const ClipboardProvider = {
    SEARCH_PROVIDER_ID: 'clipboard',
};

// UI Control Icons
export const ClipboardIcons = {
    CHECKBOX_UNCHECKED: {
        icon: 'clipboard-checkbox-unchecked-symbolic.svg',
        iconSize: 16,
    },
    CHECKBOX_CHECKED: {
        icon: 'clipboard-checkbox-checked-symbolic.svg',
        iconSize: 16,
    },
    CHECKBOX_MIXED: {
        icon: 'clipboard-checkbox-mixed-symbolic.svg',
        iconSize: 16,
    },

    LAYOUT_LIST: {
        icon: 'clipboard-view-list-symbolic.svg',
        iconSize: 16,
    },
    LAYOUT_GRID: {
        icon: 'clipboard-view-grid-symbolic.svg',
        iconSize: 16,
    },

    ACTION_PRIVATE: {
        icon: 'clipboard-eye-reveal-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PUBLIC: {
        icon: 'clipboard-eye-conceal-symbolic.svg',
        iconSize: 16,
    },

    ACTION_MERGE: {
        icon: 'clipboard-merge-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PIN: {
        icon: 'clipboard-pin-symbolic.svg',
        iconSize: 16,
    },
    ACTION_DELETE: {
        icon: 'clipboard-delete-symbolic.svg',
        iconSize: 16,
    },

    STAR_FILLED: {
        icon: 'clipboard-star-symbolic.svg',
        iconSize: 16,
    },
    STAR_UNFILLED: {
        icon: 'clipboard-star-symbolic.svg',
        iconSize: 16,
        iconOptions: {
            opacity: 0.5,
        },
    },

    ERROR_WARNING: {
        icon: 'clipboard-warning-symbolic.svg',
        iconSize: 16,
        iconOptions: {
            color: '#f5793e',
        },
    },
};

// Icon Size Configuration
export const IconSizes = {
    LIST_RICH_ICON: 16,
    GRID_RICH_ICON: 48,
    BADGE_TYPE_ICON: 14,
};

// Interaction & System Configuration
export const ClipboardConfig = {
    DIMENSION_DEBOUNCE_MS: 200,
    SEARCH_DEBOUNCE_MS: 250,
    TARGET_ITEM_WIDTH: 100,
    HISTORY_BATCH_SIZE: 15,
    FOCUS_RESTORE_INTERVAL_MS: 50,
    FOCUS_RESTORE_MAX_ATTEMPTS: 10,
};

// GSettings Keys
export const ClipboardSettings = {
    GRID_LIMIT_COLUMNS_KEY: 'clipboard-grid-limit-columns',
    GRID_MAX_COLUMNS_KEY: 'clipboard-grid-max-columns',
};
