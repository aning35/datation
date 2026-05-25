import re
import json
from typing import Any, List
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage

from .tool_context import build_planner_tool_awareness
from core.config import get_language_directive

class Plan(BaseModel):
    """Format for macro plan sequences containing business logic attribution and data extraction"""
    steps: List[str] = Field(
        description="A list of step-by-step decomposed plans. Do not combine querying data and drawing charts into a single step; provide sufficiently granular single-point step instructions."
    )
    
class Act(BaseModel):
    """Dynamically evaluated by the review node to determine whether to execute the next step or output the final report"""
    action: str = Field(
        description="Enter 'Update_Plan' to take action and generate a new plan for deep-dive retries, or 'Report' if the analytical evidence chain is sufficient and the problem has been resolved."
    )
    response: str = Field(
        description="If action is 'Report', fill in the detailed final response here, including the reasoning insight process and report tables",
        default=""
    )
    plan: Plan = Field(
        description="If action is 'Update_Plan', provide the new batch of remaining steps here. Unachieved goals need to be decomposed more finely.",
        default_factory=lambda: Plan(steps=[])
    )


# ============================================================
# Robust JSON extractor — compatible with mixed outputs from various models
# ============================================================

from datation.utils.json_parser import extract_json


from datation.agents.prompts import PLANNER_PROMPT_TEMPLATE, REPLANNER_PROMPT_TEMPLATE

# ============================================================
# Planner Prompt Factory
# ============================================================

def create_planner_prompt(llm: BaseChatModel, tools: List[Any] = None, skills_context: str = ""):
    """
    Create the system prompt text for Planner (no longer returns a chain/template, llm is manually called by builder.py).
    Returns a raw string; builder.py is responsible for wrapping it as SystemMessage + HumanMessage and passing it to the LLM.
    """
    mcp_tool_awareness = build_planner_tool_awareness(tools or [])
    from core.config import DATA_SOURCES_DIR, WORKSPACES_DIR
    import os
    return PLANNER_PROMPT_TEMPLATE.format(
        mcp_tool_awareness=mcp_tool_awareness,
        skills_context=skills_context,
        language_directive=get_language_directive(),
        workspace_dir=os.path.abspath(WORKSPACES_DIR) + "/thread_{thread_id}",
        data_sources_dir=os.path.abspath(DATA_SOURCES_DIR),
    )


def create_replanner_prompt(llm: BaseChatModel, skills_context: str = ""):
    """
    Create the prompt template string for Replanner (contains placeholders like {input}).
    builder.py is responsible for manually calling .format() and wrapping it into a message.
    skills_context will be injected, allowing the Replanner to be aware of all loaded Skill SOPs and their constraints.
    """
    return (REPLANNER_PROMPT_TEMPLATE
            .replace("{skills_context}", skills_context)
            .replace("{language_directive}", get_language_directive()))

# Keep old name alias for backward compatibility
def create_planner(llm, tools=None, skills_context=""):
    return create_planner_prompt(llm, tools=tools, skills_context=skills_context)

def create_replanner(llm, skills_context=""):
    return create_replanner_prompt(llm, skills_context=skills_context)
