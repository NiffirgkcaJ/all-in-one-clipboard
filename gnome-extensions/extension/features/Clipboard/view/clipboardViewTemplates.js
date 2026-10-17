import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { createStaticIcon } from '../../../shared/utilities/utilityIcon.js';
import { IOImage } from '../../../shared/utilities/utilityIO.js';
import { Logger } from '../../../shared/utilities/utilityLogger.js';
import { mapLayout } from '../../../shared/utilities/utilityLayout.js';

import { IconSizes } from '../constants/clipboardConstants.js';
import { ClipboardGradientStyles, ClipboardStyles } from '../constants/clipboardStyleConstants.js';

// ============================================================================
// Internal Helpers
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
 * Create a content icon.
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
function createContentIcon({ icon, iconOptions, gicon, flagPath, iconSize, styleClass = null }) {
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
 * Create a title and subtitle text column for list rows.
 *
 * @param {object} params Text parameters.
 * @param {string} params.title Title text.
 * @param {string} params.subtitle Subtitle text.
 * @param {string} [params.styleClass] Optional style class.
 * @returns {St.Widget} Text column.
 */
function createListTitleSubtitleColumn({ title, subtitle, styleClass = null }) {
    const textCol = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: styleClass,
    });

    const titleLabel = new St.Label({
        text: title || '',
        style_class: ClipboardStyles.LIST_TITLE,
        x_expand: true,
    });
    titleLabel.get_clutter_text().set_line_wrap(false);
    titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    textCol.add_child(titleLabel);

    const subLabel = new St.Label({
        text: subtitle || '',
        style_class: ClipboardStyles.LIST_SUBTITLE,
        x_expand: true,
    });
    subLabel.get_clutter_text().set_line_wrap(false);
    subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
    textCol.add_child(subLabel);

    return textCol;
}

/**
 * Create a title and subtitle text column for grid cards.
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
        style_class: ClipboardStyles.GRID_HEADER_CONTENT,
    });

    const titleLabel = new St.Label({
        text: title || '',
        style_class: ClipboardStyles.GRID_TITLE,
        x_expand: true,
    });
    titleLabel.get_clutter_text().set_line_wrap(false);
    titleLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    labelsContainer.add_child(titleLabel);

    const subLabel = new St.Label({
        text: subtitle || '',
        style_class: ClipboardStyles.GRID_SUBTITLE,
        x_expand: true,
    });
    subLabel.get_clutter_text().set_line_wrap(false);
    subLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.MIDDLE);
    labelsContainer.add_child(subLabel);

    return labelsContainer;
}

// ============================================================================
// Label Primitives
// ============================================================================

/**
 * Create list label content.
 *
 * @param {object} params Template parameters.
 * @param {string} [params.text] Text content.
 * @returns {St.Widget} Label container widget.
 */
export function createListLabel({ text }) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: ClipboardStyles.LIST_LABEL_CONTAINER,
    });

    const label = new St.Label({
        text: text || '',
        style_class: ClipboardStyles.LIST_LABEL_CONTENT,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.get_clutter_text().set_line_wrap(false);
    label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    contentWidget.add_child(label);

    return contentWidget;
}

/**
 * Create grid label content.
 *
 * @param {object} params Template parameters.
 * @param {string} [params.text] Text content.
 * @returns {St.Widget} Label container widget.
 */
export function createGridLabel({ text }) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: ClipboardStyles.GRID_LABEL_CONTAINER,
    });

    const label = new St.Label({
        text: text || '',
        style_class: ClipboardStyles.GRID_LABEL_CONTENT,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.get_clutter_text().set_line_wrap(true);
    label.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    contentWidget.add_child(label);

    return contentWidget;
}

// ============================================================================
// Header Primitives
// ============================================================================

/**
 * Create list header content.
 *
 * @param {object} params Template parameters.
 * @returns {St.Widget} Header content widget.
 */
export function createListHeader(params) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: ClipboardStyles.LIST_HEADER_CONTAINER,
    });

    contentWidget.add_child(
        createContentIcon({
            ...params,
            iconSize: IconSizes.LIST_VISUAL,
            styleClass: ClipboardStyles.LIST_HEADER_VISUAL,
        }),
    );
    contentWidget.add_child(
        createListTitleSubtitleColumn({
            ...params,
            styleClass: ClipboardStyles.LIST_HEADER_CONTENT,
        }),
    );

    return contentWidget;
}

/**
 * Create grid header content.
 *
 * @param {object} params Template parameters.
 * @returns {St.Widget} Header content widget.
 */
export function createGridHeader(params) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: ClipboardStyles.GRID_HEADER_CONTAINER,
    });

    const hasIcon = Boolean(params.icon || params.gicon || params.flagPath);

    if (hasIcon) {
        const visualWrapper = new St.Bin({
            style_class: ClipboardStyles.GRID_HEADER_VISUAL,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        visualWrapper.set_child(
            createContentIcon({
                ...params,
                iconSize: IconSizes.GRID_VISUAL,
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
// Media Primitives
// ============================================================================

/**
 * Create media list content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.sourcePath Source file path.
 * @param {string} params.previewPath Preview file path.
 * @param {number} params.previewSize Preview size.
 * @param {string} params.logLabel Label used in load error messages.
 * @returns {St.Widget} Media content widget.
 */
export function createListMedia({ sourcePath, previewPath, previewSize, logLabel }) {
    if (!sourcePath) {
        return null;
    }

    const mediaContainer = new St.Bin({
        style_class: ClipboardStyles.LIST_MEDIA_CONTAINER,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const mediaVisual = new St.Bin({
        style_class: ClipboardStyles.LIST_MEDIA_VISUAL,
        width: previewSize,
        height: previewSize,
        x_expand: false,
        y_expand: false,
    });
    mediaContainer.set_style(`min-height: ${previewSize}px;`);
    mediaContainer.set_child(mediaVisual);

    const cancellable = createActorCancellable(mediaContainer);
    IOImage.ensurePreviewAsync(sourcePath, previewPath, previewSize, cancellable)
        .then((ready) => {
            if (ready && !cancellable.is_cancelled()) {
                mediaVisual.set_style(`background-image: url('file://${previewPath}'); background-size: ${previewSize}px ${previewSize}px;`);
            }
        })
        .catch((e) => {
            Logger.error(`Failed to load list view ${logLabel}: ${e.message || e}`);
        });

    return mediaContainer;
}

/**
 * Create media grid content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.sourcePath Source file path.
 * @param {string} params.previewPath Preview file path.
 * @param {number} params.previewSize Preview size.
 * @param {string} params.logLabel Label used in load error messages.
 * @returns {St.Widget} Media content widget.
 */
export function createGridMedia({ sourcePath, previewPath, previewSize, logLabel }) {
    if (!sourcePath) {
        return null;
    }

    const mediaContainer = new St.Bin({
        style_class: ClipboardStyles.GRID_MEDIA_CONTAINER,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });

    const mediaVisual = new St.Bin({
        style_class: ClipboardStyles.GRID_MEDIA_VISUAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    mediaContainer.set_child(mediaVisual);

    const cancellable = createActorCancellable(mediaContainer);
    IOImage.ensurePreviewAsync(sourcePath, previewPath, previewSize, cancellable)
        .then((ready) => {
            if (ready && !cancellable.is_cancelled()) {
                mediaVisual.set_style(`background-image: url('file://${previewPath}'); background-size: cover;`);
            }
        })
        .catch((e) => {
            Logger.error(`Failed to load grid view ${logLabel}: ${e.message || e}`);
        });

    return mediaContainer;
}

// ============================================================================
// Tile Primitives
// ============================================================================

/**
 * Create list tile content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.tileStyle Tile style.
 * @returns {St.Widget} Tile content widget.
 */
export function createListTile(params) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: ClipboardStyles.LIST_TILE_CONTAINER,
    });

    const tileVisual = new St.Bin({
        style_class: ClipboardStyles.LIST_TILE_VISUAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const tileSurface = new St.Bin({
        style: params.tileStyle,
        x_expand: true,
        y_expand: true,
    });
    tileVisual.set_child(tileSurface);
    contentWidget.add_child(tileVisual);

    contentWidget.add_child(
        createListTitleSubtitleColumn({
            ...params,
            styleClass: ClipboardStyles.LIST_TILE_CONTENT,
        }),
    );

    return contentWidget;
}

/**
 * Create grid tile content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.tileStyle Tile style.
 * @param {string} params.title Title text.
 * @returns {St.Widget} Tile content widget.
 */
export function createGridTile({ tileStyle, title }) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: ClipboardStyles.GRID_TILE_CONTAINER,
    });

    if (tileStyle) {
        contentWidget.set_style(tileStyle);
    }

    const spacer = new St.Widget({ y_expand: true });
    contentWidget.add_child(spacer);

    const labelOverlay = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: ClipboardStyles.GRID_TILE_VISUAL,
    });
    labelOverlay.set_style(ClipboardGradientStyles.TILE_CARD);

    const tileLabel = new St.Label({
        text: title || '',
        style_class: ClipboardStyles.GRID_TILE_CONTENT,
        x_expand: true,
        y_expand: true,
    });
    tileLabel.get_clutter_text().set_line_wrap(false);
    tileLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    labelOverlay.add_child(tileLabel);

    contentWidget.add_child(labelOverlay);

    return contentWidget;
}

// ============================================================================
// Gutter Primitives
// ============================================================================

/**
 * Create list gutter content.
 *
 * @param {object} params Template parameters.
 * @param {string} [params.gutterText] Gutter prefix text.
 * @param {string} [params.text] Gutter content text.
 * @returns {St.Widget} Gutter content widget.
 */
export function createListGutter({ gutterText, text }) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            horizontal: true,
            x_expand: true,
            y_align: 'center',
        }),
        style_class: ClipboardStyles.LIST_GUTTER_CONTAINER,
    });

    const prefixLabel = new St.Label({
        text: gutterText || '',
        style_class: ClipboardStyles.LIST_GUTTER_VISUAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    contentWidget.add_child(prefixLabel);

    const gutterContentLabel = new St.Label({
        text: text || '',
        style_class: ClipboardStyles.LIST_GUTTER_CONTENT,
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    gutterContentLabel.get_clutter_text().set_use_markup(true);
    gutterContentLabel.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);

    contentWidget.add_child(gutterContentLabel);

    return contentWidget;
}

/**
 * Create grid gutter content.
 *
 * @param {object} params Template parameters.
 * @param {string} params.text Gutter content text.
 * @returns {St.Widget} Gutter grid widget.
 */
export function createGridGutter({ text }) {
    const contentWidget = new St.BoxLayout({
        ...mapLayout({
            vertical: true,
            expand: true,
        }),
        style_class: ClipboardStyles.GRID_GUTTER_CONTAINER,
    });

    const gutterContent = new St.Label({
        text: text || '',
        style_class: ClipboardStyles.GRID_GUTTER_CONTENT,
        x_expand: true,
    });
    gutterContent.get_clutter_text().set_use_markup(true);
    gutterContent.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    gutterContent.get_clutter_text().set_line_wrap(true);
    gutterContent.get_clutter_text().set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);

    contentWidget.add_child(gutterContent);

    return contentWidget;
}

// ============================================================================
// Archetype Dispatchers
// ============================================================================

/**
 * Render list content for a visual archetype.
 *
 * @param {string} viewType Archetype view type.
 * @param {object} config View configuration.
 * @param {object} [options] Render options.
 * @param {string} [logLabel] Log label for diagnostics.
 * @returns {St.Widget} Rendered list widget.
 */
export function renderListArchetype(viewType, config, options = {}, logLabel = '') {
    switch (viewType) {
        case 'label':
            return createListLabel(config);
        case 'header':
            return createListHeader(config);
        case 'media':
            return createListMedia({
                sourcePath: config.sourcePath,
                previewPath: config.previewPath,
                previewSize: options.previewSize,
                logLabel,
            });
        case 'tile':
            return createListTile(config);
        case 'gutter':
            return createListGutter(config);
        default:
            if (config.icon) {
                return createListHeader(config);
            }
            return createListLabel(config);
    }
}

/**
 * Render grid content for a visual archetype.
 *
 * @param {string} viewType Archetype view type.
 * @param {object} config View configuration.
 * @param {object} [options] Render options.
 * @param {string} [logLabel] Log label for diagnostics.
 * @returns {St.Widget} Rendered grid widget.
 */
export function renderGridArchetype(viewType, config, options = {}, logLabel = '') {
    switch (viewType) {
        case 'label':
            return createGridLabel(config);
        case 'header':
            return createGridHeader(config);
        case 'media':
            return createGridMedia({
                sourcePath: config.sourcePath,
                previewPath: config.previewPath,
                previewSize: options.previewSize,
                logLabel,
            });
        case 'tile':
            return createGridTile({
                tileStyle: config.gridTileStyle || config.tileStyle,
                title: config.title,
            });
        case 'gutter':
            return createGridGutter(config);
        default:
            if (config.icon) {
                return createGridHeader(config);
            }
            return createGridLabel(config);
    }
}
