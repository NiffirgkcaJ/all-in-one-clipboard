#!/bin/bash
set -e

# --- Configuration & Argument Parsing ---
TARGET=$1

# Check if a valid target was provided
if [[ "$TARGET" != "review" && "$TARGET" != "package" && "$TARGET" != "update-templates" ]]; then
    echo "Error: Invalid or missing target." >&2
    echo "Usage: $0 [review | package | update-templates]" >&2
    echo "  review           - Build the source zip for extensions.gnome.org review" >&2
    echo "  package          - Build the installable package for GitHub Releases" >&2
    echo "  update-templates - Only update translation template files" >&2
    exit 1
fi

# Read the UUID directly from the metadata.json inside the extension directory
if ! EXTENSION_UUID=$(jq -r '.uuid' gnome-extensions/extension/metadata.json); then
    echo "Error: Could not parse UUID from gnome-extensions/extension/metadata.json." >&2
    echo "Please ensure 'jq' is installed and the file is correct." >&2
    exit 1
fi

# --- Update Templates Function ---
update_translation_templates() {
    # This part runs every time, so your templates are always up-to-date.
    echo "Updating translation templates..."

    # Update the UI strings template (from .js files)
    xgettext --from-code=UTF-8 -o gnome-extensions/translation/all-in-one-clipboard.pot -k_ -L JavaScript gnome-extensions/extension/*.js gnome-extensions/extension/features/**/*.js gnome-extensions/extension/shared/**/*.js

    # Update the DATA strings template (from .json files) using our Python script
    python3 ./gnome-extensions/build-aux/extract-data-strings.py gnome-extensions/translation/all-in-one-clipboard-content.pot gnome-extensions/extension/assets/data/json

    # Safely merge any new strings into the language files (e.g., all-in-one-clipboard@fr.po)
    echo "Merging new strings into language files..."
    for po_file in gnome-extensions/translation/*.po; do
        if [ -f "$po_file" ]; then
            # Figure out which template to use based on the filename
            if [[ "$po_file" == *"all-in-one-clipboard-content"* ]]; then
                msgmerge --update "$po_file" gnome-extensions/translation/all-in-one-clipboard-content.pot
            else
                msgmerge --update "$po_file" gnome-extensions/translation/all-in-one-clipboard.pot
            fi
        fi
    done
    echo "Translation templates are up-to-date."
}

# --- Update Templates Flag ---
if [ "$TARGET" == "update-templates" ]; then
    update_translation_templates
    exit 0
fi

# --- Build Directory ---
BUILD_DIR="build_temp"

# --- Set Zip Filename ---
if [ "$TARGET" == "review" ]; then
    ZIP_FILE="${EXTENSION_UUID}-review.zip"
    echo "Building SOURCE zip for extensions.gnome.org review..."
else # Target is "package"
    ZIP_FILE="${EXTENSION_UUID}.zip"
    echo "Building installable PACKAGE for distribution..."
fi

# --- Main Script ---
# 1. Clean up previous build artifacts
echo "Cleaning up old build files..."
rm -rf "$BUILD_DIR"
# Clean up both possible zip file names to be safe
rm -f "${EXTENSION_UUID}.zip" "${EXTENSION_UUID}-review.zip"

# Only update templates when creating a distributable package
if [ "$TARGET" == "package" ]; then
    update_translation_templates
fi

# 2. Create a fresh build directory and copy files
echo "Copying all extension files..."
mkdir -p "$BUILD_DIR"
cp -r gnome-extensions/extension/* "$BUILD_DIR/"

# 3. Compile assets required for both 'package' and 'review' builds (GResource and Translations)
echo "Compiling GResource bundle..."
(cd "$BUILD_DIR" && glib-compile-resources --target=resources.gresource all-in-one-clipboard.gresource.xml)
if [ $? -ne 0 ]; then
    echo "Error: Failed to compile GResource bundle. Aborting." >&2
    exit 1
fi

echo "Compiling translation files..."
mkdir -p "$BUILD_DIR/locale"
for po_file in gnome-extensions/translation/*.po; do
    if [ -f "$po_file" ]; then
        lang_code=$(basename "$po_file" .po | cut -d'@' -f2)
        if [[ "$lang_code" == $(basename "$po_file" .po) ]]; then continue; fi
        domain=$(basename "$po_file" .po | cut -d'@' -f1)
        mkdir -p "$BUILD_DIR/locale/$lang_code/LC_MESSAGES"
        echo "  - Compiling $po_file -> $domain.mo for language '$lang_code'"
        msgfmt --output-file="$BUILD_DIR/locale/$lang_code/LC_MESSAGES/$domain.mo" "$po_file"
    fi
done

# 4. Compile schemas only for the 'package' build
if [ "$TARGET" == "package" ]; then
    echo "Compiling GSettings schema for package build..."
    glib-compile-schemas "$BUILD_DIR/schemas/"
    if [ $? -ne 0 ]; then
        echo "Error: Failed to compile schemas. Aborting." >&2
        exit 1
    fi
else
    echo "Skipping schema compilation for review build."
fi

# 5. Clean up all unnecessary source files from the build directory
echo "Cleaning up source assets before packaging..."
rm -rf "$BUILD_DIR/assets"
rm -f "$BUILD_DIR/all-in-one-clipboard.gresource.xml"

# 6. Create the zip archive from the cleaned build directory
echo "Creating zip file: $ZIP_FILE..."
(cd "$BUILD_DIR" && zip -r "../$ZIP_FILE" . -x ".*" -x "__MACOSX")

# 7. Clean up the temporary build directory
echo "Cleaning up temporary directory..."
rm -rf "$BUILD_DIR"

# 8. Final success message
echo "Build successful! Archive created at: $ZIP_FILE"