"""
QA Agent — For quick question and answering after analysis and report generation
"""
from typing import Any, List
from langchain_core.language_models import BaseChatModel
from langgraph.prebuilt import create_react_agent
from datation.agents.prompts import QA_AGENT_SYSTEM_PROMPT

def create_qa_agent(
    llm: BaseChatModel,
    tools: List[Any],
    skills_context: str = "",
):
    """
    Create a QA Agent (ReAct) to interpret existing reports/data and provide quick Q&A.
    """
    system_prompt = QA_AGENT_SYSTEM_PROMPT
    
    # Dynamically inject paths
    import os
    from core.config import DATA_SOURCES_DIR, WORKSPACES_DIR, get_language_directive
    system_prompt = system_prompt.replace("{workspace_dir}", os.path.abspath(WORKSPACES_DIR) + "/thread_{thread_id}")
    system_prompt = system_prompt.replace("{data_sources_dir}", os.path.abspath(DATA_SOURCES_DIR))
    system_prompt = system_prompt.replace("{language_directive}", get_language_directive())

    if skills_context:
        system_prompt += f"\n\n## Agent Skills\n{skills_context}"

    agent = create_react_agent(llm, tools, prompt=system_prompt)
    return agent
