from pathlib import Path
from typing import Any, Union
from .formatter import JsonFormatter


# ========================================================================
# JSON Exporter
# ========================================================================

class JsonExporter:
    """Atomic file exporter ensuring clean write operations for datasets."""

    @classmethod
    def export_atomic(
        cls,
        data: Any,
        target_path: Union[str, Path],
        indent: int = JsonFormatter.DEFAULT_INDENT,
        compact_arrays: bool = True,
    ) -> bool:
        """Atomically serialize and write dataset payload to target destination."""
        destination = Path(target_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_destination = destination.with_suffix(f"{destination.suffix}.tmp")

        # Atomic Write
        try:
            success = JsonFormatter.write_json(
                data,
                temp_destination,
                indent=indent,
                compact_arrays=compact_arrays,
            )
            if not success:
                return False
            temp_destination.replace(destination)
            return True
        except Exception:
            if temp_destination.exists():
                temp_destination.unlink()
            return False
