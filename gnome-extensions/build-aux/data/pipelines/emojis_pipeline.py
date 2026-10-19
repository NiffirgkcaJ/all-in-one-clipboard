from pathlib import Path
from typing import Any, Dict, List, Optional
from core.base_pipeline import BaseDatasetPipeline
from core.exporter import JsonExporter
from core.fetcher import HttpFetcher
from core.validator import JsonValidator


# ========================================================================
# Emojis Dataset Pipeline
# ========================================================================

class EmojisPipeline(BaseDatasetPipeline):
    """Pipeline processing live upstream emoji catalog and keyword mappings."""

    def __init__(self, name: str, config: Dict[str, Any], project_root: Path) -> None:
        """Initialize emojis pipeline state and paths."""
        super().__init__(name, config, project_root)
        self.raw_groups: Optional[List[Dict[str, Any]]] = None
        self.raw_keywords: Optional[Dict[str, List[str]]] = None

    # ====================================================================
    # Lifecycle Hooks
    # ====================================================================

    def fetch(self) -> bool:
        """Download categorized emoji catalog and keyword dictionary from upstream."""
        dataset_cfg = self.config.get("datasets", {}).get("emojis", {})
        groups_url = dataset_cfg.get("groups_url", "")
        keywords_url = dataset_cfg.get("keywords_url", "")
        if not groups_url or not keywords_url:
            return False

        # Upstream Data Retrieval
        self.raw_groups = HttpFetcher.fetch_json(groups_url)
        self.raw_keywords = HttpFetcher.fetch_json(keywords_url)

        return isinstance(self.raw_groups, list) and isinstance(self.raw_keywords, dict)

    def clean(self) -> bool:
        """Enrich emoji definitions with keywords and Unicode codepoints."""
        if not self.raw_groups or not isinstance(self.raw_keywords, dict):
            return False

        cleaned_categories: List[Dict[str, Any]] = []

        # Category Traversal
        for category_block in self.raw_groups:
            if not isinstance(category_block, dict):
                continue

            category_name = category_block.get("name", "").strip()
            category_slug = category_block.get("slug", "").strip()
            raw_emojis = category_block.get("emojis", [])
            enriched_emojis: List[Dict[str, Any]] = []

            # Emoji Traversal
            for item in raw_emojis:
                if not isinstance(item, dict):
                    continue

                emoji_char = item.get("emoji", "")
                if not emoji_char:
                    continue

                # Keyword Resolution
                matched_keywords = self.raw_keywords.get(emoji_char, [])
                if not matched_keywords:
                    name_words = item.get("name", "").lower().split()
                    matched_keywords = [w for w in name_words if len(w) > 1]

                unique_keywords = list(dict.fromkeys(
                    k.strip() for k in matched_keywords if k and k.strip()
                ))

                # Codepoint Calculation
                codepoints = [f"U+{ord(c):04X}" for c in emoji_char]

                enriched_emojis.append({
                    "emoji": emoji_char,
                    "skin_tone_support": item.get("skin_tone_support", False),
                    "name": item.get("name", "").strip(),
                    "slug": item.get("slug", "").strip(),
                    "unicode_version": item.get("unicode_version", "1.0"),
                    "emoji_version": item.get("emoji_version", "1.0"),
                    "keywords": unique_keywords,
                    "codepoints": codepoints,
                })

            cleaned_categories.append({
                "name": category_name,
                "slug": category_slug,
                "emojis": enriched_emojis,
            })

        self.data = cleaned_categories
        return True

    def validate(self) -> bool:
        """Validate structure and minimum counts across all emoji categories."""
        # Structural Verification
        valid, _ = JsonValidator.validate_categorized_items(
            self.data,
            category_key="name",
            items_key="emojis",
        )
        return valid

    def export(self) -> bool:
        """Export serialized emoji catalog with compact arrays directly to destination path."""
        output_rel = self.config["datasets"]["emojis"]["output_file"]
        output_path = self.project_root / output_rel
        max_version = self._find_max_unicode_version(self.data)
        payload = self.wrap_with_metadata(self.data, version=max_version)

        # File Writing
        return JsonExporter.export_atomic(payload, output_path, compact_arrays=True)

    # ====================================================================
    # Helper Utilities
    # ====================================================================

    def _find_max_unicode_version(self, categories: List[Dict[str, Any]]) -> str:
        """Extract highest Unicode version string from emoji entries."""
        max_version = 0.0

        # Version Search
        for category in categories:
            for item in category.get("emojis", []):
                version_str = item.get("unicode_version", "0.0")
                try:
                    parsed = float(version_str)
                    if parsed > max_version:
                        max_version = parsed
                except (ValueError, TypeError):
                    continue

        return str(max_version) if max_version > 0.0 else "16.0"
