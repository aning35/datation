from typing import Any, Callable, Dict, List
from langgraph.graph import StateGraph, END, START
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, AIMessage

from .state import PlanExecuteState
from .planner import create_planner_prompt, create_replanner_prompt, Plan, Act, extract_json
from .executor import create_executor_agent

MAX_PARSE_RETRIES = 2  # Maximum number of retries after parsing fails
MAX_REPLAN_CYCLES = 100  # Hard limit for executor->reviewer cycles to prevent infinite steps


def compile_autodata_graph(llm: BaseChatModel, tools: List[Any], skills_context: str = "", checkpointer=None, store=None):
    """
    Responsible for assembling the global hybrid architecture (Plan-and-Execute + ReAct + Reviewer) state machine.
    """
    planner_prompt = create_planner_prompt(llm, tools=tools, skills_context=skills_context)
    replanner_prompt = create_replanner_prompt(llm, skills_context=skills_context)
    executor_agent = create_executor_agent(llm, tools, skills_context=skills_context)
    
    # ==== Node Definitions ====
    
    async def plan_step(state: PlanExecuteState):
        """Macro planning node: manually calls LLM + robust JSON extraction, completely bypassing LangChain Parser"""
        user_input = state["input"]
        from langchain_core.messages import SystemMessage
        messages = [
            SystemMessage(content=planner_prompt),
            HumanMessage(content=user_input),
        ]

        last_error = None
        for attempt in range(1 + MAX_PARSE_RETRIES):
            if attempt > 0:
                # Append a corrective instruction on retry
                messages.append(HumanMessage(
                    content=f"[System Correction] Your previous output could not be parsed as valid JSON. Error: {last_error}\n"
                            f"Please re-output, only returning a raw JSON object {{\"steps\": [...]}}, without any extra text."
                ))
                print(f"[Planner] Retry {attempt}/{MAX_PARSE_RETRIES} after parse failure: {last_error}")
            
            response = await llm.ainvoke(messages)
            raw_text = response.content or ""
            
            # If the model returns reasoning_content, take only the content part
            if hasattr(response, 'additional_kwargs'):
                reasoning = response.additional_kwargs.get('reasoning_content', '')
                if reasoning:
                    print(f"[Planner] Stripped {len(reasoning)} chars of reasoning content")

            try:
                data = extract_json(raw_text)
                plan_obj = Plan(**data)
                print(f"[Planner] ✅ Successfully parsed plan with {len(plan_obj.steps)} steps")
                return {"plan": plan_obj.steps, "past_steps": [], "evidence_chain": []}
            except Exception as e:
                last_error = str(e)
                # Add the model's error response to the context as well, so it sees its failure
                messages.append(response)
                continue

        # All retries failed: return a degraded single-step plan for the Executor to attempt directly
        print(f"[Planner] ❌ All {MAX_PARSE_RETRIES+1} attempts failed. Falling back to single-step plan.")
        return {"plan": [user_input], "past_steps": [], "evidence_chain": []}

    async def execute_step(state: PlanExecuteState):
        """Execution node: pops the first step of the current plan and hands it to the sandbox environment for interactive execution"""
        plan = state["plan"]
        if not plan:
             print("[DataAnalyst Executor] ⚠️ Warning: Attempted to execute with empty plan. Returning state unchanged.")
             return {"plan": [], "past_steps": [], "evidence_chain": []}
             
        task = plan[0]

        # Read the current artifact index and inject it into the execution task context
        from tools.data_computation.sandbox import read_workspace_manifest, sandbox_current_task
        from core.config import WORKSPACES_DIR
        manifest = read_workspace_manifest(workspace_base=WORKSPACES_DIR)
        task_with_context = task
        if manifest:
            task_with_context += f"\n\n<workspace_manifest>\n{manifest}\n</workspace_manifest>"

        # Inject original user input to ensure the Executor can see the complete data provided by the user
        original_input = state.get("input", "")
        if original_input:
            task_with_context += f"\n\n<original_user_input>\n{original_input}\n</original_user_input>"

        # Inject the absolute path of the workspace directory to prevent the AI from doing full disk searches like 'find /'
        from tools.data_computation.sandbox import sandbox_thread_id
        thread_id = sandbox_thread_id.get(None)
        if thread_id:
            import os
            workspace_abs = os.path.join(os.path.abspath(WORKSPACES_DIR), f"thread_{thread_id}")
            task_with_context += f"\n\n[System Prompt] Current working directory: {workspace_abs}"

        # Set the task description in ContextVar for sandbox manifest logging
        sandbox_current_task.set(task)
        
        # Send the local target to the sub-ReAct state machine for execution
        try:
            agent_response = await executor_agent.ainvoke(
                {"messages": [HumanMessage(content=task_with_context)]}
            )
            # Get the information obtained after its execution (possibly containing a report returned after exception self-testing)
            execution_result = agent_response["messages"][-1].content
        except Exception as e:
            # Capture API errors, tool exceptions, etc., and pass the error message as the execution result to the reviewer
            # The reviewer will decide whether to retry based on the error message (Update_Plan)
            error_msg = f"[EXECUTION ERROR]: {type(e).__name__}: {str(e)}"
            print(f"[DataAnalyst Executor] ❌ Task failed with exception: {error_msg}")
            execution_result = (
                f"{error_msg}\n\n"
                f"-> An exception occurred during this step. The Reviewer should analyze the cause "
                f"and decide whether to decompose/modify the task and re-add it to the plan."
            )
        
        # Feed this step's summary back to the macro review state
        return {
            "plan": plan[1:],
            "past_steps": [(task, execution_result)],
            "evidence_chain": [{"task_reference": task, "content": execution_result}]
        }

    async def replan_step(state: PlanExecuteState):
        """Evaluation node: verify evidence, supplement the plan, or end the analysis"""
        
        remaining_plan = state.get("plan", [])
        past_steps = state.get("past_steps", [])
        
        # Hard limit: prevent the Reviewer from infinitely appending steps and causing dead loops
        if len(past_steps) >= MAX_REPLAN_CYCLES:
            print(f"[DataAnalyst Reviewer] 🛑 Reached max replan cycles ({MAX_REPLAN_CYCLES}). Force finishing.")
            summary_parts = [f"- {s[0]}" for s in past_steps[-3:]]  # Summary of the last 3 steps
            return {"response": f"Task reached the system limit after {len(past_steps)} steps and was automatically finished.\n\nRecently completed steps:\n" + "\n".join(summary_parts)}
        
        # Dynamic evaluation: even if the plan is not empty, call the LLM Reviewer to evaluate the current evidence and the remaining plan.
        # This allows finding execution errors midway and adjusting the plan at any time (achieving true dynamic replanning).
        print(f"[DataAnalyst Reviewer] 🔍 Evaluating step results. Remaining tasks: {len(remaining_plan)} (cycle {len(past_steps)}/{MAX_REPLAN_CYCLES})")
        # Directly format historical steps and evidence chains (without truncation, leveraging the model's large context capability)
        past_steps_fmt = "\n".join([
            f"- Completed task: {s[0]}\n  Execution result: {s[1]}"
            for s in state.get("past_steps", [])
        ])
        
        evidence_chain_fmt = "\n".join([
            f"- Core evidence({e.get('task_reference', 'N/A')}): {e.get('content', '')}"
            for e in state.get("evidence_chain", [])
        ])

        # Read the latest artifact index and inject it into the evaluation context
        from tools.data_computation.sandbox import read_workspace_manifest
        from core.config import WORKSPACES_DIR
        manifest = read_workspace_manifest(workspace_base=WORKSPACES_DIR)
        manifest_section = ""
        if manifest:
            manifest_section = f"\n\nFiles produced in the current workspace:\n<workspace_manifest>\n{manifest}\n</workspace_manifest>"

        # replanner_prompt is now a template string with placeholders; fill it using .format() and wrap it into a message
        filled_prompt = replanner_prompt.format(
            input=state.get("input", ""),
            past_steps=past_steps_fmt,
            evidence_chain=evidence_chain_fmt,
            plan=str(remaining_plan),
        ) + manifest_section

        # Context-aware constraint injection:
        # When the plan is not yet complete, the "Report" option is not given to the LLM — it can only adjust/confirm the remaining plan.
        # The "Report" option is only opened for the LLM to decide whether to finish once all steps are completed.
        if remaining_plan:
            filled_prompt += (
                "\n\n⚠️ [Current Stage Constraint] The remaining plan is not empty; you can only output `Update_Plan` at this stage. "
                "The `Report` option is unavailable until all steps are completed. "
                "Please evaluate the execution result of the latest step, decide whether to adjust the remaining steps, and then output `Update_Plan`."
            )

        messages = [HumanMessage(content=filled_prompt)]
        
        last_error = None
        for attempt in range(1 + MAX_PARSE_RETRIES):
            if attempt > 0:
                messages.append(HumanMessage(
                    content=f"[System Correction] Your previous output could not be parsed as valid JSON. Error: {last_error}\n"
                            f"Please re-output, only returning a raw JSON object, without any extra text."
                ))
                print(f"[Replanner] Retry {attempt}/{MAX_PARSE_RETRIES} after parse failure: {last_error}")

            response = await llm.ainvoke(messages)
            raw_text = response.content or ""

            try:
                data = extract_json(raw_text)
                output = Act(**data)
                
                if output.action == "Report":
                    return {"response": output.response}
                else:
                    return {"plan": output.plan.steps}
            except Exception as e:
                last_error = str(e)
                messages.append(response)
                continue

        # Fallback: all retries failed, report directly
        print(f"[Replanner] ❌ All attempts failed. Forcing Report with available evidence.")
        evidence_summary = "\n".join([
            f"- {step[0]}: {step[1][:200]}" 
            for step in state.get("past_steps", [])
        ])
        return {"response": f"Due to an internal system processing exception, the following is a summary of the analytical evidence collected so far:\n{evidence_summary}"}

    # ==== Edge / Router Definitions ====
    def should_end(state: PlanExecuteState):
        """If the final state indicator is received, finish flowing through the graph"""
        if "response" in state and state["response"]:
            return True
        else:
            return False

    # ==== Construct Global Graph ====
    workflow = StateGraph(PlanExecuteState)
    workflow.add_node("planner", plan_step)
    workflow.add_node("executor", execute_step)
    workflow.add_node("reviewer", replan_step)

    workflow.add_edge(START, "planner")
    workflow.add_edge("planner", "executor")
    workflow.add_edge("executor", "reviewer")
    workflow.add_conditional_edges(
        "reviewer",
        should_end,
        {True: END, False: "executor"},
    )
    
    # Compile into a self-executable main control App
    app = workflow.compile(checkpointer=checkpointer, store=store)
    return app
