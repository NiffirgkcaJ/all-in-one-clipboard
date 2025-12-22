# How to Contribute

We welcome contributions of all kinds, from reporting bugs to submitting code and translating. Thank you for your interest in helping to improve All-in-One Clipboard!

## Translating the Extension

Translating the extension into your language is one of the most valuable ways to contribute. Our system uses the standard `gettext` framework, which is common in the GNOME community.

There are two sets of files you will need to translate:
1.  **UI Files:** For the user interface (buttons, labels, settings).
2.  **Content Files:** For the data (names and keywords of emojis, symbols, etc.).

### Prerequisites

Before you begin, you will need the `gettext` tools installed on your system. On a Fedora/Ubuntu-based system, you can install them with:
```bash
# Fedora
sudo dnf install gettext

# Ubuntu/Debian
sudo apt-get install gettext
```
You may also find a graphical `.po` file editor like [Poedit](https://poedit.net/) helpful.

### Adding a New Language

Let's say you want to add a translation for your language (e.g., German, `de_DE`).

1.  **Find your Locale Code:** First, find the exact locale code for your language by running `locale | grep LANG` in your terminal. For example, `de_DE.UTF-8`. The code you need is `de_DE`.

2.  **Fork & Clone the Repository:** On GitHub, "Fork" the repository to your own account. Then, clone your fork to your computer:
    ```bash
    git clone https://github.com/YOUR_USERNAME/all-in-one-clipboard.git
    cd all-in-one-clipboard
    ```

3.  **Generate the Template Files First:** Run the `update-templates` command. This ensures the master template files (`.pot`) are created and up-to-date.
    ```bash
    ./build.sh update-templates
    ```

4.  **Create the Language Files:** Run the following two commands from the root of the project directory. These will create the two `.po` files you need to edit.
    ```bash
    # Create the UI translation file
    msginit --input=gnome-extensions/translation/all-in-one-clipboard.pot --locale=<your_locale_code> --output-file=gnome-extensions/translation/all-in-one-clipboard@<your_locale_code>.po

    # Create the Data Content translation file
    msginit --input=gnome-extensions/translation/all-in-one-clipboard-content.pot --locale=<your_locale_code> --output-file=gnome-extensions/translation/all-in-one-clipboard-content@<your_locale_code>.po
    ```
    *(Remember to replace `<your_locale_code>` with your actual locale code!)*

5.  **Translate the Files:** Open both `...@<your_locale_code>.po` files in a text editor or Poedit. You will see entries like this:
    ```po
    #: extension/prefs.js:101
    msgid "Hide Panel Icon"
    msgstr ""
    ```
    Your job is to fill in the empty `msgstr ""`.
    ```po
    msgid "Hide Panel Icon"
    msgstr "Das Panel-Symbol ausblenden"
    ```
    Do this for all the entries in both files.

6.  **Test Your Changes:**
    *   Run the `./install.sh` script to install your translated version.
    *   **Log out of your user session and log back in.** This is the most reliable way to clear GNOME's caches and see your changes. A simple `Alt+F2`, `r` restart may not be enough.
    *   Set your system language to your language and check if your translations appear correctly in the extension and its preferences.

7.  **Submit a Pull Request:** Once you are happy with your translations, commit your changes and submit a Pull Request on GitHub with your two new `.po` files.

### Updating an Existing Language

If you are improving an existing translation, the process is even simpler:
1.  Make sure you have the latest code from the repository.
2.  Run `./build.sh update-templates` to ensure your local translation files are updated with any new strings.
3.  Open the existing `.po` files (e.g., `gnome-extensions/translation/all-in-one-clipboard@de_DE.po`).
4.  Find any untranslated entries (where `msgstr` is empty) or fix any existing translations.
5.  Save the files, test them, and submit a Pull Request.

---

## For Developers

When adding new user-facing text to any `.js` file, please remember to wrap it in the `_()` function to mark it for translation.
```javascript
// Good
let myLabel = new St.Label({ text: _("My New Label") });

// Bad
let myLabel = new St.Label({ text: "My New Label" });
```
The build script will automatically handle extracting the string and updating the translation templates.