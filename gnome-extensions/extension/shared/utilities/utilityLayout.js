import { adjustAnimationTime } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Logger } from './utilityLogger.js';

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
 * Calculate 2D padding and margin overhead metrics from CSS theme nodes.
 *
 * @param {St.ThemeContext} themeContext Active stage theme context.
 * @param {string[]} classHierarchy List of style class names ordered from parent to child.
 * @param {object} [options] Optional measurement flags.
 * @param {boolean} [options.includeLeafPadding] Whether to include padding on the final node in the hierarchy.
 * @returns {object} Cumulative 2D theme overhead specification.
 */
export function measureThemeGeometry(themeContext, classHierarchy, options = {}) {
    if (!themeContext || !Array.isArray(classHierarchy) || classHierarchy.length === 0) {
        return {
            horizontalOverhead: 0,
            verticalOverhead: 0,
        };
    }

    const includeLeafPadding = Boolean(options.includeLeafPadding);
    const theme = themeContext.get_theme();
    let currentNode = themeContext.get_root_node();
    let horizontalOverhead = 0;
    let verticalOverhead = 0;

    for (let i = 0; i < classHierarchy.length; i++) {
        const styleClass = classHierarchy[i];
        if (!styleClass) continue;

        currentNode = St.ThemeNode.new(themeContext, currentNode, theme, GObject.TYPE_NONE, null, styleClass, null, '');

        const isLeaf = i === classHierarchy.length - 1;
        const skipPadding = isLeaf && !includeLeafPadding;
        const hPadding = skipPadding ? 0 : currentNode.get_horizontal_padding();
        const vPadding = skipPadding ? 0 : currentNode.get_vertical_padding();
        const hMargins = currentNode.get_margin(St.Side.LEFT) + currentNode.get_margin(St.Side.RIGHT);
        const vMargins = currentNode.get_margin(St.Side.TOP) + currentNode.get_margin(St.Side.BOTTOM);

        horizontalOverhead += hPadding + hMargins;
        verticalOverhead += vPadding + vMargins;
    }

    return {
        horizontalOverhead,
        verticalOverhead,
    };
}

/**
 * Calculate 2D card layout geometry from allocated dimensions, controls, and theme metrics.
 *
 * @param {object} [options] Sizing options.
 * @param {number|null} [options.width] Total allocated card width.
 * @param {number|null} [options.height] Total allocated card height.
 * @param {number} [options.controlsWidth] Space consumed by horizontal controls.
 * @param {number} [options.controlsHeight] Space consumed by vertical controls.
 * @param {object} [options.metrics] Resolved 2D theme metrics specification.
 * @returns {object} Layout geometry specification.
 */
export function calculateCardGeometry(options = {}) {
    const width = options.width;
    const height = options.height;
    const metrics = options.metrics;
    assertValidLayoutAxes(width, height, { context: 'UtilityLayout' });
    Logger.assert(
        Boolean(metrics && typeof metrics.horizontalOverhead === 'number' && typeof metrics.verticalOverhead === 'number'),
        'calculateCardGeometry requires valid 2D theme metrics.',
        'UtilityLayout',
    );

    const controlsWidth = options.controlsWidth || 0;
    const controlsHeight = options.controlsHeight || 0;
    const availableWidth = width !== null ? Math.max(0, width - metrics.horizontalOverhead - controlsWidth) : null;
    const availableHeight = height !== null ? Math.max(0, height - metrics.verticalOverhead - controlsHeight) : null;

    return {
        totalWidth: width,
        totalHeight: height,
        availableWidth,
        availableHeight,
        metrics,
    };
}

/**
 * Check whether an axis dimension is explicitly unconstrained or a bounded number.
 *
 * @param {*} value Candidate axis value.
 * @param {boolean} [allowZero] Whether zero pixels is valid on a constrained axis.
 * @returns {boolean} True when value is null or a finite number within bounds.
 */
export function isValidLayoutDimension(value, allowZero = false) {
    if (value === null) {
        return true;
    }

    return typeof value === 'number' && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
}

/**
 * Assert symmetric 2D axis validity with explicit null or bounded numbers and at least one constrained axis.
 *
 * @param {number|null} width Candidate horizontal axis dimension.
 * @param {number|null} height Candidate vertical axis dimension.
 * @param {object} [options] Validation options.
 * @param {boolean} [options.allowZero] Whether zero is permitted on constrained axes.
 * @param {string} [options.widthName] Label for horizontal axis in failure messages.
 * @param {string} [options.heightName] Label for vertical axis in failure messages.
 * @param {string} [options.context] Logger context label.
 */
export function assertValidLayoutAxes(width, height, options = {}) {
    const allowZero = Boolean(options.allowZero);
    const widthName = options.widthName || 'width';
    const heightName = options.heightName || 'height';
    const context = options.context || 'UtilityLayout';
    const boundDescription = allowZero ? 'a non-negative number' : 'a positive number';

    Logger.assert(isValidLayoutDimension(width, allowZero), `${context} requires ${widthName} to be null or ${boundDescription}.`, context);
    Logger.assert(isValidLayoutDimension(height, allowZero), `${context} requires ${heightName} to be null or ${boundDescription}.`, context);
    Logger.assert(width !== null || height !== null, `${context} requires at least one constrained axis.`, context);
}

/**
 * Synchronize an explicit numeric axis dimension on an actor when supplied.
 *
 * @param {Clutter.Actor} actor Target actor instance.
 * @param {string} axis Property name to synchronize.
 * @param {number|null|undefined} value Target axis dimension.
 * @private
 */
function _syncActorAxis(actor, axis, value) {
    if (value === undefined || value === null) return;

    Logger.assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, `syncActorGeometry requires non-negative numeric ${axis}.`, 'UtilityLayout');
    if (actor[axis] !== value) {
        actor[axis] = value;
    }
}

/**
 * Synchronize explicit 2D width and height dimensions on an actor when supplied.
 *
 * @param {Clutter.Actor} actor Target actor instance.
 * @param {object} [geometry] Target 2D dimensions.
 * @param {number|null} [geometry.width] Explicit target width.
 * @param {number|null} [geometry.height] Explicit target height.
 */
export function syncActorGeometry(actor, geometry = {}) {
    if (!actor || !geometry) return;

    _syncActorAxis(actor, 'width', geometry.width);
    _syncActorAxis(actor, 'height', geometry.height);
}

// ========================================================================
// Declarative Geometry Engine
// ========================================================================

/**
 * Apply a single optional maximum axis bound to a proportional scale factor.
 *
 * @param {number} size Projected dimension size on the constrained axis.
 * @param {number|null|undefined} maxBound Optional maximum axis bound.
 * @param {number} currentScale Current scale factor.
 * @param {string} boundName Bound field name for diagnostics.
 * @returns {number} Updated scale factor.
 * @private
 */
function _resolveBoundScale(size, maxBound, currentScale, boundName) {
    if (maxBound === undefined || maxBound === null) return currentScale;

    Logger.assert(typeof maxBound === 'number' && Number.isFinite(maxBound) && maxBound >= 0, `_calculateScale requires non-negative numeric ${boundName}.`, 'UtilityLayout');
    if (size * currentScale > maxBound) {
        return size > 0 ? Math.min(currentScale, maxBound / size) : 0;
    }
    return currentScale;
}

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
    let scale = _resolveBoundScale(width, bounds.maxWidth, 1, 'maxWidth');
    scale = _resolveBoundScale(height, bounds.maxHeight, scale, 'maxHeight');
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
    let ratio = width > 0 && height > 0 ? height / width : ratioConstraints?.default > 0 ? ratioConstraints.default : 0;
    if (ratio > 0 && ratioConstraints) {
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
    const requestedWidth = Math.round(targetWidth);
    const requestedHeight = Math.round(requestedWidth * ratio);
    const scale = _calculateScale(requestedWidth, requestedHeight, bounds);
    const width = Math.round(requestedWidth * scale);
    const height = Math.round(requestedHeight * scale);
    const aspectRatio = width > 0 && height > 0 ? height / width : ratio;
    return { width, height, aspectRatio };
}

/**
 * Project geometry when target height is fixed.
 *
 * @param {number} targetHeight Fixed projection height.
 * @param {number} ratio Aspect ratio.
 * @param {object} [bounds] Bounding limits.
 * @returns {object} Resolved dimensions and ratio.
 */
function _projectTargetHeight(targetHeight, ratio, bounds) {
    const requestedHeight = Math.round(targetHeight);
    const requestedWidth = Math.round(requestedHeight / ratio);
    const scale = _calculateScale(requestedWidth, requestedHeight, bounds);
    const width = Math.round(requestedWidth * scale);
    const height = Math.round(requestedHeight * scale);
    const aspectRatio = width > 0 && height > 0 ? height / width : ratio;
    return { width, height, aspectRatio };
}

/**
 * Validate an optional fixed projection target dimension.
 *
 * @param {number|null|undefined} value Target dimension override.
 * @param {string} targetName Target field name for diagnostics.
 * @returns {boolean} True when a positive numeric target dimension was supplied.
 * @private
 */
function _assertTargetDimension(value, targetName) {
    if (value === undefined || value === null) return false;

    Logger.assert(typeof value === 'number' && Number.isFinite(value) && value > 0, `resolveGeometry requires positive numeric ${targetName}.`, 'UtilityLayout');
    return true;
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
 * @param {number} [dimensions.aspectRatio] Explicit fallback ratio, expressed as height divided by width.
 * @param {object} [constraints] Declarative constraint descriptor.
 * @param {number} [constraints.targetWidth] Explicit fixed projection width.
 * @param {number} [constraints.targetHeight] Explicit fixed projection height.
 * @param {object} [constraints.bounds] Bounding box limits.
 * @param {number} [constraints.bounds.maxWidth] Maximum permissible width.
 * @param {number} [constraints.bounds.maxHeight] Maximum permissible height.
 * @param {object} [constraints.aspectRatio] Proportional limits defined as height divided by width.
 * @param {number} [constraints.aspectRatio.default] Explicit ratio used to derive a missing dimension.
 * @param {number} [constraints.aspectRatio.min] Minimum permissible ratio.
 * @param {number} [constraints.aspectRatio.max] Maximum permissible ratio.
 * @returns {object} Resolved 2D geometry specification.
 */
export function resolveGeometry(dimensions = {}, constraints = {}) {
    const rawWidth = dimensions.naturalWidth ?? dimensions.width ?? 0;
    const rawHeight = dimensions.naturalHeight ?? dimensions.height ?? 0;
    const initialWidth = rawWidth > 0 ? rawWidth : 0;
    const initialHeight = rawHeight > 0 ? rawHeight : 0;
    const ratioConstraints = {
        ...(dimensions.aspectRatio > 0 ? { default: dimensions.aspectRatio } : {}),
        ...(constraints.aspectRatio || {}),
    };
    const ratio = _resolveRatio(initialWidth, initialHeight, ratioConstraints);
    Logger.assert(ratio > 0, 'resolveGeometry requires positive dimensions or an explicit default aspectRatio.', 'UtilityLayout');

    const hasTargetWidth = _assertTargetDimension(constraints.targetWidth, 'targetWidth');
    const hasTargetHeight = _assertTargetDimension(constraints.targetHeight, 'targetHeight');
    Logger.assert(!(hasTargetWidth && hasTargetHeight), 'resolveGeometry cannot accept both targetWidth and targetHeight.', 'UtilityLayout');

    let result;
    if (hasTargetWidth) {
        result = _projectTargetWidth(constraints.targetWidth, ratio, constraints.bounds);
    } else if (hasTargetHeight) {
        result = _projectTargetHeight(constraints.targetHeight, ratio, constraints.bounds);
    } else {
        const unscaledWidth = initialWidth > 0 ? initialWidth : Math.round(initialHeight / ratio);
        const unscaledHeight = initialWidth > 0 ? Math.round(initialWidth * ratio) : initialHeight;
        const scale = _calculateScale(unscaledWidth, unscaledHeight, constraints.bounds);
        const resolvedWidth = Math.round(unscaledWidth * scale);
        const resolvedHeight = Math.round(unscaledHeight * scale);
        const effectiveRatio = resolvedWidth > 0 && resolvedHeight > 0 ? resolvedHeight / resolvedWidth : ratio;

        result = {
            width: resolvedWidth,
            height: resolvedHeight,
            aspectRatio: effectiveRatio,
        };
    }

    Logger.assert(result.width > 0 && result.height > 0, 'resolveGeometry failed to resolve positive 2D dimensions.', 'UtilityLayout');
    return result;
}
