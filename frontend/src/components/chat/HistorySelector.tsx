import React, { useState, useEffect, useRef } from 'react';
import { History, X, Check, Loader2 } from 'lucide-react';

interface HistoryItem {
    thread_id: string;
    query: string;
    updated_at: string;
    status: string;
}

interface HistorySelectorProps {
    isOpen: boolean;
    onClose: () => void;
    selectedThreadIds: string[];
    setSelectedThreadIds: (ids: string[]) => void;
    currentThreadId: string | null;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:18321';

export const HistorySelector: React.FC<HistorySelectorProps> = ({
    isOpen,
    onClose,
    selectedThreadIds,
    setSelectedThreadIds,
    currentThreadId,
}) => {
    const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/history`);
            const data = await res.json();
            // Filter out the current conversation and uncompleted conversations
            const completed = data.history.filter((h: HistoryItem) =>
                h.status === 'Completed' && h.thread_id !== currentThreadId
            );
            setHistoryList(completed);
        } catch (e) {
            console.error('Failed to load history:', e);
        } finally {
            setLoading(false);
        }
    };

    const toggleSelection = (threadId: string) => {
        if (selectedThreadIds.includes(threadId)) {
            setSelectedThreadIds(selectedThreadIds.filter(id => id !== threadId));
        } else {
            setSelectedThreadIds([...selectedThreadIds, threadId]);
        }
    };

    if (!isOpen) return null;

    return (
        <div ref={containerRef} className="absolute bottom-full mb-2 right-0 w-96 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20 max-h-96 flex flex-col">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-600" />
                    <span className="text-xs font-semibold text-slate-700">选择历史对话工作目录</span>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                    <div className="flex items-center justify-center py-8 text-slate-400">
                        <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                ) : historyList.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400">
                        暂无已完成的历史对话
                    </div>
                ) : (
                    <div className="space-y-1">
                        {historyList.map((item) => {
                            const isSelected = selectedThreadIds.includes(item.thread_id);
                            return (
                                <button
                                    key={item.thread_id}
                                    onClick={() => toggleSelection(item.thread_id)}
                                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-start gap-2 ${
                                        isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'
                                    }`}
                                >
                                    <div className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                                        isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
                                    }`}>
                                        {isSelected && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div
                                            className="text-xs font-medium text-slate-700 line-clamp-2"
                                            title={item.query}
                                        >
                                            {item.query}
                                        </div>
                                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                                            {new Date(item.updated_at).toLocaleString('zh-CN')}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {selectedThreadIds.length > 0 && (
                <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-600">
                    已选择 {selectedThreadIds.length} 个历史工作目录
                </div>
            )}
        </div>
    );
};
