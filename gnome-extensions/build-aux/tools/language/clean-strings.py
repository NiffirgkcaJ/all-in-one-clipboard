#!/usr/bin/env python3
"""
Sanitize and clean gettext .po files for all-in-one-clipboard.

Purges obsolete messages prefixed with #~, then reformats the file with msgcat.

Usage:
    python3 clean-strings.py <path_to_po_file> [more_po_files...]

Example:
    python3 clean-strings.py gnome-extensions/translation/all-in-one-clipboard@<lang_code>.po
"""

from pathlib import Path
import re
import subprocess
import sys

# --- Helper Functions ---

def strip_obsolete_entries(content: str) -> str:
    """
    Removes dead gettext entries starting with #~ and their preceding comments.

    Args:
        content: Raw gettext PO file content.

    Returns:
        Content with all obsolete message blocks removed.
    """
    return re.sub(r'(?:^[ \t]*#.*$\n)*^[ \t]*#~.*$\n?', '', content, flags=re.MULTILINE)

# --- Core Processing ---

def clean_po_file(po_path: Path) -> None:
    """
    Cleans a single .po file by stripping obsolete blocks and reformatting.

    Args:
        po_path: Path to the target .po file to clean.
    """
    print(f"Cleaning '{po_path}'...", flush=True)
    content = po_path.read_text(encoding="utf-8")
    cleaned_content = strip_obsolete_entries(content)

    po_path.write_text(cleaned_content, encoding="utf-8")

    # Reformat using msgcat.
    subprocess.run(["msgcat", "--no-wrap", str(po_path), "-o", str(po_path)], check=True)

    # Validate compilation.
    res = subprocess.run(["msgfmt", "-c", "-v", str(po_path), "-o", "/dev/null"], capture_output=True, text=True)
    print(f"  Validation: {res.stderr.strip()}", flush=True)

# --- Main Entry Point ---

def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <path_to_po_file> [more_po_files...]")
        print(f"Example: {sys.argv[0]} gnome-extensions/translation/all-in-one-clipboard@<lang_code>.po")
        sys.exit(1)

    target_files = [Path(arg) for arg in sys.argv[1:]]

    for po_file in target_files:
        if not po_file.is_file():
            print(f"Error: File not found '{po_file}'", file=sys.stderr)
            sys.exit(1)

        clean_po_file(po_file)

    print("Cleaning complete.")

if __name__ == "__main__":
    main()

