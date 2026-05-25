import React, { useState, useCallback } from 'react';
import { History, Loader2, Clock, Trash2, PauseCircle, Eye, Play, CheckCircle2, MessageSquare } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

interface HistoryItem {
    thread_id: string;
    query: string;
    updated_at: string;
    status: string;
}

interface HistoryModalProps {
    historyOpen: boolean;
    setHistoryOpen: (open: boolean) => void;
    historyList: HistoryItem[];
    historyLoading: boolean;
    handleAnalysis: (isRetry?: boolean, overrideThreadId?: string, viewOnly?: boolean) => void;
    onRefreshHistory?: () => void;
    currentThreadId: string | null;
    onNewConversation: () => void;
}

/* ── Status config (matches backend status codes) ── */
const getStatusConfig = (t: any): Record<string, { icon: React.ReactElement; className: string; label: string }> => ({
    'Completed': {
        icon: <CheckCircle2 className="w-3 h-3" />,
        className: 'text-emerald-600 bg-emerald-50 border-emerald-200',
        label: t('history.statusCompleted')
    },
    'In Progress': {
        icon: <PauseCircle className="w-3 h-3" />,
        className: 'text-slate-600 bg-slate-100 border-slate-200',
        label: t('history.statusPending')
    },
    'Pending Confirmation': {
        icon: <MessageSquare className="w-3 h-3" />,
        className: 'text-amber-600 bg-amber-50 border-amber-200',
        label: t('history.statusConfirm')
    },
});

export const HistoryModal: React.FC<HistoryModalProps> = ({
    historyOpen,
    setHistoryOpen,
    historyList,
    historyLoading,
    handleAnalysis,
    onRefreshHistory,
    currentThreadId,
    onNewConversation,
}) => {
    const { t } = useTranslation();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);

    const STATUS_CONFIG = getStatusConfig(t);

    const handleDelete = useCallback(async (thread_id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirmId !== thread_id) {
            setConfirmId(thread_id);
            return;
        }
        setDeletingId(thread_id);
        setConfirmId(null);
        try {
            const res = await fetch(`http://localhost:18321/history/${thread_id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.success) {
                // If the deleted conversation is the currently viewed one, navigate to new conversation
                if (thread_id === currentThreadId) {
                    onNewConversation();
                    setHistoryOpen(false);
                }
            } else {
                console.error('Delete errors:', json.errors);
            }
        } catch (err) {
            console.error('Delete request failed:', err);
        } finally {
            setDeletingId(null);
            onRefreshHistory?.();
        }
    }, [confirmId, onRefreshHistory, currentThreadId, onNewConversation, setHistoryOpen]);

    if (!historyOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 sm:p-6" onClick={() => { setHistoryOpen(false); setConfirmId(null); }}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <History className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800 leading-tight">{t('history.title')}</h2>
                            <p className="text-xs text-slate-500 mt-0.5">{t('history.subtitle')}</p>
                        </div>
                    </div>
                    <button onClick={() => { setHistoryOpen(false); setConfirmId(null); }} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                    {historyLoading ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                            <p className="text-sm">{t('history.loading')}</p>
                        </div>
                    ) : historyList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-4 text-slate-400">
                            <Clock className="w-12 h-12 text-slate-200" />
                            <p className="text-sm">{t('history.empty')}</p>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {historyList.map((item, idx) => {
                                const isDeleting = deletingId === item.thread_id;
                                const isConfirming = confirmId === item.thread_id;
                                const statusCfg = STATUS_CONFIG[item.status];
                                const canResume = item.status === 'In Progress' || item.status === 'Pending Confirmation';

                                return (
                                    <div
                                        key={idx}
                                        className={`group border rounded-xl p-4 transition-all bg-white
                                            ${isConfirming ? 'border-red-300 bg-red-50 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}
                                            ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 overflow-hidden">
                                                <h3 className={`font-bold text-sm mb-1.5 line-clamp-2 ${isConfirming ? 'text-red-700' : 'text-slate-800'}`} title={item.query}>
                                                    {isConfirming ? t('history.confirmDelete') : item.query}
                                                </h3>
                                                {!isConfirming && (
                                                    <div className="flex items-center gap-2.5 text-xs text-slate-500 flex-wrap">
                                                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {item.updated_at ? new Date(item.updated_at).toLocaleString('zh-CN') : '时间未记录'}</span>
                                                        <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{item.thread_id.substring(0, 8)}</span>
                                                        {statusCfg && (
                                                            <span className={`px-2 py-0.5 rounded-full font-medium flex items-center gap-1 border ${statusCfg.className}`}>
                                                                {statusCfg.icon} {statusCfg.label}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="shrink-0 flex items-center gap-1.5">
                                                {isConfirming ? (
                                                    <>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}
                                                            className="text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 px-3 py-1.5 rounded-lg font-medium border border-slate-200 transition-colors"
                                                        >
                                                            {t('settings.cancel')}
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleDelete(item.thread_id, e)}
                                                            className="text-xs bg-red-500 text-white hover:bg-red-600 px-3 py-1.5 rounded-lg font-medium shadow-sm flex items-center gap-1.5 transition-colors"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" /> {t('history.confirmDeleteBtn')}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                                                        {/* All statuses have "View" action */}
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleAnalysis(true, item.thread_id, true); }}
                                                            className="text-xs bg-slate-50 text-slate-600 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg font-medium border border-slate-200 shadow-sm flex items-center gap-1"
                                                        >
                                                            <Eye className="w-3.5 h-3.5" /> {t('history.view')}
                                                        </button>

                                                        {/* "Pending" or "Confirm" status allows "Continue" or "Confirm" action */}
                                                        {canResume && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleAnalysis(false, item.thread_id); }}
                                                                className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg font-medium border border-blue-200 shadow-sm flex items-center gap-1"
                                                            >
                                                                <Play className="w-3.5 h-3.5" /> {t('history.continue')}
                                                            </button>
                                                        )}

                                                        {/* Delete */}
                                                        <button
                                                            onClick={(e) => handleDelete(item.thread_id, e)}
                                                            className="text-xs bg-red-50 text-red-500 hover:bg-red-100 px-2 py-1.5 rounded-lg font-medium border border-red-200 shadow-sm flex items-center gap-1"
                                                        >
                                                            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
