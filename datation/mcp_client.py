"""
MCP Factory Client - Dynamically mount authentic MCP tools from configuration
"""
import asyncio
import json
import os
import uuid
from contextlib import AsyncExitStack
from typing import Dict, List, Any

# MCP Python SDK bindings
from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp.client.session import ClientSession
from langchain_core.tools import StructuredTool
from pydantic import create_model, Field

def _json_schema_to_pydantic(schema: dict, model_name: str):
    """
    Given a JSON schema from MCP Tool definition, dynamically construct a Pydantic Model
    so LangChain can strictly type-check and map the arguments.
    """
    fields = {}
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    for key, prop in properties.items():
        prop_type_str = prop.get("type", "string")
        if prop_type_str == "string":
            py_type = str
        elif prop_type_str == "integer":
            py_type = int
        elif prop_type_str == "number":
            py_type = float
        elif prop_type_str == "boolean":
            py_type = bool
        elif prop_type_str == "array":
            py_type = list
        elif prop_type_str == "object":
            py_type = dict
        else:
            py_type = Any

        description = prop.get("description", "")
        if key in required:
            fields[key] = (py_type, Field(..., description=description))
        else:
            fields[key] = (py_type, Field(None, description=description))

    return create_model(model_name, **fields)

class MCPManager:
    def __init__(self, config_path: str = "~/.datation/mcp_servers.json"):
        self.config_path = os.path.expanduser(config_path)
        self.sessions: Dict[str, ClientSession] = {}
        self.server_status: Dict[str, dict] = {}
        self.exit_stack = AsyncExitStack()

    async def initialize(self):
        """Start the MCP servers explicitly requested by configuration via stdio."""
        if not os.path.exists(self.config_path):
            print(f"[MCP] Config not found at {self.config_path}, proceeding without MCP.")
            return
            
        with open(self.config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
            
        servers = config.get("mcpServers", {})
        
        for name, cfg in servers.items():
            self.server_status[name] = {"status": "connecting", "error": None}
            try:
                command = cfg.get("command")
                args = cfg.get("args", [])
                envConfig = cfg.get("env", {})
                
                # Merge existing env vars to carry over auth/tokens
                server_env = os.environ.copy()
                server_env.update(envConfig)
                
                server_parameters = StdioServerParameters(
                    command=command,
                    args=args,
                    env=server_env
                )
                
                stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_parameters))
                stdio, write = stdio_transport
                session = await self.exit_stack.enter_async_context(ClientSession(stdio, write))
                
                # Prevent hanging if subprocess crashes (e.g. missing NPM package)
                await asyncio.wait_for(session.initialize(), timeout=5.0)
                
                self.sessions[name] = session
                self.server_status[name] = {"status": "connected", "error": None}
                print(f"[MCP] Successfully established connection to Server: {name}")
                
            except asyncio.TimeoutError:
                error_msg = "Connection timeout after 5s. The server process may have crashed (e.g., missing dependencies)."
                self.server_status[name] = {"status": "error", "error": error_msg}
                print(f"[MCP] Warning - Failed to start server {name}: {error_msg}")
            except Exception as e:
                self.server_status[name] = {"status": "error", "error": str(e)}
                print(f"[MCP] Warning - Failed to start server {name}: {e}")

    async def get_tools(self) -> List[StructuredTool]:
        """Fetch MCP tools remotely over the sessions and bind them uniquely."""
        langchain_tools = []
        
        for server_name, session in self.sessions.items():
            try:
                tools_response = await session.list_tools()
                for tool in tools_response.tools:
                    tool_name = f"{server_name}_{tool.name}"
                    # Normalize tool name since langchain tools usually only allow dashes and underscores
                    safe_tool_name = tool_name.replace("-", "_")
                    
                    # Create an async closure to safely bind the runtime parameters
                    async def make_mcp_coro(bound_session, bound_tool_name):
                        async def mcp_tool_coro(**kwargs):
                            try:
                                result = await bound_session.call_tool(bound_tool_name, arguments=kwargs)
                                if result.content:
                                    return "\n".join(
                                        [str(item.text) if hasattr(item, "text") else getattr(item, 'data', str(item)) for item in result.content]
                                    )
                                if result.isError:
                                    return f"Tool Error: {result}"
                                return "Executed successfully with no payload."
                            except Exception as e:
                                return f"Tool execution error: {type(e).__name__}: {str(e)}"
                        return mcp_tool_coro

                    coro = await make_mcp_coro(session, tool.name)
                    schema_model = _json_schema_to_pydantic(tool.inputSchema, f"{safe_tool_name}_schema")

                    langchain_tools.append(
                        StructuredTool(
                            name=safe_tool_name,
                            description=tool.description or tool.name,
                            func=None,
                            coroutine=coro,
                            args_schema=schema_model
                        )
                    )
            except Exception as e:
                print(f"[MCP] Failed to fetch tools from {server_name}: {e}")
                
        return langchain_tools
                
    async def cleanup(self):
        """Shut down and release stdio connections."""
        print("[MCP] Cleaning up exit stack sessions...")
        await self.exit_stack.aclose()
