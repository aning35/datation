import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { DragEvent } from 'react';
import { Send, Square, Paperclip, X, FileText, FileSpreadsheet, Image, Brain, Zap, Server, History, RefreshCw, Loader2, Info } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { McpSelector } from './McpSelector';
import { HistorySelector } from './HistorySelector';

interface UploadedFile {
    id: string;
    filename: string;
    original_name: string;
    size: number;
    path: string;
    status?: 'uploading' | 'done' | 'error';
}

interface ChatInputProps {
    query: string;
    setQuery: (query: string) => void;
    isProcessing: boolean;
    isPaused?: boolean;
    handleAnalysis: () => void;
    stopAnalysis: () => void;
    chunksLength: number;
    currentQuery: string;
    currentThreadId: string | null;
    setCurrentThreadId: (id: string) => void;
    enableThinking: boolean;
    setEnableThinking: (v: boolean) => void;
    enabledMcpServers: string[];
    setEnabledMcpServers: (servers: string[]) => void;
    selectedHistoryThreadIds: string[];
    setSelectedHistoryThreadIds: (ids: string[]) => void;
    onFilesUploaded: (files: string[]) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:18321';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ name }: { name: string }) {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['csv', 'xlsx', 'xls'].includes(ext)) return <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return <Image className="w-3.5 h-3.5 text-purple-500" />;
    return <FileText className="w-3.5 h-3.5 text-blue-500" />;
}

export const ChatInput: React.FC<ChatInputProps> = ({
    query,
    setQuery,
    isProcessing,
    isPaused = false,
    handleAnalysis,
    stopAnalysis,
    chunksLength,
    currentQuery,
    currentThreadId,
    setCurrentThreadId,
    enableThinking,
    setEnableThinking,
    enabledMcpServers,
    setEnabledMcpServers,
    selectedHistoryThreadIds,
    setSelectedHistoryThreadIds,
    onFilesUploaded,
}) => {
    const { t, language } = useTranslation();
    const [isMultiLine, setIsMultiLine] = useState(() => query.includes('\n') || query.length > 60);

    useEffect(() => {
        const hasNewline = query.includes('\n');
        if (isMultiLine) {
            if (!hasNewline && query.length < 45) {
                setIsMultiLine(false);
            }
        } else {
            const ta = textareaRef.current;
            const physicalWrap = ta ? ta.scrollHeight > 38 : false;
            if (hasNewline || query.length > 55 || physicalWrap) {
                setIsMultiLine(true);
            }
        }
    }, [query, isMultiLine]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [mcpServers, setMcpServers] = useState<string[]>([]);
    const [showMcpSelector, setShowMcpSelector] = useState(false);
    const [quickInputs, setQuickInputs] = useState<string[]>([]);
    const [showAgentSelect, setShowAgentSelect] = useState(false);
    const [selectedAgentIdx, setSelectedAgentIdx] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [showHistorySelector, setShowHistorySelector] = useState(false);
    const [fetchingSuggestions, setFetchingSuggestions] = useState(false);
    const suggestionsAbortRef = useRef<AbortController | null>(null);

    const [installedSkills, setInstalledSkills] = useState<{ name: string; description: string; path: string }[]>([]);
    const [showMentionSelect, setShowMentionSelect] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);

    // Fetch installed skills from backend
    useEffect(() => {
        const fetchSkills = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/config/skills`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.skills && Array.isArray(data.skills)) {
                        setInstalledSkills(data.skills);
                    }
                }
            } catch (e) {
                console.error('Failed to fetch skills in ChatInput', e);
            }
        };
        fetchSkills();
        // Listen for skills update events (triggered after install/uninstall)
        const onSkillsUpdated = () => fetchSkills();
        window.addEventListener('skills-updated', onSkillsUpdated);
        return () => window.removeEventListener('skills-updated', onSkillsUpdated);
    }, []);

    const mentionListContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (showMentionSelect && mentionListContainerRef.current) {
            const innerContainer = mentionListContainerRef.current.querySelector('.p-1');
            if (innerContainer) {
                const selectedEl = innerContainer.children[selectedMentionIdx] as HTMLElement;
                if (selectedEl) {
                    selectedEl.scrollIntoView({
                        behavior: 'auto',
                        block: 'nearest',
                    });
                }
            }
        }
    }, [selectedMentionIdx, showMentionSelect]);

    const availableAgents = [
        { id: 'Supervisor', name: 'Supervisor', desc: t('agents.autoRoute'), icon: '🤖' },
        { id: 'RequirementsAnalyst', name: 'Requirements Analyst', desc: t('agents.clarifyReq'), icon: '📝' },
        { id: 'DataAnalyst', name: 'Data Analyst', desc: t('agents.writeCode'), icon: '📊' },
        { id: 'ReportGenerator', name: 'Report Generator', desc: t('agents.genReport'), icon: '📄' },
        { id: 'QAAgent', name: 'QA Agent', desc: t('agents.qaAnswer'), icon: '💬' },
        { id: 'SkillExecutor', name: 'Skill Executor', desc: t('agents.skillExecute'), icon: '🛠️' }
    ];

    const cancelSuggestions = useCallback(() => {
        if (suggestionsAbortRef.current) {
            suggestionsAbortRef.current.abort();
            suggestionsAbortRef.current = null;
        }
        setFetchingSuggestions(false);
    }, []);

    const fetchSuggestions = useCallback(async (file: UploadedFile, isRefresh = false) => {
        // Cancel the previous in-flight request
        cancelSuggestions();
        const controller = new AbortController();
        suggestionsAbortRef.current = controller;
        setFetchingSuggestions(true);
        try {
            const res = await fetch(`${API_BASE_URL}/suggestions/from-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: file.path,
                    refresh: isRefresh,
                    excluded: quickInputs
                }),
                signal: controller.signal
            });
            const data = await res.json();
            if (data.suggestions) {
                setQuickInputs(data.suggestions);
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.error('Failed to get suggestions:', e);
            }
        } finally {
            suggestionsAbortRef.current = null;
            setFetchingSuggestions(false);
        }
    }, [quickInputs, cancelSuggestions]);

    // Load MCP Servers from backend API instead of Electron
    useEffect(() => {
        const loadMcpServers = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/mcp/servers`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.servers && Array.isArray(data.servers)) {
                        setMcpServers(data.servers);
                    }
                }
            } catch (e) {
                console.error('Failed to load MCP servers from backend', e);
            }
        };
        loadMcpServers();
    }, []);

    const prevThreadIdRef = useRef<string | null>(currentThreadId);
    useEffect(() => {
        if (currentThreadId !== prevThreadIdRef.current) {
            // Only clear if switching between two DIFFERENT existing conversations
            // (Don't clear when a new thread ID is generated for the first time)
            if (prevThreadIdRef.current !== null && currentThreadId !== null) {
                setUploadedFiles([]);
                setQuickInputs([]);
            }
            prevThreadIdRef.current = currentThreadId;
        }
    }, [currentThreadId]);

    useEffect(() => {
        const ta = textareaRef.current;
        if (ta && isMultiLine) {
            ta.style.height = 'auto';
            // Capped at exactly 3 of text lines (approx 76px scrollHeight)
            const newHeight = Math.min(76, ta.scrollHeight);
            ta.style.height = `${newHeight}px`;
            ta.style.overflowY = ta.scrollHeight > 76 ? 'auto' : 'hidden';
        } else if (ta) {
            ta.style.height = 'auto';
            ta.style.overflowY = 'hidden';
        }
    }, [query, isMultiLine]);

    const handleQueryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setQuery(val);

        if (val === '/' || val.endsWith(' /')) {
            setShowAgentSelect(true);
            setSelectedAgentIdx(0);
        } else if (showAgentSelect && !val.includes('/')) {
            setShowAgentSelect(false);
        }

        const caretPos = e.target.selectionStart;
        const textBeforeCaret = val.substring(0, caretPos);
        const match = textBeforeCaret.match(/@(\S*)$/);
        
        if (match) {
            setShowMentionSelect(true);
            setMentionFilter(match[1]);
            setSelectedMentionIdx(0);
        } else {
            setShowMentionSelect(false);
        }
    };

    const selectAgent = (agentId: string) => {
        setShowAgentSelect(false);
        const newQuery = query.replace(/\/\s*$/, '') + `[@${agentId}] `;
        setQuery(newQuery);
        setTimeout(() => {
            const ta = textareaRef.current;
            if (ta) {
                ta.focus();
                ta.selectionStart = ta.selectionEnd = newQuery.length;
            }
        }, 0);
    };

    const filteredFiles = uploadedFiles
        .filter(f => f.original_name.toLowerCase().includes(mentionFilter.toLowerCase()))
        .map(f => ({ type: 'file' as const, id: f.id, label: f.original_name, value: f.original_name, desc: formatBytes(f.size) }));

    const filteredSkills = installedSkills
        .filter(s => s.name.toLowerCase().includes(mentionFilter.toLowerCase()) || s.description.toLowerCase().includes(mentionFilter.toLowerCase()))
        .map(s => ({ type: 'skill' as const, id: s.name, label: s.name, value: s.name, desc: s.description }));

    const mentionOptions = [...filteredFiles, ...filteredSkills];

    const selectMention = (option: { type: 'file' | 'skill'; id: string; label: string; value: string; desc: string }) => {
        setShowMentionSelect(false);
        const ta = textareaRef.current;
        if (!ta) return;

        const caretPos = ta.selectionStart;
        const textBeforeCaret = query.substring(0, caretPos);
        const textAfterCaret = query.substring(caretPos);

        const replacement = `@${option.value} `;
        const newQuery = textBeforeCaret.replace(/@\S*$/, replacement) + textAfterCaret;
        setQuery(newQuery);

        const newCaretPos = textBeforeCaret.replace(/@\S*$/, replacement).length;
        
        setTimeout(() => {
            ta.focus();
            ta.selectionStart = ta.selectionEnd = newCaretPos;
        }, 0);
    };

    const getOrCreateThreadId = () => {
        if (currentThreadId) return currentThreadId;
        const newId = crypto.randomUUID();
        setCurrentThreadId(newId);
        return newId;
    };

    const uploadFiles = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        if (!fileArray.length) return;
        
        setUploading(true);
        const tid = getOrCreateThreadId();

        // 1. Immediately create pending entries for visual feedback
        const pendingFiles: UploadedFile[] = fileArray.map(f => ({
            id: crypto.randomUUID(),
            filename: '',
            original_name: f.name,
            size: f.size,
            path: '',
            status: 'uploading'
        }));
        
        setUploadedFiles(prev => [...prev, ...pendingFiles]);

        // 1.5. Wait a tick to ensure React renders the pending chips before we block with network requests
        await new Promise(resolve => setTimeout(resolve, 10));

        // 2. Upload files individually and update their status
        for (let i = 0; i < fileArray.length; i++) {
            const file = fileArray[i];
            const pending = pendingFiles[i];
            
            try {
                const formData = new FormData();
                formData.append('file', file);
                const res = await fetch(`${API_BASE_URL}/upload/${tid}`, {
                    method: 'POST',
                    body: formData,
                });
                
                if (!res.ok) throw new Error('Upload failed');
                
                const data = await res.json();
                if (data.success) {
                    const completedFile: UploadedFile = {
                        id: pending.id,
                        filename: data.filename,
                        original_name: data.original_name,
                        size: data.size,
                        path: data.path,
                        status: 'done',
                    };

                    setUploadedFiles(prev => prev.map(f => f.id === pending.id ? completedFile : f));
                    
                    // Trigger suggestion for the first successful file after a small UI settle delay
                    if (i === 0) {
                        setTimeout(() => fetchSuggestions(completedFile), 100);
                    }
                    onFilesUploaded([data.original_name]);
                } else {
                    throw new Error(data.error || 'Unknown error');
                }
            } catch (e) {
                console.error('Upload failed for', file.name, e);
                setUploadedFiles(prev => prev.map(f => f.id === pending.id ? { ...f, status: 'error' } : f));
            }
        }

        setUploading(false);

        // Auto-set initial query if empty
        if (!query.trim() && fileArray.length > 0) {
            const names = fileArray.map(f => f.name).join('、');
            setQuery(`${t('chat.analyzeFiles')}${names}`);
        }
    }, [currentThreadId, query, fetchSuggestions, t, onFilesUploaded]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) uploadFiles(e.target.files);
        e.target.value = '';
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
    };

    const removeFile = (id: string) => {
        const idx = uploadedFiles.findIndex(f => f.id === id);
        const newFiles = uploadedFiles.filter(f => f.id !== id);
        setUploadedFiles(newFiles);

        if (idx === 0) setQuickInputs([]);
        if (newFiles.length === 0 && query.includes(t('chat.analyzeFiles'))) {
            setQuery('');
        }
    };

    const handleSend = () => {
        cancelSuggestions();
        setQuickInputs([]);
        handleAnalysis();
        setUploadedFiles([]);
    };

    return (
        <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-10 pb-6 px-4 sm:px-6 pointer-events-none z-10"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
        >
            <div className="max-w-5xl mx-auto w-full pointer-events-auto">
                {/* Quick Inputs */}
                {(quickInputs.length > 0 || fetchingSuggestions) && chunksLength === 0 && !currentQuery && (
                    <div className="mb-3 flex flex-wrap justify-center items-center gap-2">
                        {fetchingSuggestions && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50/50 text-slate-400 text-[13px] rounded-full animate-pulse border border-slate-100">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                {t('chat.loadingSuggestions')}
                            </div>
                        )}
                        {!fetchingSuggestions && quickInputs.map((text, idx) => (
                            <button
                                key={idx}
                                onClick={() => setQuery(text)}
                                disabled={isProcessing}
                                className="text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 rounded-full transition-all disabled:opacity-60 shadow-sm hover:shadow hover:-translate-y-0.5 max-w-[280px] truncate"
                                title={text}
                            >
                                {text}
                            </button>
                        ))}
                        {quickInputs.length > 0 && uploadedFiles.length > 0 && (
                            <button
                                onClick={() => fetchSuggestions(uploadedFiles[0], true)}
                                disabled={isProcessing || fetchingSuggestions}
                                title={t('chat.refreshSuggestions')}
                                className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 bg-white border border-slate-200 rounded-full transition-all disabled:opacity-50 shadow-sm"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${fetchingSuggestions ? 'animate-spin' : ''}`} />
                            </button>
                        )}
                    </div>
                )}

                {/* Uploaded file chips */}
                {uploadedFiles.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {uploadedFiles.map((f) => (
                            <div 
                                key={f.id} 
                                className={`flex items-center gap-1.5 border text-xs rounded-full px-3 py-1.5 shadow-sm transition-all
                                    ${f.status === 'uploading' ? 'bg-slate-50 border-slate-200 text-slate-400 animate-pulse' : 
                                      f.status === 'error' ? 'bg-red-50 border-red-200 text-red-600' : 
                                      'bg-slate-100 border-slate-200 text-slate-700'}`}
                            >
                                {f.status === 'uploading' ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    <FileIcon name={f.original_name} />
                                )}
                                <span className="max-w-[200px] truncate font-medium">{f.original_name}</span>
                                {f.size > 0 && <span className="text-slate-400">({formatBytes(f.size)})</span>}
                                
                                {f.status === 'error' && <span className="text-[10px] bg-red-100 px-1 rounded">Fail</span>}
                                
                                <button 
                                    onClick={() => removeFile(f.id)} 
                                    className="ml-1 text-slate-400 hover:text-red-500 transition-colors"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="relative">
                    {/* Agent Selection Popup */}
                    {showAgentSelect && (
                        <div className="absolute bottom-full mb-2 left-4 w-80 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20 animate-in fade-in slide-in-from-bottom-2">
                            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500">
                                {t('agents.selectAgent')}
                            </div>
                            <div className="p-1">
                                {availableAgents.map((agent, idx) => (
                                    <button
                                        key={agent.id}
                                        onClick={() => selectAgent(agent.id)}
                                        className={`w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex items-start gap-2 transition-colors ${idx === selectedAgentIdx ? 'bg-slate-100 ring-1 ring-slate-300' : ''}`}
                                    >
                                        <div className="text-lg leading-none pt-0.5">{agent.icon}</div>
                                        <div>
                                            <div className="font-medium text-sm text-slate-700">{agent.name}</div>
                                            <div className="text-xs text-slate-400">{agent.desc}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Mention (File / Skill) Selection Popup */}
                    {showMentionSelect && mentionOptions.length > 0 && (
                        <div ref={mentionListContainerRef} className="absolute bottom-full mb-2 left-4 w-80 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-30 animate-in fade-in slide-in-from-bottom-2 max-h-[300px] overflow-y-auto">
                            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 flex items-center justify-between">
                                <span>{language === 'zh' ? '提及已上传文件或 Skill' : 'Mention File or Skill'}</span>
                                <span className="text-[10px] text-slate-400 font-normal">↑↓ & Enter</span>
                            </div>
                            <div className="p-1">
                                {mentionOptions.map((option, idx) => {
                                    const isSelected = idx === selectedMentionIdx;
                                    return (
                                        <button
                                            key={option.type + '-' + option.id}
                                            onClick={() => selectMention(option)}
                                            className={`w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex items-start gap-2.5 transition-colors ${isSelected ? 'bg-blue-50/70 ring-1 ring-blue-200' : ''}`}
                                        >
                                            <div className="text-base shrink-0 pt-1">
                                                {option.type === 'file' ? (
                                                    <Paperclip className={`w-4 h-4 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                                                ) : (
                                                    <Zap className={`w-4 h-4 ${isSelected ? 'text-purple-600' : 'text-slate-400'}`} />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-1.5">
                                                    <span className="font-semibold text-sm text-slate-700 truncate">{option.label}</span>
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-bold uppercase tracking-wider ${option.type === 'file' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                                        {option.type === 'file' ? 'File' : 'Skill'}
                                                    </span>
                                                </div>
                                                {option.desc && (
                                                    <div className="text-xs text-slate-400 truncate mt-0.5">{option.desc}</div>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className={`relative bg-slate-50 border rounded-3xl shadow-sm transition-all duration-200
                        ${isMultiLine 
                            ? 'flex flex-col items-stretch pl-4 pr-3 pt-3.5 pb-2.5 min-h-[110px]' 
                            : 'flex items-end pl-4 pr-2 pb-[6px] pt-[6px] min-h-[48px]'
                        }
                        ${dragOver
                            ? 'border-blue-400 ring-2 ring-blue-400 bg-blue-50/40'
                            : 'border-slate-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 focus-within:bg-white'
                        }`}>

                        {dragOver && (
                            <div className="absolute inset-0 flex items-center justify-center z-10 rounded-3xl bg-blue-50/80 pointer-events-none">
                                <p className="text-blue-600 font-semibold text-sm flex items-center gap-2">
                                    <Paperclip className="w-4 h-4" /> {t('chat.dragDrop')}
                                </p>
                            </div>
                        )}

                        <textarea
                            ref={textareaRef}
                            id="query"
                            rows={1}
                            value={query}
                            onChange={handleQueryChange}
                            onKeyDown={(e) => {
                                if (showMentionSelect) {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setSelectedMentionIdx(prev => Math.min(prev + 1, mentionOptions.length - 1));
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setSelectedMentionIdx(prev => Math.max(prev - 1, 0));
                                        return;
                                    }
                                    if (e.key === 'Enter') {
                                        if (mentionOptions.length > 0) {
                                            e.preventDefault();
                                            selectMention(mentionOptions[selectedMentionIdx]);
                                            return;
                                        }
                                    }
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setShowMentionSelect(false);
                                        return;
                                    }
                                }

                                if (showAgentSelect) {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setSelectedAgentIdx(prev => Math.min(prev + 1, availableAgents.length - 1));
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setSelectedAgentIdx(prev => Math.max(prev - 1, 0));
                                        return;
                                    }
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        selectAgent(availableAgents[selectedAgentIdx].id);
                                        return;
                                    }
                                    if (e.key === 'Escape') {
                                        setShowAgentSelect(false);
                                        return;
                                    }
                                }

                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (!isProcessing || isPaused) {
                                        handleSend();
                                    }
                                }
                            }}
                            disabled={isProcessing && !isPaused}
                            placeholder={
                                dragOver ? t('chat.placeholderDrag') :
                                    (isProcessing && !isPaused) ? t('chat.placeholderProcessing') :
                                        isPaused ? (language === 'zh' ? '请输入您的回复以继续... (Shift+Enter 换行)' : 'Type your reply to continue... (Shift+Enter for newline)') :
                                            t('chat.placeholder')
                            }
                            className={isMultiLine 
                                ? "w-full bg-transparent py-1 pl-1 pr-1 resize-none outline-none text-slate-800 text-[15px] leading-relaxed disabled:opacity-60 scrollbar-thin scrollbar-thumb-slate-300"
                                : "flex-1 bg-transparent py-1.5 pl-1 pr-3 max-h-48 resize-none outline-none text-slate-800 text-[15px] leading-relaxed disabled:opacity-60 scrollbar-thin scrollbar-thumb-slate-300"
                            }
                        />

                        {/* Action buttons tray */}
                        <div className={isMultiLine 
                            ? "flex items-center justify-end gap-1.5 mt-2 pt-2 border-t border-slate-100/80 shrink-0"
                            : "flex items-center gap-1.5 shrink-0 ml-2"
                        }>
                            <div className="relative z-20">
                                <button
                                    onClick={() => setShowHistorySelector(!showHistorySelector)}
                                    disabled={isProcessing}
                                    title={t('chat.historyWorkspace')}
                                    className={`p-2 rounded-full transition-all flex items-center justify-center w-9 h-9 border
                                    ${selectedHistoryThreadIds.length > 0
                                            ? 'text-orange-600 bg-orange-50 border-orange-300 shadow-sm'
                                            : showHistorySelector
                                                ? 'text-orange-600 bg-orange-50 border-orange-300 shadow-sm'
                                                : 'text-slate-400 hover:text-orange-600 hover:bg-orange-50 border-transparent hover:border-orange-200'
                                        } disabled:opacity-50`}
                                >
                                    <History className="w-4 h-4" />
                                    {selectedHistoryThreadIds.length > 0 && (
                                        <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                            {selectedHistoryThreadIds.length}
                                        </span>
                                    )}
                                </button>
                                <HistorySelector
                                    isOpen={showHistorySelector}
                                    onClose={() => setShowHistorySelector(false)}
                                    selectedThreadIds={selectedHistoryThreadIds}
                                    setSelectedThreadIds={setSelectedHistoryThreadIds}
                                    currentThreadId={currentThreadId}
                                />
                            </div>

                            <button
                                onClick={() => setEnableThinking(!enableThinking)}
                                disabled={isProcessing}
                                title={t('chat.thinkingMode')}
                                className={`p-2 rounded-full transition-all flex items-center justify-center w-9 h-9 border
                                ${enableThinking
                                        ? 'text-purple-600 bg-purple-50 border-purple-300 shadow-sm'
                                        : 'text-slate-400 hover:text-purple-600 hover:bg-purple-50 border-transparent hover:border-purple-200'
                                    } disabled:opacity-50`}
                            >
                                <Brain className="w-4 h-4" />
                            </button>

                            <div className="relative z-20">
                                <button
                                    onClick={() => setShowMcpSelector(!showMcpSelector)}
                                    disabled={isProcessing}
                                    title={t('chat.selectMcp')}
                                    className={`p-2 rounded-full transition-all flex items-center justify-center w-9 h-9 border
                                    ${enabledMcpServers.length > 0
                                            ? 'text-green-600 bg-green-50 border-green-300 shadow-sm'
                                            : showMcpSelector
                                                ? 'text-green-600 bg-green-50 border-green-300 shadow-sm'
                                                : 'text-slate-400 hover:text-green-600 hover:bg-green-50 border-transparent hover:border-green-200'
                                        } disabled:opacity-50`}
                                >
                                    <Server className="w-4 h-4" />
                                    {enabledMcpServers.length > 0 && (
                                        <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                            {enabledMcpServers.length}
                                        </span>
                                    )}
                                </button>
                                <McpSelector
                                    mcpServers={mcpServers}
                                    enabledMcpServers={enabledMcpServers}
                                    setEnabledMcpServers={setEnabledMcpServers}
                                    isOpen={showMcpSelector}
                                    onClose={() => setShowMcpSelector(false)}
                                />
                            </div>

                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isProcessing && !uploading}
                                title={t('chat.uploadFile')}
                                className={`p-2 rounded-full transition-all flex items-center justify-center w-9 h-9 border
                                ${uploading
                                        ? 'text-blue-500 bg-blue-50 border-blue-200 animate-pulse'
                                        : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 border-transparent hover:border-blue-200'
                                    }`}
                            >
                                <Paperclip className="w-4 h-4" />
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept=".csv,.xlsx,.xls,.json,.txt,.md,.pdf,.png,.jpg,.jpeg,.parquet,.tsv"
                                className="hidden"
                                onChange={handleFileChange}
                            />

                            {(isProcessing && !isPaused) ? (
                                <button
                                    onClick={stopAnalysis}
                                    title={t('chat.stop')}
                                    className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-all shadow-sm w-9 h-9 animate-pulse hover:animate-none"
                                >
                                    <Square className="w-4 h-4 fill-white" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleSend}
                                    disabled={!query.trim()}
                                    title={t('chat.send')}
                                    className={`p-2 text-white rounded-full flex items-center justify-center transition-all disabled:opacity-50 disabled:bg-slate-300 shadow-sm w-9 h-9 ${isPaused ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                                >
                                    <Send className="w-4 h-4 ml-[-2px] mt-[1px]" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-2 text-center flex items-center justify-center gap-1.5 text-[11px] sm:text-[10px] text-slate-400/80 font-medium select-none tracking-wide">
                    <Info className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-slate-400/75 shrink-0" />
                    <span>{t('chat.disclaimer')}</span>
                </div>
            </div>
        </div>
    );
};
