import json
import urllib.request
from typing import Any, Dict, Optional


# ========================================================================
# HTTP Fetcher
# ========================================================================

class HttpFetcher:
    """HTTP client utility providing resilient data retrieval."""

    DEFAULT_USER_AGENT = "Mozilla/5.0"
    DEFAULT_TIMEOUT_SECONDS = 30

    @classmethod
    def fetch_text(
        cls,
        url: str,
        user_agent: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> Optional[str]:
        """Fetch raw text content from the specified URL endpoint."""
        agent = user_agent or cls.DEFAULT_USER_AGENT
        headers = {"User-Agent": agent}
        request = urllib.request.Request(url, headers=headers)

        # Network Request
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    return None
                return response.read().decode("utf-8")
        except Exception:
            return None

    @classmethod
    def fetch_json(
        cls,
        url: str,
        user_agent: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> Optional[Any]:
        """Fetch and deserialize JSON payload from the specified URL endpoint."""
        text = cls.fetch_text(url, user_agent=user_agent, timeout=timeout)
        if text is None:
            return None

        # Deserialization Logic
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    @classmethod
    def download_file(
        cls,
        url: str,
        destination_path: str,
        user_agent: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> bool:
        """Download binary content directly to the destination path."""
        agent = user_agent or cls.DEFAULT_USER_AGENT
        headers = {"User-Agent": agent}
        request = urllib.request.Request(url, headers=headers)

        # File Streaming
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    return False
                with open(destination_path, "wb") as output_file:
                    output_file.write(response.read())
            return True
        except Exception:
            return False
