"""
User Preference Memory Tools - File-based persistent storage

Stores user preferences (e.g., plot style, language, color palette) in a global
JSON file under the workspaces directory, ensuring they survive service restarts
regardless of the checkpointer backend (Memory/SQLite/Postgres).
"""
import os
import json
import threading
from langchain_core.tools import tool

# Module-level lock for thread-safe file access
_file_lock = threading.Lock()


def _prefs_path(workspace_base: str) -> str:
    """Return the path to the global user preferences file."""
    return os.path.join(workspace_base, "user_preferences.json")


def _load_prefs(path: str) -> dict:
    """Load preferences from disk, returning empty dict if not found."""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def _save_prefs(path: str, prefs: dict) -> None:
    """Atomically save preferences to disk."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(prefs, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def build_memory_manager_tools(workspace_base: str):
    """
    Build tools for saving and retrieving user preferences.
    Uses a simple JSON file for persistent storage — no database required.
    """
    prefs_file = _prefs_path(workspace_base)

    @tool
    def save_user_preference(key: str, value: str) -> str:
        """
        Saves a user preference or fact to long-term memory.
        Use this tool when the user specifies how they want things done in the future
        (e.g., "always use seaborn darkgrid", "I prefer Chinese labels").

        Args:
            key: A short, descriptive identifier for the preference (e.g., "plot_style", "language").
            value: The actual preference or fact to remember.
        """
        with _file_lock:
            prefs = _load_prefs(prefs_file)
            prefs[key] = value
            _save_prefs(prefs_file, prefs)
        return f"Successfully saved preference '{key}': '{value}'"

    @tool
    def get_user_preferences() -> str:
        """
        Retrieves all saved user preferences and facts from long-term memory.
        Call this tool before starting complex data tasks to ensure you follow the user's past instructions.
        """
        with _file_lock:
            prefs = _load_prefs(prefs_file)
        if not prefs:
            return "No user preferences found."
        return f"User Preferences: {json.dumps(prefs, ensure_ascii=False, indent=2)}"

    return [save_user_preference, get_user_preferences]
