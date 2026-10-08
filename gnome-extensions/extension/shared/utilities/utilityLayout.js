import Clutter from 'gi://Clutter';
import St from 'gi://St';

const SUPPORTS_ORIENTATION = 'orientation' in St.BoxLayout.prototype;

const ALIGN_MAP = Object.freeze({
    fill: Clutter.ActorAlign.FILL,
    start: Clutter.ActorAlign.START,
    center: Clutter.ActorAlign.CENTER,
    end: Clutter.ActorAlign.END,
});

/**
 * Resolve clutter alignment enum from string or enum value.
 *
 * @param {string|number} value Alignment specification.
 * @returns {Clutter.ActorAlign|number|undefined} Resolved Clutter alignment.
 */
function resolveAlign(value) {
    if (typeof value === 'string') {
        return ALIGN_MAP[value];
    }
    return value;
}

/**
 * Transform direction options into version safe orientation properties.
 *
 * @param {object} options Direction parameters.
 * @param {boolean} [options.vertical] Vertical flag.
 * @param {boolean} [options.horizontal] Horizontal flag.
 * @param {string} [options.orientation] Orientation string.
 * @returns {object|null} Version safe orientation properties.
 */
function transformOrientation({ vertical, horizontal, orientation }) {
    const isVertical = vertical === true || horizontal === false || orientation === 'vertical';
    const isHorizontal = horizontal === true || vertical === false || orientation === 'horizontal';

    if (isVertical) {
        return SUPPORTS_ORIENTATION ? { orientation: Clutter.Orientation.VERTICAL } : { vertical: true };
    }
    if (isHorizontal) {
        return SUPPORTS_ORIENTATION ? { orientation: Clutter.Orientation.HORIZONTAL } : { vertical: false };
    }
    return null;
}

/**
 * Transform dimension expansion options into GObject expansion properties.
 *
 * @param {object} options Expansion parameters.
 * @param {boolean} [options.expand] Uniform expansion flag.
 * @param {boolean} [options.x_expand] Horizontal expansion flag.
 * @param {boolean} [options.y_expand] Vertical expansion flag.
 * @returns {object} Dimension expansion properties.
 */
function transformExpansion({ expand, x_expand = expand, y_expand = expand }) {
    return {
        ...(x_expand !== undefined ? { x_expand: Boolean(x_expand) } : null),
        ...(y_expand !== undefined ? { y_expand: Boolean(y_expand) } : null),
    };
}

/**
 * Transform actor alignment options into Clutter alignment properties.
 *
 * @param {object} options Alignment parameters.
 * @param {string|number} [options.align] Uniform alignment specification.
 * @param {string|number} [options.x_align] Horizontal alignment specification.
 * @param {string|number} [options.y_align] Vertical alignment specification.
 * @returns {object} Clutter alignment properties.
 */
function transformAlignment({ align, x_align = align, y_align = align }) {
    const resolvedX = x_align !== undefined ? resolveAlign(x_align) : undefined;
    const resolvedY = y_align !== undefined ? resolveAlign(y_align) : undefined;

    return {
        ...(resolvedX !== undefined ? { x_align: resolvedX } : null),
        ...(resolvedY !== undefined ? { y_align: resolvedY } : null),
    };
}

/**
 * Transposes layout properties into version safe GObject parameters.
 *
 * @param {object} [options] Layout configuration parameters.
 * @param {boolean} [options.vertical] Whether container is vertical.
 * @param {boolean} [options.horizontal] Whether container is horizontal.
 * @param {string} [options.orientation] Orientation string vertical or horizontal.
 * @param {boolean} [options.expand] Whether to expand in both dimensions.
 * @param {boolean} [options.x_expand] Whether to expand horizontally.
 * @param {boolean} [options.y_expand] Whether to expand vertically.
 * @param {string|number} [options.align] Actor alignment for both dimensions.
 * @param {string|number} [options.x_align] Actor alignment horizontally.
 * @param {string|number} [options.y_align] Actor alignment vertically.
 * @returns {object} Transposed configuration parameters.
 */
export function mapLayout(options = {}) {
    const { vertical, horizontal, orientation, expand, x_expand, y_expand, align, x_align, y_align, ...otherParams } = options;

    return Object.assign(
        {},
        otherParams,
        transformOrientation({ vertical, horizontal, orientation }),
        transformExpansion({ expand, x_expand, y_expand }),
        transformAlignment({ align, x_align, y_align }),
    );
}
