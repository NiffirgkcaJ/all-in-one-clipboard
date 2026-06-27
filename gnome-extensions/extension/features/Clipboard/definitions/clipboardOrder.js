/**
 * Defines the order and modules for clipboard definitions.
 *
 * @returns {Array<object>} Ordered clipboard definition entries.
 */
export function getClipboardOrder() {
    return [
        {
            id: 'image',
            modulePath: '../definitions/clipboardDefinitionImage.js',
            exportName: 'ClipboardDefinitionImage',
        },
        {
            id: 'text',
            modulePath: '../definitions/clipboardDefinitionText.js',
            exportName: 'ClipboardDefinitionText',
        },
        {
            id: 'file',
            modulePath: '../definitions/clipboardDefinitionFile.js',
            exportName: 'ClipboardDefinitionFile',
        },
        {
            id: 'url',
            modulePath: '../definitions/clipboardDefinitionLink.js',
            exportName: 'ClipboardDefinitionLink',
        },
        {
            id: 'contact',
            modulePath: '../definitions/clipboardDefinitionContact.js',
            exportName: 'ClipboardDefinitionContact',
        },
        {
            id: 'color',
            modulePath: '../definitions/clipboardDefinitionColor.js',
            exportName: 'ClipboardDefinitionColor',
        },
        {
            id: 'code',
            modulePath: '../definitions/clipboardDefinitionCode.js',
            exportName: 'ClipboardDefinitionCode',
        },
    ];
}
