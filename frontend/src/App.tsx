import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GitBranch, Sparkles, Loader2, Terminal, FileText, ClipboardList, Zap, Play } from 'lucide-react';
import type { AgentChunk, LogEntry } from './types';

import { Sidebar } from './components/layout/Sidebar';
import { SpotlightSearch } from './components/search/SpotlightSearch';
import { ChatInput } from './components/chat/ChatInput';
import { TraceTab } from './components/chat/TraceTab';
import { WorkflowTab } from './components/workflow/WorkflowTab';
import { FilesTab } from './components/files/FilesTab';
import { PlanTab } from './components/plan/PlanTab';
import { TokenTab } from './components/token/TokenTab';
import { LogPanel } from './components/logs/LogPanel';
import { SettingsModal } from './components/settings/SettingsModal';
import { useTranslation } from './i18n/useTranslation';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:18321';

const App: React.FC = () => {
  const { t, language } = useTranslation();
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [currentQuery, setCurrentQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [chunks, setChunks] = useState<AgentChunk[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [errorDesc, setErrorDesc] = useState<string | null>(null);
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [graphSvg, setGraphSvg] = useState<string>('');
  const [graphLoading, setGraphLoading] = useState(false);
  const [reportViewMode, setReportViewMode] = useState<'preview' | 'source'>('preview');
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'trace' | 'workflow' | 'plan' | 'files' | 'token'>('trace');
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string[]>([]);
  const [completedTasks, setCompletedTasks] = useState<[string, any][]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [enableThinking, setEnableThinking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAlert, setSettingsAlert] = useState('');
  const [enabledMcpServers, setEnabledMcpServers] = useState<string[]>([]);
  const [selectedHistoryThreadIds, setSelectedHistoryThreadIds] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  // Per-message options metadata: index N = Nth User message in the conversation
  type ChunkMeta = {
    mcpServers: string[];
    enableThinking: boolean;
    historyIds: string[];
    historyLabels: { id: string; query: string }[];
    uploadedFiles: string[];
  };
  const [chunksMeta, setChunksMeta] = useState<ChunkMeta[]>([]);
  const sendMetaRef = useRef<ChunkMeta | null>(null);
  // Count of User chunks seen so far, used to know which chunksMeta slot to fill
  const userChunkCountRef = useRef<number>(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastOuterNodeRef = useRef<string | null>(null);
  const [backendReady, setBackendReady] = useState(false);

  // Poll backend /health until ready=true
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
          const data = await res.json();
          if (data.ready) {
            setBackendReady(true);
            return;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  // Preserve scroll positions per tab
  const scrollPositions = useRef<Record<string, number>>({ trace: 0, workflow: 0, files: 0 });
  // Handle scroll event to show/hide bottom button
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    // Trace tab uses internal Virtuoso scrolling, ignore parent scroll updates
    console.log('[App] handleScroll target.scrollTop:', e.currentTarget.scrollTop);
    if (activeTab === 'trace') return;

    const target = e.currentTarget;
    scrollPositions.current[activeTab] = target.scrollTop;
  };

  // Restore scroll position when tab changes
  useEffect(() => {
    if (scrollContainerRef.current && activeTab !== 'trace') {
      scrollContainerRef.current.scrollTop = scrollPositions.current[activeTab] || 0;
    }
  }, [activeTab]);

  const stopAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsProcessing(false);
  };

  const startNewConversation = () => {
    stopAnalysis();
    setQuery('');
    setCurrentQuery('');
    setChunks([]);
    setLogs([]);
    setErrorDesc(null);
    setActiveNode(null);
    setCurrentThreadId(null);
    setCurrentPlan([]);
    setCompletedTasks([]);
    setSelectedHistoryThreadIds([]);
    setUploadedFiles([]);
    setIsPaused(false);
    setEnableThinking(false);
    setEnabledMcpServers([]);
    setChunksMeta([]);
    userChunkCountRef.current = 0;
    sendMetaRef.current = null;
  };

  // Message recall: two-step confirmation driven by state
  type RecallPayload = {
    chunkIndex: number;
    messageText: string;
    meta: ChunkMeta;
  };
  const [pendingRecall, setPendingRecall] = useState<RecallPayload | null>(null);

  // Step 1: Click recall button → save params, show confirmation dialog
  const handleRecallMessage = async (chunkIndex: number, messageText: string, meta: ChunkMeta) => {
    setPendingRecall({ chunkIndex, messageText, meta });
  };

  // Step 2: Confirm and execute recall
  const confirmRecall = async () => {
    if (!pendingRecall) return;
    const { chunkIndex, messageText, meta } = pendingRecall;
    setPendingRecall(null);

    // Calculate the index of the recalled User chunk among all User chunks
    let userCountBefore = 0;
    for (let i = 0; i < chunkIndex; i++) {
      if (chunks[i].node === 'User') userCountBefore++;
    }

    // Call backend rollback API to truncate LangGraph state
    if (currentThreadId) {
      try {
        const res = await fetch(`${API_BASE_URL}/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            thread_id: currentThreadId,
            user_message_index: userCountBefore,
          }),
        });
        const result = await res.json();
        if (result.error) {
          console.error('[Rollback] Backend error:', result.error);
        } else {
          console.log('[Rollback] Backend success:', result);
        }
      } catch (e) {
        console.error('[Rollback] API call failed:', e);
      }
    }

    // Frontend: remove this User chunk and all subsequent chunks
    setChunks(prev => prev.slice(0, chunkIndex));
    setChunksMeta(prev => prev.slice(0, userCountBefore));
    userChunkCountRef.current = userCountBefore;

    // Restore message text back to the input box
    setQuery(messageText);

    // Restore config options
    if (meta.enableThinking) setEnableThinking(true);
    if (meta.mcpServers.length > 0) setEnabledMcpServers(meta.mcpServers);
    if (meta.historyIds.length > 0) setSelectedHistoryThreadIds(meta.historyIds);
    if (meta.uploadedFiles.length > 0) setUploadedFiles(meta.uploadedFiles);
  };

  // Load and render Mermaid graph
  const loadGraph = useCallback(async (forceReload?: boolean) => {
    // If already loading, or already have graph and not forcing reload, skip fetch
    if (graphLoading || (graphSvg && !forceReload)) return;

    setGraphLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/graph`);
      const data = await res.json();
      if (data.mermaid) {
        let enhancedMermaid = data.mermaid;
        // Beautify node labels
        enhancedMermaid = enhancedMermaid.replace(/Supervisor\(Supervisor\)/g, 'Supervisor("Supervisor (统领路由)")');
        enhancedMermaid = enhancedMermaid.replace(/RequirementsAnalyst\(RequirementsAnalyst\)/g, 'RequirementsAnalyst("RequirementsAnalyst (需求分析)")');
        enhancedMermaid = enhancedMermaid.replace(/DataAnalyst\(DataAnalyst\)/g, 'DataAnalyst("DataAnalyst (数据计算)")');
        enhancedMermaid = enhancedMermaid.replace(/ReportGenerator\(ReportGenerator\)/g, 'ReportGenerator("ReportGenerator (报告生成)")');
        enhancedMermaid = enhancedMermaid.replace(/QAAgent\(QAAgent\)/g, 'QAAgent("QAAgent (深度问答)")');
        enhancedMermaid = enhancedMermaid.replace(/SkillExecutor\(SkillExecutor\)/g, 'SkillExecutor("SkillExecutor (技能执行)")');

        // Add custom classes to the bottom of the mermaid string
        enhancedMermaid += `
          classDef supervisorNode fill:#3b82f6,color:#fff,stroke-width:0px,rx:8px,ry:8px,font-weight:bold;
          classDef reqNode fill:#10b981,color:#fff,stroke-width:0px,rx:8px,ry:8px;
          classDef daNode fill:#8b5cf6,color:#fff,stroke-width:0px,rx:8px,ry:8px;
          classDef repNode fill:#f59e0b,color:#fff,stroke-width:0px,rx:8px,ry:8px;
          classDef qaNode fill:#0ea5e9,color:#fff,stroke-width:0px,rx:8px,ry:8px;
          classDef skillNode fill:#ec4899,color:#fff,stroke-width:0px,rx:8px,ry:8px;

          class Supervisor supervisorNode;
          class RequirementsAnalyst reqNode;
          class DataAnalyst daNode;
          class ReportGenerator repNode;
          class QAAgent qaNode;
          class SkillExecutor skillNode;
        `;

        // @ts-ignore - dynamic CDN import
        const mermaid = (await import('https://registry.npmmirror.com/mermaid/11/files/dist/mermaid.esm.min.mjs')).default;
        mermaid.initialize({
          startOnLoad: false, theme: 'base', themeVariables: {
            primaryColor: '#e0e7ff', primaryTextColor: '#1e293b', primaryBorderColor: '#818cf8',
            lineColor: '#94a3b8', secondaryColor: '#f0fdf4', tertiaryColor: '#fef3c7',
          }
        });
        const { svg } = await mermaid.render('graph-diagram', enhancedMermaid);
        setGraphSvg(svg);
      }
    } catch (e) {
      console.error('Failed to load graph:', e);
    } finally {
      setGraphLoading(false);
    }
  }, [graphSvg, graphLoading]);

  const toggleGraph = useCallback(() => {
    setActiveTab('workflow');
    if (!graphSvg) {
      loadGraph();
    }
  }, [graphSvg, loadGraph]);

  // Load backend history data
  const fetchHistoryData = async (silent: boolean = false) => {
    if (!silent && historyList.length === 0) {
      setHistoryLoading(true);
    }
    try {
      const res = await fetch(`${API_BASE_URL}/history`);
      const data = await res.json();
      const list = data.history || [];
      setHistoryList(list);
      return list;
    } catch (e) {
      console.error('Failed to load history:', e);
      return [];
    } finally {
      setHistoryLoading(false);
    }
  };

  // Delete a history item by thread_id
  const deleteHistory = async (threadId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/history/${threadId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        if (threadId === currentThreadId) {
          startNewConversation();
        }
      } else {
        console.error('Delete errors:', json.errors);
      }
    } catch (err) {
      console.error('Delete request failed:', err);
    } finally {
      await fetchHistoryData();
    }
  };

  useEffect(() => {
    // Only scrollIntoView for non-trace tabs (trace uses Virtuoso internal scrolling)
    if (activeTab !== 'trace') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chunks, activeTab]);

  // When task ends, mark all chunks still in 'running' state as 'completed'
  useEffect(() => {
    if (!isProcessing) {
      setChunks(prev => {
        const hasRunning = prev.some(c => c.status === 'running');
        if (!hasRunning) return prev;
        return prev.map(c => c.status === 'running' ? { ...c, status: 'completed' as const } : c);
      });
    }
  }, [isProcessing]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const isFirstRender = useRef(true);
  const initDoneRef = useRef(false);

  // Sync currentThreadId to URL
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Don't clear existing URL thread_id before init completes (prevent race condition during async init)
    if (!initDoneRef.current && !currentThreadId) {
      return;
    }
    const url = new URL(window.location.href);
    if (currentThreadId) {
      url.searchParams.set('thread_id', currentThreadId);
    } else {
      url.searchParams.delete('thread_id');
    }
    // Use replaceState to keep history clean during active session updates
    window.history.replaceState({}, '', url.toString());
  }, [currentThreadId]);

  // Reset input when switching conversations
  // Only reset on actual conversation switch (from one existing session to another),
  // not when a new thread_id is first generated (otherwise uploading files would clear options)
  const prevThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevThreadIdRef.current;
    prevThreadIdRef.current = currentThreadId;

    // Actual conversation switch: previously had a session ID and now switching to a different one
    const isSwitchingConversation = prev !== null && prev !== currentThreadId;
    if (isSwitchingConversation) {
      setQuery('');
      setEnableThinking(false);
      setEnabledMcpServers([]);
      setUploadedFiles([]);
      setSelectedHistoryThreadIds([]);
    }
  }, [currentThreadId]);

  // Handle initial deep link and onboarding
  useEffect(() => {
    const init = async () => {
      // Check if config needs setup - skip in Electron
      // Language will be loaded from localStorage or browser default

      // Always load history for sidebar
      const history = await fetchHistoryData();

      const params = new URLSearchParams(window.location.search);
      const tid = params.get('thread_id');
      if (tid && !currentThreadId) {
        const item = history.find((h: any) => h.thread_id === tid);
        if (item) {
          setCurrentQuery(item.query);
          // Then start restoration stream
          handleAnalysis(false, tid, true);
        } else {
          // If the thread doesn't exist, clear the URL parameter to go back to the home page
          const url = new URL(window.location.href);
          url.searchParams.delete('thread_id');
          window.history.replaceState({}, '', url.toString());
        }
      }
    };
    init().finally(() => { initDoneRef.current = true; });
  }, []);

  // Global Spotlight search shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Highlight logic moved to WorkflowTab component


  const handleAnalysis = async (isRetry: boolean = false, overrideThreadId?: string, viewOnly: boolean = false) => {
    if (!isRetry && !query.trim() && !overrideThreadId) return;

    if (!viewOnly) {
      setIsProcessing(true);
    }
    setErrorDesc(null);

    if (!isRetry && !overrideThreadId) {
      setCurrentQuery(query);
      setQuery(''); // Clear input after send
      setIsPaused(false); // Reset pause state when sending new message
      // Capture send-time config in a ref BEFORE resetting, so the bubble gets correct values
      sendMetaRef.current = {
        mcpServers: enabledMcpServers,
        enableThinking: enableThinking,
        historyIds: selectedHistoryThreadIds,
        historyLabels: selectedHistoryThreadIds.map(id => {
          const item = historyList.find((h: any) => h.thread_id === id);
          return { id, query: item?.query ?? id.slice(0, 8) };
        }),
        uploadedFiles: uploadedFiles,
      };
      // Reset input box to clean state after send
      setUploadedFiles([]);
      setEnableThinking(false);
      setEnabledMcpServers([]);
      setSelectedHistoryThreadIds([]);
      // On every new message: collapse sidebar + open live logs
      setSidebarCollapsed(true);
      setLogPanelOpen(true);
      setActiveTab('trace');
      if (!graphSvg && !graphLoading) {
        loadGraph();
      }
      if (!currentThreadId) {
        // Only clear records for brand new conversations (no active session)
        setChunks([]);
        setLogs([]);
        setActiveNode(null);
        setCurrentPlan([]);
        setCompletedTasks([]);
      }
      // Note: do not clear currentThreadId, maintain session continuity
    }

    // Clean up current view when loading from history
    if (overrideThreadId) {
      setChunks([]);
      setLogs([]);
      setActiveNode(null);
      setCurrentThreadId(overrideThreadId);
      setCurrentPlan([]);
      setCompletedTasks([]);
      setSelectedHistoryThreadIds([]);
      setIsPaused(false); // Reset on history load; WAITING detection during replay will re-set
      sendMetaRef.current = null;
      userChunkCountRef.current = 0; // Reset count for history load
      setChunksMeta([]); // Will be populated from messages_meta in system chunk
      const historicItem = historyList.find((h: any) => h.thread_id === overrideThreadId);
      if (historicItem) {
        setCurrentQuery(historicItem.query);
      }
    }

    try {
      const payload: any = {
        query,
        enable_thinking: enableThinking,
        history_thread_ids: selectedHistoryThreadIds,
        history_labels: overrideThreadId ? [] : (sendMetaRef.current?.historyLabels ?? []),
        // When loading history, always send [] so the backend reads saved data from disk
        enabled_mcp_servers: overrideThreadId ? [] : enabledMcpServers,
        uploaded_files: overrideThreadId ? [] : (sendMetaRef.current?.uploadedFiles ?? uploadedFiles),
      };

      if (overrideThreadId) {
        payload.thread_id = overrideThreadId;
        payload.is_retry = isRetry; // Continue or View
        payload.restore_history = true; // Tell backend to dump logs first
        payload.view_only = viewOnly; // View-only mode: paused session won't auto-resume
      } else if (currentThreadId) {
        payload.thread_id = currentThreadId;
        payload.is_retry = isRetry; // Continue with existing thread, not always retry
      }

      // Create new AbortController to allow user to stop at any time
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch(`${API_BASE_URL}/analyze/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Could not acquire reader from response");

      const decoder = new TextDecoder('utf-8');
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || "";

        for (let ev of events) {
          if (ev.startsWith("data: ")) {
            const dataStr = ev.substring(6).trim();
            if (dataStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'system' && parsed.thread_id) {
                setCurrentThreadId(parsed.thread_id);
                if (overrideThreadId) {
                  // History load: populate chunksMeta from per-message array saved on disk
                  if (parsed.messages_meta && Array.isArray(parsed.messages_meta)) {
                    setChunksMeta(parsed.messages_meta.map((m: any) => ({
                      mcpServers: m.enabled_mcp_servers ?? [],
                      enableThinking: m.enable_thinking ?? false,
                      historyIds: m.history_thread_ids ?? [],
                      historyLabels: m.history_labels ?? [],
                      uploadedFiles: m.uploaded_files ?? [],
                    })));
                    userChunkCountRef.current = parsed.messages_meta.length;
                  }
                } else {
                  // New message: chunksMeta will be appended when User chunk arrives
                }
              } else if (parsed.type === 'config_required') {
                // LLM config missing, auto-open settings panel with prompt
                setSettingsAlert(t('settings.configRequired'));
                setSettingsOpen(true);
                setIsProcessing(false);
                break;
              } else if (parsed.type === 'plan_state') {
                // Authoritative plan state event (sent by backend at end of history replay)
                if (parsed.plan) setCurrentPlan(parsed.plan);
                if (parsed.past_steps) setCompletedTasks(parsed.past_steps);
              } else if (parsed.type === 'session_status') {
                // Backend notifies session is paused/pending-continue
                setIsPaused(!!parsed.is_paused);
                if (parsed.is_paused) {
                  // Mark all still-running chunks as completed, stop spinner animations
                  setChunks(prev => prev.map(c =>
                    c.status === 'running' ? { ...c, status: 'completed' as const } : c
                  ));
                }
              } else if (parsed.type === 'log') {
                setLogs(prev => {
                  if (prev.length > 0) {
                    const last = prev[prev.length - 1];
                    if (last.level === 'llm_stream' && parsed.level === 'llm_stream' && last.node === parsed.node) {
                      const updatedLast = {
                        ...last,
                        detail: String(last.detail || '') + String(parsed.detail || '')
                      };
                      return [...prev.slice(0, -1), updatedLast];
                    }
                  }
                  return [...prev, parsed as LogEntry];
                });
                if (parsed.node) {
                  let mappedNode = parsed.node;
                  // If it's a sub-node (silent or not), try to prefix it with the last known outer node
                  // Note: Backend now sends the full hierarchical path for most cases, but we keep this as a fallback.
                  if (['planner', 'executor', 'reviewer', 'agent', 'tools'].includes(mappedNode)) {
                    if (lastOuterNodeRef.current && !mappedNode.includes(':')) {
                      // DataAnalyst's agent/tools live under executor subgraph
                      if (lastOuterNodeRef.current === 'DataAnalyst' && ['agent', 'tools'].includes(mappedNode)) {
                        mappedNode = `DataAnalyst:executor:${mappedNode}`;
                      } else {
                        mappedNode = `${lastOuterNodeRef.current}:${mappedNode}`;
                      }
                    }
                  }

                  // Also update lastOuterNodeRef for non-silent outer nodes
                  const isOuterNode = ['Supervisor', 'RequirementsAnalyst', 'DataAnalyst', 'ReportGenerator', 'QAAgent', 'SkillExecutor'].some(n =>
                    mappedNode === n || mappedNode.endsWith(':' + n)
                  );
                  if (!parsed.silent && isOuterNode) {
                    lastOuterNodeRef.current = mappedNode;
                  }

                  setActiveNode(mappedNode);
                }
              } else if (parsed.type === 'node' || parsed.node) {
                if (parsed.plan) setCurrentPlan(parsed.plan);
                if (parsed.past_steps) setCompletedTasks(parsed.past_steps);

                // When a new User chunk arrives in a fresh send, record the pending sendMeta for it
                if (parsed.node === 'User' && !overrideThreadId && sendMetaRef.current) {
                  const meta = sendMetaRef.current;
                  sendMetaRef.current = null;
                  setChunksMeta(prev => [...prev, meta]);
                  userChunkCountRef.current += 1;
                }

                // Detect pause/interrupt signal (only valid outside history load/replay; history load defers to final session_status to prevent button flickering from old fragments)
                if (!overrideThreadId && parsed.action_executed && Array.isArray(parsed.action_executed) && parsed.action_executed.some((a: string) => a && a.includes('WAITING'))) {
                  setIsPaused(true);
                }

                setChunks(prev => {
                  if (parsed.silent) return prev;
                  if (prev.length === 0) return [parsed as AgentChunk];

                  // 1. Match by run_id (Strong match)
                  if (parsed.run_id) {
                    const existingIndex = prev.findIndex(c => c.run_id === parsed.run_id);
                    if (existingIndex >= 0) {
                      // If the matched chunk is not the last one, subsequent subgraph events were already appended
                      // (e.g. ReportGenerator's collect_files, generate_chapter, etc.).
                      // Remove the old running chunk and append the updated one at the end,
                      // to maintain correct chronological order.
                      if (existingIndex < prev.length - 1) {
                        const updated = { ...prev[existingIndex], ...parsed };
                        const withoutOld = [...prev.slice(0, existingIndex), ...prev.slice(existingIndex + 1)];
                        const withCompleted = withoutOld.map(c =>
                          c.status === 'running' ? { ...c, status: 'completed' as const } : c
                        );
                        return [...withCompleted, updated];
                      }
                      const newChunks = [...prev];
                      newChunks[existingIndex] = { ...newChunks[existingIndex], ...parsed };
                      return newChunks;
                    }
                  }

                  // 2. Fuzzy match: If the last chunk is for the same node and was 'running', 
                  // we should likely update/replace it with the definitive end state.
                  // Only apply to Agent nodes (exclude manual 'User' nodes)
                  const lastChunk = prev[prev.length - 1];
                  if (parsed.node && parsed.node !== 'User' &&
                    (lastChunk.node === parsed.node || parsed.node.startsWith(lastChunk.node + ':')) &&
                    (lastChunk.status === 'running' || !lastChunk.run_id || lastChunk.run_id === parsed.run_id)) {
                    const newChunks = [...prev];
                    newChunks[newChunks.length - 1] = { ...lastChunk, ...parsed };
                    return newChunks;
                  }

                  // 3. New chunk will be appended: mark all previous still-running chunks as completed,
                  //    to avoid "next step started but previous step still shows as running" issue.
                  const withCompleted = prev.map(c =>
                    c.status === 'running' ? { ...c, status: 'completed' as const } : c
                  );

                  return [...withCompleted, parsed as AgentChunk];
                });
                if (parsed.node && parsed.node !== '__error__') {
                  let nodeName = parsed.node;
                  // If it's a sub-node (silent or not), try to prefix it with the last known outer node
                  // Note: Backend now sends the full hierarchical path for most cases, but we keep this as a fallback.
                  if (['planner', 'executor', 'reviewer', 'agent', 'tools'].includes(nodeName)) {
                    if (lastOuterNodeRef.current && !nodeName.includes(':')) {
                      // DataAnalyst's agent/tools live under executor subgraph
                      if (lastOuterNodeRef.current === 'DataAnalyst' && ['agent', 'tools'].includes(nodeName)) {
                        nodeName = `DataAnalyst:executor:${nodeName}`;
                      } else {
                        nodeName = `${lastOuterNodeRef.current}:${nodeName}`;
                      }
                    }
                  }
                  // Also update lastOuterNodeRef for non-silent outer nodes
                  const isOuterNodeAgain = ['Supervisor', 'RequirementsAnalyst', 'DataAnalyst', 'ReportGenerator', 'QAAgent', 'SkillExecutor'].some(n =>
                    nodeName === n || nodeName.endsWith(':' + n)
                  );
                  if (!parsed.silent && isOuterNodeAgain) {
                    lastOuterNodeRef.current = nodeName;
                  }

                  setActiveNode(nodeName);
                }

              }
            } catch (e) {
              console.error("Parse Error for chunk: ", dataStr);
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // User manually stopped, don't show error
      } else {
        setErrorDesc(e.message || "Unknown communication error");
      }
    } finally {
      abortControllerRef.current = null;
      setIsProcessing(false);
      // Refresh sidebar history
      fetchHistoryData();
    }
  };

  return (
    <div className="h-screen bg-slate-50 flex font-sans min-w-[1000px] overflow-x-auto overflow-y-hidden">
      {/* Backend loading overlay */}
      {!backendReady && (
        <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
            <h2 className="text-xl font-semibold text-white">{language === 'zh' ? '正在启动后端服务...' : 'Starting backend services...'}</h2>
            <p className="text-sm text-slate-300">{language === 'zh' ? '正在初始化 AI 引擎、加载工具和编译工作流，请稍候' : 'Initializing AI engine, loading tools and compiling workflow...'}</p>
          </div>
        </div>
      )}
      {/* Left Sidebar */}
      <Sidebar
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        historyList={historyList}
        historyLoading={historyLoading}
        currentThreadId={currentThreadId}
        onSelectHistory={(threadId, viewOnly) => handleAnalysis(false, threadId, viewOnly)}
        onNewConversation={startNewConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        onRefreshHistory={fetchHistoryData}
        onDeleteHistory={deleteHistory}
        onOpenSearch={() => setIsSearchOpen(true)}
      />

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Main Workspace Split */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main Content (Left) */}
          <main className="flex-1 flex flex-col relative overflow-hidden" style={{ height: '100%' }}>

            {/* Tab Navigation */}
            <div className="flex border-b border-slate-100 bg-white sticky top-0 z-20 shrink-0 px-2">
              <button
                onClick={() => setActiveTab('trace')}
                className={`px-4 py-3 flex items-center gap-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'trace'
                  ? 'border-blue-500 text-blue-700 bg-blue-50/30'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <Sparkles className={`w-4 h-4 ${activeTab === 'trace' ? 'text-amber-500' : 'text-slate-400'}`} />
                {t('tabs.trace')}
                {chunks.length > 0 && (
                  <span className="ml-1.5 bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                    {chunks.length}
                  </span>
                )}
              </button>

              <button
                onClick={toggleGraph}
                className={`px-4 py-3 flex items-center gap-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'workflow'
                  ? 'border-blue-500 text-blue-700 bg-blue-50/30'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
              >
                {graphLoading ? <Loader2 className={`w-4 h-4 animate-spin ${activeTab === 'workflow' ? 'text-indigo-500' : 'text-slate-400'}`} /> : <GitBranch className={`w-4 h-4 ${activeTab === 'workflow' ? 'text-indigo-500' : 'text-slate-400'}`} />}
                {t('tabs.workflow')}
              </button>

              {/* Mission Planning Tab — Only shown when plan or completed steps exist */}
              {(currentPlan.length > 0 || completedTasks.length > 0) && (
                <button
                  onClick={() => setActiveTab('plan')}
                  className={`px-4 py-3 flex items-center gap-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'plan'
                    ? 'border-violet-500 text-violet-700 bg-violet-50/30'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                    }`}
                >
                  <ClipboardList className={`w-4 h-4 ${activeTab === 'plan' ? 'text-violet-500' : 'text-slate-400'}`} />
                  {t('tabs.plan')}
                  {currentPlan.length > 0 && (
                    <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'plan' ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-500'}`}>
                      {completedTasks.length}/{completedTasks.length + currentPlan.length}
                    </span>
                  )}
                </button>
              )}

              <button
                onClick={() => setActiveTab('files')}
                className={`px-4 py-3 flex items-center gap-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'files'
                  ? 'border-blue-500 text-blue-700 bg-blue-50/30'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <FileText className={`w-4 h-4 ${activeTab === 'files' ? 'text-blue-500' : 'text-slate-400'}`} />
                {t('tabs.files')}
              </button>

              <button
                onClick={() => setActiveTab('token')}
                className={`px-4 py-3 flex items-center gap-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'token'
                  ? 'border-amber-500 text-amber-700 bg-amber-50/30'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <Zap className={`w-4 h-4 ${activeTab === 'token' ? 'text-amber-500' : 'text-slate-400'}`} />
                {t('tabs.token')}
              </button>

              {/* Log button — Fixed on the right side of the Tab bar */}
              <div className="ml-auto flex items-center pr-1 gap-1">
                {/* Continue button — Shown when session is paused waiting for confirmation */}
                {isPaused && !isProcessing && (
                  <button
                    onClick={() => {
                      setIsPaused(false);
                      setQuery('(用户已确认，请继续执行)');
                      setTimeout(() => handleAnalysis(false), 50);
                    }}
                    title={language === 'zh' ? '继续执行' : 'Continue'}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all border shrink-0 text-green-600 hover:bg-green-50 border-transparent hover:border-green-200"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {language === 'zh' ? '继续' : 'Continue'}
                  </button>
                )}
                <button
                  onClick={() => setLogPanelOpen(!logPanelOpen)}
                  title={logPanelOpen ? t('logs.close') : t('logs.open')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all border shrink-0 ${logPanelOpen
                    ? 'bg-slate-800 text-slate-200 border-slate-700'
                    : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 border-transparent hover:border-blue-200'
                    }`}
                >
                  <Terminal className={`w-3.5 h-3.5 ${logPanelOpen ? 'text-green-400' : ''}`} />
                  {t('tabs.logs')}
                  {logs.length > 0 && !logPanelOpen && (
                    <span className="bg-red-500 text-white text-[9px] px-1.5 py-0 rounded-full font-bold">
                      {logs.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className={`flex-1 w-full relative overscroll-none bg-white ${activeTab === 'trace' ? 'overflow-hidden' : 'scroll-smooth overflow-auto'}`}
            >
              <div className={`w-full relative ${activeTab === 'trace' ? 'h-full' : 'h-full'}`}>


                {/* Tab Content */}
                <div className="relative h-full">
                  {/* Workflow Tab */}
                  <div className={activeTab === 'workflow' ? 'h-full' : 'hidden'}>
                    <WorkflowTab
                      graphSvg={graphSvg}
                      graphLoading={graphLoading}
                      loadGraph={loadGraph}
                      activeNode={activeNode}
                      setActiveNode={setActiveNode}
                      isActive={activeTab === 'workflow'}
                    />
                  </div>

                  {/* Plan Tab */}
                  <div className={activeTab === 'plan' ? 'h-full' : 'hidden'}>
                    <PlanTab
                      currentPlan={currentPlan}
                      completedTasks={completedTasks}
                      isProcessing={isProcessing}
                    />
                  </div>

                  {/* Files Tab */}
                  <div className={activeTab === 'files' ? 'h-full' : 'hidden'}>
                    <FilesTab threadId={currentThreadId} isActive={activeTab === 'files'} />
                  </div>

                  {/* Token Usage Tab */}
                  <div className={activeTab === 'token' ? 'h-full' : 'hidden'}>
                    <TokenTab logs={logs} />
                  </div>

                  {/* Agent Trace Tab */}
                  <div className={activeTab === 'trace' ? 'h-full' : 'hidden'}>
                    <TraceTab
                      chunks={chunks}
                      completedTasks={completedTasks}
                      currentPlan={currentPlan}
                      errorDesc={errorDesc}
                      currentThreadId={currentThreadId}
                      isProcessing={isProcessing}
                      handleAnalysis={handleAnalysis}
                      reportViewMode={reportViewMode}
                      setReportViewMode={setReportViewMode}
                      chunksMeta={chunksMeta}
                      onRecallMessage={handleRecallMessage}
                    />
                  </div>
                </div>

              </div>
            </div>

            {/* Input Area (Bottom Fixed) - Only show on trace tab */}
            {activeTab === 'trace' && (
              <ChatInput
                query={query}
                setQuery={setQuery}
                isProcessing={isProcessing}
                handleAnalysis={handleAnalysis}
                stopAnalysis={stopAnalysis}
                chunksLength={chunks.length}
                currentQuery={currentQuery}
                currentThreadId={currentThreadId}
                setCurrentThreadId={setCurrentThreadId}
                enableThinking={enableThinking}
                setEnableThinking={setEnableThinking}
                enabledMcpServers={enabledMcpServers}
                setEnabledMcpServers={setEnabledMcpServers}
                selectedHistoryThreadIds={selectedHistoryThreadIds}
                setSelectedHistoryThreadIds={setSelectedHistoryThreadIds}
                onFilesUploaded={setUploadedFiles}
              />
            )}
          </main>

          {/* Right side: Real-time Log Panel */}
          <LogPanel
            logs={logs}
            logPanelOpen={logPanelOpen}
            setLogPanelOpen={setLogPanelOpen}
            isProcessing={isProcessing}
            logBottomRef={logBottomRef}
          />
        </div>
      </div>{/* End Main Column */}

      {/* Withdraw confirmation modal */}
      {pendingRecall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[420px] max-w-[90vw] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-slate-800">确认撤回</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                该消息及之后的所有对话记录将被删除，消息内容将回填到输入框。
              </p>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5 max-h-[120px] overflow-y-auto">
                <p className="text-xs text-blue-800 whitespace-pre-wrap break-words line-clamp-5">
                  {pendingRecall.messageText}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
              <button
                onClick={() => setPendingRecall(null)}
                className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmRecall}
                className="px-4 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors"
              >
                确认撤回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => { setSettingsOpen(false); setSettingsAlert(''); }}
        alertMessage={settingsAlert}
      />

      {/* Spotlight Search Modal */}
      <SpotlightSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        historyList={historyList}
        onSelectHistory={(threadId, viewOnly) => handleAnalysis(false, threadId, viewOnly)}
        setActiveTab={setActiveTab as any}
        onNewConversation={startNewConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </div>
  );
};

export default App;
