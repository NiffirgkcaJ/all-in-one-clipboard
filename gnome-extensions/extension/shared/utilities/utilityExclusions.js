import Shell from 'gi://Shell';

/**
 * Utility for handling application exclusions.
 */
export const ExclusionUtils = {
    /**
     * Checks if a window should be excluded based on the provided list.
     * Matches against Window Class, App Name, and App ID.
     *
     * @param {Meta.Window} window - The window to check.
     * @param {string[]} exclusionList - List of excluded strings.
     * @returns {boolean} True if the window is excluded, false otherwise.
     */
    isWindowExcluded(window, exclusionList) {
        if (!window || !exclusionList || exclusionList.length === 0) {
            return false;
        }

        // Normalize exclusion list
        const normalizedExclusions = exclusionList.map((s) => s.toLowerCase().trim()).filter((s) => s.length > 0);

        if (normalizedExclusions.length === 0) {
            return false;
        }

        // Gather identifiers
        const identifiers = [];

        // Window Class
        const wmClass = window.get_wm_class();
        if (wmClass) {
            identifiers.push(wmClass.toLowerCase());
        }

        // App Name & ID via WindowTracker
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (app) {
            // Application Name
            identifiers.push(app.get_name().toLowerCase());

            // Application ID
            const appId = app.get_id();
            if (appId) {
                identifiers.push(appId.toLowerCase().replace('.desktop', ''));
                identifiers.push(appId.toLowerCase());
            }
        }

        // Check for match
        return identifiers.some((id) => normalizedExclusions.includes(id));
    },
};
