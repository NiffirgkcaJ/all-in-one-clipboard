import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from core.base_pipeline import BaseDatasetPipeline
from core.exporter import JsonExporter


# ========================================================================
# Kaomojis Dataset Pipeline
# ========================================================================

class KaomojisPipeline(BaseDatasetPipeline):
    """Pipeline processing structured kaomoji emoticons and emotional groups."""

    def __init__(self, name: str, config: Dict[str, Any], project_root: Path) -> None:
        """Initialize kaomojis pipeline state and path references."""
        super().__init__(name, config, project_root)
        self.raw_data: Optional[List[Dict[str, Any]]] = None

    # ====================================================================
    # Lifecycle Hooks
    # ====================================================================

    def fetch(self) -> bool:
        """Read enriched kaomoji source dataset from repository source tree."""
        source_rel = self.config["datasets"]["kaomojis"]["source_file"]
        source_path = self.project_root / source_rel
        if not source_path.exists():
            return False

        # File Parsing
        try:
            with open(source_path, "r", encoding="utf-8") as source_file:
                self.raw_data = json.load(source_file)
            return isinstance(self.raw_data, list)
        except Exception:
            return False

    def clean(self) -> bool:
        """Normalize categories, slugs, and verify emoticon records."""
        if not self.raw_data:
            return False

        cleaned_greater_categories: List[Dict[str, Any]] = []

        # Greater Category Traversal
        for greater_block in self.raw_data:
            if not isinstance(greater_block, dict):
                continue

            greater_name = greater_block.get("name", "").strip()
            inner_categories = greater_block.get("categories", [])
            cleaned_inners: List[Dict[str, Any]] = []

            # Inner Category Traversal
            for inner_block in inner_categories:
                if not isinstance(inner_block, dict):
                    continue

                inner_name = inner_block.get("name", "").strip()
                inner_slug = inner_block.get("slug", "").strip()
                emoticons = inner_block.get("emoticons", [])
                cleaned_emoticons: List[Dict[str, Any]] = []

                # Emoticon Traversal
                for item in emoticons:
                    if not isinstance(item, dict):
                        continue

                    kaomoji_str = item.get("kaomoji", "").strip()
                    if not kaomoji_str:
                        continue

                    cleaned_emoticons.append(item)

                if cleaned_emoticons:
                    cleaned_inners.append({
                        "name": inner_name,
                        "slug": inner_slug,
                        "emoticons": cleaned_emoticons,
                    })

            if cleaned_inners:
                cleaned_greater_categories.append({
                    "name": greater_name,
                    "categories": cleaned_inners,
                })

        self.data = cleaned_greater_categories
        return True

    def validate(self) -> bool:
        """Validate presence of categories and nested emoticon records."""
        if not isinstance(self.data, list) or not self.data:
            return False

        # Category Invariant Check
        for greater_block in self.data:
            if "name" not in greater_block or "categories" not in greater_block:
                return False
            for inner_block in greater_block["categories"]:
                if "name" not in inner_block or "emoticons" not in inner_block:
                    return False
                if not inner_block["emoticons"]:
                    return False

        return True

    def export(self) -> bool:
        """Export serialized kaomoji catalog wrapped in metadata to destination."""
        output_rel = self.config["datasets"]["kaomojis"]["output_file"]
        output_path = self.project_root / output_rel
        payload = self.wrap_with_metadata(self.data)
        # File Writing
        return JsonExporter.export_atomic(payload, output_path)
