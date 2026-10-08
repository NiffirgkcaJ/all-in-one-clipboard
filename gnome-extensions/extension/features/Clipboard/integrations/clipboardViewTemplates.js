import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';
import { IOImage } from '../../../shared/utilities/utilityIO.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { mapLayout } from '../../../shared/utilities/utilityLayout.js';

import { ClipboardGradientStyles } from '../constants/clipboardStyleConstants.js';
import { IconSizes } from '../constants/clipboardConstants.js';

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Create async preview loading state for an actor.
 *
 * @param {St.Widget} actor Actor that owns the cancellable.
 * @returns {Gio.Cancellable} Cancellable tied to actor destruction.
 */
function createActorCancellable(actor) {
    const cancellable = new Gio.Cancellable();
    actor.connect('destroy', () => {
        cancellable.cancel();
    });
    return cancellable;
}

/**
 * Create a rich content icon.
 *
 * @param {object} params Icon parameters.
 * @param {string} [params.icon] Static icon name.
 * @param {object} [params.iconOptions] Static icon options.
 * @param {Gio.Icon} [params.gicon] GIcon instance.
 * @param {string} [params.flagPath] Flag icon URI.
 * @param {number} params.iconSize Icon size.
 * @param {string} [params.styleClass] Optional icon style class.
 * @returns {St.Widget} Icon widget.
 */
function createRichIcon({ icon, iconOptions, gicon, flagPath, iconSize, styleClass = null }) {
    if (gicon) {
        return new St.Icon({
            icon_size: iconSize,
            style_class: styleClass,
            gicon,
        });
    } else if (flagPath) {
        const file = Gio.File.new_for_uri(flagPath);
        return new St.Icon({
            icon_size: iconSize,
            style_class: styleClass,
            gicon: new Gio.FileIcon({ file: file }),
        });
    }

    return createStaticIcon(
        {
            icon,
            iconOptions,
            iconSize,
        },
        {
            iconSize,
            styleClass,
        },
    );
}

/**
 * Create a text column for list rows.
 *
 * @param {object} params Text parameters.
 * @param {string} params.title Title text.
 * @param {string} params.subtitle Subtitle text.
 * @returns {St.Widget} Text column.
 */
function createListTitleSubtitleColumn({ title, subtitle }) {
    const textCol = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            x_expand: true,
            y_align: 'center',
        }),
    });

    const titleLabel = new St.Label({
        text: title || '',
        style_class: 'clipboard-list-title',
        x_expand: true,
    });
    titleLabel.get_clutter_text().set_line_wrap(false);
    titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    textCol.add_child(titleLabel);

    const subLabel = new St.Label({
        text: subtitle || '',
        style_class: 'clipboard-list-subtitle',
        x_expand: true,
    });
    subLabel.get_clutter_text().set_line_wrap(false);
    subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
    textCol.add_child(subLabel);

    return textCol;
}

/**
 * Create a text column for grid cards.
 *
 * @param {object} params Text parameters.
 * @param {string} params.title Title text.
 * @param {string} params.subtitle Subtitle text.
 * @returns {St.Widget} Text column.
 */
function createGridTitleSubtitleColumn({ title, subtitle }) {
    const labelsContainer = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: 'clipboard-grid-rich-labels',
    });

    const titleLabel = new St.Label({
        text: title || '',
        style_class: 'clipboard-grid-title',
        x_expand: true,
    });
    titleLabel.get_clutter_text().set_line_wrap(false);
    titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    labelsContainer.add_child(titleLabel);

    const subLabel = new St.Label({
        text: subtitle || '',
        style_class: 'clipboard-grid-subtitle',
        x_expand: true,
    });
    subLabel.get_clutter_text().set_line_wrap(false);
    subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
    labelsContainer.add_child(subLabel);

    return labelsContainer;
}

// ============================================================================
// Text Templates
// ============================================================================

/**
 * Create plain text list content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.text Text content.
 * @returns {St.Widget} Text content widget.
 */
export function createTextListContent({ text }) {
    const contentWidget = new St.Label({
        text: text || '',
        style_class: 'clipboard-list-text-label',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    contentWidget.get_clutter_text().set_line_wrap(false);
    contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

    return contentWidget;
}

/**
 * Create plain text grid content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.text Text content.
 * @returns {St.Widget} Text content widget.
 */
export function createTextGridContent({ text }) {
    const contentWidget = new St.Label({
        text: text || '',
        style_class: 'clipboard-grid-text-label',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    contentWidget.get_clutter_text().set_line_wrap(true);
    contentWidget.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

    return contentWidget;
}

// ============================================================================
// Rich Templates
// ============================================================================

/**
 * Create rich list content.
 *
 * @param {object} params Template parameters.
 * @returns {St.Widget} Rich content widget.
 */
export function createRichListContent(params) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: 'clipboard-list-rich-container',
    });

    contentWidget.add_child(
        createRichIcon({
            ...params,
            iconSize: IconSizes.LIST_RICH_ICON,
            styleClass: 'clipboard-list-rich-icon',
        }),
    );
    contentWidget.add_child(createListTitleSubtitleColumn(params));

    return contentWidget;
}

/**
 * Create rich grid content.
 *
 * @param {object} params Template parameters.
 * @returns {St.Widget} Rich content widget.
 */
export function createRichGridContent(params) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: 'clipboard-grid-rich-container',
    });

    const hasIcon = Boolean(params.icon || params.gicon || params.flagPath);

    if (hasIcon) {
        const visualWrapper = new St.Bin({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        visualWrapper.set_child(
            createRichIcon({
                ...params,
                iconSize: IconSizes.GRID_RICH_ICON,
            }),
        );
        contentWidget.add_child(visualWrapper);
    } else {
        const spacer = new St.Widget({
            y_expand: true,
        });
        contentWidget.add_child(spacer);
    }

    contentWidget.add_child(createGridTitleSubtitleColumn(params));

    return contentWidget;
}

// ============================================================================
// Media Templates
// ============================================================================

/**
 * Create media list content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.sourcePath Source file path.
 * @param {string} params.previewPath Preview file path.
 * @param {number} params.imagePreviewSize Preview size.
 * @param {string} params.logLabel Label used in load error messages.
 * @returns {St.Widget} Media content widget.
 */
export function createMediaListContent({ sourcePath, previewPath, imagePreviewSize, logLabel }) {
    const imageWrapper = new St.Bin({
        style_class: 'clipboard-list-image-content',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const imageActor = new St.Bin({
        width: imagePreviewSize,
        height: imagePreviewSize,
        x_expand: false,
        y_expand: false,
    });
    imageWrapper.set_style(`min-height: ${imagePreviewSize}px;`);
    imageWrapper.set_child(imageActor);

    const cancellable = createActorCancellable(imageWrapper);
    IOImage.ensurePreviewAsync(sourcePath, previewPath, imagePreviewSize, cancellable)
        .then((ready) => {
            if (ready && !cancellable.is_cancelled()) {
                imageActor.set_style(`background-image: url('file://${previewPath}'); background-size: ${imagePreviewSize}px ${imagePreviewSize}px;`);
            }
        })
        .catch((e) => {
            Logger.error(`Failed to load list view ${logLabel}: ${e.message || e}`);
        });

    return imageWrapper;
}

/**
 * Create media grid content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.sourcePath Source file path.
 * @param {string} params.previewPath Preview file path.
 * @param {number} params.imagePreviewSize Preview size.
 * @param {string} params.logLabel Label used in load error messages.
 * @returns {St.Widget} Media content widget.
 */
export function createMediaGridContent({ sourcePath, previewPath, imagePreviewSize, logLabel }) {
    const imageWrapper = new St.Bin({
        style_class: 'clipboard-grid-image-content',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });

    const cancellable = createActorCancellable(imageWrapper);
    IOImage.ensurePreviewAsync(sourcePath, previewPath, imagePreviewSize, cancellable)
        .then((ready) => {
            if (ready && !cancellable.is_cancelled()) {
                imageWrapper.set_style(`background-image: url('file://${previewPath}'); background-size: cover;`);
            }
        })
        .catch((e) => {
            Logger.error(`Failed to load grid view ${logLabel}: ${e.message || e}`);
        });

    return imageWrapper;
}

// ============================================================================
// Swatch Templates
// ============================================================================

/**
 * Create swatch list content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.swatchStyle Swatch style.
 * @returns {St.Widget} Swatch content widget.
 */
export function createSwatchListContent(params) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: 'clipboard-list-rich-container',
    });

    contentWidget.add_child(
        createRichIcon({
            ...params,
            iconSize: IconSizes.LIST_RICH_ICON,
            styleClass: 'clipboard-list-rich-icon',
        }),
    );

    const swatchContainer = new St.Bin({
        style_class: 'clipboard-list-color-container',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const swatch = new St.Bin({
        style_class: 'clipboard-list-color-swatch',
        style: params.swatchStyle,
    });

    swatchContainer.set_child(swatch);
    contentWidget.add_child(swatchContainer);
    contentWidget.add_child(createListTitleSubtitleColumn(params));

    return contentWidget;
}

/**
 * Create swatch grid content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.swatchStyle Swatch style.
 * @param {string} params.title Title text.
 * @returns {St.Widget} Swatch content widget.
 */
export function createSwatchGridContent({ swatchStyle, title }) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: 'clipboard-grid-color-container',
    });

    if (swatchStyle) {
        contentWidget.set_style(swatchStyle);
    }

    const spacer = new St.Widget({ y_expand: true });
    contentWidget.add_child(spacer);

    const labelOverlay = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: 'clipboard-grid-color-card',
    });
    labelOverlay.set_style(ClipboardGradientStyles.COLOR_CARD);

    const colorLabel = new St.Label({
        text: title || '',
        style_class: 'clipboard-grid-color-label',
        x_expand: true,
        y_expand: true,
    });
    colorLabel.get_clutter_text().set_line_wrap(false);
    colorLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    labelOverlay.add_child(colorLabel);

    contentWidget.add_child(labelOverlay);

    return contentWidget;
}

// ============================================================================
// Snippet Templates
// ============================================================================

/**
 * Create snippet list content.
 *
 * @param {object} params Template parameters.
 * @returns {St.Widget} Snippet content widget.
 */
export function createSnippetListContent(params) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: 'clipboard-list-code-container',
    });

    const icon = createStaticIcon(params, { styleClass: 'clipboard-list-rich-icon' });
    contentWidget.add_child(icon);

    const codeBox = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
        }),
    });

    const lineCount = params.previewLinesCount !== undefined ? params.previewLinesCount : params.rawLines || 0;
    const lineNumbersString = Array.from({ length: lineCount }, (_unused, i) => (i + 1).toString()).join('\n');

    const numLabel = new St.Label({
        text: lineNumbersString,
        style_class: 'clipboard-list-code-numbers',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    codeBox.add_child(numLabel);

    const codeLabel = new St.Label({
        text: params.text || '',
        style_class: 'clipboard-list-code-content',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    codeLabel.get_clutter_text().set_use_markup(true);
    codeLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

    codeBox.add_child(codeLabel);
    contentWidget.add_child(codeBox);

    return contentWidget;
}

/**
 * Create snippet grid content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.text Code preview text.
 * @returns {St.Widget} Snippet content widget.
 */
export function createSnippetGridContent({ text }) {
    const contentWidget = new St.Label({
        text: text || '',
        style_class: 'clipboard-grid-code-content',
        x_expand: true,
    });
    contentWidget.get_clutter_text().set_use_markup(true);
    contentWidget.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    contentWidget.get_clutter_text().set_line_wrap(true);
    contentWidget.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);

    return contentWidget;
}
