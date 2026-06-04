import React, { useRef } from 'react';
import { Terminal, ChevronRight } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { LogEntry } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';

interface LogItemProps {
    log: LogEntry;
    cardClass: string;
}

const LogItem: React.FC<LogItemProps> = ({ log, cardClass }) => {
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
            {log.detail && (
                <div className="log-description-area custom-scrollbar">
                    {log.detail}
                </div>
            )}
        </div>
    );
};

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

    const getLogLevelStyle = (level: string) => {
        switch (level) {
            case 'llm_start': return 'log-card-llm-start';
            case 'llm_end': return 'log-card-llm-end';
            case 'tool_start': return 'log-card-tool-start';
            case 'tool_end': return 'log-card-tool-end';
            default: return 'log-card-default';
        }
    };

    return (
        <aside
            className={`log-panel-container flex flex-col shadow-inner h-full shrink-0 ${logPanelOpen
                ? 'w-1/3 min-w-[320px] border-l border-slate-700'
                : 'hidden'
                }`}
        >
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
                        data={logs}
                        followOutput={true}
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
