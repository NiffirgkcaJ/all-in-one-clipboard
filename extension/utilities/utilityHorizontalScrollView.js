import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/**
 * A ScrollView that maps vertical mouse wheel events to horizontal scrolling.
 * - Touchpads (Horizontal Swipe): Handled natively (super call).
 * - Touchpads (Vertical Swipe): Mapped to horizontal scroll.
 * - Mouse Wheels: Vertical wheel mapped to horizontal animation.
 */
export const HorizontalScrollView = GObject.registerClass(
class HorizontalScrollView extends St.ScrollView {
    constructor(params) {
        super(params);
        this.hscrollbar_policy = St.PolicyType.AUTOMATIC;
        this.vscrollbar_policy = St.PolicyType.NEVER;
    }

    vfunc_scroll_event(event) {
        const adjustment = this.hadjustment;
        if (!adjustment) return Clutter.EVENT_PROPAGATE;

        const direction = event.get_scroll_direction();

        // Touchpad Scrolling
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();

            // If moving horizontally, let parent handle it
            if (Math.abs(dx) > Math.abs(dy)) {
                return super.vfunc_scroll_event(event);
            }

            // If moving vertically, map to horizontal scroll
            const TOUCHPAD_SPEED_FACTOR = 30;
            adjustment.value += dy * TOUCHPAD_SPEED_FACTOR;

            return Clutter.EVENT_STOP;
        }

        // Mouse Wheel Scrolling
        let wheelDelta = 0;
        const source = event.get_scroll_source();

        if (source === Clutter.ScrollSource.WHEEL || source === Clutter.ScrollSource.UNKNOWN) {
            if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) {
                wheelDelta = -1;
            } else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) {
                wheelDelta = 1;
            }
        }

        // If we detected a vertical wheel scroll, animate it horizontally
        if (wheelDelta !== 0) {
            const MOUSE_STEP = 100; // Pixels per wheel click

            // Get start value considering ongoing animations
            const transition = adjustment.get_transition('value');
            let startVal = adjustment.value;
            if (transition && transition.is_playing() && transition.interval) {
                startVal = transition.interval.final;
            }

            const newVal = startVal + (wheelDelta * MOUSE_STEP);

            adjustment.ease(newVal, {
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            return Clutter.EVENT_STOP;
        }

        // Default handling for other cases
        return super.vfunc_scroll_event(event);
    }
});

/**
 * Smoothly scrolls the ScrollView to center the target actor.
 * @param {St.ScrollView} scrollView - The scroll view container
 * @param {Clutter.Actor} actor - The child actor (button) to center
 */
export function scrollToItemCentered(scrollView, actor) {
    if (!scrollView || !actor) return;

    const adjustment = scrollView.hadjustment;
    if (!adjustment) return;

    // Get coordinates relative to allocation
    const box = actor.get_allocation_box();

    // Calculate Centers
    const actorCenter = box.x1 + (box.get_width() / 2);
    const viewportWidth = adjustment.page_size;

    // Calculate Target
    let targetValue = actorCenter - (viewportWidth / 2);

    // Clamp
    targetValue = Math.max(adjustment.lower, Math.min(targetValue, adjustment.upper - viewportWidth));

    // Animate
    adjustment.ease(targetValue, {
        duration: 250,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD
    });
}