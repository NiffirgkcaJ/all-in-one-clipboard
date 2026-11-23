import { adjustAnimationTime } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// ========================================================================
// Constants
// ========================================================================

const SCROLL_TIME = 100;
const SUPPORTS_ORIENTATION = 'orientation' in St.BoxLayout.prototype;

const ALIGN_MAP = Object.freeze({
    fill: Clutter.ActorAlign.FILL,
    start: Clutter.ActorAlign.START,
    center: Clutter.ActorAlign.CENTER,
    end: Clutter.ActorAlign.END,
});

// ========================================================================
// Layout Mapping
// ========================================================================

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

/**
 * Calculate vertical offset of an actor relative to an ancestor scroll view.
 *
 * @param {St.ScrollView} scrollView Scroll view ancestor.
 * @param {Clutter.Actor} actor Descendant actor.
 * @returns {number} Vertical offset in pixels.
 */
export function getActorScrollOffset(scrollView, actor) {
    if (!scrollView || !actor) return 0;

    const scrollChild = scrollView.get_child ? scrollView.get_child() : null;
    let offset = 0;
    let current = actor;
    let hasUnallocated = false;

    while (current && current !== scrollView && current !== scrollChild) {
        if (current.has_allocation()) {
            const y1 = current.get_allocation_box().y1;
            current._lastKnownAllocationY1 = y1;
            offset += y1;
        } else if (typeof current._lastKnownAllocationY1 === 'number') {
            offset += current._lastKnownAllocationY1;
        } else {
            hasUnallocated = true;
        }
        current = current.get_parent();
    }

    if (!hasUnallocated && offset > 0) {
        actor._lastKnownScrollOffset = offset;
    } else if (offset === 0 && typeof actor._lastKnownScrollOffset === 'number') {
        offset = actor._lastKnownScrollOffset;
    }

    return offset;
}

// ========================================================================
// Scroll & Focus Utilities
// ========================================================================

/**
 * Smoothly adjust scroll adjustment value with system animation support.
 *
 * @param {St.Adjustment} adjustment Adjustment to animate.
 * @param {number} targetValue Target value to reach.
 */
export function easeAdjustment(adjustment, targetValue) {
    if (!adjustment || !Number.isFinite(targetValue)) return;

    const duration = adjustAnimationTime(SCROLL_TIME);
    if (duration > 0) {
        adjustment.ease(targetValue, {
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration,
        });
    } else {
        adjustment.value = targetValue;
    }
}

/**
 * Resolve focused item identifier within container actor.
 *
 * @param {Clutter.Actor} container Parent container actor.
 * @returns {string|null} The focused item identifier or null.
 */
export function getFocusedItemId(container) {
    if (!container || typeof global === 'undefined' || !global.stage) return null;

    let focused = global.stage.get_key_focus();
    while (focused && !focused._itemId) {
        focused = focused.get_parent();
    }

    if (!focused || !container.contains(focused)) return null;
    return focused._itemId || null;
}

// ========================================================================
// Theme Metrics
// ========================================================================

/**
 * Calculate 2D padding, margin, and intrinsic baseline metrics from CSS theme nodes.
 *
 * @param {St.ThemeContext} themeContext Active stage theme context.
 * @param {string[]} classHierarchy List of style class names ordered from parent to child.
 * @returns {object} Cumulative 2D theme metrics specification.
 */
export function measureThemeGeometry(themeContext, classHierarchy) {
    if (!themeContext || !Array.isArray(classHierarchy) || classHierarchy.length === 0) {
        return {
            horizontalOverhead: 0,
            verticalOverhead: 0,
            minWidth: 0,
            minHeight: 0,
        };
    }

    const theme = themeContext.get_theme();
    let currentNode = themeContext.get_root_node();
    let horizontalOverhead = 0;
    let verticalOverhead = 0;
    let minWidth = 0;
    let minHeight = 0;

    for (let i = 0; i < classHierarchy.length; i++) {
        const styleClass = classHierarchy[i];
        if (!styleClass) continue;

        currentNode = St.ThemeNode.new(themeContext, currentNode, theme, GObject.TYPE_NONE, null, styleClass, null, '');

        const isLeaf = i === classHierarchy.length - 1;
        const hPadding = isLeaf ? 0 : currentNode.get_horizontal_padding();
        const vPadding = isLeaf ? 0 : currentNode.get_vertical_padding();
        const hMargins = currentNode.get_margin(St.Side.LEFT) + currentNode.get_margin(St.Side.RIGHT);
        const vMargins = currentNode.get_margin(St.Side.TOP) + currentNode.get_margin(St.Side.BOTTOM);

        horizontalOverhead += hPadding + hMargins;
        verticalOverhead += vPadding + vMargins;

        const nodeMinWidth = currentNode.get_min_width();
        const nodeMinHeight = currentNode.get_min_height();
        if (nodeMinWidth > minWidth) {
            minWidth = nodeMinWidth;
        }
        if (nodeMinHeight > minHeight) {
            minHeight = nodeMinHeight;
        }
    }

    return {
        horizontalOverhead,
        verticalOverhead,
        minWidth,
        minHeight,
    };
}

// ========================================================================
// Declarative Geometry Engine
// ========================================================================

/**
 * Calculate proportional scale factor to fit within bounding limits.
 *
 * @param {number} width Current target width.
 * @param {number} height Current target height.
 * @param {object} [bounds] Maximum width and height constraints.
 * @returns {number} Scale factor.
 */
function _calculateScale(width, height, bounds) {
    if (!bounds) return 1;
    let scale = 1;
    const maxWidth = bounds.maxWidth;
    const maxHeight = bounds.maxHeight;
    if (maxWidth > 0 && width > maxWidth) {
        scale = maxWidth / width;
    }
    if (maxHeight > 0 && height * scale > maxHeight) {
        scale = maxHeight / (height || 1);
    }
    return scale;
}

/**
 * Resolve aspect ratio constrained within optional bounds.
 *
 * @param {number} width Initial item width.
 * @param {number} height Initial item height.
 * @param {object} [ratioConstraints] Aspect ratio boundary rules.
 * @returns {number} Resolved aspect ratio.
 */
function _resolveRatio(width, height, ratioConstraints) {
    let ratio = width > 0 && height > 0 ? height / width : 1;
    if (ratioConstraints) {
        const minRatio = ratioConstraints.min;
        const maxRatio = ratioConstraints.max;
        if (minRatio > 0 && ratio < minRatio) ratio = minRatio;
        if (maxRatio > 0 && ratio > maxRatio) ratio = maxRatio;
    }
    return ratio;
}

/**
 * Project geometry when target width is fixed.
 *
 * @param {number} targetWidth Fixed projection width.
 * @param {number} ratio Aspect ratio.
 * @param {object} [bounds] Bounding limits.
 * @returns {object} Resolved dimensions and ratio.
 */
function _projectTargetWidth(targetWidth, ratio, bounds) {
    const width = Math.round(targetWidth);
    let height = Math.round(width * ratio);
    const maxHeight = bounds?.maxHeight;
    if (maxHeight > 0 && height > maxHeight) {
        height = maxHeight;
    }
    const aspectRatio = width > 0 && height > 0 ? height / width : ratio;
    return { width, height, aspectRatio };
}

/**
 * Project geometry when target height is fixed.
 *
 * @param {number} targetHeight Fixed projection height.
 * @param {number} ratio Aspect ratio.
 * @param {number} fallbackWidth Fallback item width.
 * @param {object} [bounds] Bounding limits.
 * @returns {object} Resolved dimensions and ratio.
 */
function _projectTargetHeight(targetHeight, ratio, fallbackWidth, bounds) {
    const height = Math.round(targetHeight);
    let width = ratio > 0 ? Math.round(height / ratio) : fallbackWidth;
    const maxWidth = bounds?.maxWidth;
    if (maxWidth > 0 && width > maxWidth) {
        width = maxWidth;
    }
    const aspectRatio = width > 0 && height > 0 ? height / width : ratio;
    return { width, height, aspectRatio };
}

/**
 * Resolves 2D dimensions against boundary, target, and aspect ratio constraints.
 * Operates as a pure structural combinator without domain assumptions.
 *
 * @param {object} [dimensions] Base dimensions specification.
 * @param {number} [dimensions.naturalWidth] Intrinsic or raw asset width.
 * @param {number} [dimensions.naturalHeight] Intrinsic or raw asset height.
 * @param {number} [dimensions.width] Explicit target width.
 * @param {number} [dimensions.height] Explicit target height.
 * @param {object} [constraints] Declarative constraint descriptor.
 * @param {number} [constraints.targetWidth] Explicit fixed projection width.
 * @param {number} [constraints.targetHeight] Explicit fixed projection height.
 * @param {object} [constraints.bounds] Bounding box limits.
 * @param {number} [constraints.bounds.maxWidth] Maximum permissible width.
 * @param {number} [constraints.bounds.maxHeight] Maximum permissible height.
 * @param {object} [constraints.aspectRatio] Proportional limits defined as height divided by width.
 * @param {number} [constraints.aspectRatio.min] Minimum permissible ratio.
 * @param {number} [constraints.aspectRatio.max] Maximum permissible ratio.
 * @returns {object} Resolved 2D geometry specification.
 */
export function resolveGeometry(dimensions = {}, constraints = {}) {
    const rawWidth = dimensions.naturalWidth ?? dimensions.width ?? 0;
    const rawHeight = dimensions.naturalHeight ?? dimensions.height ?? 0;
    const initialWidth = rawWidth > 0 ? rawWidth : 0;
    const initialHeight = rawHeight > 0 ? rawHeight : 0;
    const ratio = _resolveRatio(initialWidth, initialHeight, constraints.aspectRatio);

    if (constraints.targetWidth > 0) {
        return _projectTargetWidth(constraints.targetWidth, ratio, constraints.bounds);
    }

    if (constraints.targetHeight > 0) {
        return _projectTargetHeight(constraints.targetHeight, ratio, initialWidth, constraints.bounds);
    }

    const unscaledWidth = initialWidth;
    const unscaledHeight = initialWidth > 0 ? Math.round(initialWidth * ratio) : initialHeight;
    const scale = _calculateScale(unscaledWidth, unscaledHeight, constraints.bounds);
    const resolvedWidth = Math.round(unscaledWidth * scale);
    const resolvedHeight = Math.round(unscaledHeight * scale);
    const effectiveRatio = resolvedWidth > 0 && resolvedHeight > 0 ? resolvedHeight / resolvedWidth : ratio;

    return {
        width: resolvedWidth,
        height: resolvedHeight,
        aspectRatio: effectiveRatio,
    };
}
