# All-in-One Clipboard GNOME Extension

A powerful, integrated clipboard manager for GNOME Shell that combines your clipboard history with quick access to Emojis, GIFs, Kaomojis, and Symbols.

This extension provides a unified, searchable interface to manage your clipboard history, find and insert emojis with skin-tone support, search for GIFs via supported providers, and browse extensive libraries of kaomojis and symbols.

## Features

*   **Clipboard History:**
    *   Saves a configurable number of text and image items from your clipboard.
    *   Pin important items to keep them at the top.
    *   Search your clipboard history.
    *   Select and delete multiple items at once.
    *   Enhanced privacy by smartly ignoring sensitive apps using standard window rules or enhanced AT-SPI detection, detailed in [Exclusion Detection](EXCLUSIONS.md#exclusion-detection).
*   **Emoji Selector:**
    *   Browse emojis by category or search by name.
    *   Full support for skin-tone modifiers, configurable in preferences.
    *   Keeps track of your recently used emojis.
*   **GIF Search:**
    *   Integrates with supported GIF providers.
    *   Search for GIFs by keyword and browse trending categories.
    *   Saves your recent GIFs for quick re-use.
*   **Kaomoji & Symbols:**
    *   Access thousands of kaomojis and symbols, organized by category.
    *   Searchable and includes a "Recents" tab for your favorites.
*   **Unified "Recents" Tab:**
    *   See all your most recently used items from every category in one convenient place.
*   **Auto-Paste:**
    *   Optionally paste content directly into the active application instead of just copying it.
*   **Highly Configurable:**
    *   Set custom keyboard shortcuts for toggling the menu or jumping to specific tabs.
    *   Hide the panel icon and open the menu at your cursor, the center of the screen, or over the active window.
    *   Fine-tune history limits, auto-paste behavior, and more.

## Compatibility

Requires GNOME Shell version 46 and up.

## Installation

### From extensions.gnome.org (Recommended)

The easiest way to install is from the official GNOME Extensions website.

<a href="https://extensions.gnome.org/extension/8671/all-in-one-clipboard/">
<img src="https://github.com/andyholmes/gnome-shell-extensions-badge/raw/master/get-it-on-ego.svg" alt="Get it on EGO" width="200" />
</a>

### Installing from a ZIP File

1.  **Download the ZIP:** Go to the [Releases](https://github.com/NiffirgkcaJ/all-in-one-clipboard/releases) page and download the latest `all-in-one-clipboard@NiffirgkcaJ.github.com.zip` file.

2.  **Unzip the File:** Extract the contents of the zip file. This will create a folder with the extension's files inside (like `extension.js`, `metadata.json`, etc.).

3.  **Find the Destination Folder:** The extension needs to be placed in your local extensions directory. You can open it in your file manager or create it if it doesn't exist with this command:
    ```bash
    mkdir -p ~/.local/share/gnome-shell/extensions/
    ```

4.  **Move and Rename:** Move the unzipped folder into the extensions directory and **rename the folder to match the extension's UUID**. This step is crucial. The UUID is: `all-in-one-clipboard@NiffirgkcaJ.github.com`.

    For example, if you unzipped the files into a folder named `all-in-one-clipboard`, you would run:
    ```bash
    mv all-in-one-clipboard ~/.local/share/gnome-shell/extensions/all-in-one-clipboard@NiffirgkcaJ.github.com
    ```

5.  **Restart GNOME Shell:**
    *   On **X11**, press `Alt` + `F2`, type `r` into the dialog, and press `Enter`.
    *   On **Wayland**, you must log out and log back in.

6.  **Enable the Extension:** Open the **Extensions** app (or GNOME Tweaks) and enable "All-in-One Clipboard". You can also do this from the command line:
    ```bash
    gnome-extensions enable all-in-one-clipboard@NiffirgkcaJ.github.com
    ```

### Install from Source (for Developers)

1.  Clone the repository:
    ```bash
    git clone https://github.com/NiffirgkcaJ/all-in-one-clipboard.git
    cd all-in-one-clipboard
    ```
2.  Run the installation script:
    ```bash
    ./install.sh
    ```
3.  Restart GNOME Shell (press `Alt` + `F2`, type `r`, and press `Enter`) or log out and back in.
4.  Enable the extension using the Extensions app or the command line:
    ```bash
    gnome-extensions enable all-in-one-clipboard@NiffirgkcaJ.github.com
    ```

## Usage

*   **Open the Menu:** Click the clipboard icon in the top panel or use the keyboard shortcut you configured (default is `<Super>v` for the clipboard tab).
*   **Navigate:** Use the icons at the top to switch between the "Recents", "Emoji", "GIF", "Kaomoji", "Symbols", and "Clipboard" tabs.
*   **Search:** Use the search bar within each tab to filter results.
*   **Select:** Click on any item to copy it to your clipboard. If auto-paste is enabled, it will also be pasted into your active window.

## Uninstallation

*   **Using the Extensions App (Recommended):**
    Open the "Extensions" application, find "All-in-One Clipboard", and click the "Uninstall" button.

*   **Using the Script:**
    If you installed from source, navigate to the cloned repository directory and run:
    ```bash
    ./uninstall.sh
    ```

## 🌐 Localization

All-in-One Clipboard is available in multiple languages thanks to the efforts of contributors from around the world.

**Supported Languages:**
*   English
*   German

### Want to Help Translate?

We would love your help to make this extension available in your language! Contributions are welcome from everyone.

To get started, please read our [Translation Guide](CONTRIBUTING.md#translating-the-extension).

## Contributing

Contributions are welcome! Please feel free to open an issue to report a bug or suggest a feature, or submit a pull request with your improvements.

## License

This project is licensed under the **GPLv3** - see the [LICENSE](LICENSE) file for details.