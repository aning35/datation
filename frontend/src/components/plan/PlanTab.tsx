import React, { useState } from 'react';
import { ClipboardList, CheckCircle2, Circle, ArrowRight, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

interface PlanTabProps {
    currentPlan: string[];
    completedTasks: [string, any][];
    isProcessing: boolean;
}

export const PlanTab: React.FC<PlanTabProps> = ({
    currentPlan,
    completedTasks,
    isProcessing,
}) => {
    const { t } = useTranslation();
    const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

    const toggleStep = (idx: number) => {
        const next = new Set(expandedSteps);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        setExpandedSteps(next);
    };

    const totalSteps = completedTasks.length + currentPlan.length;
    const progress = totalSteps > 0 ? Math.round((completedTasks.length / totalSteps) * 100) : 0;

    return (
        <div className="h-full overflow-auto p-4 sm:p-6">
            <div className="max-w-3xl mx-auto space-y-6">

                {/* Header Card */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                                <ClipboardList className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-slate-800">{t('plan.title')}</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {t('plan.progress').replace('{completed}', String(completedTasks.length)).replace('{total}', String(totalSteps))}
                                </p>
                            </div>
                        </div>
                        {isProcessing && (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                                {t('plan.running')}
                            </span>
                        )}
                    </div>

                    {/* Progress Bar */}
                    <div className="px-5 py-3 bg-slate-50/50">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-700 ease-out"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="text-xs font-bold text-slate-600 tabular-nums w-10 text-right">{progress}%</span>
                        </div>
                    </div>
                </div>

                {/* Completed Steps */}
                {completedTasks.length > 0 && (
                    <div className="space-y-1.5">
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            {t('plan.completedSteps')} ({completedTasks.length})
                        </h3>
                        <div className="space-y-1">
                            {completedTasks.map(([stepName, result], idx) => {
                                const isExpanded = expandedSteps.has(idx);
                                const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                                const hasResult = resultText && resultText.length > 0;
                                return (
                                    <div
                                        key={`done-${idx}`}
                                        className="bg-white rounded-lg border border-slate-150 shadow-sm overflow-hidden"
                                    >
                                        <button
                                            onClick={() => hasResult && toggleStep(idx)}
                                            className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${hasResult ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'}`}
                                        >
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                            <span className="text-sm text-slate-700 flex-1 line-clamp-1">{stepName}</span>
                                            {hasResult && (
                                                isExpanded
                                                    ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                    : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            )}
                                        </button>
                                        {isExpanded && hasResult && (
                                            <div className="px-4 pb-3 pt-0">
                                                <div className="bg-slate-50 rounded-md p-3 text-xs text-slate-600 font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto border border-slate-100">
                                                    {resultText}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Remaining Plan */}
                {currentPlan.length > 0 && (
                    <div className="space-y-1.5">
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-blue-500" />
                            {t('plan.remainingSteps')} ({currentPlan.length})
                        </h3>
                        <div className="space-y-1">
                            {currentPlan.map((step, idx) => {
                                const isActive = idx === 0 && isProcessing;
                                return (
                                    <div
                                        key={`plan-${idx}`}
                                        className={`bg-white rounded-lg border shadow-sm px-4 py-2.5 flex items-center gap-3 transition-all ${
                                            isActive
                                                ? 'border-blue-300 bg-blue-50/40 ring-1 ring-blue-200'
                                                : 'border-slate-150'
                                        }`}
                                    >
                                        {isActive ? (
                                            <ArrowRight className="w-4 h-4 text-blue-500 shrink-0 animate-pulse" />
                                        ) : (
                                            <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                                        )}
                                        <span className={`text-sm flex-1 ${isActive ? 'text-blue-700 font-medium' : 'text-slate-500'}`}>
                                            {step}
                                        </span>
                                        {isActive && (
                                            <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full border border-blue-200">
                                                {t('plan.executing')}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Empty State */}
                {completedTasks.length === 0 && currentPlan.length === 0 && (
                    <div className="text-center py-16">
                        <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm text-slate-500">{t('plan.empty')}</p>
                        <p className="text-xs text-slate-400 mt-1">{t('plan.emptyHint')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};
