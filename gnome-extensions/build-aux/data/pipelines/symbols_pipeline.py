import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from core.base_pipeline import BaseDatasetPipeline
from core.exporter import JsonExporter


# ========================================================================
# Symbols Dataset Pipeline
# ========================================================================

class SymbolsPipeline(BaseDatasetPipeline):
    """Pipeline processing Unicode symbols and mathematical glyphs."""

    def __init__(self, name: str, config: Dict[str, Any], project_root: Path) -> None:
        """Initialize symbols pipeline state and path references."""
        super().__init__(name, config, project_root)
        self.raw_data: Optional[List[Dict[str, Any]]] = None

    # ====================================================================
    # Lifecycle Hooks
    # ====================================================================

    def fetch(self) -> bool:
        """Read detailed symbols source dataset from repository source tree."""
        source_rel = self.config["datasets"]["symbols"]["source_file"]
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
        """Normalize symbol categories, slugs, and verify glyph records."""
        if not self.raw_data:
            return False

        cleaned_categories: List[Dict[str, Any]] = []

        # Category Traversal
        for category_block in self.raw_data:
            if not isinstance(category_block, dict):
                continue

            category_name = category_block.get("name", "").strip()
            category_slug = category_block.get("slug", category_name.lower().replace(" ", "-"))
            raw_symbols = category_block.get("symbols", [])
            cleaned_symbols: List[Dict[str, Any]] = []

            # Symbol Traversal
            for item in raw_symbols:
                if not isinstance(item, dict):
                    continue

                symbol_char = item.get("symbol", "").strip()
                if not symbol_char:
                    continue

                cleaned_symbols.append(item)

            if cleaned_symbols:
                cleaned_categories.append({
                    "name": category_name,
                    "slug": category_slug,
                    "symbols": cleaned_symbols,
                })

        self.data = cleaned_categories
        return True

    def validate(self) -> bool:
        """Validate presence of categories and nested symbol items."""
        if not isinstance(self.data, list) or not self.data:
            return False

        # Category Invariant Check
        for category_block in self.data:
            if "name" not in category_block or "symbols" not in category_block:
                return False
            if not category_block["symbols"]:
                return False

        return True

    def export(self) -> bool:
        """Export serialized symbols catalog wrapped in metadata to destination."""
        output_rel = self.config["datasets"]["symbols"]["output_file"]
        output_path = self.project_root / output_rel
        payload = self.wrap_with_metadata(self.data)
        # File Writing
        return JsonExporter.export_atomic(payload, output_path)
