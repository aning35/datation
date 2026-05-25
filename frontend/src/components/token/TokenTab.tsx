import React, { useMemo } from 'react';
import { Zap, ArrowDownCircle, ArrowUpCircle, Activity, Hash, TrendingUp } from 'lucide-react';
import type { LogEntry } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';

interface TokenTabProps {
  logs: LogEntry[];
}

interface AgentStats {
  name: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export const TokenTab: React.FC<TokenTabProps> = ({ logs }) => {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const llmLogs = logs.filter(l => l.level === 'llm_end');
    let totalIn = 0;
    let totalOut = 0;
    const agentMap = new Map<string, AgentStats>();

    for (const log of llmLogs) {
      const inT = log.input_tokens || 0;
      const outT = log.output_tokens || 0;
      totalIn += inT;
      totalOut += outT;

      // Group by node (agent name)
      // node format: "DataAnalyst:executor:agent" or "Supervisor" etc.
      const nodeName = log.node || 'unknown';
      const parts = nodeName.split(':');
      // Use the most meaningful segment for grouping
      const FRIENDLY_NAMES: Record<string, string> = {
        'Supervisor': '路由决策 (Supervisor)',
        'RequirementsAnalyst': '需求分析 (Analyst)',
        'ReportGenerator': '报告生成 (Reporter)',
        'QAAgent': '问答助手 (QA)',
        'SkillExecutor': '技能执行 (Skill)',
        'planner': '任务规划 (Planner)',
        'replanner': '任务规划 (Planner)',
        'agent': '任务执行 (Executor)',
        'reviewer': '执行审查 (Reviewer)',
      };
      // Pick the best identifier: prefer the second-to-last meaningful part
      const rawKey = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
      const agentName = FRIENDLY_NAMES[rawKey] || rawKey;
      
      if (!agentMap.has(agentName)) {
        agentMap.set(agentName, { name: agentName, inputTokens: 0, outputTokens: 0, calls: 0 });
      }
      const agent = agentMap.get(agentName)!;
      agent.inputTokens += inT;
      agent.outputTokens += outT;
      agent.calls += 1;
    }

    const agents = Array.from(agentMap.values()).sort((a, b) => 
      (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)
    );

    return {
      totalIn,
      totalOut,
      totalCalls: llmLogs.length,
      agents,
    };
  }, [logs]);

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  };

  const total = stats.totalIn + stats.totalOut;

  if (stats.totalCalls === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 px-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-200">
          <Zap className="w-7 h-7 text-slate-300" />
        </div>
        <p className="text-sm font-medium">{t('token.empty')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-5 space-y-5">

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownCircle className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-blue-600 uppercase tracking-wide">{t('token.input')}</span>
          </div>
          <p className="text-2xl font-bold text-blue-800">{formatNumber(stats.totalIn)}</p>
          <p className="text-[11px] text-blue-500 mt-1">{stats.totalIn.toLocaleString()} tokens</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpCircle className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-600 uppercase tracking-wide">{t('token.output')}</span>
          </div>
          <p className="text-2xl font-bold text-emerald-800">{formatNumber(stats.totalOut)}</p>
          <p className="text-[11px] text-emerald-500 mt-1">{stats.totalOut.toLocaleString()} tokens</p>
        </div>
        <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-violet-500" />
            <span className="text-xs font-medium text-violet-600 uppercase tracking-wide">{t('token.total')}</span>
          </div>
          <p className="text-2xl font-bold text-violet-800">{formatNumber(total)}</p>
          <p className="text-[11px] text-violet-500 mt-1">{total.toLocaleString()} tokens</p>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-amber-600 uppercase tracking-wide">{t('token.calls')}</span>
          </div>
          <p className="text-2xl font-bold text-amber-800">{stats.totalCalls}</p>
          <p className="text-[11px] text-amber-500 mt-1">LLM {t('token.calls').toLowerCase()}</p>
        </div>
      </div>

      {/* Agent Breakdown */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">{t('token.breakdown')}</h3>
        </div>
        <div className="space-y-2">
          {stats.agents.map((agent) => {
            const agentTotal = agent.inputTokens + agent.outputTokens;
            const pct = total > 0 ? (agentTotal / total * 100) : 0;
            return (
              <div key={agent.name} className="bg-white rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{agent.name}</span>
                  <span className="text-[11px] text-slate-400 font-medium">{agent.calls} calls · {pct.toFixed(1)}%</span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                  <div className="h-2 rounded-full flex overflow-hidden">
                    <div
                      className="bg-blue-400 h-full transition-all duration-500"
                      style={{ width: total > 0 ? `${(agent.inputTokens / total) * 100}%` : '0%' }}
                    />
                    <div
                      className="bg-emerald-400 h-full transition-all duration-500"
                      style={{ width: total > 0 ? `${(agent.outputTokens / total) * 100}%` : '0%' }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                    {t('token.input')}: {formatNumber(agent.inputTokens)}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    {t('token.output')}: {formatNumber(agent.outputTokens)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
