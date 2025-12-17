// Internal Data Types
export const ClipboardType = {
    IMAGE: 'image',
    FILE: 'file',
    URL: 'url',
    COLOR: 'color',
    CODE: 'code',
    TEXT: 'text',
    CONTACT: 'contact',
};

// Content Styling
export const ClipboardStyling = {
    [ClipboardType.IMAGE]: {
        icon: 'clipboard-type-image-symbolic.svg',
        iconSize: 16,
        layout: 'image',
    },
    [ClipboardType.FILE]: {
        icon: 'clipboard-type-file-symbolic.svg',
        iconSize: 16,
        layout: 'rich',
    },
    [ClipboardType.URL]: {
        icon: 'clipboard-type-link-symbolic.svg',
        iconSize: 16,
        layout: 'rich',
    },
    [ClipboardType.CONTACT]: {
        layout: 'rich',
        iconSize: 16,
        subtypes: {
            email: {
                icon: 'clipboard-type-contact-email-symbolic.svg',
            },
            phone: {
                icon: 'clipboard-type-contact-phone-symbolic.svg',
            },
        },
    },
    [ClipboardType.COLOR]: {
        icon: 'clipboard-type-color-pipette-symbolic.svg',
        iconSize: 16,
        layout: 'color',
        subtypes: {
            single: {
                icon: 'clipboard-type-color-pipette-symbolic.svg',
            },
            gradient: {
                icon: 'clipboard-type-color-gradient-symbolic.svg',
            },
            palette: {
                icon: 'clipboard-type-color-palette-symbolic.svg',
            },
        },
    },
    [ClipboardType.CODE]: {
        icon: 'clipboard-type-code-symbolic.svg',
        iconSize: 16,
        layout: 'code',
    },
    [ClipboardType.TEXT]: {
        icon: 'clipboard-type-text-symbolic.svg',
        iconSize: 16,
        layout: 'text',
    },
};

// UI Control Icons
export const ClipboardIcons = {
    CHECKBOX_CHECKED: {
        icon: 'clipboard-checkbox-checked-symbolic.svg',
        iconSize: 16,
    },
    CHECKBOX_UNCHECKED: {
        icon: 'clipboard-checkbox-unchecked-symbolic.svg',
        iconSize: 16,
    },
    CHECKBOX_MIXED: {
        icon: 'clipboard-checkbox-mixed-symbolic.svg',
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
    DELETE: {
        icon: 'clipboard-delete-symbolic.svg',
        iconSize: 16,
    },

    ACTION_PIN: {
        icon: 'clipboard-pin-symbolic.svg',
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

    ERROR_WARNING: {
        icon: 'clipboard-warning-symbolic.svg',
        iconSize: 16,
        iconOptions: {
            color: '#f5793e',
        },
    },

    LAYOUT_LIST: {
        icon: 'clipboard-view-list-symbolic.svg',
        iconSize: 16,
    },
    LAYOUT_GRID: {
        icon: 'clipboard-view-grid-symbolic.svg',
        iconSize: 16,
    },
};

// Icon Size Configuration
export const IconSizes = {
    LIST_RICH_ICON: 16,
    GRID_RICH_ICON: 48,
    BADGE_TYPE_ICON: 14,
};
