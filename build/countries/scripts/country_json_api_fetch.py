import json
import urllib.request
import os
import re

# =================CONFIGURATION =================
# Define paths relative to this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXTENSION_ROOT = os.path.abspath(os.path.join(BASE_DIR, "../../../extension"))

# Input/Output paths
API_URL = "https://restcountries.com/v3.1/all?fields=name,cca2,idd,flags"
JSON_OUTPUT_DIR = os.path.join(EXTENSION_ROOT, "assets/data/json")
JSON_FILENAME = "countries.json"
SVG_OUTPUT_DIR = os.path.join(EXTENSION_ROOT, "assets/data/svg")
XML_FILE_PATH = os.path.join(EXTENSION_ROOT, "all-in-one-clipboard.gresource.xml")

# ================= LOGIC =================

def fetch_api_data():
    print(f"Fetching data from {API_URL}...")
    headers = {'User-Agent': 'Mozilla/5.0'}
    req = urllib.request.Request(API_URL, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            if response.status != 200:
                print(f"Error: Received status code {response.status}")
                return None
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching data: {e}")
        return None

def get_gresource_prefix(xml_path):
    """
    Reads the XML file to find the <gresource prefix="..."> attribute.
    Defaults to a standard path if not found.
    """
    default_prefix = "/org/gnome/shell/extensions/all-in-one-clipboard"
    if not os.path.exists(xml_path):
        print(f"Warning: XML file not found at {xml_path}. Using default prefix.")
        return default_prefix

    try:
        with open(xml_path, 'r', encoding='utf-8') as f:
            content = f.read()
            match = re.search(r'<gresource\s+prefix="([^"]+)"', content)
            if match:
                return match.group(1)
    except Exception as e:
        print(f"Error reading XML prefix: {e}")

    return default_prefix

def download_svg(url, cca2):
    """Downloads the SVG and saves it locally."""
    if not url or not url.endswith('.svg'):
        return None

    filename = f"{cca2.lower()}.svg"
    filepath = os.path.join(SVG_OUTPUT_DIR, filename)

    # Don't re-download if it exists (optional, removed for fresh sync)
    # if os.path.exists(filepath): return filename

    try:
        urllib.request.urlretrieve(url, filepath)
        return filename
    except Exception as e:
        print(f"Failed to download flag for {cca2}: {e}")
        return None

def get_flag_emoji(country_code):
    if not country_code or len(country_code) != 2: return None
    try:
        OFFSET = 127397
        code = country_code.upper()
        if not code.isalpha(): return None
        return chr(ord(code[0]) + OFFSET) + chr(ord(code[1]) + OFFSET)
    except: return None

def format_dial_code(root, suffixes, cca2):
    if not root: return None
    # North America
    if root == "+1":
        if cca2 in ["US", "CA"]: return "+1"
        if suffixes: return f"{root}{suffixes[0]}"
    # Russia/Kazakhstan
    if root == "+7":
        if cca2 in ["RU", "KZ"]: return "+7"
    # Standard
    suffix = suffixes[0] if suffixes else ""
    return f"{root}{suffix}"

def update_gresource_xml(svg_files):
    """
    Updates the .gresource.xml file to include the new SVGs.
    It removes old flag references and adds new ones.
    """
    if not os.path.exists(XML_FILE_PATH):
        print("Error: GResource XML file not found.")
        return

    print("Updating GResource XML...")

    with open(XML_FILE_PATH, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    in_gresource = False

    # We will filter out old SVG flag lines to avoid duplicates/stale files
    svg_rel_path = "assets/data/svg/"

    for line in lines:
        # If the line contains a reference to the flags folder, skip it (we will regenerate them)
        if svg_rel_path in line and "<file>" in line:
            continue

        # Check for the closing tag of gresource to insert our files before it
        if "</gresource>" in line:
            # Calculate the indentation of the closing tag itself
            closing_tag_indent = line[:len(line) - len(line.lstrip())]

            # Add one level of indentation (e.g., 4 spaces) to that
            file_indent = closing_tag_indent + "    " 

            for filename in sorted(svg_files):
                new_lines.append(f"{file_indent}<file>{svg_rel_path}{filename}</file>\n")
            new_lines.append(line)
        else:
            new_lines.append(line)

    with open(XML_FILE_PATH, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

    print("XML updated successfully.")

def main():
    # 1. Setup Directories
    os.makedirs(JSON_OUTPUT_DIR, exist_ok=True)
    os.makedirs(SVG_OUTPUT_DIR, exist_ok=True)

    # 2. Get Data & Prefix
    data = fetch_api_data()
    if not data: return

    resource_prefix = get_gresource_prefix(XML_FILE_PATH)
    print(f"Using GResource prefix: {resource_prefix}")

    processed_list = []
    downloaded_svgs = []

    print("Processing countries and downloading flags...")

    # Sort for clean JSON
    data.sort(key=lambda x: x.get('name', {}).get('common', ''))

    for country in data:
        cca2 = country.get('cca2', '')
        name = country.get('name', {}).get('common', 'Unknown')

        # Dial Code
        idd = country.get('idd', {})
        dial_code = format_dial_code(idd.get('root', ''), idd.get('suffixes', []), cca2)
        if not dial_code: continue

        # Download SVG
        flags = country.get('flags', {})
        svg_url = flags.get('svg', '')
        filename = download_svg(svg_url, cca2)

        flag_resource_path = ""
        if filename:
            downloaded_svgs.append(filename)
            # Construct the resource:// string
            flag_resource_path = f"resource://{resource_prefix}/assets/data/svg/{filename}"

        item = {
            "name": name,
            "code": cca2,
            "dial_code": dial_code,
            "emoji": get_flag_emoji(cca2) or "",
            "flag_path": flag_resource_path
        }
        processed_list.append(item)

    # 3. Save JSON
    json_path = os.path.join(JSON_OUTPUT_DIR, JSON_FILENAME)
    print(f"Saving JSON to {json_path}...")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(processed_list, f, ensure_ascii=False, indent=2)

    # 4. Update XML
    if downloaded_svgs:
        update_gresource_xml(downloaded_svgs)

    print("Done! All systems go.")

if __name__ == "__main__":
    main()