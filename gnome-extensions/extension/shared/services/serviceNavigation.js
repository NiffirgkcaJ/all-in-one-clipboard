let _tabBar = null;
let _onSelectTab = null;
let _onSelectDefaultTab = null;

/**
 * Coordinates keyboard focus navigation and tab switching across extension views.
 */
export class MenuNavigationService {
    /**
     * Registers the active main tab bar instance and tab switch callbacks.
     *
     * @param {object} options Controller configuration options.
     * @param {object} options.tabBar Main tab bar actor.
     * @param {Function} [options.onSelectTab] Callback invoked to select a tab by name.
     * @param {Function} [options.onSelectDefaultTab] Callback invoked to select the default tab.
     */
    static registerController({ tabBar, onSelectTab = null, onSelectDefaultTab = null }) {
        _tabBar = tabBar;
        _onSelectTab = onSelectTab;
        _onSelectDefaultTab = onSelectDefaultTab;
    }

    /**
     * Unregisters the controller when the menu indicator is destroyed.
     */
    static unregisterController() {
        _tabBar = null;
        _onSelectTab = null;
        _onSelectDefaultTab = null;
    }

    /**
     * Checks if the main tab bar is currently visible.
     *
     * @returns {boolean} True if the tab bar is registered and visible.
     */
    static isTabBarVisible() {
        return Boolean(_tabBar && _tabBar.visible);
    }

    /**
     * Attempts to navigate focus to the main tab bar.
     *
     * @param {'first'|'last'|'active'} [direction='first'] Target tab button.
     * @returns {boolean} True if the tab bar exists, is visible, and gained focus.
     */
    static focusTabBar(direction = 'first') {
        if (!_tabBar || !_tabBar.visible) {
            return false;
        }

        if (direction === 'last') {
            return _tabBar.focusLastTab();
        }
        if (direction === 'active') {
            return _tabBar.focusActiveTab();
        }
        return _tabBar.focusFirstTab();
    }

    /**
     * Selects a specific main tab by localized name.
     *
     * @param {string} tabName Localized tab name.
     * @returns {boolean} True if selection was initiated.
     */
    static selectTab(tabName) {
        if (_onSelectTab) {
            _onSelectTab(tabName);
            return true;
        }
        return false;
    }

    /**
     * Selects the user-configured default tab.
     *
     * @returns {boolean} True if selection was initiated.
     */
    static selectDefaultTab() {
        if (_onSelectDefaultTab) {
            _onSelectDefaultTab();
            return true;
        }
        return false;
    }
}
