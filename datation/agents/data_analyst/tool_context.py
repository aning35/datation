"""
Dynamically generate tool usage constraint rules, injected into the System Prompt of Planner / Executor.

Design Principles:
- LangGraph has already informed the model of tool names/schemas via the API tools parameter, so no need to list them repeatedly.
- We only need to inject behavioral constraint rules regarding "when to select which category of tools".
- The only dynamic part is: determining whether MCP tools exist (if yes → inject rules, if no → skip).
"""
from typing import Any, List

# Known built-in tool names (non-MCP)
BUILTIN_TOOL_NAMES = {
    "DataComputationSandbox",
    "LocalFileReader",
    "WebSearch",
    "KnowledgeBaseSearch",
    "ShellExecutor",
    "get_user_preferences",
    "save_user_preference",
    "QuerySessionExperience",
    "SaveSessionExperience",
}


def has_mcp_tools(tools: List[Any]) -> bool:
    """Determine whether the tool list contains MCP tools"""
    return any(
        getattr(t, "name", "") and getattr(t, "name", "") not in BUILTIN_TOOL_NAMES
        for t in tools
    )


def build_executor_tool_rules(tools: List[Any]) -> str:
    """
    Generate tool selection constraint rules for Executor.
    Only injected when MCP tools exist, without repeatedly listing tool names (the model already knows them via API tools parameter).
    """
    if not has_mcp_tools(tools):
        return ""

    return """[Tool Usage Priority Rules — MUST BE STRICTLY OBSERVED]
Your tool list contains both MCP-specific tools and a general Python sandbox (DataComputationSandbox).
Select tools according to the following principles:
  1. Querying external databases (SQL/Cypher/graph databases, etc.) → Use corresponding MCP tools.
     DO NOT write connection code (psycopg2, neo4j driver, etc.) in DataComputationSandbox.
     MCP tools have pre-packaged connections and authentication, call them directly.
  2. Data processing / computation / visualization / reading & writing local files → Use DataComputationSandbox.
  3. Typical workflow: Fetch data via MCP tools → Perform computation and visualization in the sandbox.

[⚠️ Data Volume Safety Rules — CRITICAL, MUST BE OBSERVED]
Production databases may have hundreds of thousands or millions of records. Unrestricted queries will lead to:
  - Database timeout crashes
  - Application out-of-memory errors
  - Exceeding the LLM's context window limit

You must strictly observe the following rules:
  1. **SQL queries MUST include LIMIT**: Any SELECT query must end with `LIMIT 500` (or smaller).
     Use `SELECT COUNT(*)` first to understand the data size before deciding on a query strategy.
  2. **Neo4j/Graph queries MUST include LIMIT**: Any MATCH ... RETURN must end with `LIMIT 500`.
     Use `MATCH (n:Label) RETURN count(n)` first to understand node sizes.
  3. **Prioritize aggregation over raw details**: Use aggregation functions like GROUP BY / COUNT / SUM / AVG to get statistical results
     instead of pulling all detailed records. Analysis insights come from aggregated metrics, not raw data.
  4. **Paging strategy**: If you indeed need to traverse large amounts of data, do it in batches using OFFSET/LIMIT or SKIP/LIMIT.
  5. **Field pruning**: Select/Return only fields required for analysis; do not SELECT * / RETURN n.
  6. **Data sampling**: For exploratory analysis, retrieve a sample of LIMIT 20 first to understand the data structure and distribution
     before deciding on subsequent precise query plans.
"""


def build_planner_tool_awareness(tools: List[Any]) -> str:
    """
    Generate tool capability awareness constraints for Planner.
    Only injected when MCP tools exist, without repeatedly listing tool names.
    """
    if not has_mcp_tools(tools):
        return ""

    return """**When planning, you must distinguish between two categories of tools:**
  - MCP data source tools (those in the tool list whose names contain a server prefix): Directly query external databases, no need to write connection code.
  - DataComputationSandbox: Process, aggregate, and visualize fetched data.

  Planning steps must split "fetching data" and "processing" into independent steps:
  Correct Example:
    Step 1: Query database using MCP tools to fetch raw data.
    Step 2: Process and visualize the data in the sandbox.
  Incorrect Example:
    Write code in the sandbox to connect to the database and query ← Sandbox should not connect to external databases on its own.

**⚠️ Data Volume Safety — Planning Constraints:**
  - Every "fetching data" step must explicitly require: first querying COUNT/statistical summary → then deciding on a fetching strategy.
  - Never plan steps like "pulling all detailed data"; aggregate/restrictive conditions must be applied.
  - Correct Example: "Aggregate and calculate the number of orders and total premium by channel dimension."
  - Incorrect Example: "Pull all order data" ← Could be hundreds of thousands of rows, crashing the system directly.
"""
