from typing import Annotated, Optional, Sequence
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from typing import TypedDict


class SupervisorState(TypedDict):
    """
    Overall supervisor agent state.

    - messages:                     Complete conversation message chain
    - next:                         Next routing destination
    - last_completed_node:          Name of the last completed node (used by Supervisor to determine the current stage)
    - requirements_brief:           Structured task instructions output by the requirements analysis agent (optional)
    - analysis_result:              Original result text after DataAnalyst execution (optional)
    - in_requirements_clarification: Flag indicating whether currently in the requirements interview clarification loop
    - awaiting_confirmation_from:   Flag indicating which Agent is currently waiting for user confirmation (None = None)
    """
    messages: Annotated[Sequence[BaseMessage], add_messages]
    next: str
    last_completed_node: Optional[str]
    requirements_brief: Optional[str]
    analysis_result: Optional[str]
    requires_report: Optional[bool]
    in_requirements_clarification: bool
    awaiting_confirmation_from: Optional[str]
