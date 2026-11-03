#!/usr/bin/env python3
"""
Automated PO translation utility for all-in-one-clipboard UI strings.

Scans gettext .po files for untranslated or fuzzy messages, translates them via Google Translate GTX over HTTP/2, and validates the compiled output.

Usage:
    python3 translate-strings.py <path_to_po> <target_language_code>

Example:
    python3 translate-strings.py gnome-extensions/translation/all-in-one-clipboard@<lang_code>.po <lang_code>
"""

import ast
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse

# --- Helper Functions ---

def parse_po_str(raw: str) -> str:
    """
    Decodes quoted and escaped gettext string blocks.

    Args:
        raw: Raw string block from the gettext file.

    Returns:
        Decoded string value.
    """
    matches = re.findall(r'"(?:[^"\\]|\\.)*"', raw)
    return "".join(ast.literal_eval(m) for m in matches)

def format_po_str(val: str) -> str:
    """
    Encodes a string into gettext msgstr format.

    Args:
        val: Decoded string value.

    Returns:
        Formatted msgstr line ending with a newline.
    """
    escaped = val.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'msgstr "{escaped}"\n'

def remove_fuzzy_flag(comments: str) -> str:
    """
    Removes the fuzzy flag from comment blocks while preserving other flags.

    Args:
        comments: Comment block preceding a message entry.

    Returns:
        Updated comment block with fuzzy flags removed.
    """
    comments = re.sub(r'(^[ \t]*#,\s*)fuzzy,\s*', r'\1', comments, flags=re.MULTILINE)
    comments = re.sub(r'(^[ \t]*#,.*),\s*fuzzy\b', r'\1', comments, flags=re.MULTILINE)
    comments = re.sub(r'^[ \t]*#,\s*fuzzy\s*$\n?', '', comments, flags=re.MULTILINE)
    return comments

def translate_gtx(text: str, target_lang: str) -> str:
    """
    Translates text to the target language via Google Translate GTX over HTTP/2.

    Args:
        text: Source text to translate.
        target_lang: Target language code.

    Returns:
        Translated string or empty string on failure.
    """
    url = (
        "https://translate.googleapis.com/translate_a/single?"
        + urllib.parse.urlencode({
            "client": "gtx",
            "sl": "en",
            "tl": target_lang,
            "dt": "t",
            "q": text,
        })
    )

    try:
        res = subprocess.run(
            ["curl", "--http2", "-s", url],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        data = json.loads(res.stdout)
        translated = "".join(part[0] for part in data[0] if part[0])

        # Normalize spaced format specifiers like % d to %d.
        translated = re.sub(r'%\s*([dsf])', r'%\1', translated)
        return translated
    except Exception as e:
        print(f"  [ERROR] Translating '{text[:40]}...': {e}", file=sys.stderr, flush=True)
        return ""

# --- Core Processing ---

def process_po_file(po_path: Path, target_lang: str) -> None:
    """
    Translates untranslated and fuzzy entries in a .po file and validates with msgfmt.

    Args:
        po_path: Path to the .po file to update.
        target_lang: Target language code.
    """
    print(f"Reading '{po_path}' for target language '{target_lang}'...", flush=True)
    content = po_path.read_text(encoding="utf-8")

    pattern = re.compile(
        r'((?:^[ \t]*#.*$\n)*)'
        r'(^[ \t]*msgid\s+(?:\"(?:[^\"\\\\]|\\\\.)*\"\s*\n)+)'
        r'(^[ \t]*msgstr\s+(?:\"(?:[^\"\\\\]|\\\\.)*\"\s*\n)+)',
        re.MULTILINE
    )

    matches = list(pattern.finditer(content))

    # Pre-scan entries to translate.
    to_translate: list[tuple[int, str, bool]] = []
    for idx, m in enumerate(matches):
        comments, msgid_raw, msgstr_raw = m.groups()
        msgid = parse_po_str(msgid_raw)
        msgstr = parse_po_str(msgstr_raw)

        if not msgid:
            continue

        is_fuzzy = bool(re.search(r'^[ \t]*#,\s*fuzzy', comments, re.MULTILINE))
        is_empty = not msgstr.strip()

        if is_empty or is_fuzzy:
            to_translate.append((idx, msgid, is_fuzzy))

    total = len(to_translate)
    print(f"Found {total} strings to translate or update in '{po_path.name}'.", flush=True)

    if total == 0:
        print("Nothing to translate. File is already up to date.", flush=True)
        return

    # Process translations.
    output_pieces: list[str] = []
    last_end = 0
    current_num = 0

    to_translate_map = {idx: (msgid, is_fuzzy) for idx, msgid, is_fuzzy in to_translate}

    for idx, m in enumerate(matches):
        start, end = m.span()
        output_pieces.append(content[last_end:start])
        last_end = end

        comments, msgid_raw, msgstr_raw = m.groups()

        if idx in to_translate_map:
            current_num += 1
            msgid, is_fuzzy = to_translate_map[idx]
            status_tag = "[FUZZY]" if is_fuzzy else "[NEW]"

            new_translation = translate_gtx(msgid, target_lang)

            if new_translation:
                display_orig = msgid.replace("\n", " ")[:40]
                display_trans = new_translation.replace("\n", " ")[:40]
                print(f"[{current_num}/{total}] {status_tag} '{display_orig}' -> '{display_trans}'", flush=True)

                if is_fuzzy:
                    comments = remove_fuzzy_flag(comments)

                new_msgstr_raw = format_po_str(new_translation)
                output_pieces.append(f"{comments}{msgid_raw}{new_msgstr_raw}")
                time.sleep(0.05)
                continue

        output_pieces.append(m.group(0))

    output_pieces.append(content[last_end:])
    new_content = "".join(output_pieces)

    po_path.write_text(new_content, encoding="utf-8")
    print(f"\nSaved updated translations to '{po_path}'. Reformatting with msgcat...", flush=True)

    # Reformat using msgcat.
    subprocess.run(["msgcat", "--no-wrap", str(po_path), "-o", str(po_path)], check=True)

    # Validate using msgfmt.
    res = subprocess.run(["msgfmt", "-c", "-v", str(po_path), "-o", "/dev/null"], capture_output=True, text=True)
    print(f"Validation: {res.stderr.strip()}", flush=True)

# --- Main Entry Point ---

def main() -> None:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <path_to_po> <target_language_code>")
        print(f"Example: {sys.argv[0]} gnome-extensions/translation/all-in-one-clipboard@<lang_code>.po <lang_code>")
        sys.exit(1)

    po_file = Path(sys.argv[1])
    target_lang = sys.argv[2]
    if not po_file.is_file():
        print(f"Error: File not found '{po_file}'", file=sys.stderr)
        sys.exit(1)

    process_po_file(po_file, target_lang)

if __name__ == "__main__":
    main()
