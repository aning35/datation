import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, MessageSquare, FileText, ClipboardList, Zap, Settings, Plus, Sparkles, GitBranch, CornerDownLeft } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

interface HistoryItem {
  thread_id: string;
  query: string;
  updated_at: string;
  status: string;
}

interface SpotlightSearchProps {
  isOpen: boolean;
  onClose: () => void;
  historyList: HistoryItem[];
  onSelectHistory: (threadId: string, viewOnly: boolean) => void;
  setActiveTab: (tab: string) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
}

interface SearchResult {
  id: string;
  type: 'tab' | 'action' | 'history';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  handler: () => void;
}

export const SpotlightSearch: React.FC<SpotlightSearchProps> = ({
  isOpen,
  onClose,
  historyList,
  onSelectHistory,
  setActiveTab,
  onNewConversation,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  // Scroll active item into view dynamically
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'auto',
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  // Global keyboard shortcut to close on Escape
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleGlobalKeyDown);
    }
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Auto focus input
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Reset index when search query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Reset search state whenever the search modal is opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // static sections for tabs and quick actions
  const staticItems = useMemo<SearchResult[]>(() => [
    // Tabs
    {
      id: 'tab-trace',
      type: 'tab',
      title: t('tabs.trace') || '智能分析诊断',
      subtitle: '查看 AI 对话推理、数据分析与可视化面板',
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      handler: () => {
        setActiveTab('trace');
        onClose();
      }
    },
    {
      id: 'tab-workflow',
      type: 'tab',
      title: t('tabs.workflow') || '智能分析链路',
      subtitle: '查看数据分析专家团队的工作流有向图',
      icon: <GitBranch className="w-4 h-4 text-indigo-500" />,
      handler: () => {
        setActiveTab('workflow');
        onClose();
      }
    },
    {
      id: 'tab-plan',
      type: 'tab',
      title: t('tabs.plan') || '规划执行步骤',
      subtitle: '跟踪多智能体协同规划与步骤详情',
      icon: <ClipboardList className="w-4 h-4 text-violet-500" />,
      handler: () => {
        setActiveTab('plan');
        onClose();
      }
    },
    {
      id: 'tab-files',
      type: 'tab',
      title: t('tabs.files') || '数据集与提取文件',
      subtitle: '管理并下载该会话生成或上传的全部文件',
      icon: <FileText className="w-4 h-4 text-blue-500" />,
      handler: () => {
        setActiveTab('files');
        onClose();
      }
    },
    {
      id: 'tab-token',
      type: 'tab',
      title: t('tabs.token') || '算力消耗分析',
      subtitle: '统计多步骤推理中所使用的 Tokens 成本',
      icon: <Zap className="w-4 h-4 text-amber-500" />,
      handler: () => {
        setActiveTab('token');
        onClose();
      }
    },
    // Quick Actions
    {
      id: 'action-new',
      type: 'action',
      title: t('sidebar.newChat') || '开启新会话',
      subtitle: '重置工作区并开启一轮全新的对话',
      icon: <Plus className="w-4 h-4 text-[#89b4fa]" />,
      handler: () => {
        onNewConversation();
        onClose();
      }
    },
    {
      id: 'action-settings',
      type: 'action',
      title: t('sidebar.settings') || '打开系统设置',
      subtitle: '配置 API 密钥、系统参数及管理 Skills 技能市场',
      icon: <Settings className="w-4 h-4 text-[#a6adc8]" />,
      handler: () => {
        onOpenSettings();
        onClose();
      }
    }
  ], [t, setActiveTab, onNewConversation, onOpenSettings, onClose]);

  // Combined searchable items
  const filteredResults = useMemo(() => {
    const search = query.trim().toLowerCase();
    
    // Filter tabs and actions
    const filteredStatic = staticItems.filter(item => 
      item.title.toLowerCase().includes(search) || 
      (item.subtitle && item.subtitle.toLowerCase().includes(search))
    );

    // Filter history
    const filteredHistory: SearchResult[] = historyList
      .filter(item => item.query.toLowerCase().includes(search))
      .map(item => ({
        id: `history-${item.thread_id}`,
        type: 'history',
        title: item.query,
        subtitle: `历史会话 • ${new Date(item.updated_at).toLocaleString('zh-CN', { hour12: false })}`,
        icon: <MessageSquare className="w-4 h-4 text-slate-400" />,
        handler: () => {
          onSelectHistory(item.thread_id, true);
          onClose();
        }
      }));

    return [...filteredStatic, ...filteredHistory];
  }, [query, staticItems, historyList, onSelectHistory, onClose]);

  // Handle Keyboard Selection
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredResults.length) % filteredResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredResults[selectedIndex]) {
        filteredResults[selectedIndex].handler();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-999 flex items-start justify-center pt-[15vh]">
      <div 
        ref={containerRef}
        className="bg-white/90 dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[60vh] select-none"
      >
        {/* Search Input bar */}
        <div className="flex items-center px-4.5 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <Search className="w-5 h-5 text-slate-400 shrink-0 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索功能、板块、历史会话... (Esc 关闭)"
            className="flex-1 py-4 bg-transparent outline-none text-slate-800 dark:text-slate-200 text-[15px] placeholder-slate-400"
          />
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <kbd className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-slate-400">Esc</kbd>
          </div>
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-4">
          {filteredResults.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400 dark:text-slate-500">
              未找到匹配的搜索结果
            </div>
          ) : (
            <div className="space-y-1">
              {/* Group headings logic or uniform list */}
              {filteredResults.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    ref={el => {
                      if (isSelected) {
                        activeItemRef.current = el;
                      }
                    }}
                    key={item.id}
                    onClick={item.handler}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all flex items-center gap-3 ${
                      isSelected 
                        ? 'bg-blue-600 text-white shadow-md' 
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className={`p-2 rounded-lg shrink-0 ${
                      isSelected 
                        ? 'bg-white/15 text-white' 
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold truncate ${isSelected ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className={`text-[11px] mt-0.5 truncate ${isSelected ? 'text-blue-100/90' : 'text-slate-400 dark:text-slate-500'}`}>
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <div className="shrink-0 flex items-center gap-1 text-[10px] font-medium bg-white/20 px-2 py-1 rounded text-white animate-fade-in">
                        <span className="text-[11px]">确认</span>
                        <CornerDownLeft className="w-3 h-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4.5 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
          <div className="flex items-center gap-3">
            <span>↑↓ 导航</span>
            <span>Enter 确认</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>全局呼出</span>
            <kbd className="font-mono bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200/50 dark:border-slate-700/50 px-1 py-0.5 rounded text-[10px]">⌘</kbd>
            <span>+</span>
            <kbd className="font-mono bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200/50 dark:border-slate-700/50 px-1 py-0.5 rounded text-[10px]">K</kbd>
          </div>
        </div>
      </div>
    </div>
  );
};
