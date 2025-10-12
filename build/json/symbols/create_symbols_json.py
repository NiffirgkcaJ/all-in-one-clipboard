import json
import os
import re

# --- Configuration ---

# The order of this list now determines the final order of the categories in the JSON file.
# This has been updated to match your specified sequence.
SOURCE_FILES = [
    '[Microsoft] General Punctuation.txt',
    '[Microsoft] Currency Symbols.txt',
    '[Microsoft] Latin Symbols.txt',
    '[Microsoft] Geometric Symbols.txt',
    '[Microsoft] Math Symbols.txt',
    '[Microsoft] Supplemental Symbols.txt',
    '[Microsoft] Language Symbols.txt',
]

# The name of the output JSON file.
OUTPUT_JSON_FILE = 'unicode_symbols.json'


def clean_category_name(filename):
    """Creates a clean category name from a filename."""
    name = re.sub(r'\[Microsoft\]\s*', '', filename)
    name = name.replace('.txt', '')
    return name.strip()

def read_symbols_from_file(filepath):
    """Reads all characters from a file, treating each as a potential symbol."""
    if not os.path.exists(filepath):
        print(f"Warning: Source file '{filepath}' not found. Skipping.")
        return []

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        return [char for char in content if not char.isspace()]

def save_json_data(data, filepath):
    """Saves the final data structure to a new JSON file."""
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"\nSuccessfully created the symbol library: '{filepath}'")

def main():
    """Main function to build the symbols JSON."""
    final_data = []

    print("Starting to build Unicode symbol library...")

    # The script will now process files in the exact order defined in SOURCE_FILES.
    for filename in SOURCE_FILES:
        category_name = clean_category_name(filename)
        symbols = read_symbols_from_file(filename)

        if not symbols:
            continue

        print(f"Processing '{category_name}'...")

        # 1. Deduplicate the symbols.
        unique_symbols = set(symbols)

        # 2. Sort the symbols WITHIN this category by their Unicode code point value.
        sorted_symbols = sorted(list(unique_symbols), key=ord)

        # 3. Create the JSON object for this category.
        category_object = {
            "name": category_name,
            "symbols": sorted_symbols
        }

        # 4. Append the object to the list. The order is preserved.
        final_data.append(category_object)

    # The line that previously sorted 'final_data' alphabetically has been removed
    # to preserve the custom order from the SOURCE_FILES list.

    save_json_data(final_data, OUTPUT_JSON_FILE)

if __name__ == '__main__':
    main()