import json
import os
import uuid
import time
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langgraph.graph import END

import core.state as state
from core.config import (
    SAVER_TYPE, WORKSPACES_DIR, TEMPERATURE, KNOWLEDGE_DIR,
    DATA_SOURCES_DIR, SKILLS_DIR, MODEL_NAME,
    LLM_API_BASE, LLM_API_KEY, LLM_MAX_TOKENS, load_app_config
)
from utils.i18n import t
from tools.data_computation.sandbox import sandbox_thread_id, sandbox_history_thread_ids

router = APIRouter()

class AnalyzeRequest(BaseModel):
    query: str
    thread_id: str | None = None
    is_retry: bool = False
    restore_history: bool = False
    view_only: bool = False
    enable_thinking: bool = False
    history_thread_ids: list[str] = []
    history_labels: list[dict] = []  # [{"id": str, "query": str}]
    enabled_mcp_servers: list[str] = []
    uploaded_files: list[str] = []

@router.post("/analyze")
async def start_analysis(request: AnalyzeRequest):
    """
    Trigger system analysis.
    Use asynchronous ainvoke to submit the task to the graph with real system environment connection capability.
    Implements a three-layer Tool loading architecture: dynamically load Layer 3 MCP Tools selected by the user.
    """
    if not state.agent_app:
        return {"error": "System booting or graph building failed."}
    if not LLM_API_KEY:
        return {"error": "LLM API Key is not configured. Please go to Settings and configure your model API key."}
        
    from langchain_core.messages import HumanMessage
    initial_state = {
        "messages": [HumanMessage(content=request.query)]
    }
    
    thread_id = request.thread_id or str(uuid.uuid4())
    # [FIX] Set ContextVar immediately to ensure that any child tasks derived from subsequent ainvoke inherit the correct session isolation
    sandbox_thread_id.set(thread_id)
    
    # Filter Layer 3 MCP tools selected by the user
    all_mcp_tools = await state.mcp_manager.get_tools()
    filtered_mcp_tools = []
    if request.enabled_mcp_servers:
        filtered_mcp_tools = [
            t for t in all_mcp_tools
            if any(t.name.replace("-", "_").startswith(f"{server.replace('-', '_')}_") for server in request.enabled_mcp_servers)
        ]
        
    # Dynamically assemble a graph exclusive to the current request
    from agents.supervisor_builder import compile_supervisor_graph
    from tools.data_computation.sandbox import create_data_computation_tool
    from tools.local_file_reader.reader import build_local_file_reader_tool
    from tools.web_search.search import build_web_search_tool
    from tools.knowledge_search.searcher import build_knowledge_search_tool
    from tools.shell_executor.shell import build_shell_executor_tool
    from tools.memory.save_preference import build_memory_manager_tools
    from tools.memory.session_experience import build_session_experience_tools
    from skill_loader import inject_skills_context
    
    base_tools = [
        create_data_computation_tool(workspace_base=WORKSPACES_DIR),
        build_local_file_reader_tool(base_path=DATA_SOURCES_DIR, workspace_base=WORKSPACES_DIR),
        build_web_search_tool(),
        build_knowledge_search_tool(knowledge_base_path=KNOWLEDGE_DIR),
        build_shell_executor_tool(cwd=WORKSPACES_DIR),
    ]
    base_tools.extend(build_memory_manager_tools(workspace_base=WORKSPACES_DIR))
    base_tools.extend(build_session_experience_tools(workspace_base=WORKSPACES_DIR))
    base_tools.extend(filtered_mcp_tools)

    skills_ctx = inject_skills_context(skills_dir=SKILLS_DIR)
    active_app = compile_supervisor_graph(
        state.llm, base_tools,
        skills_context=skills_ctx,
        checkpointer=state.agent_app.checkpointer,
        store=state.agent_app.store if hasattr(state.agent_app, 'store') else None,
    )
    
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 100}
    
    # Safely drive MCP Tools node execution containing async calls based on an async event loop
    result = await active_app.ainvoke(initial_state, config=config)
    
    final_report = "Dispatch and processing completed"
    if "messages" in result and len(result["messages"]) > 0:
        final_report = result["messages"][-1].content
        
    return {
        "thread_id": thread_id,
        "query": request.query,
        "final_report": final_report,
        "action_chain": [] # Currently the top-level is not easy to expand with specific underlying actions, left blank or to be read from the graph later
    }

@router.post("/analyze/stream")
async def stream_analysis(request: AnalyzeRequest, fastapi_req: Request):
    """
    Provide SSE (Server-Sent Events) real-time graph state streaming.
    Also expose fine-grained LLM/Tool call logs for consumption by the frontend log panel.
    """
    if not state.agent_app:
        async def _err():
            yield f"data: {json.dumps({'type': 'node', 'node': '__error__', 'final_response': 'System booting or graph building failed.', 'status': 'error'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(_err(), media_type="text/event-stream")

    if not LLM_API_KEY:
        async def _err_key():
            yield f"data: {json.dumps({'type': 'config_required', 'field': 'llm_api_key', 'message': 'LLM API Key is not configured'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(_err_key(), media_type="text/event-stream")

    from langchain_core.messages import HumanMessage, AIMessage
    from langgraph.types import Command
    
    thread_id = request.thread_id or str(uuid.uuid4())
    # [FIX] Set ContextVar immediately to ensure that subsequent graph compilation or preprocessing logic inherits the correct session isolation
    sandbox_thread_id.set(thread_id)

    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 100}
    lang = load_app_config().get('language', 'zh')

    # ---- Prioritize determining the target workspace directory (for state persistence, loading history, etc.) ----
    _workspace_dir = os.path.abspath(WORKSPACES_DIR)
    target_workspace = None
    current_iso_time = datetime.now(timezone.utc).isoformat()
    
    if SAVER_TYPE == "postgres" and state.postgres_pool:
        try:
            # Note: We must use synchronous psycopg3 or acquire conn carefully.
            # But stream_analysis is an async function, we can use async context managers.
            async with state.postgres_pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT workspace_path FROM thread_metadata WHERE thread_id = %s", (thread_id,))
                    row = await cur.fetchone()
                    if row and row[0]:
                        target_workspace = row[0]
                        await cur.execute(
                            "UPDATE thread_metadata SET updated_at = CURRENT_TIMESTAMP WHERE thread_id = %s",
                            (thread_id,)
                        )
                    elif request.restore_history:
                        print(f"[Meta] Skip metadata creation for non-existent thread restoration: {thread_id}")
                        target_workspace = os.path.join(_workspace_dir, f"thread_{thread_id}")
                    else:
                        target_workspace = os.path.join(_workspace_dir, f"thread_{thread_id}")
                        await cur.execute(
                            "INSERT INTO thread_metadata (thread_id, workspace_path) VALUES (%s, %s)",
                            (thread_id, target_workspace)
                        )
                    await conn.commit()
        except Exception as _e:
            print(f"[Meta] DB Error in stream_analysis workspace resolution: {_e}")

    # Fallback for Memory Saver
    if not target_workspace:
        meta = state.global_memory_meta.get(thread_id, {})
        if "workspace_path" in meta:
            target_workspace = meta["workspace_path"]
        else:
            target_workspace = os.path.join(_workspace_dir, f"thread_{thread_id}")
        
        meta["workspace_path"] = target_workspace
        meta["updated_at"] = current_iso_time
        if "created_at" not in meta:
            meta["created_at"] = current_iso_time
        state.global_memory_meta[thread_id] = meta
        
    os.makedirs(target_workspace, exist_ok=True)
    
    # ---- Save/Restore MCP Servers selected by the user ----
    mcp_selection_file = os.path.join(target_workspace, ".mcp_servers.json")
    if request.enabled_mcp_servers and len(request.enabled_mcp_servers) > 0:
        # The user explicitly passed the selection list in the UI, save it
        try:
            with open(mcp_selection_file, "w", encoding="utf-8") as f:
                json.dump(request.enabled_mcp_servers, f)
        except Exception as e:
            print(f"[TCP] Failed to save MCP selection: {e}")
    else:
        # Not passed by UI (e.g. resuming conversation directly in history after page refresh), try reading from local
        if os.path.exists(mcp_selection_file):
            try:
                with open(mcp_selection_file, "r", encoding="utf-8") as f:
                    request.enabled_mcp_servers = json.load(f)
                    print(f"[MCP] Restored MCP selection from disk: {request.enabled_mcp_servers}")
            except Exception as e:
                pass

    # ---- Save/Restore uploaded files list ----
    uploads_meta_file = os.path.join(target_workspace, ".uploads.json")
    uploads_dir = os.path.join(target_workspace, "uploads")
    if request.uploaded_files and len(request.uploaded_files) > 0:
        # New message: save the filename of current upload
        try:
            with open(uploads_meta_file, "w", encoding="utf-8") as f:
                json.dump(request.uploaded_files, f, ensure_ascii=False)
        except Exception as e:
            print(f"[Uploads] Failed to save upload list: {e}")
    else:
        # History restore: prioritize reading metadata file
        if os.path.exists(uploads_meta_file):
            try:
                with open(uploads_meta_file, "r", encoding="utf-8") as f:
                    request.uploaded_files = json.load(f)
                    print(f"[Uploads] Restored upload list from disk: {request.uploaded_files}")
            except Exception as e:
                pass
        # Fallback: scan uploads/ directory (compatible with old sessions that did not save metadata)
        elif os.path.exists(uploads_dir):
            try:
                files = [f for f in os.listdir(uploads_dir) if not f.startswith('.')]
                if files:
                    request.uploaded_files = files
                    print(f"[Uploads] Scanned uploads dir, found: {files}")
            except Exception as e:
                pass

    # ---- Option persistence per message (messages_meta.jsonl) ----
    # Add one line per message, recorded sequentially, do not overwrite history
    messages_meta_file = os.path.join(target_workspace, "messages_meta.jsonl")
    if not request.restore_history and request.query:
        # New message: append record to JSONL
        try:
            meta_entry = {
                "enable_thinking": request.enable_thinking,
                "enabled_mcp_servers": request.enabled_mcp_servers,
                "uploaded_files": request.uploaded_files,
                "history_thread_ids": request.history_thread_ids,
                "history_labels": request.history_labels,
            }
            with open(messages_meta_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(meta_entry, ensure_ascii=False) + "\n")
        except Exception as e:
            print(f"[MessagesMeta] Failed to append: {e}")

    # Filter MCP tools (moved outside, before graph compilation)
    all_mcp_tools = await state.mcp_manager.get_tools()
    if request.enabled_mcp_servers:
        filtered_mcp_tools = [
            t for t in all_mcp_tools
            if any(t.name.replace("-", "_").startswith(f"{server.replace('-', '_')}_") for server in request.enabled_mcp_servers)
        ]
        print(f"[MCP] Filtered to {len(filtered_mcp_tools)}/{len(all_mcp_tools)} tools from servers: {request.enabled_mcp_servers}")
    else:
        filtered_mcp_tools = []
        print(f"[MCP] No MCP servers selected, using 0 MCP tools")

    # ---- Thinking Mode: ChatOpenAIThinking is used to support reasoning_content callback ----
    if request.enable_thinking:
        from core.thinking_chat import ChatOpenAIThinking
        from agents.supervisor_builder import compile_supervisor_graph
        from langgraph.checkpoint.memory import MemorySaver
        from tools.data_computation.sandbox import create_data_computation_tool
        from tools.local_file_reader.reader import build_local_file_reader_tool
        from tools.web_search.search import build_web_search_tool
        from tools.knowledge_search.searcher import build_knowledge_search_tool
        from tools.shell_executor.shell import build_shell_executor_tool
        from tools.memory.save_preference import build_memory_manager_tools
        from tools.memory.session_experience import build_session_experience_tools
        from skill_loader import inject_skills_context

        clean_model = MODEL_NAME.split('/')[-1] if '/' in MODEL_NAME else MODEL_NAME
        reasoning_llm = ChatOpenAIThinking(
            model=clean_model,
            temperature=TEMPERATURE,
            openai_api_base=LLM_API_BASE,
            openai_api_key=LLM_API_KEY,
            max_tokens=LLM_MAX_TOKENS,
            streaming=False,
            model_kwargs={
                "extra_body": {
                    "thinking": {"type": "enabled"},
                    "reasoning_effort": "high",
                },
            },
        )
        thinking_tools = [
            create_data_computation_tool(workspace_base=WORKSPACES_DIR),
            build_local_file_reader_tool(base_path=DATA_SOURCES_DIR, workspace_base=WORKSPACES_DIR),
            build_web_search_tool(),
            build_knowledge_search_tool(knowledge_base_path=KNOWLEDGE_DIR),
            build_shell_executor_tool(cwd=WORKSPACES_DIR),
        ]
        thinking_tools.extend(build_memory_manager_tools(workspace_base=WORKSPACES_DIR))
        thinking_tools.extend(build_session_experience_tools(workspace_base=WORKSPACES_DIR))
        thinking_tools.extend(filtered_mcp_tools)
        skills_ctx = inject_skills_context(skills_dir=SKILLS_DIR)
        _checkpointer = state.postgres_pool and __import__('langgraph.checkpoint.postgres.aio', fromlist=['AsyncPostgresSaver']).AsyncPostgresSaver(state.postgres_pool) or MemorySaver()
        active_app = compile_supervisor_graph(
            reasoning_llm, thinking_tools,
            skills_context=skills_ctx,
            checkpointer=_checkpointer,
        )
        print(f"[Thinking Mode] 🧠 Using {clean_model} with thinking enabled for thread {thread_id}")
    else:
        # Dynamically compile graph to use filtered MCP tools
        from agents.supervisor_builder import compile_supervisor_graph
        from tools.data_computation.sandbox import create_data_computation_tool
        from tools.local_file_reader.reader import build_local_file_reader_tool
        from tools.web_search.search import build_web_search_tool
        from tools.knowledge_search.searcher import build_knowledge_search_tool
        from tools.shell_executor.shell import build_shell_executor_tool
        from tools.memory.save_preference import build_memory_manager_tools
        from tools.memory.session_experience import build_session_experience_tools
        from skill_loader import inject_skills_context

        base_tools = [
            create_data_computation_tool(workspace_base=WORKSPACES_DIR),
            build_local_file_reader_tool(base_path=DATA_SOURCES_DIR, workspace_base=WORKSPACES_DIR),
            build_web_search_tool(),
            build_knowledge_search_tool(knowledge_base_path=KNOWLEDGE_DIR),
            build_shell_executor_tool(cwd=WORKSPACES_DIR),
        ]
        base_tools.extend(build_memory_manager_tools(workspace_base=WORKSPACES_DIR))
        base_tools.extend(build_session_experience_tools(workspace_base=WORKSPACES_DIR))
        base_tools.extend(filtered_mcp_tools)

        skills_ctx = inject_skills_context(skills_dir=SKILLS_DIR)
        active_app = compile_supervisor_graph(
            state.llm, base_tools,
            skills_context=skills_ctx,
            checkpointer=state.agent_app.checkpointer if state.agent_app else None,
            store=state.agent_app.store if (state.agent_app and hasattr(state.agent_app, 'store')) else None,
        )
        print(f"[Normal Mode] Using filtered MCP tools for thread {thread_id}")

    # Check if the graph is currently awaiting an interrupt resumption
    curr_state = await active_app.aget_state(config)
    is_interrupted = curr_state and curr_state.tasks and any(t.interrupts for t in curr_state.tasks)
    
    if (request.is_retry or request.view_only) and request.thread_id and not request.query:
        # Pure reconnection to load history (in view_only mode, paused sessions only replay and do not resume)
        initial_state = None
    elif is_interrupted:
        # We are resuming from an interrupt (e.g., RequirementsAnalyst)
        if not request.query:
            initial_state = None
        else:
            initial_state = Command(resume=request.query)
    else:
        # Starting a normal fresh analysis step or continuing a conversation
        if not request.query:
            initial_state = None
        else:
            user_message = request.query
            # If a historical workspace directory is selected, add prompt info
            if request.history_thread_ids:
                history_hint = f"\n\n[System Prompt] The user has selected the workspace directories of {len(request.history_thread_ids)} historical conversations for you to access. These directories contain data files, charts, etc. generated in previous analyses. You should:\n1. Use the LocalFileReader tool to list available files in the historical workspaces\n2. Directly read these files in your Python code for analysis\n3. The full paths of the historical workspaces will be automatically injected as comments during code execution"
                user_message += history_hint

            initial_state = {
                "messages": [HumanMessage(content=user_message)]
            }

            # Inject uploaded file list into the message to ensure AI knows all available files
            if request.uploaded_files:
                files_hint = "\n\n[System Prompt] The user has uploaded the following files (located in the uploads/ directory, which can be read by passing the filename to LocalFileReader):\n"
                for fname in request.uploaded_files:
                    files_hint += f"- {fname}\n"
                initial_state["messages"][0].content += files_hint

    async def event_generator():
        # Inject thread_id into sandbox's ContextVar so it can record the workspace directory mapping
        sandbox_thread_id.set(thread_id)
        sandbox_history_thread_ids.set(request.history_thread_ids)

        # Debug logs
        if request.history_thread_ids:
            print(f"[History Workspaces] Selected {len(request.history_thread_ids)} history threads: {request.history_thread_ids}")
        else:
            print(f"[History Workspaces] No history threads selected")

        # Note: target_workspace is already resolved at the upper layer, use it directly here
        logs_path = os.path.join(target_workspace, "stream_logs.jsonl")

        def append_log(log_entry: dict):
            try:
                with open(logs_path, "a", encoding="utf-8") as _f:
                    _f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
            except Exception as _e:
                print(f"[Log] Warning: failed to write stream_logs: {_e}")

        def persist_markdown(filename: str, content: str):
            """Save key Markdown output to the workspace's outputs directory."""
            try:
                outputs_dir = os.path.join(target_workspace, "outputs")
                os.makedirs(outputs_dir, exist_ok=True)
                file_path = os.path.join(outputs_dir, filename)
                with open(file_path, "w", encoding="utf-8") as _f:
                    _f.write(content)
                print(f"[Persist] Saved {filename} to {outputs_dir}")
            except Exception as _e:
                print(f"[Persist] Warning: failed to save {filename}: {_e}")

        plan_state_path = os.path.join(target_workspace, "plan_state.json")

        def persist_plan_state():
            """Persist current plan and completed_tasks to disk, ensuring the full progress can be restored during resumption."""
            try:
                with open(plan_state_path, "w", encoding="utf-8") as _f:
                    json.dump({"plan": current_plan, "past_steps": completed_tasks}, _f, ensure_ascii=False)
            except Exception as _e:
                print(f"[PlanState] Warning: failed to persist plan state: {_e}")

        # Load existing state if this is a retry or we want to be safe
        saved_state = await active_app.aget_state(config)
        state_values = saved_state.values if saved_state else {}
        # Prioritize restoring from disk plan_state.json (contains full progress of DataAnalyst subgraph)
        # SupervisorState at the outer layer of checkpoint does not contain plan/past_steps
        if os.path.exists(plan_state_path):
            try:
                with open(plan_state_path, "r", encoding="utf-8") as _f:
                    disk_plan_state = json.load(_f)
                current_plan = disk_plan_state.get("plan", [])
                completed_tasks = disk_plan_state.get("past_steps", [])
                print(f"[PlanState] Restored from disk: {len(current_plan)} planned, {len(completed_tasks)} completed")
            except Exception as _e:
                print(f"[PlanState] Warning: failed to load plan_state.json: {_e}")
                current_plan = state_values.get("plan", [])
                completed_tasks = state_values.get("past_steps", [])
        else:
            current_plan = state_values.get("plan", [])
            completed_tasks = state_values.get("past_steps", [])

        try:
            # Load per-message options metadata for history restore
            all_messages_meta = []
            if request.restore_history and os.path.exists(messages_meta_file):
                try:
                    with open(messages_meta_file, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                all_messages_meta.append(json.loads(line))
                except Exception as e:
                    print(f"[MessagesMeta] Failed to read: {e}")

            # Emit the system chunk - for new messages, include current options;
            # for history restores, include per-message options list
            yield f"data: {json.dumps({'type': 'system', 'thread_id': thread_id, 'enabled_mcp_servers': request.enabled_mcp_servers or [], 'uploaded_files': request.uploaded_files or [], 'enable_thinking': request.enable_thinking, 'history_thread_ids': request.history_thread_ids, 'history_labels': request.history_labels, 'messages_meta': all_messages_meta})}\n\n"
            

            # -----------------------------------------------------------------
            # [HISTORY RESTORATION LOGIC]
            # ... (rest of the logic)
            next_nodes = saved_state.next if saved_state else []
            is_finished = not next_nodes
            
            if request.restore_history and saved_state:
                # 1. Restore previously saved real-time logs
                if os.path.exists(logs_path):
                    try:
                        with open(logs_path, "r", encoding="utf-8") as _f:
                            for line in _f:
                                line = line.strip()
                                if line:
                                    try:
                                        log_entry = json.loads(line)
                                        yield f"data: {json.dumps(log_entry, ensure_ascii=False)}\n\n"
                                    except:
                                        pass
                    except Exception:
                        pass

                messages = state_values.get("messages", [])
                
                # Emit a chunk for each AIMessage to reconstruct the full conversational flow.
                # If there are multiple turns in the history, we want them all displayed.
                emitted_count = 0
                
                # Check if we naturally restored "node" events from the stream log file
                has_node_events = False
                if os.path.exists(logs_path):
                    try:
                        with open(logs_path, "r", encoding="utf-8") as _f:
                            for line in _f:
                                if '"node"' in line and '"type": "node"' in line:
                                    has_node_events = True
                                    break
                    except: pass

                # If we successfully replayed real node execution chunks from the file,
                # we do NOT need to synthetically generate them from the final AIMessage state.
                if not has_node_events:
                    for i, msg in enumerate(messages):
                        msg_type = getattr(msg, "type", None) or getattr(msg, "__class__", None).__name__
                        content = getattr(msg, "content", "")
                        if not content: continue

                        if msg_type in ("ai", "AIMessage"):
                            # Attribute the message to the correct node if the name is available
                            node_name = getattr(msg, "name", None) or "ReportGenerator"
                            chunk = {
                                "type": "node",
                                "node": node_name,
                                "run_id": f"history_restore_ai_{i}", # Stable ID for history
                                "action_executed": [t("trace.codes.HISTORY_RESTORED" if node_name == "ReportGenerator" else "trace.codes.FEEDBACK_RESTORED", lang), t("trace.codes.LOADED_RECORD", lang, count=emitted_count + 1)],
                                "plan": current_plan if i == len(messages)-1 else [],
                                "past_steps": completed_tasks if i == len(messages)-1 else [],
                                "final_response": content,
                                "status": "completed",
                                "created_at": datetime.now(timezone.utc).isoformat()
                            }
                            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                            emitted_count += 1
                        elif msg_type in ("human", "HumanMessage"):
                            chunk = {
                                "type": "node",
                                "node": "User",
                                "run_id": f"history_restore_user_{i}", # Stable ID for history
                                "action_executed": [t("trace.codes.USER_INPUT", lang), content],
                                "plan": [],
                                "past_steps": [],
                                "final_response": None,
                                "status": "completed",
                                "created_at": datetime.now(timezone.utc).isoformat()
                            }
                            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                            emitted_count += 1
                                
                    if emitted_count == 0:
                        # Fallback if no AI messages found
                        chunk = {
                            "type": "node",
                            "node": "ReportGenerator",
                            "run_id": "history_restore_empty",
                            "action_executed": [t("trace.codes.HISTORY_DIALOG_STATE", lang), t("trace.codes.EMPTY_AI_RESPONSE", lang)],
                            "plan": current_plan,
                            "past_steps": completed_tasks,
                            "final_response": "(No response was generated for this session)",
                            "status": "completed",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        }
                        yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                
                # Send an authoritative plan state event whether replayed from stream_logs or synthesized from messages
                # Ensure the "Task Planning" tab on the frontend correctly displays plan data of the historical session
                if current_plan or completed_tasks:
                    plan_state_chunk = {
                        "type": "plan_state",
                        "plan": current_plan,
                        "past_steps": completed_tasks,
                    }
                    yield f"data: {json.dumps(plan_state_chunk, ensure_ascii=False)}\n\n"

                if request.is_retry:
                    yield "data: [DONE]\n\n"
                    return
                
            # view_only mode: whether saved_state exists or not, do not execute the graph, return directly
            if request.view_only:
                yield f"data: {json.dumps({'type': 'session_status', 'is_paused': not is_finished, 'is_interrupted': is_interrupted if not is_finished else False}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return

            # [USER INPUT VISIBILITY]
            # Moved here (after history restoration) to ensure correct chronological order in the UI.
            # Send current plan state before sending new user input (ensures frontend recovers progress immediately when resuming)
            if (current_plan or completed_tasks) and not request.restore_history:
                plan_state_chunk = {
                    "type": "plan_state",
                    "plan": current_plan,
                    "past_steps": completed_tasks,
                }
                yield f"data: {json.dumps(plan_state_chunk, ensure_ascii=False)}\n\n"

            # If there's a fresh query (either new or resume), emit it as a 'User' node.
            if request.query:
                user_chunk = {
                    "type": "node",
                    "node": "User",
                    "run_id": f"user_{int(time.time()*1000)}",
                    "action_executed": [t("trace.codes.USER_INPUT", lang), request.query],
                    "plan": current_plan,
                    "past_steps": completed_tasks,
                    "final_response": None,
                    "status": "completed",
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                # Log it so it persists for future reloads
                append_log(user_chunk)
                yield f"data: {json.dumps(user_chunk, ensure_ascii=False)}\n\n"

            async def run_graph(q: asyncio.Queue):
                try:
                    async for event in active_app.astream_events(initial_state, config=config, version="v2"):
                        await q.put(event)
                    
                    # After the stream completes, check if it was interrupted
                    curr_state = await active_app.aget_state(config)
                    is_interrupted_now = curr_state and curr_state.tasks and any(t.interrupts for t in curr_state.tasks)
                    if is_interrupted_now:
                        interrupt_task = next(t for t in curr_state.tasks if t.interrupts)
                        interrupt_payload = interrupt_task.interrupts[0].value
                        
                        display_message = interrupt_payload.get("display_message", "Waiting for your reply or confirmation...")
                        # Produce a proxy chunk so the frontend displays the interrupt message 
                        await q.put({
                            "event": "on_chain_end",
                            "name": "__interrupt__",
                            "data": {
                                "output": {
                                    "display_message": display_message
                                }
                            }
                        })
                        
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    await q.put(e)
                finally:
                    await q.put(None)

            q = asyncio.Queue()
            task = asyncio.create_task(run_graph(q))
            
            last_node_run_id = None
            current_known_path = None

            while True:
                if await fastapi_req.is_disconnected():
                    print(f"[Stream] Client disconnected! Canceling execution for thread {thread_id}")
                    task.cancel()
                    break

                try:
                    event = await asyncio.wait_for(q.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if event is None:
                    break

                if isinstance(event, Exception):
                    raise event

                kind = event.get("event", "")
                name = event.get("name", "")
                data = event.get("data", {})
                run_id = event.get("run_id")
                tags = event.get("tags", [])
                metadata = event.get("metadata", {})
                langgraph_node = metadata.get("langgraph_node", "")
                ts = time.strftime("%H:%M:%S")

                # ---- Hierarchy Path Extraction (core logic: ensure all events have full Context, and filter out LangGraph internal nodes) ----
                # Blacklist: LangGraph framework internal nodes should not appear in the business path
                INTERNAL_NODES = {
                    "__pregel_pull", "__pregel_push", "__pregel_read",
                    "ChannelWrite", "ChannelRead", "RunnableSequence",
                    "RunnableLambda", "RunnableParallel", "RunnablePassthrough",
                    "branch", "should_continue",
                }

                lp = metadata.get("langgraph_path", [])
                
                if lp and isinstance(lp, (list, tuple)):
                    # Filter out LangGraph internal nodes + pure numbers + True/False conditional branch identifiers
                    path = [str(x) for x in lp
                            if str(x) not in INTERNAL_NODES
                            and not str(x).startswith("__pregel")
                            and not str(x).isdigit()
                            and str(x) not in ("True", "False")]
                    if path:
                         full_node_path = ":".join(path)
                         current_known_path = full_node_path
                    else:
                         # If empty after filtering, fallback to historically known valid path, extreme case fallback to langgraph_node
                         full_node_path = current_known_path or langgraph_node or name
                else:
                    full_node_path = current_known_path or langgraph_node or name


                # Track the run_id of relevant nodes
                is_node_start_or_end = kind in ("on_chain_start", "on_chain_end", "on_node_start", "on_node_end")
                # Check if path contains any core Agent nodes (top-level agent or its child nodes)
                TOP_AGENTS = {"Supervisor", "RequirementsAnalyst", "DataAnalyst", "ReportGenerator", "QAAgent", "SkillExecutor"}
                is_agent_node = any(agent in full_node_path for agent in TOP_AGENTS)
                
                if is_node_start_or_end and is_agent_node:
                    if run_id:
                        last_node_run_id = run_id

                # ---- Graph Node Level Events (reserved for Trace panel and flowchart highlighting) ----
                if kind == "on_node_start":
                    if full_node_path:
                        print(f"[NodeHighlight] on_node_start: name={name} langgraph_node={langgraph_node} lp={lp} full_node_path={full_node_path}")
                        # Only used for real-time flowchart highlighting, does not enter Trace list (avoiding redundancy)
                        yield f"data: {json.dumps({'type': 'node', 'node': full_node_path, 'status': 'running', 'silent': True}, ensure_ascii=False)}\n\n"

                # Also send highlighting for on_chain_start (covers scenarios where on_node_start is not triggered)
                if kind == "on_chain_start":
                    if name == "agent_app":
                        yield f"data: {json.dumps({'type': 'node', 'node': '__start__', 'status': 'running', 'silent': True}, ensure_ascii=False)}\n\n"
                    elif is_agent_node and full_node_path:
                        print(f"[NodeHighlight] on_chain_start: name={name} full_node_path={full_node_path}")
                        yield f"data: {json.dumps({'type': 'node', 'node': full_node_path, 'status': 'running', 'silent': True}, ensure_ascii=False)}\n\n"
                    # [DEBUG] Record original path info of all on_chain_start for debugging subgraph highlighting
                    if name not in INTERNAL_NODES and name not in ("agent_app", "Unnamed", "LangGraph"):
                        print(f"[PathDebug] on_chain_start: kind={kind} name={name} langgraph_node={langgraph_node} lp={lp} full_node_path={full_node_path} is_agent_node={is_agent_node}")

                # DataAnalyst's subgraph is independently invoked via ainvoke, and its internal nodes' langgraph_path
                # does not contain the parent node "DataAnalyst", causing is_agent_node=False.
                # Need to additionally match these subgraph business nodes to ensure planner/executor/reviewer events are captured.
                SUBGRAPH_BUSINESS_NODES = {"planner", "executor", "reviewer",
                                           "collect_files", "generate_outline", "generate_chapter",
                                           "merge_report", "convert_html"}
                is_subgraph_node = name in SUBGRAPH_BUSINESS_NODES

                if kind == "on_chain_end" and (is_agent_node or is_subgraph_node or name == "__interrupt__" or langgraph_node == "__end__" or full_node_path.endswith(":__end__")):
                    output = data.get("output", {})
                    # When a node is interrupted, its output might not be strictly a dict
                    if not isinstance(output, dict):
                        output = {}

                    if name == "__interrupt__":
                        target_run_id = f"interrupt_{int(time.time()*1000)}"
                        inter_msg = output.get("display_message", "Waiting for your reply or confirmation...")
                        action_executed = [t("trace.codes.WAITING_REPLY", lang), inter_msg]
                        chunk = {
                            "type": "node",
                            "node": full_node_path,
                            "action_executed": action_executed,
                            "plan": current_plan,
                            "past_steps": completed_tasks,
                            "final_response": output.get("display_message"),
                            "status": "completed",
                            "run_id": target_run_id,
                            "created_at": datetime.now(timezone.utc).isoformat()
                        }
                        append_log(chunk)
                        yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                        continue

                    if name == "Supervisor":
                        next_route = output.get("next", "FINISH")

                        agent_title = t(f"trace.codes.ROUTE_TO_{next_route}", lang)
                        if agent_title == f"trace.codes.ROUTE_TO_{next_route}":
                            agent_title = next_route
                        action_msg = agent_title

                        # Extract final response only when FINISH + direct_response is present
                        # Avoid mistakenly taking historical messages accumulated in state as new final_response
                        supervisor_final = None
                        if next_route == "FINISH":
                            direct_resp = output.get("messages", [])
                            if direct_resp and hasattr(direct_resp[-1], "content"):
                                supervisor_final = direct_resp[-1].content

                        chunk = {
                            "type": "node",
                            "node": full_node_path,
                            "run_id": event.get("run_id"),
                            "action_executed": [t("trace.codes.ROUTING_DECISION", lang), action_msg],
                            "plan": current_plan,
                            "past_steps": completed_tasks,
                            "final_response": supervisor_final,
                            "status": "completed",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        }
                        append_log(chunk)
                        yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                        continue

                    if "plan" in output:
                        new_plan = output["plan"]
                        if new_plan != current_plan:
                            current_plan = new_plan
                            plan_text = "\n".join(f"{i+1}. {s}" for i, s in enumerate(current_plan))
                            # Overwrite and save the latest plan
                            persist_markdown("mission_plan.md", f"# {t('trace.missionPlan', lang)}\n\n{plan_text}")
                            
                            # Append to change history record
                            try:
                                outputs_dir = os.path.join(target_workspace, "outputs")
                                os.makedirs(outputs_dir, exist_ok=True)
                                history_path = os.path.join(outputs_dir, "mission_plan_history.md")
                                timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
                                open_mode = "a" if os.path.exists(history_path) else "w"
                                with open(history_path, open_mode, encoding="utf-8") as f:
                                    if open_mode == "w":
                                        f.write(f"# Mission Plan History\n\n")
                                    f.write(f"## {timestamp} (Node: {name})\n\n{plan_text}\n\n---\n\n")
                            except Exception as e:
                                pass
                            persist_plan_state()

                    if "past_steps" in output:
                        if isinstance(output["past_steps"], list):
                            completed_tasks.extend(output["past_steps"])
                            persist_plan_state()

                    # ---- Generate different Trace content based on node type ----
                    # Known business node collection (used to filter LangGraph internal event leaks)
                    KNOWN_BUSINESS_NODES = TOP_AGENTS | {
                        "planner", "executor", "reviewer", "agent", "tools",
                        "collect_files", "generate_outline", "generate_chapter",
                        "merge_report", "convert_html",
                    }
                    _has_explicit_response = False  # Mark whether response was explicitly set in the handler

                    if name == "planner":
                        # Planning node: display the generated mission plan
                        plan_text = "\n".join(f"{i+1}. {s}" for i, s in enumerate(current_plan))
                        action_executed = [t("trace.codes.PLANNING_COMPLETED", lang), plan_text]

                    elif name == "executor":
                        # Execution node: display currently executing task + result summary
                        latest_step = completed_tasks[-1] if completed_tasks else None
                        if latest_step and isinstance(latest_step, (list, tuple)) and len(latest_step) >= 2:
                            task_name = latest_step[0]
                            result_text = str(latest_step[1])
                            result_summary = result_text
                            action_executed = [t("trace.codes.EXECUTE_STEP_WITH_NAME", lang, taskName=task_name), result_summary]
                        else:
                            action_executed = [t("trace.codes.EXECUTE_STEP", lang), t("trace.codes.COMPLETED_TEXT", lang)]

                    elif name == "reviewer":
                        # Review node: display current decision of whether to continue or finish
                        has_response = bool(output.get("response"))
                        remaining = len(current_plan)
                        done = len(completed_tasks)
                        if has_response:
                            action_executed = [
                                t("trace.codes.REVIEW_COMPLETED_GENERATE", lang),
                                t("trace.codes.REVIEW_COMPLETED_GENERATE_DESC", lang, done=done)
                            ]
                        else:
                            next_task = current_plan[0] if current_plan else t("trace.codes.PENDING", lang)
                            action_executed = [
                                t("trace.codes.REVIEW_COMPLETED_CONTINUE", lang),
                                t("trace.codes.REVIEW_COMPLETED_CONTINUE_DESC", lang, remaining=done + 1, nextTask=next_task)
                            ]
                    elif name == "RequirementsAnalyst":
                        # Requirements analysis node: display structured requirements summary
                        brief_preview = output.get("requirements_brief", t("trace.codes.COMPLETED_TEXT", lang))
                        action_executed = [t("trace.codes.REQUIREMENTS_COMPLETED", lang), brief_preview]
                        
                        # Save the full requirements document
                        req_full = output.get("requirements_brief", "")
                        if req_full:
                             persist_markdown("requirements.md", f"# Requirements\n\n{req_full}")

                    elif name == "ReportGenerator":
                        # Report generation node: display report title and summary line
                        msgs = output.get("messages", [])
                        report_text = ""
                        if msgs and hasattr(msgs[-1], "content"):
                            report_text = msgs[-1].content
                        else:
                            report_text = t("trace.codes.COMPLETED_TEXT", lang)
                        action_executed = [t("trace.codes.REPORT_GENERATED", lang), report_text]
                        persist_markdown("final_report.md", report_text)
                        
                    elif name == "QAAgent":
                        # QA node: display answers content
                        msgs = output.get("messages", [])
                        qa_text = ""
                        if msgs and hasattr(msgs[-1], "content"):
                            qa_text = msgs[-1].content
                        else:
                            qa_text = t("trace.codes.COMPLETED_TEXT", lang)
                        action_executed = [t("trace.codes.QA_COMPLETED", lang), qa_text]
                        output["response"] = qa_text
                        _has_explicit_response = True

                    elif name == "SkillExecutor":
                        # Skill execution node: display execution results
                        msgs = output.get("messages", [])
                        skill_text = ""
                        if msgs and hasattr(msgs[-1], "content"):
                            skill_text = msgs[-1].content
                        else:
                            skill_text = t("trace.codes.COMPLETED_TEXT", lang)
                        action_executed = ["Skill execution completed", skill_text]
                        output["response"] = skill_text
                        _has_explicit_response = True

                    elif name == "DataAnalyst":
                        # Data analysis main graph completed
                        action_executed = [t("trace.codes.DATA_ANALYSIS_ENDED", lang), t("trace.codes.COMPLETED_TEXT", lang)]

                    elif name == "collect_files":
                        # ReportGenerator subgraph: collect files
                        files = output.get("available_files", [])
                        action_executed = [t("trace.codes.COLLECT_FILES", lang), t("trace.codes.COLLECT_FILES_DESC", lang, count=len(files))]

                    elif name == "generate_outline":
                        # ReportGenerator subgraph: generate outline
                        outline = output.get("outline", [])
                        if outline:
                            outline_text = "\n".join(f"{i+1}. {ch.get('title', ch) if isinstance(ch, dict) else ch}" for i, ch in enumerate(outline))
                        else:
                            outline_text = t("trace.codes.COMPLETED_TEXT", lang)
                        action_executed = [t("trace.codes.GENERATE_OUTLINE", lang), outline_text]

                    elif name == "generate_chapter":
                        # ReportGenerator subgraph: generate chapter
                        chapters = output.get("chapters", [])
                        if chapters:
                            latest = chapters[-1] if chapters else {}
                            chapter_title = latest.get("title", "") if isinstance(latest, dict) else ""
                            desc = t("trace.codes.CHAPTER_COMPLETED", lang, title=chapter_title) if chapter_title else t("trace.codes.COMPLETED_TEXT", lang)
                            action_executed = [t("trace.codes.GENERATE_CHAPTER", lang), desc]
                        else:
                            action_executed = [t("trace.codes.GENERATE_CHAPTER", lang), t("trace.codes.COMPLETED_TEXT", lang)]

                    elif name == "merge_report":
                        # ReportGenerator subgraph: merge report
                        md = output.get("final_markdown", "")
                        desc = t("trace.codes.REPORT_MERGED", lang, count=len(md)) if md else t("trace.codes.COMPLETED_TEXT", lang)
                        action_executed = [t("trace.codes.MERGE_REPORT", lang), desc]

                    elif name == "convert_html":
                        # ReportGenerator subgraph: convert HTML
                        html = output.get("final_html", "")
                        desc = t("trace.codes.HTML_GENERATED", lang) if html else t("trace.codes.COMPLETED_TEXT", lang)
                        action_executed = [t("trace.codes.CONVERT_HTML", lang), desc]

                    else:
                        # Skip LangGraph internal/framework events (such as __end__, agent_app)
                        # These events' output contains full state, which leaks old response
                        if name not in KNOWN_BUSINESS_NODES:
                            continue
                        latest_step = completed_tasks[-1] if completed_tasks else None
                        action_executed = latest_step

                    chunk = {
                        "type": "node",
                        "node": full_node_path,
                        "run_id": event.get("run_id"),
                        "action_executed": action_executed,
                        "plan": current_plan,
                        "past_steps": completed_tasks,
                        "final_response": None,
                        "status": "completed",
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    # Extract final_response only from agents that explicitly set response in their handler
                    if _has_explicit_response and "response" in output and isinstance(output["response"], str):
                        chunk["final_response"] = output["response"]

                    append_log(chunk)
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                    
                elif kind == "on_chain_start" and name in TOP_AGENTS:
                    agent_title = t(f"trace.codes.RUNNING_{name}", lang)
                    if agent_title == f"trace.codes.RUNNING_{name}":
                        agent_title = f"{name} {t('trace.codes.RUNNING', lang)}"
                    chunk = {
                        "type": "node",
                        "node": full_node_path,
                        "run_id": event.get("run_id"),
                        "action_executed": [t("trace.codes.RUNNING", lang), agent_title],
                        "plan": current_plan,
                        "past_steps": completed_tasks,
                        "final_response": None,
                        "status": "running",
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    append_log(chunk)
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

                # ---- LLM call starts ----
                elif kind == "on_chat_model_start":
                    # [Highlight] When LLM reasoning starts, highlight the agent node of the current subgraph
                    if is_agent_node and full_node_path:
                        # Infer agent child node path: if full_node_path is "SkillExecutor", generate "SkillExecutor:agent"
                        agent_highlight_path = full_node_path
                        if not full_node_path.endswith(":agent"):
                            agent_highlight_path = f"{full_node_path}:agent"
                        yield f"data: {json.dumps({'type': 'node', 'node': agent_highlight_path, 'status': 'running', 'silent': True}, ensure_ascii=False)}\n\n"

                    msgs = event.get("data", {}).get("input", {})
                    # Extract summary of the last message
                    messages = msgs.get("messages", [[]])
                    last_msg = ""
                    if messages and len(messages) > 0:
                        flat = messages[-1] if isinstance(messages[-1], list) else [messages[-1]]
                        if flat:
                            content = getattr(flat[-1], "content", str(flat[-1]))
                            last_msg = content
                    log = {
                        "type": "log",
                        "ts": ts,
                        "level": "llm_start",
                        "title": t('logs.codes.LLM_START', lang, name=name.replace("ChatOpenAIThinking", "ChatOpenAI")),
                        "detail": last_msg,
                        "node": full_node_path,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    append_log(log)
                    yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"

                # ---- LLM content streaming output (avoiding long freeze sensation) ----
                elif kind == "on_chat_model_stream":
                    chunk_content = ""
                    chunk_msg = event.get("data", {}).get("chunk", {})
                    
                    if hasattr(chunk_msg, "content") and chunk_msg.content:
                        chunk_content += str(chunk_msg.content)
                    
                    # Support parsing OpenAI-compatible reasoning_content field of thinking chain
                    if hasattr(chunk_msg, "additional_kwargs") and "reasoning_content" in chunk_msg.additional_kwargs:
                         chunk_content += str(chunk_msg.additional_kwargs["reasoning_content"])
                         
                    # If incremental content can be parsed
                    if chunk_content:
                        log = {
                            "type": "log",
                            "ts": ts,
                            "level": "llm_stream",
                            "title": t('logs.codes.LLM_STREAM', lang),
                            "detail": chunk_content,
                            "node": full_node_path,
                            "created_at": datetime.now(timezone.utc).isoformat()
                        }
                        # Avoid writing a large number of small fragments to local disk which seriously affects IO performance; for stream logs, we only stream, not write append_log(log)
                        yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"

                # ---- LLM call ends ----
                elif kind == "on_chat_model_end":
                    output = event.get("data", {}).get("output", {})
                    content = ""
                    if hasattr(output, "content"):
                        content = output.content
                    elif isinstance(output, dict):
                        content = str(output)
                    
                    # Extract token usage
                    in_tokens = "?"
                    out_tokens = "?"
                    in_tokens_int = 0
                    out_tokens_int = 0
                    if hasattr(output, "usage_metadata") and output.usage_metadata:
                        u = output.usage_metadata
                        in_tokens_int = u.get('input_tokens', 0) or 0
                        out_tokens_int = u.get('output_tokens', 0) or 0
                        in_tokens = str(in_tokens_int)
                        out_tokens = str(out_tokens_int)
                    
                    log = {
                        "type": "log",
                        "ts": ts,
                        "level": "llm_end",
                        "title": t('logs.codes.LLM_END', lang, name=name, **{'in': in_tokens, 'out': out_tokens}),
                        "detail": content,
                        "node": full_node_path,
                        "input_tokens": in_tokens_int,
                        "output_tokens": out_tokens_int,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    append_log(log)
                    yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"

                # ---- Tool call starts ----
                elif kind == "on_tool_start":
                    # [Highlight] When tool invocation starts, highlight the tools node of the current subgraph
                    if is_agent_node and full_node_path:
                        tools_highlight_path = full_node_path
                        if not full_node_path.endswith(":tools"):
                            # If current path is "SkillExecutor:agent", replace with "SkillExecutor:tools"
                            if full_node_path.endswith(":agent"):
                                tools_highlight_path = full_node_path.rsplit(":agent", 1)[0] + ":tools"
                            else:
                                tools_highlight_path = f"{full_node_path}:tools"
                        yield f"data: {json.dumps({'type': 'node', 'node': tools_highlight_path, 'status': 'running', 'silent': True}, ensure_ascii=False)}\n\n"

                    tool_input = event.get("data", {}).get("input", {})
                    input_preview = str(tool_input)
                    log = {
                        "type": "log",
                        "ts": ts,
                        "level": "tool_start",
                        "title": t('logs.codes.TOOL_START', lang, name=name),
                        "detail": input_preview,
                        "node": full_node_path,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    append_log(log)
                    yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"

                # ---- Tool call ends ----
                elif kind == "on_tool_end":
                    output = event.get("data", {}).get("output", "")
                    output_str = str(output)
                    log = {
                        "type": "log",
                        "ts": ts,
                        "level": "tool_end",
                        "title": t('logs.codes.TOOL_END', lang, name=name),
                        "detail": output_str,
                        "node": full_node_path,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    append_log(log)
                    yield f"data: {json.dumps(log, ensure_ascii=False)}\n\n"


            yield "data: [DONE]\n\n"
        except Exception as e:
            import traceback
            error_detail = traceback.format_exc()
            print(f"[SSE Stream Error] {error_detail}")
            error_chunk = {
                "type": "node",
                "node": "__error__",
                "error": error_detail,
                "detail": error_detail,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            append_log(error_chunk)
            yield f"data: {json.dumps(error_chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        finally:
            if 'task' in locals() and not task.done():
                task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


class RollbackRequest(BaseModel):
    thread_id: str
    user_message_index: int  # which HumanMessage (0-based), rollback to before this one


@router.post("/rollback")
async def rollback_conversation(request: RollbackRequest):
    """
    Rollback conversation: truncate messages in LangGraph state and messages_meta.jsonl.
    user_message_index indicates which HumanMessage (0-based) to withdraw.
    Rolls back to the state before that HumanMessage.
    """
    from langchain_core.messages import HumanMessage, RemoveMessage

    if not state.agent_app:
        return {"error": "System not ready"}

    thread_id = request.thread_id
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 100}

    try:
        # 1. Get current LangGraph state
        current_state = await state.agent_app.aget_state(config)
        if not current_state or not current_state.values:
            return {"error": "No state found for this thread"}

        messages = current_state.values.get("messages", [])
        if not messages:
            return {"error": "No messages in state"}

        # 2. Find the position of the N-th HumanMessage
        human_count = 0
        cut_index = -1
        for i, msg in enumerate(messages):
            if isinstance(msg, HumanMessage) or getattr(msg, "type", "") == "human":
                if human_count == request.user_message_index:
                    cut_index = i
                    break
                human_count += 1

        if cut_index == -1:
            return {"error": f"HumanMessage index {request.user_message_index} not found"}

        # 3. Use RemoveMessage to delete cut_index and all subsequent messages,
        #    AND reset supervisor state fields to avoid stale routing after rollback
        messages_to_remove = messages[cut_index:]
        remove_ops = [RemoveMessage(id=msg.id) for msg in messages_to_remove if hasattr(msg, 'id') and msg.id]

        if remove_ops:
            await state.agent_app.aupdate_state(
                config,
                {
                    "messages": remove_ops,
                    "last_completed_node": "",
                    "analysis_result": None,
                    "requirements_brief": None,
                    "in_requirements_clarification": False,
                    "awaiting_confirmation_from": None,
                },
            )
            print(f"[Rollback] Removed {len(remove_ops)} messages from thread {thread_id}, reset supervisor state")

        # 4. Truncate workspace files
        workspace_dir = os.path.join(
            os.path.expanduser(WORKSPACES_DIR),
            f"thread_{thread_id}"
        )

        # 4a. Truncate messages_meta.jsonl
        meta_file = os.path.join(workspace_dir, "messages_meta.jsonl")
        if os.path.exists(meta_file):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                # Keep the first user_message_index entries
                truncated = lines[:request.user_message_index]
                with open(meta_file, "w", encoding="utf-8") as f:
                    f.writelines(truncated)
                print(f"[Rollback] Truncated messages_meta.jsonl: {len(lines)} → {len(truncated)} entries")
            except Exception as e:
                print(f"[Rollback] ⚠️ Failed to truncate messages_meta: {e}")

        # 4b. Truncate stream_logs.jsonl — the critical fix
        #     Without this, reopening the conversation would replay all original log events,
        #     making the rollback appear to have no effect.
        logs_file = os.path.join(workspace_dir, "stream_logs.jsonl")
        if os.path.exists(logs_file):
            try:
                # Backup before truncating, so we can recover if needed
                import shutil, glob
                existing_baks = glob.glob(logs_file + ".bak.*")
                seq = max((int(b.rsplit(".", 1)[-1]) for b in existing_baks if b.rsplit(".", 1)[-1].isdigit()), default=0) + 1
                backup_file = f"{logs_file}.bak.{seq}"
                shutil.copy2(logs_file, backup_file)
                print(f"[Rollback] Backed up stream_logs.jsonl → stream_logs.jsonl.bak.{seq}")

                import json as _json
                with open(logs_file, "r", encoding="utf-8") as f:
                    log_lines = f.readlines()

                # Find the cut position: count User node events in stream_logs.
                # The N-th User node event corresponds to user_message_index N.
                user_node_count = 0
                log_cut_pos = len(log_lines)  # default: keep all (if index not found)
                for idx, line in enumerate(log_lines):
                    line_stripped = line.strip()
                    if not line_stripped:
                        continue
                    try:
                        entry = _json.loads(line_stripped)
                        # Match User node events (both from live stream and history replay)
                        if entry.get("node") == "User" and entry.get("type") in ("node", None):
                            if user_node_count == request.user_message_index:
                                log_cut_pos = idx
                                break
                            user_node_count += 1
                    except _json.JSONDecodeError:
                        continue

                if log_cut_pos < len(log_lines):
                    truncated_logs = log_lines[:log_cut_pos]
                    with open(logs_file, "w", encoding="utf-8") as f:
                        f.writelines(truncated_logs)
                    print(f"[Rollback] Truncated stream_logs.jsonl: {len(log_lines)} → {len(truncated_logs)} lines")
                else:
                    print(f"[Rollback] ⚠️ User node #{request.user_message_index} not found in stream_logs, file not truncated")
            except Exception as e:
                print(f"[Rollback] ⚠️ Failed to truncate stream_logs: {e}")

        # 4c. Clean plan_state.json if rolling back to the very beginning
        plan_state_file = os.path.join(workspace_dir, "plan_state.json")
        if request.user_message_index == 0 and os.path.exists(plan_state_file):
            try:
                os.remove(plan_state_file)
                print(f"[Rollback] Removed plan_state.json (full rollback)")
            except Exception as e:
                print(f"[Rollback] ⚠️ Failed to remove plan_state.json: {e}")

        return {
            "status": "ok",
            "removed_messages": len(remove_ops),
            "remaining_user_messages": request.user_message_index,
        }

    except Exception as e:
        print(f"[Rollback] ❌ Error: {e}")
        return {"error": str(e)}

