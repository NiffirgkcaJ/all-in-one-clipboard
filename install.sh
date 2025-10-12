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
mkdir -p "$INSTALL_DIR/schemas"

# 2. Copy all necessary files and directories
echo "Copying files..."
cp -r extension/* "$INSTALL_DIR/"

# 3. Compile the GSettings schema in the installation directory
echo "Compiling settings schema..."
glib-compile-schemas "$INSTALL_DIR/schemas/"
if [ $? -ne 0 ]; then
    echo "Warning: Schema compilation failed. Settings may not work correctly."
fi

# 4. Final success message
echo "Extension installed successfully."
echo "Please enable the extension and then restart GNOME Shell (Alt+F2, type 'r', press Enter) or log out."