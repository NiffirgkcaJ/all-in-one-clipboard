import hashlib
import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, Optional


# ========================================================================
# Pipeline Contract
# ========================================================================

class BaseDatasetPipeline(ABC):
    """Abstract base class establishing the dataset pipeline contract."""

    def __init__(self, name: str, config: Dict[str, Any], project_root: Path) -> None:
        """Initialize the pipeline with dataset name, config dictionary, and project root."""
        self.name = name
        self.config = config
        self.project_root = project_root
        self.data: Any = None

    # ====================================================================
    # Lifecycle Hooks
    # ====================================================================

    @abstractmethod
    def fetch(self) -> bool:
        """Download or read raw upstream source data."""
        pass

    @abstractmethod
    def clean(self) -> bool:
        """Normalize, deduplicate, and enrich parsed dataset records."""
        pass

    @abstractmethod
    def validate(self) -> bool:
        """Validate structure and required constraints against expected schema."""
        pass

    @abstractmethod
    def export(self) -> bool:
        """Write finalized dataset output to the extension assets directory."""
        pass

    # ====================================================================
    # Execution Runner
    # ====================================================================

    def run(self) -> bool:
        """Execute the complete lifecycle sequence for this dataset."""
        # Step Execution
        if not self.fetch():
            return False
        if not self.clean():
            return False
        if not self.validate():
            return False
        return self.export()

    # ====================================================================
    # Metadata Utilities
    # ====================================================================

    def wrap_with_metadata(
        self,
        dataset_payload: Any,
        version: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Wrap data array with standard attribution and extension metadata."""
        content_version = version or self._compute_content_hash(dataset_payload)
        dataset_info = self.config.get("datasets", {}).get(self.name, {})

        # Attribution Metadata
        attribution = {
            "provider": dataset_info.get("provider", "Various"),
            "url": dataset_info.get("source_url", ""),
            "notes": dataset_info.get("notes", ""),
        }

        extension_info = self._load_extension_metadata()

        return {
            "_metadata": {
                "data_version": content_version,
                "attribution": attribution,
                "extension_info": extension_info,
            },
            "data": dataset_payload,
        }

    def _compute_content_hash(self, payload: Any) -> str:
        """Compute sha256 checksum prefix from normalized serialized data."""
        serialized = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        return f"sha256:{digest[:16]}"

    def _load_extension_metadata(self) -> Optional[Dict[str, str]]:
        """Load name and uuid from extension metadata JSON manifest."""
        meta_rel = self.config.get("extension_metadata", "gnome-extensions/extension/metadata.json")
        meta_path = self.project_root / meta_rel
        if not meta_path.exists():
            return None

        # Manifest Reading
        try:
            with open(meta_path, "r", encoding="utf-8") as meta_file:
                content = json.load(meta_file)
            return {
                "name": content.get("name", "All-in-One Clipboard"),
                "uuid": content.get("uuid", "all-in-one-clipboard@NiffirgkcaJ.github.com"),
            }
        except Exception:
            return None
