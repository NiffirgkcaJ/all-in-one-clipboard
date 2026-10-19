import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from core.base_pipeline import BaseDatasetPipeline
from core.exporter import JsonExporter
from core.fetcher import HttpFetcher


# ========================================================================
# TLDs Dataset Pipeline
# ========================================================================

class TldsPipeline(BaseDatasetPipeline):
    """Pipeline ingesting and classifying top level domains from ICANN IANA."""

    def __init__(self, name: str, config: Dict[str, Any], project_root: Path) -> None:
        """Initialize TLD pipeline state and configuration."""
        super().__init__(name, config, project_root)
        self.raw_text: Optional[str] = None
        self.version_marker: Optional[str] = None

    # ====================================================================
    # Lifecycle Hooks
    # ====================================================================

    def fetch(self) -> bool:
        """Fetch authoritative TLD list from the official IANA registry."""
        endpoint = self.config["datasets"]["tlds"]["api_url"]
        # Remote Retrieval
        text = HttpFetcher.fetch_text(endpoint)
        if not text:
            return False
        self.raw_text = text
        return True

    def clean(self) -> bool:
        """Parse raw text lines, filter comments, and categorize TLD groups."""
        if not self.raw_text:
            return False

        lines = self.raw_text.splitlines()
        version_marker = ""
        cctlds: List[str] = []
        gtlds: List[str] = []
        idns: List[str] = []

        # Line Classification
        for line in lines:
            trimmed = line.strip()
            if not trimmed:
                continue

            # Header Metadata
            if trimmed.startswith("#"):
                match = re.search(r"Version\s+([0-9]+)", trimmed)
                if match:
                    version_marker = match.group(1)
                continue

            tld = trimmed.lower()
            if not tld.replace("-", "").isalnum():
                continue

            # Group Categorization
            if tld.startswith("xn--"):
                idns.append(tld)
            elif len(tld) == 2:
                cctlds.append(tld)
            else:
                gtlds.append(tld)

        cctlds.sort()
        gtlds.sort()
        idns.sort()
        all_tlds = sorted(cctlds + gtlds + idns)

        # Structured Payload
        self.version_marker = version_marker
        self.data = {
            "total_count": len(all_tlds),
            "cctlds_count": len(cctlds),
            "gtlds_count": len(gtlds),
            "idns_count": len(idns),
            "cctlds": cctlds,
            "gtlds": gtlds,
            "idns": idns,
            "all": all_tlds,
        }
        return True

    def validate(self) -> bool:
        """Validate structure and minimum counts across classified TLD lists."""
        if not isinstance(self.data, dict):
            return False
        # Cardinality Check
        if self.data.get("total_count", 0) < 1000:
            return False
        if not self.data.get("gtlds") or not self.data.get("cctlds"):
            return False
        return True

    def export(self) -> bool:
        """Export serialized TLD catalog with metadata wrapper to destination path."""
        output_rel = self.config["datasets"]["tlds"]["output_file"]
        output_path = self.project_root / output_rel
        payload = self.wrap_with_metadata(self.data, version=self.version_marker)
        # File Writing
        return JsonExporter.export_atomic(payload, output_path, compact_arrays=True)
