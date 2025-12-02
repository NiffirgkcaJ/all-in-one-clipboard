// Internal Data Types
export const ClipboardType = {
    IMAGE: 'image',
    FILE: 'file',
    URL: 'url',
    COLOR: 'color',
    CODE: 'code',
    TEXT: 'text',
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
    [ClipboardType.COLOR]: {
        icon: 'clipboard-type-color-symbolic.svg',
        iconSize: 16,
        layout: 'rich',
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
        icon: 'clipboard-star-filled-symbolic.svg',
        iconSize: 16,
    },
    STAR_UNFILLED: {
        icon: 'clipboard-star-unfilled-symbolic.svg',
        iconSize: 16,
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
};
