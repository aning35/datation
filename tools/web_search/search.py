import json
from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class WebSearchInput(BaseModel):
    query: str = Field(description="Keywords to search for background information")
    max_results: int = Field(default=3, description="Maximum number of search results to return, default 3")

def perform_web_search(query: str, max_results: int = 3) -> str:
    """Perform a lightweight web search using DuckDuckGo without requiring an API key."""
    try:
        search = DuckDuckGoSearchResults(num_results=max_results, output_format="list")
        results = search.invoke(query)
        # Results is typically a list of dicts with 'snippet', 'title', 'link'
        return json.dumps(results, ensure_ascii=False, indent=2)
    except Exception as e:
        return f"Web Search Failed: {str(e)}"

def build_web_search_tool() -> StructuredTool:
    """
    Build a structured web search tool exposed to the Agent.
    """
    return StructuredTool.from_function(
        func=perform_web_search,
        name="web_search",
        description="Call this tool to read external web snippets when you need to obtain the latest industry information, perform documentation queries, or gather background facts to assist in data analysis and reasoning.",
        args_schema=WebSearchInput,
    )
