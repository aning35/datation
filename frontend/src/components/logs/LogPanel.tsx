import React, { useRef, useState, useCallback, useMemo } from 'react';
import { Terminal, ChevronRight, ChevronDown } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { LogEntry } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';

// Max characters to show before truncating detail text
const DETAIL_TRUNCATE_LEN = 500;
// Max log entries to feed into Virtuoso (older entries are discarded from view)
const MAX_DISPLAY_LOGS = 500;

interface LogItemProps {
    log: LogEntry;
    cardClass: string;
}

const LogItem: React.FC<LogItemProps> = React.memo(({ log, cardClass }) => {
    const [expanded, setExpanded] = useState(false);

    const detail = log.detail;
    const needsTruncate = detail && detail.length > DETAIL_TRUNCATE_LEN;
    const displayDetail = detail
        ? (needsTruncate && !expanded ? detail.slice(0, DETAIL_TRUNCATE_LEN) : detail)
        : null;

    return (
        <div className={`log-card ${cardClass}`}>
            <div className="flex items-center gap-2 flex-wrap">
                <span className="log-ts-text shrink-0 font-medium">{log.ts}</span>
                {log.node && (
                    <span className="bg-slate-700 text-slate-200 border border-slate-600 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider shrink-0">
                        {log.node}
                    </span>
                )}
                <span className="log-title-text font-medium leading-relaxed">{log.title}</span>
            </div>
            {displayDetail && (
                <div className="log-description-area custom-scrollbar">
                    {displayDetail}
                    {needsTruncate && (
                        <button
                            onClick={() => setExpanded(prev => !prev)}
                            className="inline-flex items-center gap-0.5 ml-1 text-blue-400 hover:text-blue-300 text-[10px] font-semibold cursor-pointer select-none"
                        >
                            {expanded ? (
                                <>收起<ChevronRight className="w-3 h-3" /></>
                            ) : (
                                <>...展开 ({Math.round(detail.length / 1000)}KB)<ChevronDown className="w-3 h-3" /></>
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
});
LogItem.displayName = 'LogItem';

interface LogPanelProps {
    logs: LogEntry[];
    logPanelOpen: boolean;
    setLogPanelOpen: (open: boolean) => void;
    isProcessing: boolean;
    logBottomRef: React.RefObject<HTMLDivElement | null>;
}

export const LogPanel: React.FC<LogPanelProps> = ({
    logs,
    logPanelOpen,
    setLogPanelOpen,
    isProcessing,
    logBottomRef,
}) => {
    const { t } = useTranslation();
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const getLogLevelStyle = useCallback((level: string) => {
        switch (level) {
            case 'llm_start': return 'log-card-llm-start';
            case 'llm_end': return 'log-card-llm-end';
            case 'tool_start': return 'log-card-tool-start';
            case 'tool_end': return 'log-card-tool-end';
            default: return 'log-card-default';
        }
    }, []);

    // Cap displayed logs to avoid massive Virtuoso dataset
    const displayLogs = useMemo(() => {
        if (logs.length <= MAX_DISPLAY_LOGS) return logs;
        return logs.slice(logs.length - MAX_DISPLAY_LOGS);
    }, [logs]);

    if (!logPanelOpen) {
        return null;
    }

    return (
        <aside className="log-panel-container flex flex-col shadow-inner h-full shrink-0 w-1/3 min-w-[320px] border-l border-slate-700">
            <div
                className="log-panel-header px-4 py-3 flex items-center justify-between cursor-pointer select-none hover:bg-[#293548] shrink-0"
                onClick={() => setLogPanelOpen(false)}
            >
                <div className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-green-400" />
                    <h2 className="text-sm font-bold tracking-wide log-title-text">{t('logs.title')}</h2>
                </div>
                <div className="flex items-center gap-3">
                    {logs.length > 0 && (
                        <span className="text-[11px] font-mono text-white bg-[#0f172a] px-2 py-0.5 rounded border border-slate-700">{logs.length} {t('logs.entries')}</span>
                    )}
                    <ChevronRight className="w-5 h-5 text-slate-500 hover:text-white transition-colors" />
                </div>
            </div>

            <div className="flex-1 overflow-hidden font-mono text-xs">
                {logs.length === 0 && !isProcessing ? (
                    <div className="m-auto text-slate-600 text-center py-10 flex flex-col items-center">
                        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3 border border-slate-700">
                            <Terminal className="w-6 h-6 text-slate-600" />
                        </div>
                        <p className="text-sm">{t('logs.waitingLogs')}</p>
                    </div>
                ) : (
                    <Virtuoso
                        ref={virtuosoRef}
                        data={displayLogs}
                        followOutput="smooth"
                        defaultItemHeight={60}
                        increaseViewportBy={{ top: 100, bottom: 100 }}
                        itemContent={(_index, log) => (
                            <div className="px-3 pb-2">
                                <LogItem log={log} cardClass={getLogLevelStyle(log.level)} />
                            </div>
                        )}
                        components={{
                            Header: () => <div className="h-3" />,
                            Footer: () => <div className="h-2" />,
                        }}
                        style={{ height: '100%' }}
                    />
                )}
                <div ref={logBottomRef} />
            </div>
        </aside>
    );
};
