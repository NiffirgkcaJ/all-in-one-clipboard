// Layout Constants
export const GridMetrics = {
    FAST_PAINT_BATCH_SIZE: 6,
    MIN_ASPECT_RATIO: 9 / 16,
    HEIGHT_MEDIA: 1.5,
    HEIGHT_DEFAULT: 1.0,
    LABEL_WEIGHTS: {
        LONG: { threshold: 200, height: 1.5 },
        MEDIUM: { threshold: 100, height: 1.2 },
        SHORT: { threshold: 50, height: 0.9 },
        TINY: { height: 0.7 },
    },
};

// Grid Virtualization Metrics
export const GridVirtualization = {
    HISTORY_MIN_ITEMS: 120,
    PINNED_MIN_ITEMS: 300,
    OVERSCAN_PX: 1400,
};

// List Metrics
export const ListMetrics = {
    ITEM_HEIGHT: 64,
    ITEM_PADDING_MARGIN_PX: 12,
};

// List Virtualization Metrics
export const ListVirtualization = {
    HISTORY_MIN_ITEMS: 120,
    PINNED_MIN_ITEMS: 300,
    OVERSCAN_PX: 1000,
};
