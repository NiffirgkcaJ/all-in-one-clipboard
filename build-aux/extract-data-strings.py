#!/usr/bin/env python3

import json
import sys
from pathlib import Path

# --- Configuration ---
POT_HEADER = r'''# Translation template for All-in-One Clipboard data content.
# Copyright (C) 2025 YOUR NAME
# This file is distributed under the same license as the All-in-One Clipboard package.
#
#, fuzzy
msgid ""
msgstr ""
"Project-Id-Version: all-in-one-clipboard\n"
"Report-Msgid-Bugs-To: \n"
"POT-Creation-Date: 2025-10-26 10:00+0000\n"
"PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE\n"
"Last-Translator: FULL NAME <EMAIL@ADDRESS>\n"
"Language-Team: LANGUAGE <LL@li.org>\n"
"Language: \n"
"MIME-Version: 1.0\n"
"Content-Type: text/plain; charset=UTF-8\n"
"Content-Transfer-Encoding: 8bit\n"

'''

# --- Main Logic ---
def escape_string(s):
    """Escapes quotes and backslashes for POT format."""
    return s.replace('\\', '\\\\').replace('"', '\\"')

def extract_emoji_strings(data_array, string_set):
    """Extracts all translatable strings from the emojis data structure."""
    for category in data_array:
        string_set.add(category.get('name', ''))
        for emoji in category.get('emojis', []):
            string_set.add(emoji.get('name', ''))
            for keyword in emoji.get('keywords', []):
                string_set.add(keyword)

def extract_kaomoji_strings(data_array, string_set):
    """Extracts all translatable strings from the kaomojis data structure."""
    for greater_category in data_array:
        string_set.add(greater_category.get('name', ''))
        for inner_category in greater_category.get('categories', []):
            string_set.add(inner_category.get('name', ''))
            for emoticon in inner_category.get('emoticons', []):
                string_set.add(emoticon.get('description', ''))
                for keyword in emoticon.get('keywords', []):
                    string_set.add(keyword)

def extract_symbol_strings(data_array, string_set):
    """Extracts all translatable strings from the symbols data structure."""
    for category in data_array:
        string_set.add(category.get('name', ''))
        for symbol in category.get('symbols', []):
            string_set.add(symbol.get('name', ''))

# --- Main Logic ---
def main():
    if len(sys.argv) != 3:
        print("Usage: python extract-data-strings.py <output_file.pot> <input_dir>")
        sys.exit(1)

    output_file = Path(sys.argv[1])
    input_dir = Path(sys.argv[2])

    translatable_strings = set()

    # A map to link filenames to their specific extraction function.
    file_processors = {
        "emojis.json": extract_emoji_strings,
        "kaomojis.json": extract_kaomoji_strings,
        "symbols.json": extract_symbol_strings
    }

    # Process each configured JSON file.
    for filename, processor_func in file_processors.items():
        json_file_path = input_dir / filename
        if not json_file_path.exists():
            print(f"Warning: '{json_file_path}' not found, skipping.")
            continue

        try:
            with open(json_file_path, 'r', encoding='utf-8') as f:
                # Load the whole object, then pass the '.data' part to the processor.
                full_data_object = json.load(f)
                data_array = full_data_object.get('data')

                if data_array is None:
                    print(f"Error: Could not find 'data' key in '{json_file_path}'. Is the file finalized?")
                    continue

                # Call the correct function for this file type.
                processor_func(data_array, translatable_strings)
        except (json.JSONDecodeError, Exception) as e:
            print(f"Error processing '{json_file_path}': {e}")

    # Write to the .pot file.
    translatable_strings.discard('')

    sorted_strings = sorted(list(translatable_strings))
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(POT_HEADER)
        for s in sorted_strings:
            f.write('#: extension/assets/data/*.json\n')
            f.write(f'msgid "{escape_string(s)}"\n')
            f.write('msgstr ""\n\n')

    print(f"Generated {output_file} with {len(sorted_strings)} unique strings.")

if __name__ == '__main__':
    main()