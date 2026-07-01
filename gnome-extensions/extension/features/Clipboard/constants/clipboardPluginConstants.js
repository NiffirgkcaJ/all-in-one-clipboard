// Internal Data Types
export const ClipboardType = {
    IMAGE: 'image',
    FILE: 'file',
    URL: 'url',
    CONTACT: 'contact',
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

// Execution Priority
export const ClipboardPriority = {
    [ClipboardType.IMAGE]: 10,
    [ClipboardType.FILE]: 20,
    [ClipboardType.URL]: 30,
    [ClipboardType.CONTACT]: 40,
    [ClipboardType.COLOR]: 50,
    [ClipboardType.CODE]: 60,
    [ClipboardType.TEXT]: 70,
};
