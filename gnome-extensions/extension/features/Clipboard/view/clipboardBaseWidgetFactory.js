import { createDynamicIconButton, createStaticIconButton } from '../../../shared/utilities/utilityIcon.js';

import { ClipboardIcons } from '../constants/clipboardConstants.js';

/**
 * Shared factory for creating standard clipboard widgets.
 * Reduces duplication between List and Grid item factories.
 */
export class ClipboardBaseWidgetFactory {
    /**
     * Create a selection checkbox with standard binding logic.
     * @param {Object} itemData The item data
     * @param {Object} options Render options
     * @param {Set} options.selectedIds Set of selected item IDs
     * @param {Map} [options.checkboxIconsMap] Map to register checkbox icons
     * @param {Function} [options.onSelectionChanged] Callback when selection changes
     * @param {Object} [styleOptions] Additional style options for the button
     * @returns {St.Button} The configured checkbox button
     */
    static createCheckbox(itemData, options, styleOptions = {}) {
        const isChecked = options.selectedIds?.has(itemData.id) || false;

        const checkbox = createDynamicIconButton(
            {
                unchecked: ClipboardIcons.CHECKBOX_UNCHECKED,
                checked: ClipboardIcons.CHECKBOX_CHECKED,
            },
            {
                initial: isChecked ? 'checked' : 'unchecked',
                style_class: 'button clipboard-checkbox',
                can_focus: false,
                ...styleOptions,
            },
        );

        const checkboxIcon = checkbox.child;
        if (options.checkboxIconsMap) {
            options.checkboxIconsMap.set(itemData.id, checkboxIcon);
        }

        checkbox.connect('clicked', () => {
            if (options.selectedIds.has(itemData.id)) {
                options.selectedIds.delete(itemData.id);
                checkboxIcon.state = 'unchecked';
            } else {
                options.selectedIds.add(itemData.id);
                checkboxIcon.state = 'checked';
            }
            options.onSelectionChanged?.();
        });

        return checkbox;
    }

    /**
     * Create a Pin/Unpin button.
     * @param {Object} itemData The item data
     * @param {boolean} isPinned Whether the item is currently pinned
     * @param {Object} options Render options
     * @param {Object} options.manager ClipboardManager instance
     * @param {Object} [styleOptions] Additional style options
     * @returns {St.Button} The configured pin button
     */
    static createPinButton(itemData, isPinned, options, styleOptions = {}) {
        const pinButton = createStaticIconButton(isPinned ? ClipboardIcons.STAR_FILLED : ClipboardIcons.STAR_UNFILLED, {
            style_class: 'button clipboard-control-button',
            can_focus: false,
            ...styleOptions,
        });

        pinButton.connect('clicked', () => {
            if (isPinned) {
                options.manager.unpinItem(itemData.id);
            } else {
                options.manager.pinItem(itemData.id);
            }
        });

        return pinButton;
    }

    /**
     * Create a Delete button.
     * @param {Object} itemData The item data
     * @param {Object} options Render options
     * @param {Object} options.manager ClipboardManager instance
     * @param {Object} [styleOptions] Additional style options
     * @returns {St.Button} The configured delete button
     */
    static createDeleteButton(itemData, options, styleOptions = {}) {
        const deleteButton = createStaticIconButton(ClipboardIcons.DELETE, {
            style_class: 'button clipboard-control-button',
            can_focus: false,
            ...styleOptions,
        });

        deleteButton.connect('clicked', () => {
            options.manager.deleteItem(itemData.id);
        });

        return deleteButton;
    }
}
