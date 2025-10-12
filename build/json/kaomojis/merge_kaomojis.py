import json
import os
from collections import OrderedDict

# --- Configuration ---

# The original JSON file to be expanded
BASE_JSON_FILE = 'kaomojis.json'

# The name of the new, merged JSON file that will be created
OUTPUT_JSON_FILE = 'kaomojis_expanded.json'

# This mapping defines the integration plan.
# It tells the script which text files belong to which category.
MAPPING = [
    {
        'sources': ['[Microsoft] Happy.txt', '[Google] Smiling.txt'],
        'main_category': 'Positive',
        'sub_category': 'Joy'
    },
    {
        'sources': ['[Google] Love.txt'],
        'main_category': 'Positive',
        'sub_category': 'Love'
    },
    {
        'sources': ['[Microsoft] Acting Cute.txt'],
        'main_category': 'Positive',
        'sub_category': 'Cute' # New sub-category
    },
    {
        'sources': ['[Microsoft] Sad.txt', '[Google] Crying.txt'],
        'main_category': 'Negative',
        'sub_category': 'Sadness'
    },
    {
        'sources': ['[Microsoft] Angry.txt'],
        'main_category': 'Negative',
        'sub_category': 'Anger'
    },
    {
        'sources': ['[Google] Look of Disapproval.txt'],
        'main_category': 'Negative',
        'sub_category': 'Dissatisfaction'
    },
    {
        'sources': ['[Google] Nervous.txt'],
        'main_category': 'Negative',
        'sub_category': 'Fear'
    },
    {
        'sources': ['[Google] Shruggie.txt'],
        'main_category': 'Neutral',
        'sub_category': 'Indifference'
    },
    {
        'sources': ['[Microsoft] Surprised_Speechless.txt', '[Google] Surprise.txt'],
        'main_category': 'Neutral',
        'sub_category': 'Surprise'
    },
    {
        'sources': ['[Microsoft] Greeting.txt'],
        'main_category': 'Various',
        'sub_category': 'Greeting'
    },
    {
        'sources': ['[Google] Hugging.txt'],
        'main_category': 'Various',
        'sub_category': 'Hugging'
    },
    {
        'sources': ['[Google] Table Flip.txt'],
        'main_category': 'Various',
        'sub_category': 'Table Flipping' # New sub-category
    },
    {
        'sources': ['[Google] Dancing.txt'],
        'main_category': 'Various',
        'sub_category': 'Dancing' # New sub-category
    },
    {
        'sources': ['[Google] Flexing.txt'],
        'main_category': 'Various',
        'sub_category': 'Flexing' # New sub-category
    },
    {
        'sources': ['[Google] Pointers.txt'],
        'main_category': 'Various',
        'sub_category': 'Pointing' # New sub-category
    },
    {
        'sources': ['[Google] Animals.txt'],
        'main_category': 'Animals',
        'sub_category': 'General' # New sub-category
    },
    {
        'sources': ['[Microsoft] Classic ASCII Emoticons.txt', '[Google] Classic.txt'],
        'main_category': 'Other',
        'sub_category': 'Classic' # New sub-category
    }
]

def load_json_data(filepath):
    """Loads the initial JSON data from the base file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: The base file '{filepath}' was not found.")
        print("Please make sure it's in the same directory as the script.")
        exit()
    except json.JSONDecodeError:
        print(f"Error: The file '{filepath}' is not a valid JSON file.")
        exit()

def read_kaomojis_from_file(filepath):
    """Reads all lines from a text file and returns them as a list."""
    if not os.path.exists(filepath):
        print(f"Warning: Source file '{filepath}' not found. Skipping.")
        return []
    with open(filepath, 'r', encoding='utf-8') as f:
        # Read each line, strip whitespace, and filter out empty lines
        return [line.strip() for line in f if line.strip()]

def save_json_data(data, filepath):
    """Saves the final data structure to a new JSON file."""
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"\nSuccessfully created the expanded file: '{filepath}'")

def main():
    """Main function to run the merging process."""
    kaomoji_data = load_json_data(BASE_JSON_FILE)

    print("Starting the merge process...")

    # A set to keep track of all kaomojis added to avoid duplicates across categories
    master_set = set()
    # Pre-populate with existing kaomojis
    for main_cat in kaomoji_data:
        for sub_cat in main_cat.get('categories', []):
            master_set.update(sub_cat.get('emoticons', []))

    for rule in MAPPING:
        main_cat_name = rule['main_category']
        sub_cat_name = rule['sub_category']

        # Collect all new kaomojis from the source files for this rule
        new_kaomojis_from_files = []
        for source_file in rule['sources']:
            new_kaomojis_from_files.extend(read_kaomojis_from_file(source_file))

        if not new_kaomojis_from_files:
            continue

        # Find the main category object in our data structure
        main_cat_obj = next((cat for cat in kaomoji_data if cat['name'] == main_cat_name), None)
        if not main_cat_obj:
            print(f"Error: Main category '{main_cat_name}' not found in base JSON. Check mapping.")
            continue

        # Find the sub-category object
        sub_cat_obj = next((scat for scat in main_cat_obj['categories'] if scat['name'] == sub_cat_name), None)

        # If the sub-category doesn't exist, create it
        if sub_cat_obj is None:
            print(f"Creating new sub-category: '{sub_cat_name}' under '{main_cat_name}'")
            sub_cat_obj = {'name': sub_cat_name, 'emoticons': []}
            main_cat_obj['categories'].append(sub_cat_obj)

        # --- Merge and Deduplicate ---
        existing_emoticons = set(sub_cat_obj['emoticons'])

        # Filter out any kaomojis that are already in ANY category
        unique_new_kaomojis = {k for k in new_kaomojis_from_files if k not in master_set}

        # Combine, sort, and update
        combined_set = existing_emoticons.union(unique_new_kaomojis)
        sub_cat_obj['emoticons'] = sorted(list(combined_set))

        # Add the newly added kaomojis to the master set
        master_set.update(unique_new_kaomojis)

    save_json_data(kaomoji_data, OUTPUT_JSON_FILE)


if __name__ == '__main__':
    main()