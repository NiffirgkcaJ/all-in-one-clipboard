#!/usr/bin/env python3
"""
Extract translatable strings from JSON data files for gettext.

This script recursively scans JSON files for translatable string fields
and generates a .pot file for translation.

Usage:
    python extract-data-strings.py <output_file.pot> <input_dir>

Example:
    python extract-data-strings.py gnome-extensions/translation/data-content.pot gnome-extensions/extension/assets/data/json
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timezone

# --- Configuration ---
# Keys whose string values should be extracted for translation
TRANSLATABLE_KEYS = frozenset({
    'name',
    'description',
    'keywords',
})

# Files to skip for non-translatable content
SKIP_FILES = frozenset({
    'countries.json',      # Country codes, not user-facing
    'emojisModifier.json', # Skin tone modifiers, not user-facing text
})

# Template for the header of the .pot file
POT_HEADER_TEMPLATE = r'''# Translation template for All-in-One Clipboard data content.
# Copyright (C) 2025 NiffirgkcaJ
# This file is distributed under the same license as the All-in-One Clipboard package.
#
#, fuzzy
msgid ""
msgstr ""
"Project-Id-Version: all-in-one-clipboard\n"
"Report-Msgid-Bugs-To: \n"
"POT-Creation-Date: {creation_date}\n"
"PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE\n"
"Last-Translator: FULL NAME <EMAIL@ADDRESS>\n"
"Language-Team: LANGUAGE <LL@li.org>\n"
"Language: \n"
"MIME-Version: 1.0\n"
"Content-Type: text/plain; charset=UTF-8\n"
"Content-Transfer-Encoding: 8bit\n"

'''

# --- Extraction Logic ---
# Escapes quotes and backslashes for POT format
def escape_string(s):
    """Escapes quotes and backslashes for POT format."""
    return s.replace('\\', '\\\\').replace('"', '\\"')

# Recursively extracts translatable strings from any JSON structure
def extract_strings_recursive(obj, string_set):
    """
    Recursively extracts translatable strings from any JSON structure.
    
    Looks for keys defined in TRANSLATABLE_KEYS and extracts their string values.
    Handles both direct string values and arrays of strings (like keywords).
    
    Args:
        obj: The JSON object (dict, list, or primitive) to process
        string_set: Set to accumulate extracted strings
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
                # Recurse into nested structures
                extract_strings_recursive(value, string_set)
    elif isinstance(obj, list):
        for item in obj:
            extract_strings_recursive(item, string_set)

# Processes a single JSON file and extracts translatable strings
def process_json_file(json_path, string_set):
    """
    Processes a single JSON file and extracts translatable strings.
    
    Args:
        json_path: Path to the JSON file
        string_set: Set to accumulate extracted strings
        
    Returns:
        Number of strings extracted from this file
    """
    initial_count = len(string_set)
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        # Handle both wrapped ({"data": [...]}) and unwrapped ([...]) formats
        if isinstance(data, dict) and 'data' in data:
            data = data['data']
            
        extract_strings_recursive(data, string_set)
        
        extracted = len(string_set) - initial_count
        return extracted
        
    except json.JSONDecodeError as e:
        print(f"  Error: Invalid JSON in '{json_path.name}': {e}")
        return 0
    except Exception as e:
        print(f"  Error processing '{json_path.name}': {e}")
        return 0

# Auto-discovers all JSON files in the input directory
def discover_json_files(input_dir):
    """
    Auto-discovers all JSON files in the input directory.
    
    Args:
        input_dir: Path to the directory to scan
        
    Returns:
        List of Path objects for discovered JSON files
    """
    json_files = []
    
    for json_path in sorted(input_dir.glob('*.json')):
        if json_path.name in SKIP_FILES:
            print(f"  Skipping: {json_path.name} (in skip list)")
            continue
        json_files.append(json_path)
        
    return json_files

# Generates the .pot file with extracted strings
def generate_pot_file(output_path, strings, source_files):
    """
    Generates the .pot file with extracted strings.
    
    Args:
        output_path: Path for the output .pot file
        strings: Set of strings to include
        source_files: List of source file paths for comments
    """
    # Remove empty strings and sort
    strings.discard('')
    sorted_strings = sorted(strings)
    
    # Generate source comment
    source_comment = ', '.join(f.name for f in source_files)
    
    creation_date = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M+0000')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(POT_HEADER_TEMPLATE.format(creation_date=creation_date))
        
        for s in sorted_strings:
            f.write(f'#: {source_comment}\n')
            f.write(f'msgid "{escape_string(s)}"\n')
            f.write('msgstr ""\n\n')
    
    return len(sorted_strings)


# --- Main Entry Point ---
# Main function
def main():
    if len(sys.argv) != 3:
        print("Usage: python extract-data-strings.py <output_file.pot> <input_dir>")
        print("Example: python extract-data-strings.py gnome-extensions/translation/data-content.pot gnome-extensions/extension/assets/data/json")
        sys.exit(1)

    output_file = Path(sys.argv[1])
    input_dir = Path(sys.argv[2])

    if not input_dir.exists():
        print(f"Error: Input directory '{input_dir}' does not exist.")
        sys.exit(1)

    if not input_dir.is_dir():
        print(f"Error: '{input_dir}' is not a directory.")
        sys.exit(1)

    print(f"Scanning directory: {input_dir}")
    print()
    
    # Auto-discover JSON files
    json_files = discover_json_files(input_dir)
    
    if not json_files:
        print("No JSON files found to process.")
        sys.exit(0)
    
    print(f"Found {len(json_files)} JSON file(s) to process:")
    for f in json_files:
        print(f"  - {f.name}")
    print()
    
    # Extract strings from all files
    all_strings = set()
    
    for json_path in json_files:
        count = process_json_file(json_path, all_strings)
        print(f"  {json_path.name}: {count} new strings")
    
    print()
    
    # Generate output
    output_file.parent.mkdir(parents=True, exist_ok=True)
    total = generate_pot_file(output_file, all_strings, json_files)
    
    print(f"Generated '{output_file}' with {total} unique translatable strings.")

# Entry point
if __name__ == '__main__':
    main()