/** Application configuration — web version (no Electron-specific fields) */
export interface AppConfig {
  llm_model: string;
  llm_temperature: number;
  llm_max_tokens: number;
  llm_api_base: string;
  llm_api_key: string;

  // LangSmith Tracing
  langchain_tracing_v2: boolean;
  langchain_endpoint: string;
  langchain_api_key: string;
  langchain_project: string;

  // FastAPI Server
  api_host: string;
  api_port: number;
  web_port: number;

  // Directory Paths
  data_sources_dir: string;
  skills_dir: string;
  knowledge_dir: string;
  mcp_config_path: string;
  workspaces_dir: string;

  // Persistence
  saver_type: 'sqlite' | 'postgres';
  db_uri: string;
  sqlite_path: string;

  // Language
  language: 'en' | 'zh';

  // Debugging
  debug_llm_traffic: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  llm_model: 'deepseek/deepseek-v4-pro',
  llm_temperature: 0.7,
  llm_max_tokens: 65536,
  llm_api_base: 'https://api.deepseek.com',
  llm_api_key: '',
  langchain_tracing_v2: false,
  langchain_endpoint: 'https://api.smith.langchain.com',
  langchain_api_key: '',
  langchain_project: 'datation-agent',
  api_host: '0.0.0.0',
  api_port: 18321,
  web_port: 1420,
  data_sources_dir: '~/.datation/data_sources',
  skills_dir: '~/.datation/skills',
  knowledge_dir: '~/.datation/knowledge_base',
  mcp_config_path: '~/.datation/mcp_servers.json',
  workspaces_dir: '~/.datation/workspaces',
  saver_type: 'sqlite',
  db_uri: 'postgresql://postgres:postgres@localhost:5432/datation',
  sqlite_path: '~/.datation/datation.db',
  language: 'en',
  debug_llm_traffic: true,
};
