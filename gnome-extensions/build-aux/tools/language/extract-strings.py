#!/usr/bin/env python3
"""
Extract translatable strings from JavaScript source code or JSON data files for gettext.

Recursively scans source or data files and generates a standardized .pot template file for translation.

Usage:
    python3 extract-strings.py [ui | data] <output_file.pot> <input_dir>

Example:
    python3 extract-strings.py ui gnome-extensions/translation/all-in-one-clipboard.pot gnome-extensions/extension
    python3 extract-strings.py data gnome-extensions/translation/all-in-one-clipboard-content.pot gnome-extensions/extension/assets/data
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

# --- Configuration ---

# Keys whose string values should be extracted for translation.
TRANSLATABLE_KEYS: frozenset[str] = frozenset({
    'name',
    'description',
    'keywords',
})

# Files to skip for non-translatable content.
SKIP_FILES: frozenset[str] = frozenset({
    'countries.json',
    'emojisModifier.json',
})

# Directories to skip.
SKIP_DIRS: frozenset[str] = frozenset({
    'clipboard',
    'gif',
})

# Template for the header of the .pot file.
POT_HEADER_TEMPLATE = r'''# Translation template for All-in-One Clipboard {domain_name}.
# Copyright (C) {year} NiffirgkcaJ
# This file is distributed under the same license as the All-in-One Clipboard package.
#
#, fuzzy
msgid ""
msgstr ""
"Project-Id-Version: all-in-one-clipboard\n"
"Report-Msgid-Bugs-To: https://github.com/NiffirgkcaJ/all-in-one-clipboard/issues\n"
"POT-Creation-Date: {creation_date}\n"
"PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE\n"
"Last-Translator: FULL NAME <EMAIL@ADDRESS>\n"
"Language-Team: LANGUAGE <EMAIL@ADDRESS>\n"
"Language: \n"
"MIME-Version: 1.0\n"
"Content-Type: text/plain; charset=UTF-8\n"
"Content-Transfer-Encoding: 8bit\n"

'''

# --- Helper Functions ---

def escape_string(s: str) -> str:
    """
    Escapes quotes and backslashes for POT format.

    Args:
        s: String to escape.

    Returns:
        Escaped string formatted for gettext.
    """
    return s.replace('\\', '\\\\').replace('"', '\\"')

def extract_strings_recursive(obj: object, string_set: set[str]) -> None:
    """
    Recursively extracts translatable strings from any JSON structure.

    Looks for keys defined in TRANSLATABLE_KEYS and extracts their string values.
    Handles both direct string values and arrays of strings such as keywords.

    Args:
        obj: The JSON object, dictionary, list, or primitive to process.
        string_set: Set to accumulate extracted strings.
    """
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in TRANSLATABLE_KEYS:
                if isinstance(value, str) and value.strip():
                    string_set.add(value.strip())
                elif isinstance(value, list):
                    for item in value:
                        if isinstance(item, str) and item.strip():
                            string_set.add(item.strip())
            else:
                extract_strings_recursive(value, string_set)
    elif isinstance(obj, list):
        for item in obj:
            extract_strings_recursive(item, string_set)

def process_json_file(json_path: Path, string_set: set[str]) -> int:
    """
    Processes a single JSON file and extracts translatable strings.

    Args:
        json_path: Path to the JSON file.
        string_set: Set to accumulate extracted strings.

    Returns:
        Number of strings extracted from this file.
    """
    initial_count = len(string_set)

    try:
        with open(json_path, 'r', encoding='utf-8') as json_file:
            data = json.load(json_file)

        # Handle both wrapped and unwrapped data formats.
        if isinstance(data, dict) and 'data' in data:
            data = data['data']

        extract_strings_recursive(data, string_set)
        return len(string_set) - initial_count

    except json.JSONDecodeError as e:
        print(f"  Error: Invalid JSON in '{json_path.name}': {e}", file=sys.stderr)
        return 0
    except Exception as e:
        print(f"  Error processing '{json_path.name}': {e}", file=sys.stderr)
        return 0

def discover_json_files(input_dir: Path) -> list[Path]:
    """
    Auto-discovers all JSON files in the input directory.

    Args:
        input_dir: Path to the directory to scan.

    Returns:
        List of Path objects for discovered JSON files.
    """
    json_files: list[Path] = []

    for current_dir, directories, filenames in os.walk(input_dir, topdown=True):
        # Prune excluded directories before descending.
        for directory in list(directories):
            if directory in SKIP_DIRS:
                print(f"  Skipping directory: {Path(current_dir) / directory}")
                directories.remove(directory)

        # Filter and collect JSON files.
        for filename in sorted(filenames):
            if not filename.endswith('.json'):
                continue

            if filename in SKIP_FILES:
                print(f"  Skipping file: {filename}")
                continue

            json_files.append(Path(current_dir) / filename)
    print()

    json_files.sort()
    return json_files

# --- Core Processing ---

def generate_pot_file(output_path: Path, strings: set[str], source_files: list[Path]) -> int:
    """
    Generates the .pot file with extracted strings.

    Args:
        output_path: Path for the output .pot file.
        strings: Set of strings to include.
        source_files: List of source file paths for comments.

    Returns:
        Total number of unique strings written.
    """
    strings.discard('')
    sorted_strings = sorted(strings)
    source_comment = ', '.join(json_file.name for json_file in source_files)
    creation_date = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M+0000')
    current_year = datetime.now().year

    with open(output_path, 'w', encoding='utf-8') as pot_file:
        pot_file.write(POT_HEADER_TEMPLATE.format(
            domain_name="data content",
            year=current_year,
            creation_date=creation_date,
        ))

        for string in sorted_strings:
            pot_file.write(f'#: {source_comment}\n')
            pot_file.write(f'msgid "{escape_string(string)}"\n')
            pot_file.write('msgstr ""\n\n')

    return len(sorted_strings)

def extract_ui_strings(output_path: Path, input_dir: Path) -> None:
    """
    Extracts translatable strings from JavaScript source files into a .pot template.

    Args:
        output_path: Path for the output .pot file.
        input_dir: Directory containing JavaScript source files.
    """
    print(f"Scanning directory: {input_dir}\n", flush=True)
    js_files = sorted(input_dir.glob("**/*.js"))
    if not js_files:
        print("No JavaScript files found to process.", flush=True)
        return

    print(f"Found {len(js_files)} JavaScript files to process.", flush=True)

    creation_date = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M+0000')
    current_year = datetime.now().year
    header = POT_HEADER_TEMPLATE.format(
        domain_name="UI strings",
        year=current_year,
        creation_date=creation_date,
    )

    cmd = [
        "xgettext",
        "--no-wrap",
        "--from-code=UTF-8",
        "--omit-header",
        "-k_",
        "-L",
        "JavaScript",
    ] + [str(p) for p in js_files] + ["-o", "-"]

    res = subprocess.run(cmd, capture_output=True, text=True, check=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as pot_file:
        pot_file.write(header)
        pot_file.write(res.stdout)

    print(f"Generated '{output_path}' with UI translatable strings.", flush=True)

def extract_data_strings(output_path: Path, input_dir: Path) -> None:
    """
    Extracts translatable strings from JSON data files into a .pot template.

    Args:
        output_path: Path for the output .pot file.
        input_dir: Directory containing JSON data files.
    """
    print(f"Scanning directory: {input_dir}\n", flush=True)

    json_files = discover_json_files(input_dir)
    if not json_files:
        print("No JSON files found to process.", flush=True)
        return

    print(f"Found {len(json_files)} JSON files to process:", flush=True)
    for json_file in json_files:
        print(f"  - {json_file.name}", flush=True)
    print(flush=True)

    all_strings: set[str] = set()
    for json_path in json_files:
        count = process_json_file(json_path, all_strings)
        print(f"  {json_path.name}: {count} new strings", flush=True)
    print(flush=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    total = generate_pot_file(output_path, all_strings, json_files)
    print(f"Generated '{output_path}' with {total} unique translatable strings.", flush=True)

# --- Main Entry Point ---

def main() -> None:
    if len(sys.argv) == 4:
        mode = sys.argv[1].lower()
        output_file = Path(sys.argv[2])
        input_dir = Path(sys.argv[3])
    elif len(sys.argv) == 3:
        output_file = Path(sys.argv[1])
        input_dir = Path(sys.argv[2])
        mode = "data" if "content" in output_file.name else "ui"
    else:
        print(f"Usage: {sys.argv[0]} [ui | data] <output_file.pot> <input_dir>")
        print(f"Example: {sys.argv[0]} ui gnome-extensions/translation/all-in-one-clipboard.pot gnome-extensions/extension")
        print(f"Example: {sys.argv[0]} data gnome-extensions/translation/all-in-one-clipboard-content.pot gnome-extensions/extension/assets/data")
        sys.exit(1)

    if not input_dir.exists():
        print(f"Error: Input directory '{input_dir}' does not exist.", file=sys.stderr)
        sys.exit(1)

    if not input_dir.is_dir():
        print(f"Error: '{input_dir}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    if mode == "ui":
        extract_ui_strings(output_file, input_dir)
    elif mode == "data":
        extract_data_strings(output_file, input_dir)
    else:
        print(f"Error: Unknown extraction mode '{mode}'. Use 'ui' or 'data'.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
