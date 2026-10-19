import json
import re
from pathlib import Path
from typing import Any, Union


# ========================================================================
# JSON Formatter
# ========================================================================

class JsonFormatter:
    """Structure-agnostic serialization and formatting utility."""

    DEFAULT_INDENT = 4

    @classmethod
    def serialize(
        cls,
        data: Any,
        indent: int = DEFAULT_INDENT,
        compact_arrays: bool = True,
    ) -> str:
        """Serialize data structure to a formatted JSON string."""
        raw_json = json.dumps(data, indent=indent, ensure_ascii=False)
        if not compact_arrays:
            return raw_json

        # Array Compacting
        return cls._compact_primitive_arrays(raw_json)

    @classmethod
    def write_json(
        cls,
        data: Any,
        target_path: Union[str, Path],
        indent: int = DEFAULT_INDENT,
        compact_arrays: bool = True,
    ) -> bool:
        """Serialize data structure directly into the target file location."""
        destination = Path(target_path)
        destination.parent.mkdir(parents=True, exist_ok=True)

        # File Serialization
        try:
            formatted = cls.serialize(data, indent=indent, compact_arrays=compact_arrays)
            with open(destination, "w", encoding="utf-8") as target_file:
                target_file.write(formatted)
                target_file.write("\n")
            return True
        except Exception:
            return False

    @classmethod
    def format_file(
        cls,
        source_path: Union[str, Path],
        target_path: Union[str, Path, None] = None,
        indent: int = DEFAULT_INDENT,
        compact_arrays: bool = True,
    ) -> bool:
        """Read existing JSON file and format content cleanly."""
        source = Path(source_path)
        destination = Path(target_path) if target_path else source

        # File Parsing
        try:
            with open(source, "r", encoding="utf-8") as input_file:
                payload = json.load(input_file)
            return cls.write_json(payload, destination, indent=indent, compact_arrays=compact_arrays)
        except Exception:
            return False

    @staticmethod
    def _compact_primitive_arrays(json_text: str) -> str:
        """Collapse multi-line arrays of primitive items into single-line format."""
        # Primitive Array Match
        pattern = re.compile(r"\[\s*\n([^\[\]\{\}]*?)\n\s*\]", re.MULTILINE)

        def replacer(match: re.Match) -> str:
            lines = match.group(1).splitlines()
            items = [line.strip().rstrip(",") for line in lines if line.strip()]
            joined = ", ".join(items)
            # Threshold Check
            if len(items) > 30 or len(joined) > 140:
                return match.group(0)
            return f"[{joined}]"

        return pattern.sub(replacer, json_text)
