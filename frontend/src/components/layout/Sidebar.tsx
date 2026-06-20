import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Plus, Settings, ChevronLeft, MessageSquare,
  Trash2, Loader2, Clock, CheckCircle2, PauseCircle, MessageCircle, PanelLeftOpen, Search,
  X, Check
} from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_COLLAPSED_WIDTH = 60;

interface HistoryItem {
  thread_id: string;
  query: string;
  updated_at: string;
  status: string;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  historyList: HistoryItem[];
  historyLoading: boolean;
  currentThreadId: string | null;
  onSelectHistory: (threadId: string, viewOnly: boolean) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onRefreshHistory: () => void;
  onDeleteHistory: (threadId: string) => Promise<void>;
  onOpenSearch: () => void;
}

/** Group history items by date: today / yesterday / earlier */
function groupByDate(
  items: HistoryItem[],
  labels: { today: string; yesterday: string; earlier: string }
): { label: string; items: HistoryItem[] }[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const groups: Record<string, HistoryItem[]> = {};

  for (const item of items) {
    const d = item.updated_at ? new Date(item.updated_at) : null;
    let groupKey: string;
    if (!d) {
      groupKey = labels.earlier;
    } else if (d.toDateString() === todayStr) {
      groupKey = labels.today;
    } else if (d.toDateString() === yesterdayStr) {
      groupKey = labels.yesterday;
    } else {
      groupKey = labels.earlier;
    }

    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(item);
  }

  // Ensure canonical order: today → yesterday → earlier
  const canonicalOrder = [labels.today, labels.yesterday, labels.earlier];
  return canonicalOrder.filter(k => groups[k]).map(k => ({
    label: k,
    items: groups[k],
  }));
}

/** 根据会话状态返回左侧图标 */
const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'In Progress':
      return <PauseCircle className="w-3 h-3 shrink-0 text-orange-400" />;
    case 'Pending Confirmation':
      return <MessageCircle className="w-3 h-3 shrink-0 text-amber-500" />;
    case 'Completed':
      return <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-500" />;
    default:
      return <MessageSquare className="w-3 h-3 shrink-0 text-[#585b70]" />;
  }
};

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  historyList,
  historyLoading,
  currentThreadId,
  onSelectHistory,
  onNewConversation,
  onOpenSettings,
  onDeleteHistory,
  onOpenSearch,
}) => {
  const { t } = useTranslation();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Drag-to-resize ──
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (isCollapsed) return;
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [isCollapsed, width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = e.clientX - startX.current;
      const newW = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW.current + delta));
      onWidthChange(newW);
    };

    const onMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onWidthChange]);

  const handleDelete = useCallback(async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteId !== threadId) {
      setConfirmDeleteId(threadId);
      setTimeout(() => setConfirmDeleteId(prev => prev === threadId ? null : prev), 3000);
      return;
    }
    setDeletingId(threadId);
    setConfirmDeleteId(null);
    try {
      await onDeleteHistory(threadId);
    } finally {
      setDeletingId(null);
    }
  }, [confirmDeleteId, onDeleteHistory]);

  const handleCancelDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
  }, []);

  const grouped = useMemo(() => groupByDate(historyList, {
    today: t('sidebar.today'),
    yesterday: t('sidebar.yesterday'),
    earlier: t('sidebar.earlier'),
  }), [historyList, t]);

  // ── Collapsed state: icon-only sidebar ──
  if (isCollapsed) {
    return (
      <div className="sidebar-container" style={{ width: SIDEBAR_COLLAPSED_WIDTH }}>
        {/* Expand Sidebar Toggle Button */}
        <div className="flex items-center justify-center py-4.5 border-b border-white/5 shrink-0">
          <button
            onClick={onToggleCollapse}
            title={t('sidebar.expand')}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-white/10 transition-all"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
        </div>

        {/* New Chat */}
        <div className="flex items-center justify-center py-3">
          <button
            onClick={onNewConversation}
            title={t('sidebar.newChat')}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#a6adc8] hover:text-[#89b4fa] hover:bg-[rgba(137,180,250,0.12)] transition-all"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings */}
        <div className="flex flex-col items-center gap-1 pb-3 border-t border-white/5 pt-2">
          <button
            onClick={onOpenSettings}
            title={t('sidebar.settings')}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[rgba(255,255,255,0.06)] transition-all"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── Expanded state ──
  return (
    <div className="sidebar-container" style={{ width }}>
      {/* Header: Logo + Title + Search + Collapse Button */}
      <div className="sidebar-header flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-lg overflow-hidden shadow-sm shrink-0">
            <img src="/icon.png" alt="Datation" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-[#cdd6f4] leading-tight truncate">Datation</h1>
            <span className="text-[10px] text-[#6c7086] font-mono tracking-tight block truncate">{t('app.subtitle')}</span>
          </div>
        </div>

        {/* Search Button */}
        <button
          onClick={onOpenSearch}
          title={t('sidebar.search') || '搜索对话与功能 (⌘K)'}
          className="p-1.5 rounded-lg text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-white/10 transition-colors ml-2 shrink-0"
        >
          <Search className="w-4 h-4" />
        </button>

        <button
          onClick={onToggleCollapse}
          title={t('sidebar.collapse')}
          className="p-1.5 rounded-lg text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-white/10 transition-colors ml-1 shrink-0"
        >
          <ChevronLeft className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* New Chat Button */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <button className="sidebar-new-chat-btn" onClick={onNewConversation}>
          <Plus className="w-4 h-4 shrink-0" />
          <span className="truncate">{t('sidebar.newChat')}</span>
        </button>
      </div>

      {/* History Section */}
      {historyLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-[#89b4fa]" />
        </div>
      ) : historyList.length === 0 ? (
        <div className="sidebar-empty flex-1">
          <div className="sidebar-empty-icon">
            <Clock className="w-5 h-5 text-[rgba(166,173,200,0.3)]" />
          </div>
          <span className="text-xs">{t('sidebar.noHistory')}</span>
          <span className="text-[10px]">{t('sidebar.startFirst')}</span>
        </div>
      ) : (
        <div className="sidebar-history-list">
          {grouped.map(group => (
            <div key={group.label}>
              <div className="sidebar-section-label">{group.label}</div>
              {group.items.map(item => {
                const isActive = item.thread_id === currentThreadId;
                const isDeleting = deletingId === item.thread_id;
                const isConfirming = confirmDeleteId === item.thread_id;

                return (
                  <div
                    key={item.thread_id}
                    className={`sidebar-history-item group ${isActive ? 'active' : ''} ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}
                    onClick={() => onSelectHistory(item.thread_id, true)}
                    title={item.query}
                  >
                    <StatusIcon status={item.status} />
                    <span className="sidebar-history-title">
                      {isConfirming ? t('sidebar.deleteConfirm') : item.query}
                    </span>
                    {/* Shared slot: show status normally, show delete on hover */}
                    <div className="sidebar-action-slot">
                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            className="sidebar-action-cancel"
                            onClick={handleCancelDelete}
                            title={t('common.cancel') || '取消'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="sidebar-history-delete confirming"
                            onClick={(e) => handleDelete(item.thread_id, e)}
                            title={t('common.confirm') || '确认'}
                          >
                            {isDeleting
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Check className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="sidebar-action-delete"
                            onClick={(e) => handleDelete(item.thread_id, e)}
                            title={t('sidebar.delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Footer: Settings */}
      <div className="sidebar-footer">
        <button className="sidebar-footer-btn" onClick={onOpenSettings}>
          <Settings className="w-4 h-4 shrink-0" />
          <span>{t('sidebar.settings')}</span>
        </button>
      </div>

      {/* Resize Handle */}
      <div
        className="sidebar-resize-handle"
        onMouseDown={onMouseDown}
      />
    </div>
  );
};
