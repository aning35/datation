import os
from typing import Any, Dict, List
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.language_models import BaseChatModel
from langgraph.prebuilt import create_react_agent

from .tool_context import build_executor_tool_rules
from datation.agents.prompts import DATA_ANALYST_EXECUTOR_PROMPT_PREFIX, DATA_ANALYST_EXECUTOR_PROMPT_SUFFIX

def create_executor_agent(
    llm: BaseChatModel,
    tools: List[Any],
    skills_context: str = "",
    system_prompt: str = ""
):
    """
    Create a ReAct sub-graph Agent specialized in interacting with sandbox and MCP environments during local analysis steps.
    """
    if not system_prompt:
        # Dynamically generate MCP tool priority rules (based on actually available tools)
        mcp_tool_rules = build_executor_tool_rules(tools)

        system_prompt = DATA_ANALYST_EXECUTOR_PROMPT_PREFIX

        # Dynamically inject data_sources and workspace base paths
        from core.config import DATA_SOURCES_DIR, WORKSPACES_DIR
        import sys
        system_prompt = system_prompt.replace("{data_sources_dir}", os.path.abspath(DATA_SOURCES_DIR))
        system_prompt = system_prompt.replace("{workspace_dir}", os.path.abspath(WORKSPACES_DIR) + "/thread_{thread_id}")
        system_prompt = system_prompt.replace("{read_cmd}", "type" if sys.platform == "win32" else "cat")

        # Dynamically inject MCP tool rules (only effective when MCP tools exist)
        if mcp_tool_rules:
            system_prompt += mcp_tool_rules + "\n"

        system_prompt += DATA_ANALYST_EXECUTOR_PROMPT_SUFFIX
        if skills_context:
            system_prompt += f"\n\n## Agent Skills\n{skills_context}"

        from core.config import get_language_directive
        system_prompt += get_language_directive()

    # Directly use LangGraph's prebuilt ReAct Agent to build the micro-step execution graph
    executor_executor = create_react_agent(llm, tools, prompt=system_prompt)
    return executor_executor
