// Internal Data Types
export const ClipboardType = {
    IMAGE: 'image',
    FILE:  'file',
    URL:   'url',
    COLOR: 'color',
    CODE:  'code',
    TEXT:  'text'
};

// Content Styling
export const ClipboardStyling = {
    [ClipboardType.IMAGE]: {
        icon: 'image-x-generic-symbolic',
        layout: 'image'
    },
    [ClipboardType.FILE]: {
        icon: 'text-x-generic-symbolic',
        layout: 'rich'
    },
    [ClipboardType.URL]: {
        icon: 'web-browser-symbolic',
        layout: 'rich'
    },
    [ClipboardType.COLOR]: {
        icon: 'color-select-symbolic',
        layout: 'rich'
    },
    [ClipboardType.CODE]: {
        icon: 'text-x-generic-symbolic',
        layout: 'code'
    },
    [ClipboardType.TEXT]: {
        icon: 'text-x-generic-symbolic',
        layout: 'text'
    }
};

// UI Control Icons
export const ClipboardIcons = {
    CHECKBOX_CHECKED:   'checkbox-checked-symbolic',
    CHECKBOX_UNCHECKED: 'checkbox-unchecked-symbolic',
    CHECKBOX_MIXED:     'checkbox-mixed-symbolic',

    PIN_FILLED:   'starred-symbolic',
    PIN_OUTLINE:  'non-starred-symbolic',
    DELETE:       'edit-delete-symbolic',

    ACTION_PIN:     'view-pin-symbolic',
    ACTION_PRIVATE: 'view-reveal-symbolic',
    ACTION_PUBLIC:  'view-conceal-symbolic'
};