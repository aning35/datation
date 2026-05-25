import os
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class FileWriterInput(BaseModel):
    filename: str = Field(description="Relative file path to save, e.g. report.md or analysis.csv")
    content: str = Field(description="String content to write to the file")

def _safe_write_file(base_dir: str, filename: str, content: str) -> str:
    """Save a file under the designated output directory, preventing sandbox escape."""
    # Path normalization security check
    safe_base = os.path.abspath(base_dir)
    target_path = os.path.abspath(os.path.join(safe_base, filename))
    
    if os.path.commonpath([safe_base, target_path]) != safe_base:
        return f"Error: Target path {filename} attempts to escape the outputs security constraint."
        
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    
    try:
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Success: Content has been written to {target_path}."
    except Exception as e:
        return f"Error: Failed to write file - {str(e)}"

def build_local_file_writer_tool(output_base_path: str = "./outputs") -> StructuredTool:
    """
    Build a constrained file writing/persistence tool.
    """
    os.makedirs(output_base_path, exist_ok=True)
    
    return StructuredTool.from_function(
        func=lambda filename, content: _safe_write_file(output_base_path, filename, content),
        name="local_file_writer",
        description="Save your high-value analysis reports (Markdown) or intermediate refined data (CSV/JSON) to the secure system outputs archive.",
        args_schema=FileWriterInput,
    )
