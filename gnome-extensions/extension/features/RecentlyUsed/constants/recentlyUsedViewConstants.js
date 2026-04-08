// Shared nested-scroll behavior for list and grid nested views.
export const RecentlyUsedNestedViewTuning = {
    VIEWPORT_HEIGHT_EPSILON: 2,
    SCROLL_BOUNDARY_EPSILON: 0.5,
    BOTTOM_THRESHOLD_ITEM_HEIGHT_MULTIPLIER: 1.5,
    BOTTOM_THRESHOLD_MIN_PX: 96,
    MAX_SCROLL_APPEND_ITERATIONS: 16,
};

// Grid-specific sizing constraints used to derive runtime column count.
export const RecentlyUsedNestedGridViewTuning = {
    MIN_ITEM_WIDTH: 72,
    HORIZONTAL_PADDING: 16,
};

// Generic list presentation spacing.
export const RecentlyUsedListViewTuning = {
    LIST_ITEM_CONTENT_SPACING: 8,
};

// Small focus/restore delays to avoid focus flicker during view updates.
export const RecentlyUsedBaseViewTiming = {
    FOCUS_RESTORE_DELAY_MS: 100,
    SETTINGS_BUTTON_FOCUS_RESET_DELAY_MS: 10,
};
