#!/bin/bash
set -e

# --- Configuration ---
# Read the UUID directly from metadata.json
# The '-r' flag removes the quotes from the output string.
EXTENSION_UUID=$(jq -r '.uuid' gnome-extensions/extension/metadata.json)

# Check if jq succeeded and EXTENSION_UUID is set
if [ -z "$EXTENSION_UUID" ]; then
    echo "Error: Could not parse UUID from metadata.json. Is 'jq' installed?"
    exit 1
fi

# Define uninstallation directory
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

# --- Main Script ---
if [ -d "$INSTALL_DIR" ]; then
    echo "Uninstalling extension from: $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
    echo "Extension uninstalled successfully."
    echo "You may need to restart GNOME Shell (Alt+F2, type 'r', press Enter) or log out."
else
    echo "Extension not found at $INSTALL_DIR. Nothing to do."
fi