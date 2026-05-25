"""
Session Experience Tools - Session-level experience recording

Records problems and solutions encountered during execution for other agents
in the same session to reference. Stored as JSONL files per thread.
"""
import os
import json
from datetime import datetime
from typing import List
from langchain_core.tools import tool
from tools.data_computation.sandbox import sandbox_thread_id


def build_session_experience_tools(workspace_base: str) -> List:
    """Build session experience tools: record and query execution experiences."""

    @tool
    def SaveSessionExperience(problem: str, solution: str, tags: str = "") -> str:
        """
        Record a problem and its solution to the session workspace.

        Args:
            problem: A clear description of the problem or error encountered.
            solution: The solution or workaround that resolved the problem.
            tags: Optional comma-separated tags for categorization (e.g., "pandas,encoding,csv").
        """
        thread_id = sandbox_thread_id.get()
        if not thread_id:
            return "Error: No active session"

        if not problem or not solution:
            return "Error: problem and solution are required"

        workspace = os.path.join(workspace_base, f"thread_{thread_id}")
        memory_file = os.path.join(workspace, "session_memory.jsonl")
        os.makedirs(workspace, exist_ok=True)

        entry = {
            "timestamp": datetime.now().isoformat(),
            "problem": problem,
            "solution": solution,
            "tags": [t.strip() for t in tags.split(",") if t.strip()]
        }

        with open(memory_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        return "✓ Experience recorded to session memory"

    @tool
    def QuerySessionExperience(query: str = "") -> str:
        """
        Query experiences recorded in the session.
        Input a keyword to search, leave empty to return all records.

        Args:
            query: Optional keyword to search in problems, solutions, and tags.
        """
        thread_id = sandbox_thread_id.get()
        if not thread_id:
            return "Error: No active session"

        workspace = os.path.join(workspace_base, f"thread_{thread_id}")
        memory_file = os.path.join(workspace, "session_memory.jsonl")

        if not os.path.exists(memory_file):
            return "No session experiences recorded yet"

        experiences = []
        with open(memory_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    experiences.append(json.loads(line))

        if not experiences:
            return "No session experiences recorded yet"

        # Simple keyword matching
        if query:
            query_lower = query.lower()
            filtered = [
                e for e in experiences
                if query_lower in e["problem"].lower()
                or query_lower in e["solution"].lower()
                or any(query_lower in tag.lower() for tag in e["tags"])
            ]
            experiences = filtered

        if not experiences:
            return f"No experience records found related to '{query}'"

        # Format output
        result = f"Found {len(experiences)} related experiences:\n\n"
        for i, exp in enumerate(experiences[-5:], 1):
            result += f"## Experience {i}\n"
            result += f"**Problem**: {exp['problem']}\n"
            result += f"**Solution**: {exp['solution']}\n"
            if exp['tags']:
                result += f"**Tags**: {', '.join(exp['tags'])}\n"
            result += "\n---\n\n"

        return result

    return [SaveSessionExperience, QuerySessionExperience]
