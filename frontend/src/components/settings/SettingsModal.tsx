import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Save, X, Loader2, Database, Key, Server, Folder,
  Zap, RefreshCw, Code, CheckCircle, AlertCircle,
  Eye, EyeOff, HelpCircle, Languages, Store
} from 'lucide-react';
import { Editor, loader } from '@monaco-editor/react';
import { DEFAULT_CONFIG, type AppConfig } from '../../types/config';
import { useTranslation } from '../../i18n/useTranslation';
import { FileBrowserModal } from './FileBrowserModal';
import { SkillMarketplace } from './SkillMarketplace';

// Configure Monaco Editor to use staticfile CDN for better accessibility in China
loader.config({ paths: { vs: 'https://registry.npmmirror.com/monaco-editor/0.43.0/files/min/vs' } });

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:18321';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alertMessage?: string;
}

type NavSection =
  | 'llm'
  | 'general'
  | 'mcp'
  | 'skills'
  | 'about';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, alertMessage }) => {
  const { t, setLanguage: setAppLanguage } = useTranslation();
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [activeSection, setActiveSection] = useState<NavSection>('llm');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorDesc, setErrorDesc] = useState<string | null>(null);
  const [originalConfig, setOriginalConfig] = useState<AppConfig | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);

  // MCP editor state
  const [mcpJson, setMcpJson] = useState('');
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  // Skills state
  interface SkillInfo { name: string; yaml_name: string; description: string; path?: string; }
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsScanning, setSkillsScanning] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsScanned, setSkillsScanned] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);

  // File Browser state
  const [browserModalOpen, setBrowserModalOpen] = useState(false);
  const [browserMode, setBrowserMode] = useState<'directory' | 'file'>('directory');
  const [browserTargetField, setBrowserTargetField] = useState<keyof AppConfig | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setActiveSection('llm');
      setSkills([]);
      setSkillsScanned(false);
      setMcpError(null);
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setIsLoading(true);
    setErrorDesc(null);
    try {
      const res = await fetch(`${API_BASE_URL}/config/app`);
      if (res.ok) {
        const loadedConfig = await res.json();
        setConfig({ ...DEFAULT_CONFIG, ...loadedConfig });
        if (loadedConfig.language) {
          setAppLanguage(loadedConfig.language);
        }
      } else {
        throw new Error('Failed to load configuration');
      }
    } catch (e: any) {
      setErrorDesc(typeof e === 'string' ? e : e.message || '加载配置失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (config && !originalConfig && !isLoading) {
      setOriginalConfig(config);
    }
  }, [config, originalConfig, isLoading]);

  const handleSave = async () => {
    setIsSaving(true);
    setErrorDesc(null);
    setShowSaveSuccess(false);
    try {
      if (config.language) {
        setAppLanguage(config.language);
      }

      // 1. Save App Config
      const appRes = await fetch(`${API_BASE_URL}/config/app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!appRes.ok) throw new Error('Failed to save App Config');

      // 2. Save MCP JSON if it has been loaded/edited
      if (mcpJson) {
        try {
          JSON.parse(mcpJson); // Validate
          const mcpRes = await fetch(`${API_BASE_URL}/config/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: mcpJson })
          });
          if (!mcpRes.ok) throw new Error('Failed to save MCP config');
        } catch (e: any) {
          setErrorDesc(t('settings.mcp.formatError') + e.message);
          setIsSaving(false);
          return;
        }
      }

      const needsRestart = originalConfig && (
        config.api_port !== originalConfig.api_port ||
        config.api_host !== originalConfig.api_host ||
        config.llm_model !== originalConfig.llm_model ||
        config.llm_api_base !== originalConfig.llm_api_base ||
        config.llm_api_key !== originalConfig.llm_api_key ||
        config.skills_dir !== originalConfig.skills_dir ||
        config.data_sources_dir !== originalConfig.data_sources_dir ||
        config.knowledge_dir !== originalConfig.knowledge_dir
      );

      if (needsRestart) {
        setRestartRequired(true);
      }

      setShowSaveSuccess(true);
      setOriginalConfig(config);

      setTimeout(() => {
        setShowSaveSuccess(false);
      }, 3000);
    } catch (e: any) {
      setErrorDesc(typeof e === 'string' ? e : e.message || '保存配置失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof AppConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    if (field === 'language') {
      setAppLanguage(value as 'en' | 'zh');
    }
  };

  const NAV_ITEMS: { id: NavSection; label: string; icon: React.ReactNode }[] = [
    { id: 'llm', label: t('settings.sections.llm'), icon: <Key className="w-4 h-4" /> },
    { id: 'mcp', label: t('settings.sections.mcp'), icon: <Code className="w-4 h-4" /> },
    { id: 'skills', label: t('settings.sections.skills'), icon: <Zap className="w-4 h-4" /> },
    { id: 'general', label: t('settings.sections.general'), icon: <Settings className="w-4 h-4" /> },
    { id: 'about', label: t('settings.sections.about'), icon: <HelpCircle className="w-4 h-4" /> },
  ];

  const loadMcpJson = useCallback(async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/config/mcp`);
      if (res.ok) {
        const data = await res.json();
        setMcpJson(data.content || '{}');
      } else {
        throw new Error('Failed to load MCP config');
      }
    } catch (e: any) {
      setMcpError(typeof e === 'string' ? e : e.message || '读取 MCP 配置失败');
    } finally {
      setMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === 'mcp' && isOpen) {
      loadMcpJson();
    }
  }, [activeSection, isOpen, loadMcpJson]);

  const scanSkills = useCallback(async () => {
    if (!config.skills_dir) return;
    setSkillsScanning(true);
    setSkillsError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/config/skills`);
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills || []);
      } else {
        throw new Error('Failed to scan skills');
      }
    } catch (e: any) {
      setSkillsError(typeof e === 'string' ? e : e.message || t('settings.skills.scanFailed'));
    } finally {
      setSkillsScanned(true);
      setSkillsScanning(false);
    }
  }, [config.skills_dir, t]);

  useEffect(() => {
    if (activeSection === 'skills' && isOpen && config.skills_dir && !skillsScanned && !skillsScanning) {
      scanSkills();
    }
  }, [activeSection, isOpen, config.skills_dir, skillsScanned, skillsScanning, scanSkills]);

  const openBrowser = (field: keyof AppConfig, mode: 'directory' | 'file') => {
    setBrowserTargetField(field);
    setBrowserMode(mode);
    setBrowserModalOpen(true);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[82vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 leading-tight">{t('settings.title')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('settings.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="w-44 shrink-0 border-r border-slate-100 bg-slate-50 py-3 flex flex-col gap-0.5 overflow-y-auto">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-left w-full rounded-none
                  ${activeSection === item.id
                    ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                <span className={activeSection === item.id ? 'text-blue-600' : 'text-slate-400'}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 bg-white">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <p className="text-sm">{t('settings.loading')}</p>
              </div>
            ) : (
              <>
                {alertMessage && (
                  <div className="bg-amber-50 text-amber-700 p-3 rounded-lg text-sm border border-amber-200 mb-4 flex items-center gap-2 animate-pulse">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="font-medium">{alertMessage}</span>
                  </div>
                )}
                {errorDesc && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-200 mb-4 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> {errorDesc}
                  </div>
                )}
                {showSaveSuccess && !restartRequired && (
                  <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[110] animate-in fade-in slide-in-from-top-4 duration-500">
                    <div className="bg-emerald-600 text-white px-8 py-3.5 rounded-full shadow-2xl flex items-center gap-3 border border-white/20 backdrop-blur-md ring-4 ring-emerald-500/10">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-bold tracking-wide">{t('settings.saveSuccess')}</span>
                    </div>
                  </div>
                )}

                {restartRequired && (
                  <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-100 flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
                      <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mb-4 text-amber-500">
                        <RefreshCw className="w-6 h-6 animate-spin-slow" />
                      </div>
                      <h3 className="text-base font-bold text-slate-800 mb-2">
                        {t('settings.restartRequired')}
                      </h3>
                      <p className="text-xs text-slate-500 leading-relaxed mb-6 px-2">
                        {t('settings.restartMessage')}
                      </p>
                      <div className="flex items-center gap-3 w-full">
                        <button
                          onClick={() => setRestartRequired(false)}
                          disabled={isSaving}
                          className="flex-1 px-4 py-2.5 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {t('settings.restartLater')}
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              setIsSaving(true);
                              const port = config.api_port || 18321;
                              const host = config.api_host === '0.0.0.0' ? 'localhost' : (config.api_host || 'localhost');
                              await fetch(`http://${host}:${port}/restart`, { method: 'POST' });
                            } catch (e) {
                              console.error('Restart failed', e);
                            }

                            const pollHealth = async () => {
                              const port = originalConfig?.api_port || 18321;
                              const host = (originalConfig?.api_host === '0.0.0.0' ? 'localhost' : originalConfig?.api_host) || 'localhost';
                              let serverWentDown = false;

                              for (let i = 0; i < 120; i++) {
                                await new Promise(r => setTimeout(r, 1000));
                                try {
                                  const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) });
                                  if (res.ok) {
                                    if (serverWentDown) {
                                      return true;
                                    }
                                  } else {
                                    serverWentDown = true;
                                  }
                                } catch {
                                  serverWentDown = true;
                                }
                              }
                              return false;
                            };

                            const ok = await pollHealth();
                            if (ok) {
                              window.location.reload();
                            } else {
                              setIsSaving(false);
                              alert(t('settings.restartTimeout'));
                            }
                          }}
                          disabled={isSaving}
                          className="flex-1 px-4 py-2.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl shadow-md shadow-amber-500/10 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                        >
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          {isSaving ? t('settings.restarting') : t('settings.restartNow')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* LLM */}
                {activeSection === 'llm' && (
                  <SectionWrapper title={t('settings.llm.title')} icon={<Key className="w-4 h-4 text-blue-500" />}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label={t('settings.llm.model')} help={t('settings.llm.modelHelp')}>
                        <TextInput value={config.llm_model} onChange={v => handleChange('llm_model', v)} />
                      </Field>
                      <Field label={t('settings.llm.baseUrl')} span2>
                        <TextInput value={config.llm_api_base} onChange={v => handleChange('llm_api_base', v)} />
                      </Field>
                      <Field label={t('settings.llm.apiKey')} span2>
                        <TextInput type="password" value={config.llm_api_key} onChange={v => handleChange('llm_api_key', v)} placeholder="sk-..." />
                      </Field>
                      <Field label={`${t('settings.llm.temperature')}: ${config.llm_temperature}`}>
                        <input
                          type="range" min="0" max="2" step="0.1"
                          value={config.llm_temperature}
                          onChange={e => handleChange('llm_temperature', parseFloat(e.target.value))}
                          className="w-full mt-2 accent-blue-600"
                        />
                      </Field>
                      <Field label={`${t('settings.llm.maxTokens') || 'Max Tokens'}: ${config.llm_max_tokens || 65536}`}>
                        <input
                          type="number"
                          value={config.llm_max_tokens || 65536}
                          onChange={e => handleChange('llm_max_tokens', parseInt(e.target.value) || 65536)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm bg-white text-slate-800"
                        />
                      </Field>
                      <div className="md:col-span-2 pt-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox" id="debug_llm_traffic"
                            checked={config.debug_llm_traffic}
                            onChange={e => handleChange('debug_llm_traffic', e.target.checked)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                          />
                          <div className="flex flex-col">
                            <label htmlFor="debug_llm_traffic" className="text-sm font-medium text-slate-800 cursor-pointer">
                              {t('settings.llm.debugTraffic')}
                            </label>
                            <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                              {t('settings.llm.debugTrafficHelp')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </SectionWrapper>
                )}

                {/* General Settings */}
                {activeSection === 'general' && (
                  <div className="flex flex-col gap-10">
                    <SectionWrapper title={t('settings.server.title')} icon={<Server className="w-4 h-4 text-emerald-500" />}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label={t('settings.server.host')}>
                          <TextInput value={config.api_host} onChange={v => handleChange('api_host', v)} />
                        </Field>
                        <Field label={t('settings.server.port')}>
                          <input
                            type="number" value={config.api_port}
                            onChange={e => handleChange('api_port', parseInt(e.target.value) || 18321)}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm text-slate-800"
                          />
                        </Field>
                        <Field label={t('settings.server.webPort') || 'Web Port'}>
                          <input
                            type="number" value={config.web_port}
                            onChange={e => handleChange('web_port', parseInt(e.target.value) || 1420)}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm text-slate-800"
                          />
                        </Field>
                      </div>
                    </SectionWrapper>

                    <div className="h-px bg-slate-200 w-full" />

                    <SectionWrapper title={t('settings.directories.title')} icon={<Folder className="w-4 h-4 text-amber-500" />}>
                      <div className="grid grid-cols-1 gap-4">
                        <Field label={t('settings.directories.dataSources')} help={t('settings.directories.dataSourcesHelp')}>
                          <PathInput
                            value={config.data_sources_dir}
                            onChange={v => handleChange('data_sources_dir', v)}
                            onBrowse={() => openBrowser('data_sources_dir', 'directory')}
                          />
                        </Field>
                        <Field label={t('settings.directories.skills')} help={t('settings.directories.skillsHelp')}>
                          <PathInput
                            value={config.skills_dir}
                            onChange={v => handleChange('skills_dir', v)}
                            onBrowse={() => openBrowser('skills_dir', 'directory')}
                          />
                        </Field>
                        <Field label={t('settings.directories.knowledge')} help={t('settings.directories.knowledgeHelp')}>
                          <PathInput
                            value={config.knowledge_dir}
                            onChange={v => handleChange('knowledge_dir', v)}
                            onBrowse={() => openBrowser('knowledge_dir', 'directory')}
                          />
                        </Field>
                        <Field label={t('settings.directories.mcpConfig')} help={t('settings.directories.mcpConfigHelp')}>
                          <PathInput
                            value={config.mcp_config_path}
                            onChange={v => handleChange('mcp_config_path', v)}
                            onBrowse={() => openBrowser('mcp_config_path', 'file')}
                          />
                        </Field>
                        <Field label={t('settings.directories.workspaces')} help={t('settings.directories.workspacesHelp')}>
                          <PathInput
                            value={config.workspaces_dir}
                            onChange={v => handleChange('workspaces_dir', v)}
                            onBrowse={() => openBrowser('workspaces_dir', 'directory')}
                          />
                        </Field>
                      </div>
                    </SectionWrapper>

                    <div className="h-px bg-slate-200 w-full" />

                    <SectionWrapper title={t('settings.persistence.title')} icon={<Database className="w-4 h-4 text-indigo-500" />}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label={t('settings.persistence.saverType')}>
                          <select
                            value={config.saver_type}
                            onChange={e => handleChange('saver_type', e.target.value as 'sqlite' | 'postgres')}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm text-slate-800 bg-white"
                          >
                            <option value="sqlite">{t('settings.persistence.sqlite')}</option>
                            <option value="postgres">{t('settings.persistence.postgres')}</option>
                          </select>
                        </Field>
                        {config.saver_type === 'postgres' && (
                          <div className="md:col-span-2">
                            <Field label={t('settings.persistence.dbUri')}>
                              <TextInput
                                value={config.db_uri}
                                onChange={v => handleChange('db_uri', v)}
                                placeholder="postgresql://user:pass@localhost:5432/db"
                              />
                            </Field>
                          </div>
                        )}
                        {config.saver_type === 'sqlite' && (
                          <div className="md:col-span-2">
                            <Field label={t('settings.persistence.sqlitePath')}>
                              <PathInput
                                value={config.sqlite_path}
                                onChange={v => handleChange('sqlite_path', v)}
                                onBrowse={() => openBrowser('sqlite_path' as any, 'file')}
                              />
                            </Field>
                          </div>
                        )}
                      </div>
                    </SectionWrapper>

                    <div className="h-px bg-slate-200 w-full" />

                    <SectionWrapper title={t('settings.langsmith.title')} icon={<span className="w-4 h-4 text-xs font-bold text-slate-600">LS</span>}>
                      <div className="grid grid-cols-1 gap-4">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox" id="tracing"
                            checked={config.langchain_tracing_v2}
                            onChange={e => handleChange('langchain_tracing_v2', e.target.checked)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                          />
                          <label htmlFor="tracing" className="text-sm font-medium text-slate-800 cursor-pointer">
                            {t('settings.langsmith.enable')}
                          </label>
                        </div>
                        {config.langchain_tracing_v2 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6 border-l-2 border-blue-100">
                            <Field label={t('settings.langsmith.project')} span2>
                              <TextInput value={config.langchain_project} onChange={v => handleChange('langchain_project', v)} />
                            </Field>
                            <Field label={t('settings.langsmith.endpoint')} span2>
                              <TextInput value={config.langchain_endpoint} onChange={v => handleChange('langchain_endpoint', v)} />
                            </Field>
                            <Field label={t('settings.langsmith.apiKey')} span2>
                              <TextInput type="password" value={config.langchain_api_key} onChange={v => handleChange('langchain_api_key', v)} placeholder="lsv2_..." />
                            </Field>
                          </div>
                        )}
                      </div>
                    </SectionWrapper>

                    <div className="h-px bg-slate-200 w-full" />

                    <SectionWrapper title={t('settings.language.title')} icon={<Languages className="w-4 h-4 text-purple-500" />}>
                      <div className="grid grid-cols-1 gap-4">
                        <Field label={t('settings.language.label')}>
                          <select
                            value={config.language}
                            onChange={e => handleChange('language', e.target.value as 'en' | 'zh')}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm text-slate-800 bg-white"
                          >
                            <option value="en">{t('settings.language.english')}</option>
                            <option value="zh">{t('settings.language.chinese')}</option>
                          </select>
                        </Field>
                      </div>
                    </SectionWrapper>
                  </div>
                )}

                {/* MCP */}
                {activeSection === 'mcp' && (
                  <SectionWrapper title={t('settings.mcp.title')} icon={<Code className="w-4 h-4 text-violet-500" />}>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        {t('settings.mcp.filePath')}<span className="font-mono text-slate-700">{config.mcp_config_path}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={loadMcpJson}
                          className="text-slate-500 hover:text-slate-700 p-1.5 rounded hover:bg-slate-100 transition-colors"
                          title={t('settings.mcp.reload')}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {mcpError && (
                      <div className="flex items-center gap-2 bg-red-50 text-red-600 p-2.5 rounded-lg text-xs border border-red-200 mb-3">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {mcpError}
                      </div>
                    )}
                    {mcpLoading ? (
                      <div className="flex items-center justify-center h-32 text-slate-400 gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                        <span className="text-sm">{t('settings.mcp.loading')}</span>
                      </div>
                    ) : (
                      <div className="h-[400px] w-full border border-slate-700 rounded-xl overflow-hidden bg-slate-950">
                        <Editor
                          height="100%"
                          defaultLanguage="json"
                          theme="vs-dark"
                          loading={
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                              <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                              <span className="text-xs font-medium">Editor Loading...</span>
                            </div>
                          }
                          value={mcpJson}
                          onChange={(val: string | undefined) => setMcpJson(val || '')}
                          options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            padding: { top: 16, bottom: 16 },
                          }}
                        />
                      </div>
                    )}
                  </SectionWrapper>
                )}

                {/* Skills */}
                {activeSection === 'skills' && (
                  <SectionWrapper title={t('settings.skills.title')} icon={<Zap className="w-4 h-4 text-orange-500" />} action={
                    <button
                      onClick={() => setShowMarketplace(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg hover:from-orange-600 hover:to-amber-600 transition-all shadow-sm"
                    >
                      <Store className="w-3.5 h-3.5" />
                      {t('settings.skills.marketplace')}
                    </button>
                  }>
                    <div className="mb-4">
                      <Field label={t('settings.skills.skillsDir')}>
                        <PathInput
                          value={config.skills_dir}
                          onChange={v => { handleChange('skills_dir', v); setSkillsScanned(false); setSkills([]); }}
                          onBrowse={() => openBrowser('skills_dir', 'directory')}
                        />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs text-slate-500">{t('settings.skills.scanHint')} <span className="font-mono bg-slate-100 px-1 rounded">SKILL.md</span> {t('settings.skills.clickToScan')}</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={scanSkills}
                          disabled={skillsScanning}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {skillsScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          {t('settings.skills.scanButton')}
                        </button>
                      </div>
                    </div>
                    {skillsError && (
                      <div className="flex items-center gap-2 bg-red-50 text-red-600 p-2.5 rounded-lg text-xs border border-red-200 mb-3">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {skillsError}
                      </div>
                    )}
                    {skillsScanned && (
                      skills.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                          <Zap className="w-8 h-8 text-slate-300" />
                          <p className="text-sm">{t('settings.skills.noSkills')}</p>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500 mb-3 ml-1">{t('settings.skills.foundSkills')} <span className="font-semibold text-slate-700">{skills.length}</span> {t('settings.skills.availableSkills')}</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {skills.map((skill, index) => (
                              <div
                                key={index}
                                className="group flex flex-col p-4 bg-slate-50 border border-slate-200 rounded-2xl hover:border-orange-300 hover:shadow-lg hover:shadow-orange-500/5 transition-all duration-300 relative overflow-hidden"
                              >
                                <div className="flex items-start gap-3 mb-4">
                                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 group-hover:bg-orange-500 transition-all duration-300">
                                    <Zap className="w-5 h-5 text-orange-600 group-hover:text-white transition-colors" />
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="text-base font-bold text-slate-800 truncate group-hover:text-orange-700 transition-colors" title={skill.name}>
                                      {skill.name}
                                    </h4>
                                    <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate uppercase tracking-tighter" title={skill.path}>
                                      dir: {skill.path}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-auto px-1">
                                  <p className="text-xs leading-relaxed text-slate-500 line-clamp-3" title={skill.description}>
                                    {skill.description || t('settings.skills.noDescription')}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    )}
                    {!skillsScanned && !skillsScanning && (
                          <div className="flex flex-col items-center justify-center py-12 text-slate-300 gap-2">
                        <Zap className="w-10 h-10" />
                        <p className="text-sm text-slate-400">{t('settings.skills.clickToDiscover')}</p>
                      </div>
                    )}
                  </SectionWrapper>
                )}

                {/* About */}
                {activeSection === 'about' && (
                  <SectionWrapper title={t('settings.about.title')} icon={<HelpCircle className="w-4 h-4 text-blue-500" />}>
                    <div className="flex flex-col items-center justify-center py-1 text-center select-none">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/10 flex items-center justify-center text-white mb-4 transform hover:scale-105 transition-transform duration-300">
                        <Settings className="w-8 h-8 animate-spin-slow" />
                      </div>

                      <h3 className="text-xl font-black text-slate-800 tracking-tight">Datation</h3>
                      <p className="text-[11px] font-semibold text-blue-600 mt-0.5">Multi-Agent Data Analysis Platform</p>

                      <div className="mt-4 flex flex-col items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-xl px-5 py-2.5 w-full max-w-sm">
                        <div className="flex items-center justify-between w-full border-b border-slate-200/50 pb-1.5">
                          <span className="text-[11px] font-semibold text-slate-500">{t('settings.about.version')}</span>
                          <span className="text-[10px] font-mono font-bold text-slate-800 bg-blue-100/60 px-2 py-0.5 rounded text-blue-700">v1.0.0</span>
                        </div>
                        <div className="flex items-center justify-between w-full pt-1.5">
                          <span className="text-[11px] font-semibold text-slate-500">GitHub</span>
                          <a
                            href="https://github.com/aning35/datation"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-mono font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors flex items-center gap-1"
                          >
                            aning35/datation
                          </a>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400 mt-4 max-w-xs leading-relaxed">
                        {t('settings.about.description')}
                      </p>

                      <div className="mt-4 text-[9px] text-slate-400 font-mono">
                        {t('settings.about.copyright')}
                      </div>
                    </div>
                  </SectionWrapper>
                )}


              </>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-50 bg-slate-50 flex items-center justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
            {t('settings.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>

      <FileBrowserModal
        isOpen={browserModalOpen}
        onClose={() => setBrowserModalOpen(false)}
        mode={browserMode}
        initialPath={typeof config[browserTargetField || 'data_sources_dir'] === 'string' ? config[browserTargetField || 'data_sources_dir'] as string : ''}
        onSelect={(path) => {
          if (browserTargetField) {
            handleChange(browserTargetField, path);
          }
        }}
        title={browserMode === 'directory' ? 'Select Directory' : 'Select File'}
      />

      <SkillMarketplace
        isOpen={showMarketplace}
        onClose={() => setShowMarketplace(false)}
        localSkillNames={skills.map(s => s.name)}
        onInstalled={() => { setSkillsScanned(false); scanSkills(); window.dispatchEvent(new Event('skills-updated')); }}
      />
    </div>
  );
};

const SectionWrapper: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }> = ({ title, icon, children, action }) => (
  <div>
    <div className="flex items-center justify-between mb-5 pb-1">
      <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
        {icon} {title}
      </h3>
      {action}
    </div>
    {children}
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; span2?: boolean; help?: string }> = ({ label, children, span2, help }) => (
  <div className={span2 ? 'md:col-span-2' : ''}>
    <div className="flex items-center gap-1.5 mb-1">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {help && (
        <div className="group relative inline-block">
          <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-help hover:text-slate-600 transition-colors" />
          <div className="absolute left-0 bottom-full mb-2 w-48 p-2 bg-slate-800 text-white text-[11px] leading-relaxed rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-slate-700">
            {help}
            <div className="absolute top-full left-2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-800" />
          </div>
        </div>
      )}
    </div>
    {children}
  </div>
);

const TextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}> = ({ value, onChange, type = 'text', placeholder, disabled }) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="relative w-full">
      <input
        type={inputType}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm bg-white text-slate-800 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
        style={{ paddingRight: isPassword ? '2.5rem' : '0.75rem' }}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
        >
          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
};

const PathInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onBrowse?: () => void;
}> = ({ value, onChange, onBrowse }) => (
  <div className="flex gap-2">
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm bg-white text-slate-800 placeholder:text-slate-400"
    />
    {onBrowse && (
      <button
        onClick={onBrowse}
        className="px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-200 hover:text-slate-800 transition-colors flex items-center justify-center shrink-0"
        title="Browse"
      >
        <Folder className="w-4 h-4" />
      </button>
    )}
  </div>
);
