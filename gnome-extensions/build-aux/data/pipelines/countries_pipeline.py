import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from core.base_pipeline import BaseDatasetPipeline
from core.exporter import JsonExporter
from core.fetcher import HttpFetcher
from core.validator import JsonValidator


# ========================================================================
# Countries Dataset Pipeline
# ========================================================================

class CountriesPipeline(BaseDatasetPipeline):
    """Pipeline processing country metadata, dialing codes, and SVG flags."""

    FLAG_EMOJI_OFFSET = 127397
    DEFAULT_RESOURCE_PREFIX = "/org/gnome/shell/extensions/all-in-one-clipboard"

    def __init__(self, name: str, config: Dict[str, Any], project_root: Path) -> None:
        """Initialize countries pipeline state and path references."""
        super().__init__(name, config, project_root)
        self.raw_data: Optional[List[Dict[str, Any]]] = None
        self.available_flags: List[str] = []

    # ====================================================================
    # Lifecycle Hooks
    # ====================================================================

    def fetch(self) -> bool:
        """Fetch raw country definitions from the country data endpoint."""
        endpoint = self.config["datasets"]["countries"]["api_url"]
        # Remote Retrieval
        data = HttpFetcher.fetch_json(endpoint)
        if not isinstance(data, list):
            return False
        self.raw_data = data
        return True

    def clean(self) -> bool:
        """Normalize country records, extract dial codes, and locate SVG flag assets."""
        if not self.raw_data:
            return False

        flags_dir = self.project_root / self.config["flags_dir"]
        xml_path = self.project_root / self.config["gresource_xml"]
        resource_prefix = self._resolve_resource_prefix(xml_path)

        # Alphabetical Sorting
        sorted_countries = sorted(
            self.raw_data,
            key=lambda item: item.get("name", {}).get("common", ""),
        )

        cleaned_list: List[Dict[str, Any]] = []
        flag_filenames: List[str] = []

        # Record Transformation
        for country in sorted_countries:
            cca2 = country.get("cca2", "").upper()
            if not cca2 or len(cca2) != 2:
                continue

            name = country.get("name", {}).get("common", "Unknown")
            idd = country.get("idd", {})
            dial_code = self._format_dial_code(
                idd.get("root", ""),
                idd.get("suffixes", []),
                cca2,
            )
            if not dial_code:
                continue

            svg_filename = f"{cca2.lower()}.svg"
            svg_path = flags_dir / svg_filename

            if svg_path.exists():
                flag_filenames.append(svg_filename)

            emoji = country.get("flag") or self._calculate_flag_emoji(cca2)
            flag_resource_path = (
                f"resource://{resource_prefix}/assets/icons/flags/{svg_filename}"
            )

            record = {
                "name": name,
                "code": cca2,
                "dial_code": dial_code,
                "emoji": emoji,
                "flag_path": flag_resource_path,
            }
            cleaned_list.append(record)

        self.data = cleaned_list
        self.available_flags = flag_filenames
        return True

    def validate(self) -> bool:
        """Validate country records against structural expectations."""
        required_fields = {
            "name": str,
            "code": str,
            "dial_code": str,
            "emoji": str,
            "flag_path": str,
        }
        # Validation Logic
        valid, _ = JsonValidator.validate_list_of_objects(
            self.data,
            required_fields,
            min_items=150,
        )
        return valid

    def export(self) -> bool:
        """Export serialized countries JSON with metadata wrapper to extension destination path."""
        output_path = self.project_root / self.config["datasets"]["countries"]["output_file"]
        payload = self.wrap_with_metadata(self.data)
        # File Writing
        return JsonExporter.export_atomic(payload, output_path, compact_arrays=True)

    # ====================================================================
    # Helper Utilities
    # ====================================================================

    def _resolve_resource_prefix(self, xml_path: Path) -> str:
        """Resolve the gresource prefix attribute from the manifest XML file."""
        if not xml_path.exists():
            return self.DEFAULT_RESOURCE_PREFIX
        # XML Prefix Extraction
        try:
            content = xml_path.read_text(encoding="utf-8")
            match = re.search(r'<gresource\s+prefix="([^"]+)"', content)
            if match:
                return match.group(1)
        except Exception:
            pass
        return self.DEFAULT_RESOURCE_PREFIX

    def _calculate_flag_emoji(self, country_code: str) -> str:
        """Compute flag emoji sequence from two uppercase letters."""
        first_char = chr(ord(country_code[0]) + self.FLAG_EMOJI_OFFSET)
        second_char = chr(ord(country_code[1]) + self.FLAG_EMOJI_OFFSET)
        return f"{first_char}{second_char}"

    def _format_dial_code(
        self,
        root: str,
        suffixes: List[str],
        cca2: str,
    ) -> Optional[str]:
        """Normalize telephone country calling code from root and suffixes."""
        if not root:
            return None
        # North American Numbering Plan
        if root == "+1":
            if cca2 in ["US", "CA"]:
                return "+1"
            if suffixes:
                return f"{root}{suffixes[0]}"
        # Integrated Russian and Kazakh Numbering Plan
        if root == "+7":
            if cca2 in ["RU", "KZ"]:
                return "+7"
        # Standard Country Calling Code
        suffix = suffixes[0] if suffixes else ""
        return f"{root}{suffix}"
