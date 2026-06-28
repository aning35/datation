import React, { useState, useCallback, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, Navigation2, ShieldAlert, Sparkles, CodeXml, Eye, RotateCcw, Loader2, Settings, User as UserIcon, FileText, Search, Copy, Check, ClipboardList, Maximize2, Minimize2, ChevronsDown, History, Server, Printer, Undo2, BellRing, ExternalLink } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { AgentChunk } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';

interface TraceTabProps {
    chunks: AgentChunk[];
    completedTasks: [string, any][];
    currentPlan: string[];
    errorDesc: string | null;
    currentThreadId: string | null;
    isProcessing: boolean;
    handleAnalysis: (isRetry?: boolean, overrideThreadId?: string) => void;
    onRecallMessage?: (chunkIndex: number, messageText: string, meta: { mcpServers: string[]; enableThinking: boolean; historyIds: string[]; historyLabels: { id: string; query: string }[]; uploadedFiles: string[] }) => void;
    reportViewMode: 'preview' | 'source';
    setReportViewMode: (mode: 'preview' | 'source') => void;
    chunksMeta?: {
        mcpServers: string[];
        enableThinking: boolean;
        historyIds: string[];
        historyLabels: { id: string; query: string }[];
        uploadedFiles: string[];
    }[];
    onGenerateDashboard?: () => void;
}

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:18321';

// Global cache: image URL → { width, height } after successful load.
// Persists across re-renders and re-mounts so images don't cause repeated layout shifts.
const imageDimensionCache = new Map<string, { width: number; height: number }>();

/**
 * Stable image component for use inside Virtuoso + ReactMarkdown.
 * - Reserves a fixed placeholder height before load to prevent layout shifts.
 * - Caches natural dimensions after first load so re-mounts don't cause flicker.
 * - Uses loading="lazy" for images outside the viewport.
 * - Hides on error to avoid broken-image icons.
 */
const MarkdownImage = React.memo(({ src, alt, style: _style, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const resolvedSrc = src || '';
    const cached = imageDimensionCache.get(resolvedSrc);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(cached || null);
    const [hasError, setHasError] = useState(false);
    const [loaded, setLoaded] = useState(!!cached);

    const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const dims = { width: img.naturalWidth, height: img.naturalHeight };
        imageDimensionCache.set(resolvedSrc, dims);
        setDimensions(dims);
        setLoaded(true);
    }, [resolvedSrc]);

    const handleError = useCallback(() => {
        setHasError(true);
    }, []);

    if (hasError) return null;

    // Calculate aspect-ratio-based height or use a static placeholder
    const placeholderStyle: React.CSSProperties = dimensions
        ? { aspectRatio: `${dimensions.width} / ${dimensions.height}`, width: '100%', maxWidth: `${dimensions.width}px` }
        : { minHeight: '200px', width: '100%' };

    return (
        <img
            {...rest}
            src={resolvedSrc}
            alt={alt || 'Generated Chart'}
            loading="lazy"
            onLoad={handleLoad}
            onError={handleError}
            className="rounded-lg shadow-md my-4 max-w-full h-auto border border-slate-200"
            style={{
                ...placeholderStyle,
                backgroundColor: loaded ? undefined : '#f8fafc',
                transition: 'opacity 0.2s ease-in',
                opacity: loaded ? 1 : 0.6,
            }}
        />
    );
});

export const TraceTab: React.FC<TraceTabProps> = ({
    chunks,
    completedTasks,
    currentPlan,
    errorDesc,
    currentThreadId,
    isProcessing,
    handleAnalysis,
    reportViewMode,
    setReportViewMode,
    chunksMeta = [],
    onRecallMessage,
    onGenerateDashboard,
}) => {
    const { t } = useTranslation();
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const virtuosoRef = React.useRef<any>(null);

    // Debounce atBottomStateChange to prevent rapid state updates during image load cascades
    const atBottomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
        if (atBottomTimerRef.current) clearTimeout(atBottomTimerRef.current);
        atBottomTimerRef.current = setTimeout(() => {
            setShowScrollBottom(!atBottom);
        }, 150);
    }, []);

    // Build stable markdown components object with the current threadId baked in.
    // Memoised so ReactMarkdown doesn't get a new `components` prop on every render,
    // which would unmount & remount all <img> elements and retrigger network requests.
    const markdownComponents = useMemo(() => ({
        img: ({ node, ...props }: any) => {
            let resolvedSrc = props.src;
            if (resolvedSrc && !resolvedSrc.startsWith('http') && !resolvedSrc.startsWith('data:') && currentThreadId) {
                const cleanedSrc = resolvedSrc.replace(/^(\.\/)?\/?(outputs\/)?/, '');
                resolvedSrc = `${API_BASE_URL}/files/raw?thread_id=${currentThreadId}&file_path=${cleanedSrc}`;
            }
            return <MarkdownImage {...props} src={resolvedSrc} />;
        },
    }), [currentThreadId]);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const toggleExpand = (id: string) => {
        const newExpanded = new Set(expandedIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedIds(newExpanded);
    };

    const handlePrintPdf = (markdownText: string, title?: string) => {
        const printWin = window.open('', '_blank', 'width=900,height=700');
        if (!printWin) return;

        // Pre-process markdown: resolve relative image paths to full API URLs
        const processedMarkdown = currentThreadId
            ? markdownText.replace(
                /!\[([^\]]*)\]\((?!http|data:)([^)]+)\)/g,
                (_match, alt, path) => {
                    const cleanedPath = path.replace(/^(\.\/)?\/?(outputs\/)?/, '');
                    return `![${alt}](${API_BASE_URL}/files/raw?thread_id=${currentThreadId}&file_path=${cleanedPath})`;
                }
            )
            : markdownText;

        // Render markdown to a temp div so we can grab the HTML
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'position:absolute;left:-9999px;top:0';
        document.body.appendChild(tempDiv);

        import('react-dom/client').then(({ createRoot }) => {
            const root = createRoot(tempDiv);
            root.render(
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {processedMarkdown}
                </ReactMarkdown>
            );
            setTimeout(() => {
                const htmlContent = tempDiv.innerHTML;
                root.unmount();
                document.body.removeChild(tempDiv);

                printWin.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${title || 'Datation Report'}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; line-height: 1.7; font-size: 14px; }
  h1,h2,h3,h4 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 700; }
  h1 { font-size: 1.8em; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  h3 { font-size: 1.15em; }
  p { margin: 0.6em 0; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 12px; }
  code { background: #f1f5f9; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; font-size: 13px; }
  th { background: #f8fafc; font-weight: 600; }
  tr:nth-child(even) { background: #fafbfc; }
  img { max-width: 100%; height: auto; border-radius: 6px; margin: 1em 0; }
  ul, ol { padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  blockquote { border-left: 3px solid #94a3b8; margin: 1em 0; padding: 0.5em 1em; color: #64748b; background: #f8fafc; }
  @media print { body { margin: 20px; } }
</style>
</head><body>${htmlContent}</body></html>`);
                printWin.document.close();
                printWin.focus();

                // Wait for all images to load before printing
                const images = printWin.document.querySelectorAll('img');
                if (images.length === 0) {
                    setTimeout(() => printWin.print(), 300);
                } else {
                    let loaded = 0;
                    const checkAllLoaded = () => {
                        loaded++;
                        if (loaded >= images.length) {
                            setTimeout(() => printWin.print(), 300);
                        }
                    };
                    images.forEach(img => {
                        if (img.complete) {
                            checkAllLoaded();
                        } else {
                            img.addEventListener('load', checkAllLoaded);
                            img.addEventListener('error', checkAllLoaded);
                        }
                    });
                    // Fallback: print after 5s even if images fail
                    setTimeout(() => printWin.print(), 5000);
                }
            }, 100);
        });
    };

    const formatTime = (isoString?: string) => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    };

    let lastPlannerIdx = -1;
    for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i].node === 'planner') {
            lastPlannerIdx = i;
            break;
        }
    }

    // Build a map from chunk index → user-chunk-index for O(1) meta lookup
    const userChunkIdxMap: Record<number, number> = {};
    let userCount = 0;
    for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].node === 'User') {
            userChunkIdxMap[i] = userCount++;
        }
    }
    const emptyMeta = { mcpServers: [], enableThinking: false, historyIds: [], historyLabels: [], uploadedFiles: [] };
    const getNodeInfo = (nodeName: string) => {
        const parts = nodeName.split(':');

        // Priority check for specific components in the path (backwards)
        const checkNodes = [...parts].reverse();

        for (const name of checkNodes) {
            switch (name) {
                case 'Supervisor':
                    return {
                        title: t('agents.supervisor'),
                        colorClass: 'border-indigo-500 bg-indigo-50',
                        textColor: 'text-indigo-700',
                        icon: <Brain className="w-4 h-4 text-indigo-600" />
                    };
                case 'planner':
                    return {
                        title: t('agents.planner'),
                        colorClass: 'border-purple-500 bg-purple-50',
                        textColor: 'text-purple-700',
                        icon: <Navigation2 className="w-4 h-4 text-purple-600" />
                    };
                case 'executor':
                    return {
                        title: t('agents.executor'),
                        colorClass: 'border-blue-500 bg-blue-50',
                        textColor: 'text-blue-700',
                        icon: <Settings className="w-4 h-4 text-blue-600" />
                    };
                case 'reviewer':
                    return {
                        title: t('agents.reviewer'),
                        colorClass: 'border-amber-500 bg-amber-50',
                        textColor: 'text-amber-700',
                        icon: <ShieldAlert className="w-4 h-4 text-amber-600" />
                    };
                case 'RequirementsAnalyst':
                    return {
                        title: t('agents.requirementsAnalyst'),
                        colorClass: 'border-cyan-500 bg-cyan-50',
                        textColor: 'text-cyan-700',
                        icon: <Search className="w-4 h-4 text-cyan-600" />
                    };
                case 'ReportGenerator':
                    return {
                        title: t('agents.reportGenerator'),
                        colorClass: 'border-emerald-500 bg-emerald-50',
                        textColor: 'text-emerald-700',
                        icon: <FileText className="w-4 h-4 text-emerald-600" />
                    };
                case 'DataAnalyst':
                    return {
                        title: t('agents.dataAnalyst'),
                        colorClass: 'border-blue-500 bg-blue-50',
                        textColor: 'text-blue-700',
                        icon: <Sparkles className="w-4 h-4 text-blue-600" />
                    };
                case 'QAAgent':
                    return {
                        title: t('agents.qaAgent'),
                        colorClass: 'border-teal-500 bg-teal-50',
                        textColor: 'text-teal-700',
                        icon: <Brain className="w-4 h-4 text-teal-600" />
                    };
                case 'SkillExecutor':
                    return {
                        title: t('agents.skillExecutor'),
                        colorClass: 'border-pink-500 bg-pink-50',
                        textColor: 'text-pink-700',
                        icon: <Sparkles className="w-4 h-4 text-pink-600" />
                    };
                case 'User':
                    return {
                        title: t('agents.user'),
                        colorClass: 'border-slate-500 bg-slate-100',
                        textColor: 'text-slate-700',
                        icon: <UserIcon className="w-4 h-4 text-slate-600" />
                    };
                case '__error__':
                    return {
                        title: t('agents.error'),
                        colorClass: 'border-red-500 bg-red-50',
                        textColor: 'text-red-700',
                        icon: <ShieldAlert className="w-4 h-4 text-red-600" />
                    };
                case 'collect_files':
                    return {
                        title: t('agents.collectFiles'),
                        colorClass: 'border-emerald-400 bg-emerald-50',
                        textColor: 'text-emerald-700',
                        icon: <FileText className="w-4 h-4 text-emerald-500" />
                    };
                case 'generate_outline':
                    return {
                        title: t('agents.generateOutline'),
                        colorClass: 'border-emerald-400 bg-emerald-50',
                        textColor: 'text-emerald-700',
                        icon: <Navigation2 className="w-4 h-4 text-emerald-500" />
                    };
                case 'generate_chapter':
                    return {
                        title: t('agents.generateChapter'),
                        colorClass: 'border-emerald-400 bg-emerald-50',
                        textColor: 'text-emerald-700',
                        icon: <FileText className="w-4 h-4 text-emerald-500" />
                    };
                case 'merge_report':
                    return {
                        title: t('agents.mergeReport'),
                        colorClass: 'border-emerald-400 bg-emerald-50',
                        textColor: 'text-emerald-700',
                        icon: <FileText className="w-4 h-4 text-emerald-500" />
                    };
                case 'convert_html':
                    return {
                        title: t('agents.convertHtml'),
                        colorClass: 'border-emerald-400 bg-emerald-50',
                        textColor: 'text-emerald-700',
                        icon: <Settings className="w-4 h-4 text-emerald-500" />
                    };
            }
        }

        return {
            title: `Node: ${nodeName}`,
            colorClass: 'border-gray-500 bg-gray-50',
            textColor: 'text-gray-700',
            icon: <Sparkles className="w-4 h-4 text-gray-600" />
        };
    };

    return (
        <div className="flex flex-col bg-white border-slate-200 h-full">
            {chunks.length === 0 && !errorDesc && !isProcessing ? (
                <div className="m-auto text-center flex flex-col items-center text-slate-400 gap-3 py-20">
                    <Brain className="w-10 h-10 text-slate-200" />
                    <p className="text-sm text-slate-500">{t('chat.waitingMessage')}</p>
                </div>
            ) : (
                <div className="flex-1 flex flex-col relative overflow-hidden" style={{ height: '100%' }}>
                    <Virtuoso
                        ref={virtuosoRef}
                        style={{ height: '100%' }}
                        totalCount={chunks.length}
                        initialTopMostItemIndex={chunks.length > 0 ? chunks.length - 1 : 0}
                        followOutput={isProcessing ? "auto" : false}
                        data={chunks}
                        atBottomThreshold={200}
                        atBottomStateChange={handleAtBottomStateChange}
                        components={{
                            Header: () => (
                                <>
                                    <div className="pt-3" />
                                    {errorDesc && (
                                        <div className="px-3 pt-3">
                                            <div className="bg-red-50 text-red-700 p-3 rounded-lg border border-red-200 text-sm flex items-start justify-between gap-4">
                                                <div className="flex items-start gap-2">
                                                    <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                                    <div><h4 className="font-bold mb-0.5">{t('trace.executionError')}</h4><p className="text-xs">{errorDesc}</p></div>
                                                </div>
                                                {currentThreadId && (
                                                    <button
                                                        onClick={() => handleAnalysis(true)}
                                                        disabled={isProcessing}
                                                        className="shrink-0 bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-md text-xs font-bold transition-colors border border-red-300 shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                                                    >
                                                        {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                                        {t('chat.retry')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {lastPlannerIdx === -1 && (currentPlan.length > 0 || completedTasks.length > 0) && (
                                        <div className="px-3 pt-3">
                                            <div className="flex gap-2 w-full mb-2">
                                                <div className="shrink-0 w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center border border-purple-200 mt-0.5">
                                                    <Navigation2 className="w-3 h-3 text-purple-600" />
                                                </div>
                                                <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                                                    <div className="flex items-center justify-between mb-1.5 border-b border-slate-100 pb-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <ClipboardList className="w-3.5 h-3.5 text-purple-600" />
                                                            <h3 className="font-bold text-slate-800 text-xs tracking-wide">{t('trace.missionPlan')}</h3>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider bg-slate-50 px-2 py-0.5 rounded flex items-center gap-1">
                                                            {isProcessing && <Loader2 className="w-3 h-3 animate-spin" />}
                                                            {isProcessing ? t('trace.syncing') : t('trace.latest')}
                                                        </div>
                                                    </div>
                                                    <ul className="space-y-1 text-xs text-slate-700">
                                                        {completedTasks.map((task, i) => (
                                                            <li key={`c-${i}`} className="flex items-start gap-3 text-slate-400">
                                                                <div className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-200">
                                                                    <Check className="w-2.5 h-2.5 text-emerald-500" />
                                                                </div>
                                                                <span className="line-through">{task[0]}</span>
                                                            </li>
                                                        ))}
                                                        {currentPlan.map((task, i) => (
                                                            <li key={`p-${i}`} className="flex items-start gap-3 font-medium">
                                                                <div className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center border ${i === 0 && isProcessing ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200'}`}>
                                                                    {i === 0 && isProcessing && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>}
                                                                </div>
                                                                <span className={i === 0 && isProcessing ? "text-blue-700 font-bold" : "text-slate-500"}>{task}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ),
                            Footer: () => <div style={{ height: '120px' }} />
                        }}
                        itemContent={(idx, chunk) => {
                            const info = getNodeInfo(chunk.node);
                            const isError = chunk.node === '__error__';
                            const isWaiting = chunk.action_executed && Array.isArray(chunk.action_executed) && chunk.action_executed.some((a: string) => a && (a.includes('WAITING') || a.includes('等待')));

                            const isActiveWaiting = isWaiting && (idx === chunks.length - 1);

                            return (
                                <div className="px-3">
                                    {isError ? (
                                        <div className="flex gap-2 w-full mb-3">
                                            <div className="shrink-0 w-6 h-6 rounded-full bg-red-100 flex items-center justify-center mt-0.5 border border-red-200">
                                                <ShieldAlert className="w-3 h-3 text-red-600" />
                                            </div>
                                            <div className="flex-1 min-w-0 bg-red-50 rounded-lg p-2.5 border border-red-100">
                                                <div className="flex items-center justify-between mb-1">
                                                    <h3 className="font-bold text-red-700 text-sm">{t('trace.executionError')}</h3>
                                                    {chunk.created_at && (
                                                        <span className="text-[10px] text-red-400 font-medium">
                                                            {formatTime(chunk.created_at)}
                                                        </span>
                                                    )}
                                                </div>
                                                <pre className="text-xs text-red-600 whitespace-pre-wrap max-h-[200px] overflow-y-auto bg-white/50 p-2 rounded-lg border border-red-100/50">{chunk.error || chunk.detail}</pre>
                                            </div>
                                        </div>
                                    ) : chunk.report_html_url ? (
                                        /* ── HTML Report ready card ── */
                                        <div className="flex gap-2 w-full mb-3">
                                            <div className="shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mt-0.5 shadow-sm">
                                                <FileText className="w-3 h-3 text-white" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                    <h3 className="font-semibold text-[11px] text-emerald-700">{info.title}</h3>
                                                    {chunk.created_at && (
                                                        <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-1.5 py-0.5 rounded">
                                                            {formatTime(chunk.created_at)}
                                                        </span>
                                                    )}
                                                </div>
                                                <a
                                                    href={`${API_BASE_URL}/files/raw?thread_id=${currentThreadId}&file_path=${chunk.report_html_url}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="group/report block rounded-xl overflow-hidden border border-emerald-200 hover:border-emerald-400 transition-all duration-200 hover:shadow-lg hover:shadow-emerald-100/50 cursor-pointer"
                                                >
                                                    <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 p-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-200/50 group-hover/report:scale-110 transition-transform duration-200">
                                                                <FileText className="w-6 h-6 text-white" />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="font-bold text-emerald-800 text-sm">{t('trace.htmlReportReady')}</h4>
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                                                        HTML
                                                                    </span>
                                                                </div>
                                                                <p className="text-xs text-emerald-600/80 mt-0.5">{t('trace.htmlReportDesc')}</p>
                                                            </div>
                                                            <div className="shrink-0 w-8 h-8 rounded-full bg-white/80 flex items-center justify-center border border-emerald-200 group-hover/report:bg-emerald-500 group-hover/report:border-emerald-500 transition-all duration-200">
                                                                <ExternalLink className="w-4 h-4 text-emerald-500 group-hover/report:text-white transition-colors" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="bg-white px-4 py-2 border-t border-emerald-100 flex items-center justify-between">
                                                        <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1.5">
                                                            <ExternalLink className="w-3 h-3" />
                                                            {t('trace.openHtmlReport')}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400">report.html</span>
                                                    </div>
                                                </a>
                                            </div>
                                        </div>
                                    ) : isActiveWaiting ? (
                                        /* ── 独立醒目确认卡片 ── */
                                        <div className="mb-3">
                                            <div className="relative rounded-xl overflow-hidden">
                                                {/* 脉冲动画边框 */}
                                                <div className="absolute inset-0 rounded-xl border-2 border-amber-400 animate-pulse pointer-events-none" />
                                                <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 rounded-xl p-4 border border-amber-200">
                                                    <div className="flex items-start gap-3">
                                                        <div className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-200/50">
                                                            <BellRing className="w-5 h-5 text-white" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1.5">
                                                                <h3 className="font-bold text-amber-800 text-sm">{t('chat.confirmationNeeded')}</h3>
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-800 animate-pulse">
                                                                    {t('chat.waitingInput')}
                                                                </span>
                                                                {chunk.created_at && (
                                                                    <span className="text-[10px] text-amber-500 font-medium ml-auto">
                                                                        {formatTime(chunk.created_at)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {chunk.action_executed?.[1] && (
                                                                <div className="text-xs text-amber-900/80 bg-white/60 rounded-lg p-2.5 border border-amber-200/50 max-h-[300px] overflow-y-auto prose prose-sm prose-amber max-w-none">
                                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                                        {chunk.action_executed[1]}
                                                                    </ReactMarkdown>
                                                                </div>
                                                            )}
                                                            <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1.5">
                                                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                                                {t('chat.replyToConfirm')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : chunk.action_executed ? (
                                        <div className={`flex gap-2 w-full mb-3 group ${chunk.node === 'User' ? 'flex-row-reverse' : ''}`}>
                                            <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 border bg-white ${info.colorClass.split('bg-')[0]}`}>
                                                {chunk.status === 'running' ? <Loader2 className={`w-3.5 h-3.5 animate-spin ${info.textColor}`} /> : info.icon}
                                            </div>
                                            <div className={`flex-1 min-w-0 flex flex-col ${chunk.node === 'User' ? 'items-end' : 'items-start'}`}>
                                                <div className={`flex items-center gap-1.5 mb-0.5 ${chunk.node === 'User' ? 'justify-end' : 'justify-start'}`}>
                                                    <h3 className={`font-semibold text-[11px] ${info.textColor}`}>{info.title}</h3>
                                                    {chunk.created_at && (
                                                        <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-1.5 py-0.5 rounded">
                                                            {formatTime(chunk.created_at)}
                                                        </span>
                                                    )}
                                                    {/* 撤回按钮：所有 User 消息都可撤回，hover 时可见 */}
                                                    {chunk.node === 'User' && onRecallMessage && !isProcessing && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const userIdx = userChunkIdxMap[idx] ?? -1;
                                                                const meta = chunksMeta[userIdx] ?? emptyMeta;
                                                                const messageText = chunk.action_executed?.[1] || '';
                                                                onRecallMessage(idx, messageText, meta);
                                                            }}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-blue-100 rounded text-blue-400 hover:text-blue-600"
                                                            title="撤回消息"
                                                        >
                                                            <Undo2 className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className={`${chunk.node === 'User' ? 'bg-blue-50 border-blue-100' : 'bg-slate-50 border-slate-200'} rounded-lg p-2 border hover:border-slate-300 transition-colors max-w-[92%]`}>
                                                    <div className={`font-medium text-slate-700 text-xs flex items-center justify-between gap-1 ${chunk.action_executed[1] ? 'border-b border-slate-100 pb-1.5 mb-1.5' : ''}`}>
                                                        <div className="flex items-center gap-1.5 truncate mr-2">
                                                            {info.icon}
                                                            <span className="truncate">
                                                                {chunk.action_executed[0]}
                                                            </span>
                                                        </div>
                                                        {chunk.action_executed[1] && (
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); toggleExpand(`act-${idx}`); }}
                                                                    className="shrink-0 p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                    title={expandedIds.has(`act-${idx}`) ? t('trace.collapse') : t('trace.expand')}
                                                                >
                                                                    {expandedIds.has(`act-${idx}`) ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleCopy(chunk.action_executed![1], `act-${idx}`); }}
                                                                    className="shrink-0 p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                    title={t('trace.copy')}
                                                                >
                                                                    {copiedId === `act-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                                                </button>
                                                                {chunk.node !== 'User' && (
                                                                    <>
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); setReportViewMode(reportViewMode === 'preview' ? 'source' : 'preview'); }}
                                                                            className="shrink-0 p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                            title={reportViewMode === 'preview' ? t('trace.switchToSource') : t('trace.switchToPreview')}
                                                                        >
                                                                            {reportViewMode === 'preview' ? <CodeXml className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                                        </button>
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); handlePrintPdf(chunk.action_executed![1], chunk.action_executed![0]); }}
                                                                            className="shrink-0 p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                            title={t('trace.exportPdf')}
                                                                        >
                                                                            <Printer className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {chunk.action_executed[1] ? (
                                                        <div className={`${chunk.node === 'User' ? 'text-blue-800' : 'text-slate-600 bg-white p-2 rounded-lg border border-slate-100'} text-xs break-words ${!expandedIds.has(`act-${idx}`) ? 'max-h-[200px] overflow-y-auto' : ''}`}>
                                                            {expandedIds.has(`act-${idx}`) ? (
                                                                // Non-User agent nodes can render Markdown in preview mode
                                                                reportViewMode === 'preview' && chunk.node !== 'User' ? (
                                                                    <div className="prose prose-slate prose-sm max-w-none markdown-content">
                                                                        <ReactMarkdown
                                                                            remarkPlugins={[remarkGfm]}
                                                                            components={markdownComponents}
                                                                        >
                                                                            {chunk.action_executed[1]}
                                                                        </ReactMarkdown>
                                                                    </div>
                                                                ) : (
                                                                    <div className="mt-1.5 text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200 overflow-y-auto">
                                                                        <pre className="whitespace-pre-wrap font-mono leading-relaxed">{chunk.action_executed[1]}</pre>
                                                                    </div>
                                                                )
                                                            ) : (
                                                                <div className="text-xs text-slate-500 truncate max-w-full group-hover:text-slate-600 transition-colors">
                                                                    {chunk.action_executed[1]}
                                                                </div>
                                                            )}

                                                            {/* 显示用户配置信息 - 使用每条消息各自的 meta */}
                                                            {chunk.node === 'User' && (() => {
                                                                const userIdx = userChunkIdxMap[idx] ?? -1;
                                                                const meta = chunksMeta[userIdx] ?? emptyMeta;
                                                                const { enableThinking, historyIds, historyLabels, mcpServers, uploadedFiles } = meta;
                                                                const hasAny = uploadedFiles.length > 0 || historyIds.length > 0 || mcpServers.length > 0 || enableThinking;
                                                                if (!hasAny) return null;
                                                                return (
                                                                    <div className="mt-1.5 pt-1.5 border-t border-blue-200 flex flex-wrap gap-1">
                                                                        {enableThinking && (
                                                                            <span className="text-[10px] px-2 py-1 bg-purple-100 text-purple-700 rounded-full border border-purple-200 flex items-center gap-1">
                                                                                <Brain className="w-3 h-3" />
                                                                                {t('chat.thinkingMode')}
                                                                            </span>
                                                                        )}
                                                                        {historyIds.length > 0 && (
                                                                            (historyLabels && historyLabels.length > 0
                                                                                ? historyLabels
                                                                                : historyIds.map(id => ({ id, query: id.slice(0, 8) }))
                                                                            ).map(item => (
                                                                                <span key={item.id} className="text-[10px] px-2 py-1 bg-orange-100 text-orange-700 rounded-full border border-orange-200 flex items-center gap-1 max-w-[200px]">
                                                                                    <History className="w-3 h-3 shrink-0" />
                                                                                    <span className="truncate">{item.query}</span>
                                                                                </span>
                                                                            ))
                                                                        )}
                                                                        {mcpServers.map(server => (
                                                                            <span key={server} className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded-full border border-green-200 flex items-center gap-1">
                                                                                <Server className="w-3 h-3" />
                                                                                {server}
                                                                            </span>
                                                                        ))}
                                                                        {uploadedFiles.map((file, fi) => (
                                                                            <span key={fi} className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded-full border border-blue-200 flex items-center gap-1">
                                                                                <FileText className="w-3 h-3" />
                                                                                {file}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    ) : null}
                                                </div>

                                                {idx === lastPlannerIdx && (currentPlan.length > 0 || completedTasks.length > 0) && (
                                                    <div className="mt-2 bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                                                        <div className="flex items-center justify-between mb-1.5 border-b border-slate-100 pb-1.5">
                                                            <div className="flex items-center gap-1.5">
                                                                <ClipboardList className="w-3.5 h-3.5 text-purple-600" />
                                                                <h3 className="font-bold text-slate-800 text-xs tracking-wide">{t('trace.missionPlan')}</h3>
                                                            </div>
                                                            <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider bg-slate-50 px-2 py-0.5 rounded flex items-center gap-1">
                                                                {isProcessing && <Loader2 className="w-3 h-3 animate-spin" />}
                                                                {isProcessing ? t('trace.syncing') : t('trace.latest')}
                                                            </div>
                                                        </div>
                                                        <ul className="space-y-1 text-xs text-slate-700">
                                                            {completedTasks.map((task, i) => (
                                                                <li key={`c-${i}`} className="flex items-start gap-3 text-slate-400">
                                                                    <div className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-200">
                                                                        <Check className="w-2.5 h-2.5 text-emerald-500" />
                                                                    </div>
                                                                    <span className="line-through">{task[0]}</span>
                                                                </li>
                                                            ))}
                                                            {currentPlan.map((task, i) => (
                                                                <li key={`p-${i}`} className="flex items-start gap-3 font-medium">
                                                                    <div className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center border ${i === 0 && isProcessing ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200'}`}>
                                                                        {i === 0 && isProcessing && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>}
                                                                    </div>
                                                                    <span className={i === 0 && isProcessing ? "text-blue-700 font-bold" : "text-slate-500"}>{task}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : null}

                                    {chunk.final_response && (
                                        <div className={`flex gap-2 w-full mb-3 group ${chunk.node === 'User' ? 'flex-row-reverse' : ''}`}>
                                            <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 border bg-white ${info.colorClass.split('bg-')[0]}`}>
                                                {info.icon}
                                            </div>
                                            <div className={`flex-1 min-w-0 flex flex-col ${chunk.node === 'User' ? 'items-end' : 'items-start'}`}>
                                                <div className={`flex items-center gap-1.5 mb-0.5 ${chunk.node === 'User' ? 'justify-end' : 'justify-start'}`}>
                                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                                        {chunk.node.includes('RequirementsAnalyst') ? t('trace.finalRequirements') : t('trace.finalReport')}
                                                    </span>
                                                    {chunk.created_at && (
                                                        <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-1.5 py-0.5 rounded">
                                                            {formatTime(chunk.created_at)}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className={`bg-slate-50 border border-slate-200 rounded-lg p-2 transition-colors max-w-[92%]`}>
                                                    <div className="font-medium text-slate-700 text-xs flex items-center justify-between gap-1 border-b border-slate-100 pb-1.5 mb-1.5">
                                                        <div className="flex items-center gap-2">
                                                            {info.icon}
                                                            <h3 className="font-bold text-slate-800 text-sm">
                                                                {chunk.node.includes('RequirementsAnalyst') ? t('trace.needConfirm') : t('trace.analysisReport')}
                                                            </h3>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                onClick={() => toggleExpand(`final-${idx}`)}
                                                                className="p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                title={(chunk.node.includes('RequirementsAnalyst') ? !expandedIds.has(`final-${idx}`) : expandedIds.has(`final-${idx}`)) ? t('trace.collapse') : t('trace.expand')}
                                                            >
                                                                {(chunk.node.includes('RequirementsAnalyst') ? !expandedIds.has(`final-${idx}`) : expandedIds.has(`final-${idx}`)) ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                                                            </button>
                                                            <button
                                                                onClick={() => handleCopy(chunk.final_response!, `final-${idx}`)}
                                                                className="p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                title={t('trace.copy')}
                                                            >
                                                                {copiedId === `final-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                                            </button>
                                                            <button
                                                                onClick={() => setReportViewMode(reportViewMode === 'preview' ? 'source' : 'preview')}
                                                                className="p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                title={reportViewMode === 'preview' ? t('trace.switchToSource') : t('trace.switchToPreview')}
                                                            >
                                                                {reportViewMode === 'preview' ? <CodeXml className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                            </button>
                                                            <button
                                                                onClick={() => handlePrintPdf(chunk.final_response!, chunk.node.includes('RequirementsAnalyst') ? t('trace.finalRequirements') : t('trace.analysisReport'))}
                                                                className="p-1.5 hover:bg-white rounded-md transition-colors text-slate-400 hover:text-slate-600"
                                                                title={t('trace.exportPdf')}
                                                            >
                                                                <Printer className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className={`bg-white p-2 rounded-lg border border-slate-100 ${(chunk.node.includes('RequirementsAnalyst') ? expandedIds.has(`final-${idx}`) : !expandedIds.has(`final-${idx}`)) ? 'max-h-[200px] overflow-y-auto' : ''}`}>
                                                        {reportViewMode === 'preview' ? (
                                                            <div className="prose prose-slate prose-sm max-w-none text-sm leading-relaxed break-words markdown-content">
                                                                <ReactMarkdown
                                                                    remarkPlugins={[remarkGfm]}
                                                                    components={markdownComponents}
                                                                >
                                                                    {chunk.final_response}
                                                                </ReactMarkdown>
                                                            </div>
                                                        ) : (
                                                            <pre className="text-sm text-slate-600 whitespace-pre-wrap break-words font-mono leading-relaxed">
                                                                {chunk.final_response}
                                                            </pre>
                                                        )}
                                                    </div>
                                                    
                                                    {chunk.node.includes('ReportGenerator') && onGenerateDashboard && (
                                                        <div className="mt-3 flex items-center justify-end">
                                                            <button
                                                                onClick={onGenerateDashboard}
                                                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-lg shadow-sm hover:shadow transition-all text-sm font-medium"
                                                            >
                                                                <Sparkles className="w-4 h-4" />
                                                                {t('trace.generateDashboard', '生成交互式数据看板')}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        }}
                    />

                    {/* Scroll to bottom button */}
                    {showScrollBottom && chunks.length > 0 && (
                        <button
                            onClick={() => virtuosoRef.current?.scrollTo({ top: 9999999, behavior: 'smooth' })}
                            className="absolute bottom-36 right-8 z-30 p-3 bg-white border border-slate-200 shadow-lg rounded-full text-blue-600 hover:text-blue-700 hover:bg-slate-50 transition-all transform hover:scale-110 flex items-center justify-center group"
                            title={t('trace.scrollToBottom')}
                        >
                            <ChevronsDown className="w-5 h-5 group-hover:animate-bounce" />
                            <span className="absolute -top-10 right-0 bg-slate-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                {t('trace.scrollToBottom')}
                            </span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
