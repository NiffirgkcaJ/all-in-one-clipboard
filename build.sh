#!/bin/bash
set -e

# --- Configuration ---
# Read the UUID directly from the metadata.json inside the extension directory
if ! EXTENSION_UUID=$(jq -r '.uuid' extension/metadata.json); then
    echo "Error: Could not parse UUID from extension/metadata.json." >&2
    echo "Please ensure 'jq' is installed and the file is correct." >&2
    exit 1
fi

BUILD_DIR="build_temp" # A temporary directory for packaging
ZIP_FILE="${EXTENSION_UUID}.zip"

# --- Main Script ---
# 1. Clean up previous build artifacts
echo "Cleaning up old build files..."
rm -rf "$BUILD_DIR"
rm -f "$ZIP_FILE"

# 2. Create a fresh build directory
mkdir -p "$BUILD_DIR"

# 3. Copy the entire contents of the 'extension' directory
echo "Copying all extension files..."
cp -r extension/* "$BUILD_DIR/"

# 4. Compile the GSettings schema inside the build directory
echo "Compiling GSettings schema..."
glib-compile-schemas "$BUILD_DIR/schemas/"
if [ $? -ne 0 ]; then
    echo "Error: Failed to compile schemas. Aborting." >&2
    exit 1
fi

# 5. Create the zip archive from the build directory
echo "Creating zip file: $ZIP_FILE..."
(cd "$BUILD_DIR" && zip -r "../$ZIP_FILE" . -x ".*" -x "__MACOSX")

# 6. Clean up the temporary build directory
echo "Cleaning up temporary directory..."
rm -rf "$BUILD_DIR"

# 7. Final success message
echo "Build successful! Archive created at: $ZIP_FILE"