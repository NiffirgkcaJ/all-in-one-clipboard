#!/bin/bash
set -e

# --- Configuration ---
# Read the UUID directly from metadata.json
# The '-r' flag removes the quotes from the output string.
EXTENSION_UUID=$(jq -r '.uuid' extension/metadata.json)

# Check if jq succeeded and EXTENSION_UUID is set
if [ -z "$EXTENSION_UUID" ]; then
    echo "Error: Could not parse UUID from metadata.json. Is 'jq' installed?"
    exit 1
fi

# Define installation directory
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

# --- Main Script ---
echo "Installing extension to: $INSTALL_DIR"

# 1. Ensure the target directory exists and is clean
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# 2. Copy all necessary source files and directories from the 'extension' folder
echo "Copying source files..."
cp -r extension/* "$INSTALL_DIR/"

# 3. Compile the GSettings schema in the installation directory
echo "Compiling settings schema..."
glib-compile-schemas "$INSTALL_DIR/schemas/"
if [ $? -ne 0 ]; then
    echo "Warning: Schema compilation failed. Settings may not work correctly."
fi

# --- Compile Translations ---
echo "Compiling translation files..."
# Check if the 'po' directory exists
if [ -d "po" ]; then
    # Loop through every .po file in the po directory
    for po_file in po/*.po; do
        if [ -f "$po_file" ]; then
            # Get the language code
            lang_code=$(basename "$po_file" .po | cut -d'@' -f2)
            # If the filename doesn't contain '@', we skip it to be safe
            if [[ "$lang_code" == $(basename "$po_file" .po) ]]; then continue; fi

            # Get the domain (the part before '@')
            domain=$(basename "$po_file" .po | cut -d'@' -f1)

            # Create the final directory for this language inside the installation target
            mkdir -p "$INSTALL_DIR/locale/$lang_code/LC_MESSAGES"

            # Compile the .po file into a .mo file directly into the install directory
            echo "  - Compiling $domain for language '$lang_code'..."
            msgfmt --output-file="$INSTALL_DIR/locale/$lang_code/LC_MESSAGES/$domain.mo" "$po_file"
        fi
    done
else
    echo "Info: 'po' directory not found. Skipping translation compilation."
fi

# 4. Final success message
echo "Extension installed successfully."
echo "Please enable the extension and then restart GNOME Shell (Alt+F2, type 'r', press Enter) or log out."