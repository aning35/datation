import warnings
warnings.filterwarnings("ignore", message="Pydantic serializer warnings")

import os
import sys

# Add project root to module search path to prevent `ModuleNotFoundError: No module named 'tools'`
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from core.thinking_chat import ChatOpenAIThinking as ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.store.memory import InMemoryStore
from langgraph.store.postgres.aio import AsyncPostgresStore
from psycopg_pool import AsyncConnectionPool

from tools.data_computation.sandbox import create_data_computation_tool
from tools.local_file_reader.reader import build_local_file_reader_tool
from tools.web_search.search import build_web_search_tool
from tools.shell_executor.shell import build_shell_executor_tool
from tools.knowledge_search.searcher import build_knowledge_search_tool
from tools.memory.save_preference import build_memory_manager_tools
from tools.memory.session_experience import build_session_experience_tools
from agents.supervisor_builder import compile_supervisor_graph
from skill_loader import inject_skills_context

# Import configuration and state
from core.config import (
    MCP_CONFIG, SKILLS_DIR, DATA_SOURCES_DIR, KNOWLEDGE_DIR,
    MODEL_NAME, TEMPERATURE, LLM_MAX_TOKENS, WORKSPACES_DIR, API_HOST, API_PORT,
    SAVER_TYPE, DB_URI, SQLITE_PATH, LLM_API_BASE, LLM_API_KEY
)
from core import state

# Import routes
from api.router import api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Enable detailed LLM traffic logging if requested
    from core.config import DEBUG_LLM_TRAFFIC
    if DEBUG_LLM_TRAFFIC:
        print("\n" + "!"*60)
        print("!!! DEBUG MODE: LLM TRAFFIC LOGGING ENABLED !!!")
        print("!!! All LLM requests/responses will be logged to the console !!!")
        print("!"*60 + "\n")
        
        # 1. Enable LiteLLM verbose logging (used in suggestions.py and others)
        try:
            import litellm
            litellm.set_verbose = True
        except ImportError:
            pass
            
        # 2. Enable LangChain debug mode (used in main agent loops)
        try:
            import langchain
            langchain.debug = True
            # Alternative: langchain.globals.set_debug(True)
        except ImportError:
            pass

    # Startup: launch all configured MCP processes and convert them to LangChain tools
    await state.mcp_manager.initialize()
    mcp_tools = await state.mcp_manager.get_tools()
    
    # Get the actual root path for Agent Skills (Markdown SOP) storage
    skills_xml_context = inject_skills_context(skills_dir=SKILLS_DIR)

    if SAVER_TYPE == "postgres":
        state.postgres_pool = AsyncConnectionPool(
            conninfo=DB_URI,
            max_size=20,
            kwargs={'autocommit': True, 'prepare_threshold': 0}
        )
        checkpointer = AsyncPostgresSaver(state.postgres_pool)
        store = AsyncPostgresStore(state.postgres_pool)
        await checkpointer.setup()
        await store.setup()
        
        # Setup our custom thread_metadata table
        async with state.postgres_pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS thread_metadata (
                        thread_id TEXT PRIMARY KEY,
                        workspace_path TEXT,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                    """
                )
    elif SAVER_TYPE == "sqlite":
        import aiosqlite
        # Ensure the directory for the SQLite database file exists
        os.makedirs(os.path.dirname(SQLITE_PATH), exist_ok=True)
        state.sqlite_conn = await aiosqlite.connect(SQLITE_PATH)
        checkpointer = AsyncSqliteSaver(state.sqlite_conn)
        store = InMemoryStore()
        await checkpointer.setup()
        
        # Setup our custom thread_metadata table for SQLite
        await state.sqlite_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS thread_metadata (
                thread_id TEXT PRIMARY KEY,
                workspace_path TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            """
        )
        await state.sqlite_conn.commit()
        print(f"[Init] SQLite checkpointer initialized at: {SQLITE_PATH}")
    else:
        checkpointer = MemorySaver()
        store = InMemoryStore()

    # Use ChatOpenAI for universal OpenAI-compatible API support
    # Works with DeepSeek, OpenAI, OpenRouter, vLLM, or any compatible provider
    clean_model_name = MODEL_NAME.split('/')[-1] if '/' in MODEL_NAME else MODEL_NAME
    
    llm = ChatOpenAI(
        model=clean_model_name, 
        temperature=TEMPERATURE,
        openai_api_base=LLM_API_BASE,
        openai_api_key=LLM_API_KEY,
        streaming=False,
        max_tokens=LLM_MAX_TOKENS,
    )

    # Load base tools and append remote MCP Tools and Store-based memory pool
    tools = [
        create_data_computation_tool(workspace_base=WORKSPACES_DIR),
        build_local_file_reader_tool(base_path=DATA_SOURCES_DIR, workspace_base=WORKSPACES_DIR),
        build_web_search_tool(),
        build_knowledge_search_tool(knowledge_base_path=KNOWLEDGE_DIR),
        build_shell_executor_tool(cwd=WORKSPACES_DIR),
    ]
    tools.extend(build_memory_manager_tools(workspace_base=WORKSPACES_DIR))
    tools.extend(build_session_experience_tools(workspace_base=WORKSPACES_DIR))

    print("\n" + "="*50)
    print("=== 🐛 DEBUG: LAYER 1 (BUILT-IN) TOOLS ===")
    print(f"Total built-in tools loaded: {len(tools)}")
    tool_names = [getattr(t, "name", str(t)) for t in tools]
    for idx, t_name in enumerate(tool_names, 1):
        print(f"{idx}. {t_name}")
    print(f"\n[Layer 2] MCP Servers initialized globally but NOT loaded to AI yet: {len(mcp_tools)}")
    print("="*50 + "\n")

    state.llm = llm
    state.agent_app = compile_supervisor_graph(
        llm, tools,
        skills_context=skills_xml_context,
        checkpointer=checkpointer,
        store=store
    )
    
    state.app_ready = True
    print("[Init] ✅ Application is fully ready.")
    
    yield
    
    # Destroy persistent connections and MCP subprocess sessions on shutdown
    if SAVER_TYPE == "postgres" and state.postgres_pool:
        await state.postgres_pool.close()
    elif SAVER_TYPE == "sqlite" and state.sqlite_conn:
        await state.sqlite_conn.close()
    await state.mcp_manager.cleanup()

app = FastAPI(title="Datation API", version="0.1.0", lifespan=lifespan)

# Enable CORS for frontend (standalone web page) to fetch real-time reports via SSE during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# ---------------------------------------------------------------------------
# Static frontend serving (production / desktop mode)
# When the frontend has been pre-built via `cd frontend && npm run build`,
# FastAPI serves the static files directly — no Vite dev server needed.
# In development mode (dist/ doesn't exist), this block is a no-op and the
# developer continues to use `npm run dev` as before.
# ---------------------------------------------------------------------------
_frontend_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.isdir(_frontend_dist):
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    # Serve static assets (JS/CSS/images) under /assets, /favicon.ico, etc.
    app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="frontend-assets")

    @app.get("/favicon.ico", include_in_schema=False)
    async def _favicon():
        fav = os.path.join(_frontend_dist, "favicon.ico")
        if os.path.exists(fav):
            return FileResponse(fav)
        return FileResponse(os.path.join(_frontend_dist, "index.html"))

    # SPA catch-all: any non-API GET request returns index.html so that
    # client-side routing (React Router, etc.) works correctly.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(full_path: str):
        # If the exact file exists in dist/, serve it (e.g. robots.txt)
        candidate = os.path.join(_frontend_dist, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_frontend_dist, "index.html"))

    print(f"[Init] 📦 Serving pre-built frontend from {_frontend_dist}")

def main():
    uvicorn.run("datation.main:app", host=API_HOST, port=API_PORT, reload=False)

if __name__ == "__main__":
    main()
