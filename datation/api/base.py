import os
import sys
import json
import asyncio
import signal
from pathlib import Path

from fastapi import APIRouter, HTTPException, Body, Query
from langgraph.graph import END

import core.state as state
from core.config import SKILLS_DIR, MCP_CONFIG

router = APIRouter()

@router.get("/health")
def health_check():
    return {"status": "healthy", "ready": state.app_ready}

@router.post("/restart")
async def restart_backend():
    """
    Trigger a backend process restart.
    In-place replace the current process via os.execv to reload all configurations (including app.json, .env, etc.).
    """
    print("[Restart] 🔄 Backend restart requested via API. Restarting in 1 second...")

    async def _do_restart():
        await asyncio.sleep(1)  # Give the HTTP response a window to return
        
        # Clean up first
        try:
            await state.mcp_manager.cleanup()
        except Exception as e:
            print(f"[Restart] MCP cleanup error (non-fatal): {e}")
        
        if state.postgres_pool:
            try:
                await state.postgres_pool.close()
            except Exception as e:
                print(f"[Restart] Postgres pool cleanup error (non-fatal): {e}")

        # Replace the process in-place with os.execv, equivalent to restarting
        python = sys.executable
        print(f"[Restart] 🚀 Exec: {python} {sys.argv}")
        os.execv(python, [python] + sys.argv)

    asyncio.create_task(_do_restart())
    return {"status": "restarting", "message": "Backend will restart in ~1 second."}

APP_CONFIG_PATH = os.path.expanduser("~/.datation/config/app.json")

@router.get("/config/app")
def get_app_config():
    """Read the backend application configuration"""
    try:
        if os.path.exists(APP_CONFIG_PATH):
            with open(APP_CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read app config: {str(e)}")

@router.post("/config/app")
def save_app_config(config: dict = Body(...)):
    """Save the backend application configuration"""
    try:
        os.makedirs(os.path.dirname(APP_CONFIG_PATH), exist_ok=True)
        with open(APP_CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
        
        # Apply debug logging settings immediately
        debug_enabled = config.get("debug_llm_traffic", False)
        try:
            import litellm
            litellm.set_verbose = debug_enabled
        except ImportError:
            pass
            
        try:
            import langchain
            langchain.debug = debug_enabled
            # Alternative: langchain.globals.set_debug(debug_enabled)
        except ImportError:
            pass
            
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write app config: {str(e)}")

@router.get("/config/mcp")
def get_mcp_config():
    """Read the MCP configuration file"""
    mcp_path = Path(MCP_CONFIG)
    try:
        if mcp_path.exists():
            with open(mcp_path, 'r', encoding='utf-8') as f:
                return {"content": f.read()}
        return {"content": "{}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/config/mcp")
def save_mcp_config(payload: dict = Body(...)):
    """Save the MCP configuration file"""
    mcp_path = Path(MCP_CONFIG)
    try:
        os.makedirs(mcp_path.parent, exist_ok=True)
        content = payload.get("content", "{}")
        # Validate that the incoming string is actual JSON
        json.loads(content)
        with open(mcp_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return {"status": "success"}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON format: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write MCP config: {str(e)}")

@router.get("/mcp/servers")
def get_mcp_servers():
    """Get the list of available MCP servers and their runtime status"""
    mcp_path = Path(MCP_CONFIG)
    servers = []
    try:
        if mcp_path.exists():
            with open(mcp_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                mcp_servers_dict = data.get("mcpServers", {})
                
                for name in mcp_servers_dict.keys():
                    runtime_info = state.mcp_manager.server_status.get(name, {})
                    servers.append({
                        "name": name,
                        "status": runtime_info.get("status", "unknown"),
                        "error": runtime_info.get("error")
                    })
        return {"servers": servers}
    except Exception as e:
        return {"servers": []}

@router.get("/config/skills")
def get_skills():
    """Scan the skills directory"""
    skills_dir = Path(SKILLS_DIR)
    try:
        if not skills_dir.exists():
            return {"skills": []}

        skills = []
        import yaml
        for skill_path in skills_dir.iterdir():
            if skill_path.is_dir():
                skill_md = skill_path / "SKILL.md"
                if skill_md.exists():
                    desc = ""
                    try:
                        with open(skill_md, "r", encoding="utf-8") as f:
                            content = f.read()
                        if content.startswith("---"):
                            parts = content.split("---", 2)
                            if len(parts) >= 3:
                                frontmatter = yaml.safe_load(parts[1])
                                if isinstance(frontmatter, dict):
                                    desc = frontmatter.get("description", "").strip()
                    except Exception:
                        pass
                    
                    skills.append({
                        "name": skill_path.name,
                        "description": desc,
                        "path": str(skill_path)
                    })
        return {"skills": skills}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/config/skills/market")
def proxy_skills_market(page: int = 1, limit: int = 12, sortBy: str = "stars", search: str = "", occupation: str = ""):
    """Proxy the skills market API of skillsmp.com to avoid frontend CORS issues"""
    import urllib.request
    import urllib.parse

    params = {"page": page, "limit": limit, "sortBy": sortBy, "search": search}
    if occupation:
        params["occupation"] = occupation
    url = f"https://skillsmp.com/api/skills?{urllib.parse.urlencode(params)}"

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Datation/1.0",
            "Accept": "application/json"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from skillsmp.com: {str(e)}")

@router.post("/config/skills/install")
def install_skill(payload: dict = Body(...)):
    """Download all files of a Skill to the local skills directory via the skillsmp.com API"""
    import re
    import urllib.request
    import urllib.parse
    import urllib.error

    github_url = payload.get("githubUrl", "")
    name = payload.get("name", "")
    author = payload.get("author", "")
    branch = payload.get("branch", "main")

    if not github_url or not name:
        raise HTTPException(status_code=400, detail="Missing githubUrl or name")

    skills_dir = Path(SKILLS_DIR)
    target_name = f"{author}-{name}" if author else name
    target_dir = skills_dir / target_name

    try:
        # Parse githubUrl: https://github.com/{owner}/{repo}/tree/{branch}/{path_to_skill_dir}
        match = re.match(r'https://github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)', github_url)
        if not match:
            raise HTTPException(status_code=400, detail=f"Cannot parse GitHub URL: {github_url}")

        owner, repo, _, dir_path = match.groups()

        # Use skillsmp.com proxy API to get all files in the skill directory
        api_url = f"https://skillsmp.com/api/github-contents?owner={owner}&repo={repo}&path={urllib.parse.quote(dir_path, safe='')}&branch={branch}"

        req = urllib.request.Request(api_url, headers={
            "User-Agent": "Datation/1.0",
            "Accept": "application/json",
            "x-skillsmp-client": "web-download"
        })

        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        files = data.get("files", [])
        if not files:
            raise HTTPException(status_code=404, detail="No files found in the skill directory")

        # Write all files to local skill directory
        target_dir.mkdir(parents=True, exist_ok=True)
        total_size = 0
        file_count = 0

        for file_info in files:
            file_path = file_info.get("path", "")
            content = file_info.get("content", "")
            if not file_path or not content:
                continue

            # Extract just the filename (e.g. "SKILL.md" or "agents/openai.yaml")
            target_file = target_dir / file_path
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_text(content, encoding="utf-8")
            total_size += len(content)
            file_count += 1

        return {
            "status": "success",
            "path": str(target_dir),
            "files": file_count,
            "totalSize": total_size
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Install failed: {str(e)}")

@router.post("/config/skills/uninstall")
def uninstall_skill(payload: dict = Body(...)):
    """Delete the local Skill directory"""
    import shutil
    name = payload.get("name", "")
    author = payload.get("author", "")

    if not name:
        raise HTTPException(status_code=400, detail="Missing skill name")

    skills_dir = Path(SKILLS_DIR)
    target_name = f"{author}-{name}" if author else name
    target_dir = skills_dir / target_name

    try:
        if target_dir.exists() and target_dir.is_dir():
            shutil.rmtree(target_dir)
            return {"status": "success", "message": f"Successfully uninstalled {target_name}"}
        else:
            # Fallback to name only (backwards compatibility)
            fallback_dir = skills_dir / name
            if fallback_dir.exists() and fallback_dir.is_dir():
                shutil.rmtree(fallback_dir)
                return {"status": "success", "message": f"Successfully uninstalled {name}"}
            raise HTTPException(status_code=404, detail=f"Skill directory {target_name} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to uninstall: {str(e)}")

@router.get("/config/fs/list")
def list_fs(path: str = Query(""), mode: str = Query("directory")):
    """
    List the local filesystem directory, supporting ~ path expansion.
    Supports mode="directory" (only list directories) or mode="file" (list files and directories).
    """
    try:
        if not path:
            path = "~"
        
        # Expand ~ and get absolute path
        expanded_path = os.path.abspath(os.path.expanduser(path))
        
        if not os.path.exists(expanded_path):
            # Path doesn't exist yet (e.g. a new SQLite DB file) — fall back to nearest existing parent
            fallback = expanded_path
            while fallback and not os.path.exists(fallback):
                fallback = os.path.dirname(fallback)
            if fallback:
                expanded_path = fallback
            else:
                raise HTTPException(status_code=404, detail=f"Path not found: {path}")
        if not os.path.isdir(expanded_path):
            # When mode=file and a file path is provided, automatically fallback to the directory where the file is located
            if mode == "file" and os.path.isfile(expanded_path):
                expanded_path = os.path.dirname(expanded_path)
            else:
                raise HTTPException(status_code=400, detail="Path is not a directory")
            
        # Determine parent directory
        parent_path = os.path.abspath(os.path.join(expanded_path, os.pardir))
        # If current path is the root path, set parent directory to None
        if parent_path == expanded_path:
            parent_path = None
            
        entries = []
        try:
            for entry in os.scandir(expanded_path):
                if entry.name.startswith("."):
                    continue
                    
                is_dir = entry.is_dir()
                if mode == "directory" and not is_dir:
                    continue
                    
                entries.append({
                    "name": entry.name,
                    "path": os.path.abspath(entry.path),
                    "is_dir": is_dir
                })
        except PermissionError:
            raise HTTPException(status_code=403, detail="Permission denied to access this directory")
            
        # Sort: directories first, then alphabetically
        entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        
        return {
            "current_path": expanded_path,
            "parent_path": parent_path,
            "entries": entries
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/graph")
def get_graph_diagram():
    """Return the Mermaid diagram representation of the LangGraph workflow."""
    if not state.agent_app:
        return {"error": "Graph not compiled yet."}
    mermaid_str = state.agent_app.get_graph(xray=True).draw_mermaid()
    return {"mermaid": mermaid_str}
