import argparse
import json
import sys
from pathlib import Path

# Path Configuration
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from typing import Any, Dict, List, Type
from core.base_pipeline import BaseDatasetPipeline
from pipelines.countries_pipeline import CountriesPipeline
from pipelines.emojis_pipeline import EmojisPipeline
from pipelines.kaomojis_pipeline import KaomojisPipeline
from pipelines.symbols_pipeline import SymbolsPipeline
from pipelines.tlds_pipeline import TldsPipeline


# ========================================================================
# Pipeline Registry
# ========================================================================

PIPELINE_MAP: Dict[str, Type[BaseDatasetPipeline]] = {
    "countries": CountriesPipeline,
    "emojis": EmojisPipeline,
    "tlds": TldsPipeline,
    "kaomojis": KaomojisPipeline,
    "symbols": SymbolsPipeline,
}


# ========================================================================
# Pipeline Orchestrator
# ========================================================================

class PipelineOrchestrator:
    """Orchestrates execution across registered dataset pipelines."""

    def __init__(self, config_path: Path, project_root: Path) -> None:
        """Initialize orchestrator with configuration and repository root paths."""
        self.config_path = config_path
        self.project_root = project_root
        self.config = self._load_config()

    def _load_config(self) -> Dict[str, Any]:
        """Read and parse the JSON configuration file."""
        # Configuration Loading
        with open(self.config_path, "r", encoding="utf-8") as config_file:
            return json.load(config_file)

    def execute(self, action: str, target: str) -> bool:
        """Execute the specified action on the target dataset or all datasets."""
        targets: List[str] = (
            list(PIPELINE_MAP.keys()) if target == "all" else [target]
        )

        overall_success = True

        # Pipeline Iteration
        for name in targets:
            pipeline_cls = PIPELINE_MAP.get(name)
            if not pipeline_cls:
                print(f"Error: Unknown dataset '{name}'.", file=sys.stderr)
                overall_success = False
                continue

            instance = pipeline_cls(name, self.config, self.project_root)
            success = self._run_action(instance, action)

            status = "SUCCESS" if success else "FAILED"
            print(f"[{status}] Dataset '{name}' action '{action}'.")

            if not success:
                overall_success = False

        return overall_success

    def _run_action(self, pipeline: BaseDatasetPipeline, action: str) -> bool:
        """Invoke the requested lifecycle method on the pipeline instance."""
        # Lifecycle Dispatch
        if action == "run":
            return pipeline.run()
        if action == "fetch":
            return pipeline.fetch()
        if action == "clean":
            return pipeline.fetch() and pipeline.clean()
        if action == "validate":
            return pipeline.fetch() and pipeline.clean() and pipeline.validate()
        if action == "export":
            return pipeline.run()

        return False


# ========================================================================
# CLI Entry Point
# ========================================================================

def main() -> None:
    """Parse command line arguments and launch the orchestrator."""
    project_root = SCRIPT_DIR.parent.parent.parent
    config_path = SCRIPT_DIR / "config.json"

    # Argument Parser Configuration
    parser = argparse.ArgumentParser(
        description="Unified data generation and ingestion pipeline for All-in-One Clipboard.",
    )
    parser.add_argument(
        "action",
        nargs="?",
        default="run",
        choices=["run", "fetch", "clean", "validate", "export"],
        help="Lifecycle action to execute across selected datasets.",
    )
    parser.add_argument(
        "dataset",
        nargs="?",
        default="all",
        choices=list(PIPELINE_MAP.keys()) + ["all"],
        help="Target dataset name or all to process entire registry.",
    )

    args = parser.parse_args()

    # Orchestrator Execution
    orchestrator = PipelineOrchestrator(config_path, project_root)
    success = orchestrator.execute(args.action, args.dataset)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
