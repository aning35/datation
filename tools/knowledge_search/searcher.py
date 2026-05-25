import os
import subprocess
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class KnowledgeSearchInput(BaseModel):
    query: str = Field(description="Keyword or phrase to search in the knowledge base (supports regex)")
    max_lines: int = Field(default=15, description="Max lines of context to return per match, default 15 to avoid token overflow")

def _search_local_knowledge(base_dir: str, query: str, max_lines: int = 15) -> str:
    """Search local corpus files using native Python, cross-platform. A lightweight RAG alternative."""
    safe_base = os.path.abspath(os.path.expanduser(base_dir))
    
    if not os.path.exists(safe_base):
        return f"Knowledge base root directory {safe_base} not found. Please prepare the relevant corpus first."
        
    try:
        context_lines = max_lines // 2
        import re
        try:
            pattern = re.compile(query, re.IGNORECASE)
        except re.error:
            # The query from LLM may contain invalid regex escapes (e.g. \w), fall back to literal text matching
            pattern = re.compile(re.escape(query), re.IGNORECASE)

        results = []
        for root, _, files in os.walk(safe_base):
            for file in files:
                if not (file.endswith('.md') or file.endswith('.txt')):
                    continue
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                    
                    match_indices = [i for i, line in enumerate(lines) if pattern.search(line)]
                    if not match_indices:
                        continue
                    
                    results.append(f"\\n--- {os.path.relpath(filepath, safe_base)} ---")
                    
                    # Get context around the first match
                    first_match = match_indices[0]
                    start = max(0, first_match - context_lines)
                    end = min(len(lines), first_match + context_lines + 1)
                    
                    for i in range(start, end):
                        prefix = f"{i+1}:" if i != first_match else f"{i+1}>"
                        results.append(f"{prefix} {lines[i].rstrip()}")
                        
                except Exception:
                    pass
                    
        if not results:
            return f"No passages containing '{query}' were found in the local knowledge base."
            
        content = "\\n".join(results)
        if len(content) > 4000:
            content = content[:4000] + "\\n... [Results truncated due to length, try a more precise search term]"
            
        return f"Found the following knowledge snippets:\\n{content}"

    except Exception as e:
        return f"Knowledge base search failed: {str(e)}"

def build_knowledge_search_tool(knowledge_base_path: str = "~/.datation/knowledge-base") -> StructuredTool:
    """
    Provide search capability over Markdown/Text corpus files under the given root directory.
    """
    knowledge_base_path = os.path.expanduser(knowledge_base_path)
    os.makedirs(knowledge_base_path, exist_ok=True)
    
    return StructuredTool.from_function(
        func=lambda query, max_lines=15: _search_local_knowledge(knowledge_base_path, query, max_lines),
        name="knowledge_search",
        description="Search for internal proprietary terms, unfamiliar business metric definitions, or historical operational context from the enterprise local knowledge base to retrieve highly relevant context snippets (Local Light-RAG).",
        args_schema=KnowledgeSearchInput,
    )
