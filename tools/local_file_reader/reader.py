"""
Local File Reader Skill - Read heterogenous files from a given source location
"""
import os
from langchain_core.tools import Tool
from tools.data_computation.sandbox import sandbox_thread_id, sandbox_history_thread_ids

def build_local_file_reader_tool(base_path: str, workspace_base: str) -> Tool:
    """
    Provide the Agent with the ability to read local unstructured or semi-structured files.
    Searches the current session's workspace/uploads directory first, then the global data_sources directory.
    """

    def list_and_read(path_offset: str = "") -> str:
        # Get current thread_id and historical thread_ids
        thread_id = sandbox_thread_id.get()
        history_ids = sandbox_history_thread_ids.get()

        # Build search path list: multi-level fallback
        search_paths = []
        if thread_id:
            workspace_dir = os.path.join(workspace_base, f"thread_{thread_id}")
            if os.path.exists(workspace_dir):
                search_paths.append(workspace_dir)
                search_paths.append(os.path.join(workspace_dir, "uploads"))
                search_paths.append(os.path.join(workspace_dir, "outputs"))

        # Add historical workspace directories
        if history_ids:
            print(f"[LocalFileReader] Adding {len(history_ids)} history workspace paths")
        for hist_id in history_ids:
            hist_workspace = os.path.join(workspace_base, f"thread_{hist_id}")
            if os.path.exists(hist_workspace):
                search_paths.append(hist_workspace)
                search_paths.append(os.path.join(hist_workspace, "uploads"))
                search_paths.append(os.path.join(hist_workspace, "outputs"))
                print(f"[LocalFileReader] Added history path: {hist_workspace}")

        search_paths.append(base_path)

        # Try to find the file in each search path
        for search_base in search_paths:
            target_path = os.path.join(search_base, path_offset)
            if os.path.exists(target_path):
                if os.path.isdir(target_path):
                    return "Directory contents: " + ", ".join(os.listdir(target_path))
                else:
                    from utils.document_processor import processor
                    return processor.get_preview(target_path, max_chars=8000)

        return f"Error: Path '{path_offset}' not found in workspace uploads or data sources"

    return Tool(
        name="LocalFileReader",
        description="Helper to list directory content or read a file's content. Searches in: 1) current workspace uploads, 2) selected history workspaces (previous analysis outputs), 3) global data sources. Input should be relative path string.",
        func=list_and_read
    )
