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
import tempfile

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

def write_pot_file(output_path: Path, strings: set[str], source_files: list[Path]) -> int:
    """
    Generates the POT template file with extracted content strings.

    Args:
        output_path: Path for the output POT file.
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

def discover_json_files(input_dir: Path) -> list[Path]:
    """
    Auto-discovers structured JSON data files in the input directory.

    Args:
        input_dir: Path to the directory to scan.

    Returns:
        List of Path objects for discovered JSON data files.
    """
    data_dir = input_dir / "assets" / "data" if (input_dir / "assets" / "data").is_dir() else input_dir
    json_files: list[Path] = []

    for current_dir, directories, filenames in os.walk(data_dir, topdown=True):
        # Prune excluded directories before descending.
        for directory in list(directories):
            if directory in SKIP_DIRS:
                directories.remove(directory)

        # Filter and collect JSON files.
        for filename in sorted(filenames):
            if not filename.endswith('.json'):
                continue

            if filename in SKIP_FILES:
                continue

            json_files.append(Path(current_dir) / filename)

    json_files.sort()
    return json_files

def extract_json_categories(json_files: list[Path]) -> list[tuple[str, list[str]]]:
    """
    Extracts category tab names from structured JSON data files.

    Args:
        json_files: List of paths to target JSON files.

    Returns:
        List of tuples pairing category name with its associated source file references.
    """
    ordered_categories: dict[str, list[str]] = {}

    for json_path in json_files:
        try:
            with open(json_path, 'r', encoding='utf-8') as json_file:
                data = json.load(json_file)

            entries = data.get('data') if isinstance(data, dict) else data
            if not isinstance(entries, list):
                continue

            file_ref = str(json_path)
            for entry in entries:
                if isinstance(entry, dict) and 'name' in entry:
                    name = entry['name']
                    if isinstance(name, str) and name.strip():
                        # Category containers define a nested collection of child items or subcategories.
                        has_nested = any(
                            isinstance(value, list) and len(value) > 0
                            for key, value in entry.items()
                            if key not in {'keywords', 'name', 'slug', 'description'}
                        )
                        if has_nested:
                            category_name = name.strip()
                            if category_name not in ordered_categories:
                                ordered_categories[category_name] = []
                            if file_ref not in ordered_categories[category_name]:
                                ordered_categories[category_name].append(file_ref)

        except json.JSONDecodeError as error:
            print(f"  Error: Invalid JSON in '{json_path.name}': {error}", file=sys.stderr)
        except Exception as error:
            print(f"  Error processing '{json_path.name}': {error}", file=sys.stderr)

    return list(ordered_categories.items())

def extract_json_content(json_files: list[Path]) -> tuple[set[str], dict[Path, int]]:
    """
    Extracts translatable content strings across all discovered JSON data files.

    Args:
        json_files: List of paths to target JSON files.

    Returns:
        Tuple containing the set of content strings and a mapping of file paths to new string counts.
    """
    content_strings: set[str] = set()
    file_counts: dict[Path, int] = {}

    def walk_content_nodes(obj: object) -> None:
        """
        Recursively extracts translatable content values from a JSON structure.

        Args:
            obj: JSON object, dictionary, list, or primitive.
        """
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key in TRANSLATABLE_KEYS:
                    if isinstance(value, str) and value.strip():
                        content_strings.add(value.strip())
                    elif isinstance(value, list):
                        for item in value:
                            if isinstance(item, str) and item.strip():
                                content_strings.add(item.strip())
                else:
                    walk_content_nodes(value)
        elif isinstance(obj, list):
            for item in obj:
                walk_content_nodes(item)

    for json_path in json_files:
        initial_count = len(content_strings)
        try:
            with open(json_path, 'r', encoding='utf-8') as json_file:
                data = json.load(json_file)

            entries = data.get('data') if isinstance(data, dict) else data
            if isinstance(entries, (list, dict)):
                walk_content_nodes(entries)

            file_counts[json_path] = len(content_strings) - initial_count

        except json.JSONDecodeError as error:
            print(f"  Error: Invalid JSON in '{json_path.name}': {error}", file=sys.stderr)
            file_counts[json_path] = 0
        except Exception as error:
            print(f"  Error processing '{json_path.name}': {error}", file=sys.stderr)
            file_counts[json_path] = 0

    return content_strings, file_counts

# --- Core Processing ---

def extract_ui_strings(output_path: Path, input_dir: Path) -> None:
    """
    Extracts translatable strings from JavaScript source files and JSON categories into a POT template.

    Args:
        output_path: Path for the output POT file.
        input_dir: Directory containing JavaScript source files and asset data.
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

    # Extract JSON category tab names.
    json_files = discover_json_files(input_dir)
    categories = extract_json_categories(json_files)
    print(f"Found {len(categories)} category strings across data files.", flush=True)

    cat_entries: list[str] = []
    for name, refs in categories:
        source_comment = " ".join(refs)
        cat_entries.append(f'#: {source_comment}\nmsgid "{escape_string(name)}"\nmsgstr ""\n')

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if cat_entries:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".pot") as js_pot, \
             tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".pot") as cat_pot:
            js_pot.write(header + res.stdout)
            js_pot.flush()
            cat_pot.write(header + "\n".join(cat_entries) + "\n")
            cat_pot.flush()

            merge_res = subprocess.run(
                ["msgcat", "--no-wrap", js_pot.name, cat_pot.name],
                capture_output=True,
                text=True,
                check=True,
            )
            output_path.write_text(merge_res.stdout, encoding="utf-8")
    else:
        with open(output_path, "w", encoding="utf-8") as pot_file:
            pot_file.write(header)
            pot_file.write(res.stdout)

    print(f"Generated '{output_path}' with UI translatable strings.", flush=True)

def extract_data_strings(output_path: Path, input_dir: Path) -> None:
    """
    Extracts translatable strings from JSON data files into a POT template.

    Args:
        output_path: Path for the output POT file.
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

    content_strings, file_counts = extract_json_content(json_files)
    for json_path, count in file_counts.items():
        print(f"  {json_path.name}: {count} new strings", flush=True)
    print(flush=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    total = write_pot_file(output_path, content_strings, json_files)
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
