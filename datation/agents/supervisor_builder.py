from typing import Any, List
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langgraph.graph import StateGraph, START, END

from .state_supervisor import SupervisorState
from .data_analyst.builder import compile_autodata_graph
from .data_analyst.state import PlanExecuteState
from .requirements_analyst.analyst import create_requirements_analyst_agent
from .report_generator.generator import create_report_generator_graph
from .qa_agent.agent import create_qa_agent
from .skill_executor.agent import create_skill_executor_agent
from datation.utils.i18n import t
from datation.core.config import load_app_config
from datation.utils.json_parser import extract_json

def _parse_requires_report(value) -> bool:
    """Robustly parse the requires_report field, tolerating various formats from the LLM."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in ('false', 'no', '0', 'false。')
    return True  # Report required by default

def compile_supervisor_graph(
    llm: BaseChatModel,
    tools: List[Any],
    skills_context: str = "",
    checkpointer=None,
    store=None,
):
    """
    Compile the top-level Supervisor routing graph — a true Orchestrator pattern.

    After execution finishes on any node, control returns to the Supervisor, which
    determines the next step based on last_completed_node, ensuring orchestration power
    remains strictly with the Supervisor.

    Complete Routing State Machine:
        START → Supervisor
        Supervisor:
          (initial)            → RequirementsAnalyst | DataAnalyst | SkillExecutor | FINISH
          (after Requirements) → DataAnalyst
          (after DataAnalyst)  → ReportGenerator | FINISH
          (after Report)       → FINISH
          (after SkillExecutor) → FINISH
        RequirementsAnalyst → Supervisor
        DataAnalyst         → Supervisor
        ReportGenerator     → Supervisor
        SkillExecutor       → Supervisor
        FINISH → END
    """
    import json
    from langchain_core.output_parsers import StrOutputParser

    # Compile each subgraph / Agent
    data_analyst_app = compile_autodata_graph(llm, tools, skills_context=skills_context, store=store)
    requirements_agent = create_requirements_analyst_agent(llm, tools, skills_context=skills_context)
    report_agent = create_report_generator_graph(llm, tools, skills_context=skills_context)
    qa_agent = create_qa_agent(llm, tools, skills_context=skills_context)
    skill_executor = create_skill_executor_agent(llm, tools, skills_context=skills_context)

    # ──────────────────────────────────────────
    # Supervisor Prompts (by phase)
    # ──────────────────────────────────────────
    from datation.agents.prompts import SUPERVISOR_INITIAL_PROMPT

    from core.config import get_language_directive
    def make_chain(system_prompt: str):
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt + get_language_directive()),
            MessagesPlaceholder(variable_name="messages"),
        ])
        return prompt | llm | StrOutputParser()

    chains = {
        "initial": make_chain(SUPERVISOR_INITIAL_PROMPT.replace("{skills_context}", skills_context)),
    }

    def _parse(raw: str, fallback: dict) -> dict:
        return extract_json(raw, fallback=fallback)

    def _check_and_handle_confirmation(content: str, agent_name: str):
        """
        Check if the content contains <<AWAITING_USER_CONFIRMATION>>.
        If yes:
            1. Strip the marker to get clean_content.
            2. Wrap AIMessage(content=clean_content, name=agent_name) as tagged_ai_msg.
            3. Throw an interrupt to wait for user input.
            4. Resume execution after user input to generate a HumanMessage.
            5. Return (True, [tagged_ai_msg, user_msg]) — flag that confirmation was triggered, and the produced message pair.
        If no:
            Return (False, AIMessage(content=content, name=agent_name)) — flag that confirmation was not triggered, and a normal AIMessage.
        """
        from langchain_core.messages import AIMessage, HumanMessage
        from langgraph.types import interrupt

        CONFIRMATION_MARKER = "<<AWAITING_USER_CONFIRMATION>>"
        if CONFIRMATION_MARKER in content:
            print(f"[{agent_name}] ⏸️ Output requires user confirmation → triggering interrupt")
            clean_content = content.replace(CONFIRMATION_MARKER, "").rstrip()
            tagged_ai_msg = AIMessage(content=clean_content, name=agent_name)

            # Trigger interrupt, wait for user input
            user_response = interrupt({
                "action": "confirmation",
                "agent": agent_name,
                "message": f"{agent_name} execution requires your confirmation",
                "display_message": clean_content
            })

            # Resume after user confirmation: wrap response as a message
            user_msg = HumanMessage(
                content=user_response if (isinstance(user_response, str) and user_response.strip()) else "Confirmed, please proceed"
            )
            return True, [tagged_ai_msg, user_msg]
        
        return False, AIMessage(content=content, name=agent_name)

    async def supervisor_node(state: SupervisorState):
        in_clarification = state.get("in_requirements_clarification", False)
        last = state.get("last_completed_node", "")

        # ──────────────────────────────────────────
        # 0. New conversation detection: if the last message is a HumanMessage from the user,
        #    it indicates the previous round has finished and the user initiated a new request. Reset last_completed_node
        #    to let LLM routing take over, otherwise hardcoded routing will FINISH directly.
        # ──────────────────────────────────────────
        messages = list(state.get("messages", []))
        last_msg = messages[-1] if messages else None
        last_msg_is_new_human = (
            last_msg is not None and
            (getattr(last_msg, "type", "").lower() in ("human", "humanmessage") or
             last_msg.__class__.__name__ == "HumanMessage") and
            last in ("ReportGenerator", "DataAnalyst", "RequirementsAnalyst", "QAAgent", "SkillExecutor")
        )
        # Flag to reset confirmation state when routing occurs
        _reset_confirmation = False
        _reset_brief = False
        if last_msg_is_new_human and not in_clarification:
            print(f"[Supervisor] 🔄 New HumanMessage after '{last}' — resetting state for fresh routing")
            last = ""  # Reset, use LLM routing
            _reset_brief = True  # Clear old requirements brief
            if state.get("awaiting_confirmation_from"):
                _reset_confirmation = True

        # ──────────────────────────────────────────
        # 1. Interview clarification mode (hardcoded, does not go through LLM)
        # ──────────────────────────────────────────
        if in_clarification:
            messages = list(state.get("messages", []))
            last_msg = messages[-1] if messages else None
            last_msg_type = ""
            if last_msg:
                last_msg_type = (
                    getattr(last_msg, "type", "")
                    or getattr(last_msg.__class__, "__name__", "")
                )
            last_is_human = last_msg_type.lower() in ("human", "humanmessage")

            # Hardcoded: if the user replies with explicit confirmation and we already have a preliminary brief, let it proceed directly
            if last_is_human:
                content = last_msg.content.strip()
                content_lower = content.lower().strip('.!')
                if content_lower in ("确认", "确定", "同意", "好的", "继续", "(用户已确认，请继续执行)", "confirm", "yes", "ok", "y", "sure", "agreed", "go ahead") and state.get("requirements_brief"):
                    print("[Supervisor] 🚀 Requirements confirmed via shortcut → routing to DataAnalyst")
                    return {
                        "next": "DataAnalyst",
                        "in_requirements_clarification": False,
                        "last_completed_node": "RequirementsAnalyst"
                    }

            if last_is_human or last == "RequirementsAnalyst_Step":
                # User just answered clarification question or just passed a step in requirements analysis -> route back to RequirementsAnalyst to continue judging
                print("[Supervisor] 🔄 Clarification/Step loop: routing back to RequirementsAnalyst")
                return {"next": "RequirementsAnalyst"}
            else:
                # Just triggered interrupt, waiting for user UI input
                print("[Supervisor] ⏸️ Clarification: waiting for user reply (FINISH)")
                return {"next": "FINISH"}

        # ──────────────────────────────────────────
        # 1.5 Agent multi-round confirmation interaction mode (generalized)
        # ──────────────────────────────────────────
        awaiting_confirm = state.get("awaiting_confirmation_from")
        if awaiting_confirm:
            messages = list(state.get("messages", []))
            last_msg = messages[-1] if messages else None
            last_msg_type = ""
            if last_msg:
                last_msg_type = (
                    getattr(last_msg, "type", "")
                    or getattr(last_msg.__class__, "__name__", "")
                )
            last_is_human = last_msg_type.lower() in ("human", "humanmessage")

            if last_is_human or last == f"{awaiting_confirm}_Step":
                # User replied with confirmation information -> route back to corresponding Agent to continue execution
                print(f"[Supervisor] 🔄 Confirmation loop: routing back to {awaiting_confirm}")
                return {"next": awaiting_confirm}
            else:
                # Just triggered interrupt, waiting for user input
                print(f"[Supervisor] ⏸️ Confirmation: waiting for user reply for {awaiting_confirm} (FINISH)")
                return {"next": "FINISH"}

        # ──────────────────────────────────────────
        # 2. Deterministic routing for known phases (hardcoded, does not go through LLM)
        # ──────────────────────────────────────────
        if last == "RequirementsAnalyst":
            # RequirementsAnalyst itself has handled multi-round interviews and final manual confirmation; once completed, go directly to DataAnalyst
            print("[Supervisor] ✅ RequirementsAnalyst (with approval) done → routing to DataAnalyst")
            return {"next": "DataAnalyst"}

        if last == "DataAnalyst":
            result = state.get("analysis_result", "")
            # Decide whether to bypass ReportGenerator based on anchored intent (determined by RequirementsAnalyst)
            if not state.get("requires_report", True):
                print("[Supervisor] 🚦 Task flagged as NO_REPORT → bypassing ReportGenerator → FINISH")
                return {"next": "FINISH"}

            # DataAnalyst finished analysis -> go to ReportGenerator
            print("[Supervisor] 📊 DataAnalyst done → routing to ReportGenerator")
            return {"next": "ReportGenerator"}

        if last == "ReportGenerator":
            # Report generation finished -> process ends (only triggered in internal routing phase after automatic pipeline completes)
            # Note: this branch is already bypassed by last="" above when last_msg_is_new_human=True.
            print("[Supervisor] 📄 ReportGenerator done → FINISH")
            return {"next": "FINISH"}

        if last == "QAAgent":
            # QA finished -> process ends (only triggered in internal routing phase, waiting for user's next question)
            print("[Supervisor] 💬 QAAgent done → FINISH")
            return {"next": "FINISH"}

        if last == "SkillExecutor":
            # Skill execution finished -> check if in a multi-round interaction
            if state.get("awaiting_confirmation_from") == "SkillExecutor":
                # Still in Skill interaction loop (waiting for user confirmation to continue)
                print("[Supervisor] 🛠️ SkillExecutor step done, still awaiting confirmation → FINISH (waiting for user)")
                return {"next": "FINISH"}
            print("[Supervisor] 🛠️ SkillExecutor done → FINISH")
            return {"next": "FINISH"}

        # ──────────────────────────────────────────
        # 3. Only the initial query goes through the LLM routing decision
        # ──────────────────────────────────────────
        chain = chains["initial"]
        fallback = {"next": "DataAnalyst"}

        decision = _parse(
            await chain.ainvoke({"messages": state["messages"]}),
            fallback=fallback,
        )
        route_next = decision.get("next", fallback["next"])
        direct_response = decision.get("direct_response")

        print(f"[Supervisor] 🤖 LLM initial routing decision: {route_next}")

        # Extract requires_report from LLM decision and write to state
        _rr = _parse_requires_report(decision.get("requires_report", True))
        print(f"[Supervisor] 📋 requires_report={_rr}")

        if route_next == "FINISH" and direct_response:
            from langchain_core.messages import AIMessage
            return {
                "next": "FINISH",
                "messages": [AIMessage(content=direct_response)],
            }

        # Clear last_completed_node on rerouting to prevent old state interference when Supervisor enters next time
        result = {"next": route_next, "last_completed_node": "", "requires_report": _rr}
        if _reset_confirmation:
            result["awaiting_confirmation_from"] = None
        if _reset_brief:
            result["requirements_brief"] = None  # Clear the old requirements brief to avoid interfering with new requests
        return result

    async def requirements_analyst_node(state: SupervisorState):
        """Requirements analysis ReAct Agent: single processing round, no self-looping, relies on Supervisor for multi-turn flow"""
        import json
        from langchain_core.messages import AIMessage, HumanMessage
        from langgraph.types import interrupt

        # Copy messages from state for internal processing
        current_messages = list(state["messages"])
        
        # Call sub-agent to handle one round
        agent_result = await requirements_agent.ainvoke(
            {"messages": current_messages}
        )
        ai_msg = agent_result["messages"][-1]
        raw_output = ai_msg.content

        # Parse JSON output from RequirementsAnalyst
        parsed = extract_json(raw_output, fallback={"type": "brief", "content": raw_output})
        req_type = parsed.get("type", "brief")

        if req_type == "clarification":
            # Needs interview feedback: throw interrupt and set flag
            question = parsed.get("question", raw_output)
            lang = load_app_config().get("language", "zh")
            clarification_msg = t("supervisor.clarification.title", lang=lang, question=question)
            
            # Manually inject a tagged AIMessage containing Markdown rendered content and hidden raw JSON (for LLM echo recognition)
            content_with_json = f"{clarification_msg}\n\n<!-- technical_json: {raw_output} -->"
            tagged_ai_msg = AIMessage(content=content_with_json, name="RequirementsAnalyst")
            
            # Block and wait
            user_response = interrupt({
                "action": "clarify", 
                "message": question,
                "display_message": clarification_msg
            })
            
            # Resume execution: wrap response as a message and return
            user_msg = HumanMessage(content=user_response if (isinstance(user_response, str) and user_response.strip()) else t("supervisor.clarification.user_reply", lang=lang))
            
            return {
                "messages": [tagged_ai_msg, user_msg],
                "in_requirements_clarification": True,
                "last_completed_node": "RequirementsAnalyst_Step", # Mark that this is mid-step
            }

        elif req_type == "brief":
            # Preliminary brief: throw interrupt
            brief_content = parsed.get("content", raw_output)
            lang = load_app_config().get("language", "zh")
            approval_prompt = t("supervisor.approval.title", lang=lang, brief=brief_content)
            
            content_with_json = f"{approval_prompt}\n\n<!-- technical_json: {raw_output} -->"
            tagged_ai_msg = AIMessage(content=content_with_json, name="RequirementsAnalyst")

            user_response = interrupt({
                "action": "await_approval", 
                "message": t("supervisor.approval.action", lang=lang),
                "display_message": approval_prompt
            })
            
            # If empty confirmation, inject a special instruction to assist LLM in approved judgment in the next round
            if not isinstance(user_response, str) or not user_response.strip():
                user_msg = HumanMessage(content=t("supervisor.approval.user_reply", lang=lang))
            else:
                user_msg = HumanMessage(content=user_response)

            _raw_rr = parsed.get("requires_report", True)
            _parsed_rr = _parse_requires_report(_raw_rr)
            print(f"[RequirementsAnalyst] requires_report: raw={_raw_rr!r} → parsed={_parsed_rr}")

            return {
                "messages": [tagged_ai_msg, user_msg],
                "in_requirements_clarification": True,
                "last_completed_node": "RequirementsAnalyst_Step",
                "requirements_brief": brief_content,
                "requires_report": _parsed_rr,
            }

        elif req_type == "approved":
            # Final approval
            brief_content = parsed.get("content", raw_output)
            _raw_rr = parsed.get("requires_report", True)
            _parsed_rr = _parse_requires_report(_raw_rr)
            print(f"[RequirementsAnalyst] approved requires_report: raw={_raw_rr!r} → parsed={_parsed_rr}")
            return {
                "messages": [ai_msg],
                "requirements_brief": brief_content,
                "in_requirements_clarification": False,
                "last_completed_node": "RequirementsAnalyst",
                "requires_report": _parsed_rr,
            }

        else:
            # Fallback
            return {
                "messages": [ai_msg],
                "requirements_brief": raw_output,
                "in_requirements_clarification": False,
                "last_completed_node": "RequirementsAnalyst",
            }

    async def data_analyst_node(state: SupervisorState):
        """Data analysis subgraph: Plan-and-Execute + ReAct Executor"""
        from langchain_core.messages import HumanMessage, AIMessage
        # Prioritize structured description from requirements analysis as input
        analysis_input = state.get("requirements_brief") or state["messages"][-1].content

        sub_input: PlanExecuteState = {
            "input": analysis_input,
            "plan": [],
            "past_steps": [],
            "evidence_chain": [],
        }
        try:
            sub_state = await data_analyst_app.ainvoke(sub_input)
            answer = sub_state.get("response", "Data Analyst executed but produced no response.")
        except Exception as e:
            error_msg = f"[DataAnalyst Execution Exception] {type(e).__name__}: {str(e)}"
            print(f"[DataAnalyst Node] ❌ {error_msg}")
            answer = f"{error_msg}\n\n-> An exception occurred during the execution of the data analysis subgraph. Please check your API configuration or balance and try again."

        is_interrupted, msg_result = _check_and_handle_confirmation(answer, "DataAnalyst")
        if is_interrupted:
            return {
                "messages": msg_result,
                "awaiting_confirmation_from": "DataAnalyst",
                "last_completed_node": "DataAnalyst_Step",
            }
        else:
            return {
                "messages": [msg_result],
                "analysis_result": answer,
                "awaiting_confirmation_from": None,
                "last_completed_node": "DataAnalyst",
            }

    async def report_generator_node(state: SupervisorState):
        """Report Generator ReAct Agent: collect all analysis output and generate a professional HTML report"""
        import time
        from langchain_core.messages import AIMessage, HumanMessage

        original_query = ""
        for msg in state["messages"]:
            if msg.__class__.__name__ == "HumanMessage" or getattr(msg, "type", "") == "human":
                original_query = msg.content
                break

        analysis_result = state.get("analysis_result", "(No analysis result)")
        ts = time.strftime("%Y-%m-%d %H:%M:%S")

        task_prompt = (
            f"Please generate a complete, professional report for the following data analysis task.\n\n"
            f"## Original User Requirements\n{original_query}\n\n"
            f"## DataAnalyst Executive Summary\n{analysis_result}\n\n"
            f"## Report Generation Guidelines\n"
            f"- The system will automatically read all analysis output files under outputs/\n"
            f"- Please refer to specific data and charts in each chapter based on the retrieved data\n"
            f"- Please reference chart files using Markdown image syntax (e.g., `![description](run_X/chart.png)`)\n"
            f"- The system will automatically convert your Markdown report into a beautiful HTML web page\n\n"
            f"Report Generation Time: {ts}\n"
        )

        try:
            result = await report_agent.ainvoke(
                {"messages": [HumanMessage(content=task_prompt)], "available_files": [], "outline": None, "chapters": [], "current_chapter_index": 0, "final_markdown": None, "final_html": None}
            )

            # Extract final report from new state
            final_markdown = result.get("final_markdown", "")
            final_html = result.get("final_html", "")
            report = final_markdown if final_markdown else "Report generation failed"

            if final_html:
                print(f"[ReportGen] ✅ HTML report generated ({len(final_html)} bytes)")
            else:
                print("[ReportGen] ⚠️ No HTML report was generated")
        except Exception as e:
            error_msg = f"[ReportGenerator Execution Exception] {type(e).__name__}: {str(e)}"
            print(f"[ReportGen] ❌ {error_msg}")
            report = f"{error_msg}\n\n-> An exception occurred during report generation. Please check your API configuration or balance and try again."

        # Report is final output, no user confirmation needed — clear confirmation markers that the LLM might generate
        CONFIRMATION_MARKER = "<<AWAITING_USER_CONFIRMATION>>"
        report = report.replace(CONFIRMATION_MARKER, "").rstrip()
        return {
            "messages": [AIMessage(content=report, name="ReportGenerator")],
            "awaiting_confirmation_from": None,
            "last_completed_node": "ReportGenerator",
        }

    async def qa_agent_node(state: SupervisorState):
        """QA Agent provides Q&A on generated reports and data"""
        from langchain_core.messages import AIMessage

        current_messages = list(state["messages"])
        try:
            result = await qa_agent.ainvoke({"messages": current_messages})
            ai_msg = result["messages"][-1]
            content = ai_msg.content
        except Exception as e:
            error_msg = f"[QAAgent Execution Exception] {type(e).__name__}: {str(e)}"
            print(f"[QAAgent] ❌ {error_msg}")
            content = f"{error_msg}\n\n-> An exception occurred during QA. Please check your API configuration or balance and try again."

        is_interrupted, msg_result = _check_and_handle_confirmation(content, "QAAgent")
        if is_interrupted:
            return {
                "messages": msg_result,
                "awaiting_confirmation_from": "QAAgent",
                "last_completed_node": "QAAgent_Step",
            }
        else:
            return {
                "messages": [msg_result],
                "awaiting_confirmation_from": None,
                "last_completed_node": "QAAgent",
            }

    async def skill_executor_node(state: SupervisorState):
        """Skill Execution Expert: pure ReAct mode, supporting multi-round interaction (blocking on interrupt for user confirmation)"""
        from langchain_core.messages import AIMessage, HumanMessage
        from langgraph.types import interrupt
        import os
        from core.config import WORKSPACES_DIR
        from tools.data_computation.sandbox import read_workspace_manifest

        awaiting_confirm = state.get("awaiting_confirmation_from")

        if awaiting_confirm == "SkillExecutor":
            # Multi-round mode: continue passing full message chain to the agent
            current_messages = list(state["messages"])
            print(f"[SkillExecutor] 🔄 Resuming skill execution with {len(current_messages)} messages...")
        else:
            # First execution: prioritize user's latest HumanMessage (instead of possibly outdated requirements_brief)
            task_input = ""
            for msg in reversed(state["messages"]):
                if msg.__class__.__name__ == "HumanMessage" or getattr(msg, "type", "") == "human":
                    task_input = msg.content
                    break

            if not task_input:
                raise ValueError("[SkillExecutor] Cannot find any HumanMessage in state['messages'], please check the conversation status.")

            # Detect @skill-name in user message, extract and inject skill info into the front of task_input
            import re
            _skill_match = re.search(r'@([\w-]+)', task_input)
            if _skill_match:
                _skill_name = _skill_match.group(1)
                # Search for the corresponding skill location in skills_context XML
                _loc_pattern = re.search(
                    rf'<name>{re.escape(_skill_name)}</name>\s*<description>.*?</description>\s*<location>(.*?)</location>',
                    skills_context, re.DOTALL
                )
                if _loc_pattern:
                    _skill_location = _loc_pattern.group(1).strip()
                    import sys as _sys
                    _read_cmd = 'type' if _sys.platform == 'win32' else 'cat'
                    task_input = (
                        f"⚠️ [Forced Execution Directive] Your first step MUST be using ShellExecutor to run `{_read_cmd} {_skill_location}` "
                        f"to read the complete SKILL.md SOP file of @{_skill_name}, and then strictly follow the SOP workflow to execute the task. "
                        f"DO NOT bypass this step, and do not perform independent data analysis.\n\n"
                        f"---\n\n"
                    ) + task_input
                    print(f"[SkillExecutor] 🎯 Injected forced skill instruction: @{_skill_name} -> {_skill_location}")

            # Inject workspace context
            manifest = read_workspace_manifest(workspace_base=WORKSPACES_DIR)
            if manifest:
                task_input += f"\n\n<workspace_manifest>\n{manifest}\n</workspace_manifest>"

            # Get thread_id: prioritize ContextVar, then LangGraph config
            from tools.data_computation.sandbox import sandbox_thread_id
            thread_id = sandbox_thread_id.get(None)
            if not thread_id:
                # Try to get from state's configurable
                _cfg = state.get("configurable", {}) if isinstance(state, dict) else {}
                thread_id = _cfg.get("thread_id", None)
            
            print(f"[SkillExecutor] 🔍 Resolved thread_id: {thread_id}")
            
            if thread_id:
                workspace_abs = os.path.join(os.path.abspath(WORKSPACES_DIR), f"thread_{thread_id}")
                outputs_abs = os.path.join(workspace_abs, "outputs")
                os.makedirs(outputs_abs, exist_ok=True)
                task_input += f"\n[System Prompt] Output file directory (all files must be written to this directory): {outputs_abs}"
                task_input += f"\n[System Prompt] ⚠️ All generated files and project directories must be created under the output directory above. Writing files outside this directory is prohibited."
                
                # List contents of outputs and uploads directories to help the skill discover existing files
                outputs_dir = outputs_abs
                uploads_dir = os.path.join(workspace_abs, "uploads")
                if os.path.isdir(outputs_dir):
                    try:
                        output_files = os.listdir(outputs_dir)
                        if output_files:
                            task_input += f"\n[System Prompt] The following files already exist in the current directory:\n" + "\n".join(f"- {f}" for f in sorted(output_files))
                            print(f"[SkillExecutor] 📂 Injected {len(output_files)} output files into context")
                    except Exception:
                        pass
                if os.path.isdir(uploads_dir):
                    try:
                        upload_files = os.listdir(uploads_dir)
                        if upload_files:
                            task_input += f"\n[System Prompt] The uploads/ directory already contains the following files (located at {uploads_dir}):\n" + "\n".join(f"- {f}" for f in sorted(upload_files))
                            print(f"[SkillExecutor] 📂 Injected {len(upload_files)} upload files into context")
                    except Exception:
                        pass

            current_messages = [HumanMessage(content=task_input)]
            print(f"[SkillExecutor] 📝 Task input ({len(task_input)} chars): {task_input[:300]}...")

        try:
            result = await skill_executor.ainvoke({"messages": current_messages})
            ai_msg = result["messages"][-1]
            content = ai_msg.content
        except Exception as e:
            error_msg = f"[SkillExecutor Execution Exception] {type(e).__name__}: {str(e)}"
            print(f"[SkillExecutor] ❌ {error_msg}")
            content = f"{error_msg}\n\n-> An exception occurred during skill execution. Please check your API configuration or balance and try again."
            return {
                "messages": [AIMessage(content=content, name="SkillExecutor")],
                "last_completed_node": "SkillExecutor",
                "awaiting_confirmation_from": None,
            }

        is_interrupted, msg_result = _check_and_handle_confirmation(content, "SkillExecutor")
        if is_interrupted:
            return {
                "messages": msg_result,
                "awaiting_confirmation_from": "SkillExecutor",
                "last_completed_node": "SkillExecutor_Step",
            }
        else:
            return {
                "messages": [msg_result],
                "awaiting_confirmation_from": None,
                "last_completed_node": "SkillExecutor",
            }

    # ──────────────────────────────────────────
    # Build Graph
    # ──────────────────────────────────────────
    builder = StateGraph(SupervisorState)    # Add all nodes
    builder.add_node("Supervisor", supervisor_node)
    builder.add_node("RequirementsAnalyst", requirements_analyst_node)
    builder.add_node("DataAnalyst", data_analyst_node)
    builder.add_node("ReportGenerator", report_generator_node)
    builder.add_node("QAAgent", qa_agent_node)
    builder.add_node("SkillExecutor", skill_executor_node)

    # Draw state transition edges (Edges)
    builder.add_edge(START, "Supervisor")
    
    # Once child agents complete execution, uniformly return to Supervisor for routing decisions
    # Alternatively, child nodes could route directly once status changes (depends on architectural choice; here we use Supervisor as a unified entry/exit control)
    
    # Supervisor makes a decision and routes the stream to the corresponding child agent
    # Conditional branching for {"next": "WorkerName"}
    builder.add_conditional_edges(
        "Supervisor",
        lambda x: x["next"],
        {
            "RequirementsAnalyst": "RequirementsAnalyst",
            "DataAnalyst": "DataAnalyst",
            "ReportGenerator": "ReportGenerator",
            "QAAgent": "QAAgent",
            "SkillExecutor": "SkillExecutor",
            "FINISH": END
        }
    )

    builder.add_edge("RequirementsAnalyst", "Supervisor")
    builder.add_edge("DataAnalyst", "Supervisor")
    builder.add_edge("ReportGenerator", "Supervisor")
    builder.add_edge("QAAgent", "Supervisor")
    builder.add_edge("SkillExecutor", "Supervisor")

    return builder.compile(checkpointer=checkpointer)
