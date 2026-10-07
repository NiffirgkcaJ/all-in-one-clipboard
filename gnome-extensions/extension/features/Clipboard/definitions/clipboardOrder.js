import { ClipboardType } from '../constants/clipboardPluginConstants.js';

/**
 * Defines the order and modules for clipboard definitions.
 *
 * @returns {Array<object>} Ordered clipboard definition entries.
 */
export function getClipboardOrder() {
    return [
        {
            id: ClipboardType.IMAGE,
            modulePath: '../definitions/clipboardDefinitionImage.js',
            exportName: 'ClipboardDefinitionImage',
        },
        {
            id: ClipboardType.RESOURCE,
            modulePath: '../definitions/clipboardDefinitionResource.js',
            exportName: 'ClipboardDefinitionResource',
        },
        {
            id: ClipboardType.URL,
            modulePath: '../definitions/clipboardDefinitionLink.js',
            exportName: 'ClipboardDefinitionLink',
        },
        {
            id: ClipboardType.CONTACT,
            modulePath: '../definitions/clipboardDefinitionContact.js',
            exportName: 'ClipboardDefinitionContact',
        },
        {
            id: ClipboardType.COLOR,
            modulePath: '../definitions/clipboardDefinitionColor.js',
            exportName: 'ClipboardDefinitionColor',
        },
        {
            id: ClipboardType.CODE,
            modulePath: '../definitions/clipboardDefinitionCode.js',
            exportName: 'ClipboardDefinitionCode',
        },
        {
            id: ClipboardType.HTML,
            modulePath: '../definitions/clipboardDefinitionHtml.js',
            exportName: 'ClipboardDefinitionHtml',
        },
        {
            id: ClipboardType.TEXT,
            modulePath: '../definitions/clipboardDefinitionText.js',
            exportName: 'ClipboardDefinitionText',
        },
    ];
}
