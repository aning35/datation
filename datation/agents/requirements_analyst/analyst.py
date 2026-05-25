"""
Requirements Analyst — Conversational multi-turn interview ReAct Agent

Workflow:
1. Determine if the user's requirements are clear.
2. If unclear → Ask precise clarifying questions as an interviewer and wait for the user's response.
3. Continue the conversation upon receiving answers until the requirements are clear.
4. Once requirements are fully clarified, output a structured analysis task Brief for DataAnalyst to execute.
"""
from typing import Any, List
from langchain_core.language_models import BaseChatModel
from langgraph.prebuilt import create_react_agent
from datation.agents.prompts import REQUIREMENTS_ANALYST_SYSTEM_PROMPT

def create_requirements_analyst_agent(
    llm: BaseChatModel,
    tools: List[Any],
    skills_context: str = "",
):
    """
    Create a requirements analysis ReAct Agent (conversational multi-turn interaction).
    """
    system_prompt = REQUIREMENTS_ANALYST_SYSTEM_PROMPT
    if skills_context:
        system_prompt += f"\n\n## Agent Skills\n{skills_context}"
    
    from core.config import get_language_directive
    system_prompt += get_language_directive()

    agent = create_react_agent(llm, tools, prompt=system_prompt)
    return agent
