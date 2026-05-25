import os
import sys
import shutil

from fastapi import APIRouter
from langgraph.graph import END

import core.state as state
from core.config import SAVER_TYPE, WORKSPACES_DIR

router = APIRouter()

@router.get("/history")
async def get_history():
    """Get the list of historical session records based on the thread state in the LangGraph Checkpointer."""
    if not state.agent_app:
        return {"history": []}

    # (Legacy threads_meta.json removal) We now rely on DB or memory dictionary
    

    thread_ids = []

    if SAVER_TYPE == "postgres" and state.postgres_pool:
        try:
            async with state.postgres_pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        SELECT c.thread_id, MAX(c.checkpoint_id) as latest_checkpoint_id, m.updated_at, m.created_at
                        FROM checkpoints c
                        LEFT JOIN thread_metadata m ON c.thread_id = m.thread_id
                        GROUP BY c.thread_id, m.updated_at, m.created_at
                        ORDER BY latest_checkpoint_id DESC
                        LIMIT 50;
                        """
                    )
                    rows = await cur.fetchall()
                    for r in rows:
                        tid = r[0]
                        ts = r[2] or r[3]
                        if ts and hasattr(ts, 'isoformat'):
                            ts = ts.isoformat()
                        thread_ids.append({"thread_id": tid, "updated_at": ts})
        except Exception as e:
            print("DB Fetch History Error:", e)
    elif SAVER_TYPE == "sqlite" and state.sqlite_conn:
        try:
            cursor = await state.sqlite_conn.execute(
                """
                SELECT c.thread_id, MAX(c.checkpoint_id) as latest_checkpoint_id, m.updated_at, m.created_at
                FROM checkpoints c
                LEFT JOIN thread_metadata m ON c.thread_id = m.thread_id
                GROUP BY c.thread_id, m.updated_at, m.created_at
                ORDER BY latest_checkpoint_id DESC
                LIMIT 50;
                """
            )
            rows = await cursor.fetchall()
            for r in rows:
                tid = r[0]
                ts = r[2] or r[3]
                thread_ids.append({"thread_id": tid, "updated_at": ts})
        except Exception as e:
            print("SQLite Fetch History Error:", e)
    else:
        try:
            if hasattr(state.agent_app.checkpointer, "storage"):
                storage = state.agent_app.checkpointer.storage
                for thread_id, checkpoints in storage.items():
                    if checkpoints:
                        meta = state.global_memory_meta.get(thread_id, {})
                        ts = meta.get("updated_at") or meta.get("created_at") or None
                        thread_ids.append({"thread_id": thread_id, "updated_at": ts})
                # Sort by timestamp (those with timestamps first)
                thread_ids.sort(
                    key=lambda x: x["updated_at"] or "",
                    reverse=True
                )
                thread_ids = thread_ids[:50]
        except Exception as e:
            print("MemorySaver Fetch History Error:", e)

    final_history = []
    for item in thread_ids:
        config = {"configurable": {"thread_id": item["thread_id"]}}
        try:
            curr_state = await state.agent_app.aget_state(config)
            state_values = curr_state.values if curr_state else {}

            # Extract user's initial query
            messages = state_values.get("messages", [])
            input_query = None
            if messages:
                # Find the first HumanMessage
                for msg in messages:
                    # Handle cases where it could be an object (langchain) or a dict (persist dump)
                    content = getattr(msg, "content", None)
                    m_type = getattr(msg, "type", None)
                    
                    if content is None and isinstance(msg, dict):
                        content = msg.get("content")
                        m_type = msg.get("type")

                    if m_type in ("human", "HumanMessage") and content:
                        input_query = content
                        break
            
            # If no valid user input is found, it is a ghost thread (possibly an uninitialized empty state in LangGraph), skip it
            if not input_query:
                continue
            
            # Truncate queries that are too long
            if isinstance(input_query, str) and len(input_query) > 100:
                input_query = input_query[:100] + "..."

            # Determine if the task has been completed
            next_step = state_values.get("next", None)
            next_nodes = curr_state.next if curr_state else []
            is_interrupted = curr_state and curr_state.tasks and any(t.interrupts for t in curr_state.tasks)
            
            if is_interrupted:
                status = "Pending Confirmation"
            elif not next_nodes or next_step in ("FINISH", END, None):
                status = "Completed"
            else:
                status = "In Progress"

            final_history.append({
                "thread_id": item["thread_id"],
                "updated_at": item["updated_at"] or "(No timestamp recorded)",
                "query": input_query,
                "status": status,
            })
        except Exception as e:
            print(f"Error fetching state for {item['thread_id']}: {e}")
            # For records whose state cannot be read at all, choose to skip them instead of showing error placeholders to keep the list clean
            continue

    return {"history": final_history}

@router.delete("/history/{thread_id}")
async def delete_history(thread_id: str):
    """Delete the historical records and the corresponding workspace directory of the specified session."""
    import shutil
    errors = []

    # ---- 1. Delete records in the Checkpointer ----
    if SAVER_TYPE == "postgres" and state.postgres_pool:
        try:
            async with state.postgres_pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("DELETE FROM checkpoint_blobs WHERE thread_id = %s", (thread_id,))
                    await cur.execute("DELETE FROM checkpoint_migrations WHERE 1=0")  # no-op: do not delete migrations
                    await cur.execute("DELETE FROM checkpoints WHERE thread_id = %s", (thread_id,))
                    await cur.execute("DELETE FROM thread_metadata WHERE thread_id = %s", (thread_id,))
                    await conn.commit()
        except Exception as e:
            errors.append(f"DB delete error: {e}")
    elif SAVER_TYPE == "sqlite" and state.sqlite_conn:
        try:
            # The tables might not be created before the first analysis; delete safely table by table
            for table in ["checkpoint_blobs", "checkpoint_writes", "checkpoints", "thread_metadata"]:
                try:
                    await state.sqlite_conn.execute(f"DELETE FROM {table} WHERE thread_id = ?", (thread_id,))
                except Exception:
                    pass  # table does not exist yet, skip
            await state.sqlite_conn.commit()
        except Exception as e:
            errors.append(f"SQLite delete error: {e}")
    else:
        try:
            if hasattr(state.agent_app.checkpointer, "storage"):
                storage = state.agent_app.checkpointer.storage
                if thread_id in storage:
                    del storage[thread_id]
        except Exception as e:
            errors.append(f"MemorySaver delete error: {e}")

    # ---- 2. Delete the corresponding workspace directory ----
    workspace_dir = os.path.abspath(WORKSPACES_DIR)
    
    # Try to find the workspace path to delete. 
    # For now, we assume it's thread_{thread_id[:8]} if we don't query the DB, 
    # or we just try to delete the standard pattern.
    workspace_path = os.path.join(workspace_dir, f"thread_{thread_id}")
    deleted_workspace = None
    if os.path.exists(workspace_path):
        try:
            shutil.rmtree(workspace_path, ignore_errors=True)
            deleted_workspace = workspace_path
            print(f"[Delete] Removed workspace: {workspace_path}")
        except Exception as e:
            errors.append(f"Workspace delete error: {e}")

    return {
        "success": len(errors) == 0,
        "thread_id": thread_id,
        "deleted_workspace": deleted_workspace,
        "errors": errors,
    }
