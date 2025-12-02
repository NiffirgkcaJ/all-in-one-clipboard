// GSettings Keys
export const EmojiSettings = {
    ENABLE_CUSTOM_SKIN_TONES_KEY: 'enable-custom-skin-tones',
    CUSTOM_SKIN_TONE_PRIMARY_KEY: 'custom-skin-tone-primary',
    CUSTOM_SKIN_TONE_SECONDARY_KEY: 'custom-skin-tone-secondary',
    RECENTS_MAX_ITEMS_KEY: 'emoji-recents-max-items',
};

// UI Configuration
export const EmojiUI = {
    ITEMS_PER_ROW: 9,
    CATEGORY_ICON_SIZE: 16,
};

// Category Icon Mappings
export const EmojiCategoryIcons = [
    { keywords: ['smileys', 'emotion'], iconFile: 'emoji-smileys_emotion-symbolic.svg' },
    { keywords: ['people', 'body'], iconFile: 'emoji-people_body-symbolic.svg' },
    { keywords: ['animals', 'nature'], iconFile: 'emoji-animals_nature-symbolic.svg' },
    { keywords: ['food', 'drink'], iconFile: 'emoji-food_drink-symbolic.svg' },
    { keywords: ['travel', 'places'], iconFile: 'emoji-travel_places-symbolic.svg' },
    { keywords: ['activities'], iconFile: 'emoji-activities-symbolic.svg' },
    { keywords: ['objects'], iconFile: 'emoji-objects-symbolic.svg' },
    { keywords: ['symbols'], iconFile: 'emoji-symbols-symbolic.svg' },
    { keywords: ['flags'], iconFile: 'emoji-flags-symbolic.svg' },
];
