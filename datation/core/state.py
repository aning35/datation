from mcp_client import MCPManager
from core.config import MCP_CONFIG

mcp_manager = MCPManager(config_path=MCP_CONFIG)
agent_app = None
postgres_pool = None
sqlite_conn = None
global_memory_meta = {}
llm = None
app_ready = False
