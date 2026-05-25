import operator
from typing import Annotated, Any, Dict, List, Optional, Tuple, TypedDict

class PlanExecuteState(TypedDict):
    """
    Macro execution state dictionary for Datation Agent.
    Primarily used for full-lifecycle communication between Planner -> Executor -> Reviewer.
    """
    # The specific business goal or problem description originally given by the user
    input: str
    
    # The macro action sequence formulated by the Planner (List of Steps)
    plan: List[str]
    
    # Summary of historically completed tasks; after each Executor step,
    # key information is refined by the Reviewer and saved in this list (Step Context & Insights)
    # Uses operator.add to ensure append capability without carrying the full state every time
    past_steps: Annotated[List[Tuple[str, str]], operator.add]
    
    # (New mechanism) Reasoning chain / Evidence box matrix
    # Stores specific data references or analysis summaries obtained during execution exploration, used in review node to verify if "insights" are backed by actual data
    evidence_chain: Annotated[List[Dict[str, Any]], operator.add]
    
    # The final insight or report feedback responded to the user
    response: str
