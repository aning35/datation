"""
Skill Executor Agent — Pure ReAct mode, directly executing Skill SOP tasks
No planning, no review, executes immediately upon receiving a task.
"""
from typing import Any, List
from langchain_core.language_models import BaseChatModel
from langgraph.prebuilt import create_react_agent
from datation.agents.prompts import SKILL_EXECUTOR_SYSTEM_PROMPT


def create_skill_executor_agent(
    llm: BaseChatModel,
    tools: List[Any],
    skills_context: str = "",
):
    """
    Create a pure ReAct Skill Execution Agent.
    No Plan-Execute flow, directly executes tasks based on user instructions + Skill SOP.
    """
    system_prompt = SKILL_EXECUTOR_SYSTEM_PROMPT

    # Dynamically inject paths
    import os, sys
    from core.config import DATA_SOURCES_DIR, WORKSPACES_DIR, get_language_directive
    system_prompt = system_prompt.replace("{workspace_dir}", os.path.abspath(WORKSPACES_DIR) + "/thread_{thread_id}")
    system_prompt = system_prompt.replace("{data_sources_dir}", os.path.abspath(DATA_SOURCES_DIR))
    system_prompt = system_prompt.replace("{read_cmd}", "type" if sys.platform == "win32" else "cat")
    system_prompt = system_prompt.replace("{language_directive}", get_language_directive())

    if skills_context:
        system_prompt = system_prompt.replace("{skills_context}", skills_context)
    else:
        system_prompt = system_prompt.replace("{skills_context}", "(No skills loaded currently)")

    agent = create_react_agent(llm, tools, prompt=system_prompt)
    return agent
