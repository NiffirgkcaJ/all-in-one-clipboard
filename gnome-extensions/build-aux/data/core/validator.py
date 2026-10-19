from typing import Any, Dict, List, Optional, Tuple, Type


# ========================================================================
# JSON Validator
# ========================================================================

class JsonValidator:
    """Structural and semantic validation utility for dataset records."""

    @classmethod
    def validate_list_of_objects(
        cls,
        data: Any,
        required_fields: Dict[str, Type],
        min_items: int = 1,
    ) -> Tuple[bool, Optional[str]]:
        """Validate that data is a non-empty list of objects containing specified fields."""
        # Type Checking
        if not isinstance(data, list):
            return False, "Root data element must be a list."

        # Cardinality Check
        if len(data) < min_items:
            return False, f"Dataset contains {len(data)} items, minimum expected is {min_items}."

        # Field Validation
        for index, item in enumerate(data):
            if not isinstance(item, dict):
                return False, f"Item at index {index} is not an object."

            for field_name, expected_type in required_fields.items():
                if field_name not in item:
                    return False, f"Item at index {index} is missing required field '{field_name}'."
                value = item[field_name]
                if not isinstance(value, expected_type):
                    return (
                        False,
                        f"Item at index {index} field '{field_name}' must be of type {expected_type.__name__}.",
                    )

        return True, None

    @classmethod
    def validate_categorized_items(
        cls,
        data: Any,
        category_key: str = "category",
        items_key: str = "items",
    ) -> Tuple[bool, Optional[str]]:
        """Validate that data consists of categories containing item lists."""
        # Type Checking
        if not isinstance(data, list):
            return False, "Root data element must be a list of categories."

        if not data:
            return False, "Category list cannot be empty."

        # Category Validation
        for index, block in enumerate(data):
            if not isinstance(block, dict):
                return False, f"Category block at index {index} is not an object."

            if category_key not in block or not isinstance(block[category_key], str):
                return False, f"Category block at index {index} missing valid string category key."

            if items_key not in block or not isinstance(block[items_key], list):
                return False, f"Category block at index {index} missing valid items list."

        return True, None
