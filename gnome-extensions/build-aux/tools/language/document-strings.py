#!/usr/bin/env python3
"""
Document supported languages in README.md from gettext PO catalogs.

Scans the translation directory, extracts language names dynamically from PO headers with system ISO database fallback, and updates the README.md section.

Usage:
    python3 document-strings.py [readme_path] [translation_dir]

Example:
    python3 document-strings.py README.md gnome-extensions/translation
"""

import json
from pathlib import Path
import re
import sys
from typing import Optional

# --- Configuration ---

START_MARKER = "<!-- supported-languages:start -->"
END_MARKER = "<!-- supported-languages:end -->"
DEFAULT_SOURCE_LANGUAGE = "English"

# --- Helper Functions ---

def to_title_case(name: str) -> str:
    """
    Capitalizes initial letters of words even inside brackets.

    Args:
        name: Raw language name string.

    Returns:
        Title-cased language name.
    """
    return re.sub(r"\b[a-z]", lambda match: match.group(0).upper(), name.strip())

def load_iso_languages() -> dict[str, str]:
    """
    Loads ISO 639-2 language mappings from the system database when available.

    Returns:
        Mapping from ISO language codes to English language names.
    """
    iso_path = Path("/usr/share/iso-codes/json/iso_639-2.json")
    if not iso_path.is_file():
        return {}

    try:
        data = json.loads(iso_path.read_text(encoding="utf-8"))
        entries = data.get("639-2", [])
        code_map: dict[str, str] = {}
        for item in entries:
            name = item.get("name", "")
            if not name:
                continue
            clean_name = name.split(";")[0].strip()
            if "alpha_2" in item:
                code_map[item["alpha_2"].lower()] = clean_name
            if "alpha_3" in item:
                code_map[item["alpha_3"].lower()] = clean_name
        return code_map
    except Exception:
        return {}

def load_iso_territories() -> dict[str, str]:
    """
    Loads ISO 3166-1 territory mappings from the system database when available.

    Returns:
        Mapping from ISO territory codes to English territory names.
    """
    iso_path = Path("/usr/share/iso-codes/json/iso_3166-1.json")
    if not iso_path.is_file():
        return {}

    try:
        data = json.loads(iso_path.read_text(encoding="utf-8"))
        entries = data.get("3166-1", [])
        territory_map: dict[str, str] = {}
        for item in entries:
            name = item.get("common_name", item.get("name", "")).strip()
            if not name:
                continue
            if "alpha_2" in item:
                territory_map[item["alpha_2"].upper()] = name
            if "alpha_3" in item:
                territory_map[item["alpha_3"].upper()] = name
        return territory_map
    except Exception:
        return {}

def has_translated_messages(po_path: Path) -> bool:
    """
    Checks whether the catalog contains at least one translated string.

    Args:
        po_path: Path to the target PO file.

    Returns:
        True when at least one non-header string is translated, False otherwise.
    """
    content = po_path.read_text(encoding="utf-8")
    blocks = re.split(r"\n(?=msgid )", content)
    for block in blocks:
        id_match = re.search(r'msgid\s+(".*?"(?:\s+".*?")*)', block, re.DOTALL)
        str_match = re.search(r'msgstr\s+(".*?"(?:\s+".*?")*)', block, re.DOTALL)
        if id_match and str_match:
            clean_id = id_match.group(1).replace('"\n"', "").replace('"', "").replace("\n", "")
            clean_str = str_match.group(1).replace('"\n"', "").replace('"', "").replace("\n", "")
            if clean_id and clean_str:
                return True
    return False

def extract_language_name(
    po_path: Path,
    iso_languages: dict[str, str],
    iso_territories: dict[str, str],
) -> Optional[str]:
    """
    Extracts the display language name from a PO file header or fallback lookup.

    Args:
        po_path: Path to the target PO file.
        iso_languages: Mapping of ISO codes to English language names.
        iso_territories: Mapping of ISO codes to English territory names.

    Returns:
        Resolved language name, or None when resolution fails.
    """
    content = po_path.read_text(encoding="utf-8")

    # Inspect Language-Team header.
    team_match = re.search(r'^"Language-Team:\s*([^<"\n\r]+?)(?:\s*<|\s*\\n|")', content, re.MULTILINE)
    if team_match:
        team_name = team_match.group(1).strip()
        if team_name and team_name.lower() not in {"none", "language"}:
            return to_title_case(team_name)

    # Inspect Language header.
    lang_match = re.search(r'^"Language:\s*([^"\n\r]+?)(?:\\n|")', content, re.MULTILINE)
    lang_code = lang_match.group(1).strip() if lang_match else ""

    # Derive code from filename when missing in headers.
    if not lang_code:
        file_stem = po_path.stem
        if "@" in file_stem:
            lang_code = file_stem.split("@")[-1]

    if not lang_code:
        return None

    # Parse locale tag into base language and optional territory.
    parts = lang_code.replace("-", "_").split("_")
    base_code = parts[0].lower()
    territory_code = parts[1].upper() if len(parts) > 1 else ""

    lang_name = iso_languages.get(base_code, to_title_case(base_code))

    # Resolve territory when present.
    if territory_code and territory_code in iso_territories:
        return f"{lang_name} ({iso_territories[territory_code]})"

    if territory_code:
        return f"{lang_name} ({territory_code})"

    return lang_name

# --- Core Processing ---

def collect_supported_languages(translation_dir: Path) -> list[str]:
    """
    Collects and sorts all supported language names from PO files.

    Args:
        translation_dir: Directory containing translation PO files.

    Returns:
        Sorted list of unique supported language names.
    """
    iso_languages = load_iso_languages()
    iso_territories = load_iso_territories()
    languages = {DEFAULT_SOURCE_LANGUAGE}

    for po_file in translation_dir.glob("all-in-one-clipboard@*.po"):
        if not has_translated_messages(po_file):
            continue
        lang_name = extract_language_name(po_file, iso_languages, iso_territories)
        if lang_name:
            languages.add(lang_name)

    return sorted(languages)

def update_readme_supported_languages(readme_path: Path, languages: list[str]) -> bool:
    """
    Updates the Supported Languages section in the target README file.

    Args:
        readme_path: Path to README.md file.
        languages: Sorted list of supported language names.

    Returns:
        True when the file was modified, False otherwise.
    """
    readme_text = readme_path.read_text(encoding="utf-8")
    list_items = "\n".join(f"*   {lang}" for lang in languages)
    replacement_block = f"{START_MARKER}\n{list_items}\n{END_MARKER}"

    if START_MARKER in readme_text and END_MARKER in readme_text:
        pattern = re.compile(
            re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER),
            re.DOTALL,
        )
        new_text = pattern.sub(replacement_block, readme_text)
    else:
        # Match Supported Languages header and following bullet list.
        pattern = re.compile(
            r"(\*\*Supported Languages:\*\*\n)(?:\s*\*.*?\n)+",
            re.MULTILINE,
        )
        if pattern.search(readme_text):
            new_text = pattern.sub(rf"\1{replacement_block}\n", readme_text)
        else:
            print(f"Error: Could not locate Supported Languages section in '{readme_path}'.", file=sys.stderr)
            return False

    if new_text != readme_text:
        readme_path.write_text(new_text, encoding="utf-8")
        print(f"Updated '{readme_path}' with {len(languages)} supported languages.", flush=True)
        return True

    print(f"'{readme_path}' is already up-to-date.", flush=True)
    return False

# --- Main Entry Point ---

def main() -> None:
    readme_arg = sys.argv[1] if len(sys.argv) > 1 else "README.md"
    trans_arg = sys.argv[2] if len(sys.argv) > 2 else "gnome-extensions/translation"

    readme_path = Path(readme_arg)
    trans_dir = Path(trans_arg)

    if not readme_path.is_file():
        print(f"Error: README file '{readme_path}' not found.", file=sys.stderr)
        sys.exit(1)

    if not trans_dir.is_dir():
        print(f"Error: Translation directory '{trans_dir}' not found.", file=sys.stderr)
        sys.exit(1)

    languages = collect_supported_languages(trans_dir)
    print(f"Found supported languages: {', '.join(languages)}", flush=True)

    update_readme_supported_languages(readme_path, languages)

if __name__ == "__main__":
    main()

