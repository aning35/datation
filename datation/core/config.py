import os
import json
from dotenv import load_dotenv

# Load key tokens and global configuration from .env file in the current directory
load_dotenv()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_app_config():
    config_path = os.path.expanduser("~/.datation/config/app.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load app.json config: {e}")
    return {}
_app_config = load_app_config()

def get_system_language():
    lang = load_app_config().get("language", "zh")
    if lang == "en":
        return "English"
    return "Chinese"

def get_language_directive():
    lang_name = get_system_language()
    return f"\n\nIMPORTANT: You must always strictly respond and provide explanations to the user in {lang_name}."

def get_config(json_key: str, env_key: str, default_val):
    val = _app_config.get(json_key)
    if val is not None and val != "":
        return val
    env_val = os.getenv(env_key)
    if env_val is not None and env_val != "":
        # Try to cast env string to proper type based on default
        if isinstance(default_val, bool):
            return str(env_val).lower() in ("true", "1", "t", "yes")
        elif isinstance(default_val, int):
            return int(env_val)
        elif isinstance(default_val, float):
            return float(env_val)
        return env_val
    return default_val

MCP_CONFIG = os.path.expanduser(get_config("mcp_config_path", "MCP_CONFIG_PATH", "~/.datation/mcp_servers.json"))
SKILLS_DIR = os.path.expanduser(get_config("skills_dir", "SKILLS_DIR", "~/.datation/skills"))
DATA_SOURCES_DIR = os.path.expanduser(get_config("data_sources_dir", "DATA_SOURCES_DIR", "~/.datation/data_sources"))
KNOWLEDGE_DIR = os.path.expanduser(get_config("knowledge_dir", "KNOWLEDGE_DIR", "~/.datation/knowledge_base"))

MODEL_NAME = get_config("llm_model", "LLM_MODEL", "gpt-4o")
LLM_API_BASE = get_config("llm_api_base", "LLM_API_BASE", "https://api.deepseek.com")
LLM_API_KEY = get_config("llm_api_key", "LLM_API_KEY", "")
TEMPERATURE = float(get_config("llm_temperature", "LLM_TEMPERATURE", 0.7))
LLM_MAX_TOKENS = int(get_config("llm_max_tokens", "LLM_MAX_TOKENS", 65536))
LANGUAGE = get_config("language", "LANGUAGE", "en")
WORKSPACES_DIR = os.path.expanduser(get_config("workspaces_dir", "WORKSPACES_DIR", "~/.datation/workspaces"))
API_HOST = get_config("api_host", "API_HOST", "0.0.0.0")
API_PORT = int(get_config("api_port", "API_PORT", 18321))
SAVER_TYPE = get_config("saver_type", "SAVER_TYPE", "sqlite")
DB_URI = get_config("db_uri", "DB_URI", "postgresql://postgres:postgres@localhost:5432/datation")
SQLITE_PATH = os.path.expanduser(get_config("sqlite_path", "SQLITE_PATH", "~/.datation/datation.db"))
DEBUG_LLM_TRAFFIC = get_config("debug_llm_traffic", "DEBUG_LLM_TRAFFIC", True)

LANGCHAIN_TRACING_V2 = get_config("langchain_tracing_v2", "LANGCHAIN_TRACING_V2", False)
if LANGCHAIN_TRACING_V2:
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_ENDPOINT"] = str(get_config("langchain_endpoint", "LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com"))
    os.environ["LANGCHAIN_API_KEY"] = str(get_config("langchain_api_key", "LANGCHAIN_API_KEY", ""))
    os.environ["LANGCHAIN_PROJECT"] = str(get_config("langchain_project", "LANGCHAIN_PROJECT", "datation-agent"))
else:
    os.environ["LANGCHAIN_TRACING_V2"] = "false"

import shutil

# Path for the demo SQLite database (lives alongside other .datation data)
DATATION_HOME = os.path.dirname(os.path.expanduser(WORKSPACES_DIR))  # ~/.datation
DEMO_DB_PATH = os.path.join(DATATION_HOME, "demo_data.db").replace("\\", "/")

def init_default_dirs():
    os.makedirs(DATA_SOURCES_DIR, exist_ok=True)
    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
    os.makedirs(WORKSPACES_DIR, exist_ok=True)
    
    # Init Skills
    if not os.path.exists(SKILLS_DIR) or not os.listdir(SKILLS_DIR):
        bundled_skills = os.path.join(os.path.dirname(PROJECT_ROOT), "skills")
        if os.path.exists(bundled_skills) and bundled_skills != SKILLS_DIR:
            try:
                if os.path.exists(SKILLS_DIR):
                    os.rmdir(SKILLS_DIR)
                shutil.copytree(bundled_skills, SKILLS_DIR)
                print(f"[Init] Copied default skills from {bundled_skills} to {SKILLS_DIR}")
            except Exception as e:
                print(f"[Init] Failed to copy skills: {e}")
                os.makedirs(SKILLS_DIR, exist_ok=True)

    # Init Demo Database — generate a SQLite demo DB with sample e-commerce data
    # so new users can start querying immediately after setting up their LLM API key
    if not os.path.exists(DEMO_DB_PATH):
        try:
            seed_script = os.path.join(os.path.dirname(PROJECT_ROOT), "scripts", "seed_demo_db.py")
            if os.path.exists(seed_script):
                # Import and run the seed function directly (no subprocess needed)
                import importlib.util
                spec = importlib.util.spec_from_file_location("seed_demo_db", seed_script)
                seed_module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(seed_module)
                seed_module.seed_database(DEMO_DB_PATH)
            else:
                print(f"[Init] Seed script not found at {seed_script}, skipping demo DB generation")
        except Exception as e:
            print(f"[Init] Failed to generate demo database: {e}")

    # Init default MCP config — create a default mcp_servers.json with a SQLite MCP server
    # pointing to the demo database, so the system is ready to use out of the box
    if not os.path.exists(MCP_CONFIG):
        try:
            os.makedirs(os.path.dirname(MCP_CONFIG), exist_ok=True)
            default_mcp_config = {
                "mcpServers": {
                    "seed_demo_db": {
                        "command": "uvx",
                        "args": [
                            "mcp-server-sqlite",
                            "--db-path",
                            DEMO_DB_PATH,
                        ]
                    }
                }
            }
            with open(MCP_CONFIG, "w", encoding="utf-8") as f:
                json.dump(default_mcp_config, f, indent=2, ensure_ascii=False)
            print(f"[Init] Created default MCP config at {MCP_CONFIG} (SQLite → {DEMO_DB_PATH})")
        except Exception as e:
            print(f"[Init] Failed to create default MCP config: {e}")

init_default_dirs()

