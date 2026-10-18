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
    ACTION_PASTE_HTML_IMAGE: {
        icon: 'clipboard-paste-html-image-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_HTML_PLAIN: {
        icon: 'clipboard-paste-html-plain-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_HTML_RICH: {
        icon: 'clipboard-paste-html-rich-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_FILE: {
        icon: 'clipboard-paste-resource-file-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_FILES: {
        icon: 'clipboard-paste-resource-files-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_FOLDER: {
        icon: 'clipboard-paste-resource-folder-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_FOLDERS: {
        icon: 'clipboard-paste-resource-folders-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_ITEM: {
        icon: 'clipboard-paste-resource-item-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_ITEMS: {
        icon: 'clipboard-paste-resource-items-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_URI: {
        icon: 'clipboard-paste-resource-uri-symbolic.svg',
        iconSize: 16,
    },
    ACTION_PASTE_RESOURCE_URIS: {
        icon: 'clipboard-paste-resource-uris-symbolic.svg',
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
    LIST_VISUAL: 16,
    GRID_VISUAL: 48,
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
