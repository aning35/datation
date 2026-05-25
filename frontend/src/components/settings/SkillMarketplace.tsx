import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Search, Loader2, Download, CheckCircle, Star, GitFork,
  ChevronLeft, ChevronRight, ExternalLink, AlertCircle, Store,
  ChevronDown
} from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { OCCUPATIONS } from './occupations';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:18321';
const PAGE_SIZE = 12;

interface MarketSkill {
  id: string;
  name: string;
  author: string;
  authorAvatar: string;
  description: string;
  githubUrl: string;
  stars: number;
  forks: number;
  updatedAt: string;
  path: string;
  branch: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  totalIsExact?: boolean;
  totalAll?: number;
  isCapped?: boolean;
}

interface SkillMarketplaceProps {
  isOpen: boolean;
  onClose: () => void;
  localSkillNames: string[];
  onInstalled: () => void;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function timeAgo(unixTimestamp: string): string {
  const now = Date.now() / 1000;
  const diff = now - Number(unixTimestamp);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

export const SkillMarketplace: React.FC<SkillMarketplaceProps> = ({
  isOpen,
  onClose,
  localSkillNames,
  onInstalled,
}) => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<MarketSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'stars' | 'recent'>('stars');
  const [page, setPage] = useState(1);
  const [occupation, setOccupation] = useState<string>('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [uninstallingName, setUninstallingName] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<Record<string, 'success' | 'error'>>({});
  const [skillToUninstall, setSkillToUninstall] = useState<MarketSkill | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchSkills = useCallback(async (search: string, sort: string, p: number, occ: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE_URL}/config/skills/market?page=${p}&limit=${PAGE_SIZE}&sortBy=${sort}&search=${encodeURIComponent(search)}&occupation=${encodeURIComponent(occ)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkills(data.skills || []);
      setPagination(data.pagination || null);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch skills');
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load & refetch on sort/page/occupation change
  useEffect(() => {
    if (isOpen) {
      fetchSkills(searchQuery, sortBy, page, occupation);
    }
  }, [isOpen, sortBy, page, occupation]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchSkills(searchQuery, sortBy, 1, occupation);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 100);
      // Auto expand management and computer occupations by default for good first impression
      setExpandedCategories({
        'management-occupations': true,
        'computer-and-mathematical-occupations': true
      });
    }
  }, [isOpen]);

  const getSkillKey = (skill: MarketSkill) => {
    return skill.author ? `${skill.author}-${skill.name}` : skill.name;
  };

  const handleInstall = async (skill: MarketSkill) => {
    const key = getSkillKey(skill);
    setInstallingName(key);
    try {
      const res = await fetch(`${API_BASE_URL}/config/skills/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubUrl: skill.githubUrl,
          name: skill.name,
          author: skill.author,
          branch: skill.branch,
          path: skill.path,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      setInstallStatus(prev => ({ ...prev, [key]: 'success' }));
      onInstalled();
    } catch (e: any) {
      console.error('Install failed:', e);
      setInstallStatus(prev => ({ ...prev, [key]: 'error' }));
    } finally {
      setInstallingName(null);
    }
  };

  const isInstalled = (skill: MarketSkill) => {
    const key = getSkillKey(skill);
    return localSkillNames.includes(key) || installStatus[key] === 'success';
  };

  const handleUninstall = async (skill: MarketSkill) => {
    const key = getSkillKey(skill);
    setUninstallingName(key);
    try {
      const res = await fetch(`${API_BASE_URL}/config/skills/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skill.name,
          author: skill.author,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      setInstallStatus(prev => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      onInstalled();
    } catch (e: any) {
      console.error('Uninstall failed:', e);
    } finally {
      setUninstallingName(null);
    }
  };

  const renderTotalSkillsCount = () => {
    if (!pagination) return '';
    let totalText = String(pagination.total);
    if (pagination.totalAll !== undefined && pagination.totalAll > 0) {
      totalText = String(pagination.totalAll);
    } else if (pagination.isCapped || pagination.totalIsExact === false) {
      totalText = `${pagination.total}+`;
    }
    return t('settings.skills.totalSkills').replace('{total}', totalText);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-2xl shadow-2xl w-[95vw] max-w-[1250px] h-[90vh] max-h-[850px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-orange-50 to-amber-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{t('settings.skills.marketplace')}</h2>
              {pagination && (
                <p className="text-xs text-slate-500">
                  {renderTotalSkillsCount()}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/80 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Sort Bar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('settings.skills.marketSearch')}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400 transition-all"
            />
          </div>
          <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden shrink-0">
            <button
              onClick={() => { setSortBy('stars'); setPage(1); }}
              className={`px-4 py-2.5 text-xs font-semibold transition-colors ${
                sortBy === 'stars'
                  ? 'bg-orange-500 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" />{t('settings.skills.sortByStars')}</span>
            </button>
            <button
              onClick={() => { setSortBy('recent'); setPage(1); }}
              className={`px-4 py-2.5 text-xs font-semibold transition-colors ${
                sortBy === 'recent'
                  ? 'bg-orange-500 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {t('settings.skills.sortByRecent')}
            </button>
          </div>
        </div>

        {/* Main Body Columns */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Column: Sidebar Category Filter */}
          <div className="w-72 shrink-0 border-r border-slate-200 bg-slate-50/60 overflow-y-auto flex flex-col p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">
              {t('settings.skills.filterByCategory')}
            </h3>

            {/* All Categories Button */}
            <button
              onClick={() => { setOccupation(''); setPage(1); setSearchQuery(''); }}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-xl transition-all mb-4 text-left w-full
                ${occupation === ''
                  ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/10'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'}`}
            >
              <Store className="w-4 h-4 shrink-0" />
              <span>{t('settings.skills.allCategories')}</span>
            </button>

            {/* Categories Tree */}
            <div className="flex flex-col gap-1">
              {OCCUPATIONS.map((cat) => {
                const isExpanded = !!expandedCategories[cat.slug];
                const isSelected = occupation === cat.slug;
                const hasChildren = cat.children && cat.children.length > 0;

                return (
                  <div key={cat.slug} className="flex flex-col border-b border-slate-200/60 pb-2 mb-2 last:border-b-0 last:pb-0 last:mb-0">
                    {/* Category Row */}
                    <div
                      onClick={() => { setOccupation(cat.slug); setPage(1); setSearchQuery(''); }}
                      className={`group/item flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer text-xs transition-all w-full
                        ${isSelected
                          ? 'bg-orange-50 text-orange-700 font-bold border-l-2 border-orange-500'
                          : 'text-slate-700 hover:bg-slate-100'}`}
                    >
                      <span className="flex-1 truncate pr-1" title={cat.name}>
                        {cat.name}
                      </span>
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedCategories(prev => ({ ...prev, [cat.slug]: !isExpanded }));
                          }}
                          className="p-0.5 hover:bg-slate-200 rounded transition-colors text-slate-400 hover:text-slate-600 shrink-0"
                          aria-label="Expand"
                        >
                          <ChevronDown
                            className={`w-3.5 h-3.5 transform transition-transform duration-200 ${
                              isExpanded ? 'rotate-180' : 'rotate-0'
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {/* Subcategories (expanded list) */}
                    {hasChildren && isExpanded && (
                      <div className="flex flex-col gap-0.5 mt-0.5 pl-4 border-l border-slate-200 ml-3.5 py-0.5">
                        {cat.children!.map((subcat) => {
                          const isSubSelected = occupation === subcat.slug;
                          return (
                            <div
                              key={subcat.slug}
                              onClick={() => { setOccupation(subcat.slug); setPage(1); setSearchQuery(''); }}
                              className={`px-2 py-1 rounded-md cursor-pointer text-[11px] transition-all truncate w-full
                                ${isSubSelected
                                  ? 'bg-amber-50 text-amber-700 font-semibold border-l-2 border-amber-400 pl-1.5'
                                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
                              title={subcat.name}
                            >
                              {subcat.name}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Grid of skills */}
          <div className="flex-1 overflow-y-auto px-6 py-4 bg-slate-50/20 relative">
            {/* 1. First-time loading spinner (when no skills are present yet) */}
            {loading && skills.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
                <span className="text-sm font-medium">Loading...</span>
              </div>
            )}

            {/* 2. Error State */}
            {!loading && error && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-red-400">
                <AlertCircle className="w-8 h-8" />
                <span className="text-sm">{error}</span>
                <button
                  onClick={() => fetchSkills(searchQuery, sortBy, page, occupation)}
                  className="px-4 py-2 text-xs bg-red-50 text-red-600 rounded-lg border border-red-200 hover:bg-red-100 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* 3. Empty State (when load finishes and nothing is found) */}
            {!loading && !error && skills.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <Search className="w-8 h-8" />
                <span className="text-sm">No skills found</span>
              </div>
            )}

            {/* 4. Skills Grid (rendered when we have skills, with optional loading opacity) */}
            {skills.length > 0 && (
              <div className={`grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity duration-200 ${
                loading ? 'opacity-40 pointer-events-none' : 'opacity-100'
              }`}>
                {skills.map(skill => {
                  const key = getSkillKey(skill);
                  const installed = isInstalled(skill);
                  const installing = installingName === key;
                  const uninstalling = uninstallingName === key;
                  const failed = installStatus[key] === 'error';

                  return (
                    <div
                      key={key}
                      className="group flex flex-col p-4 bg-white border border-slate-200 rounded-2xl hover:border-orange-300 hover:shadow-lg hover:shadow-orange-500/5 transition-all duration-300 relative overflow-hidden"
                    >
                      {/* Author row */}
                      <div className="flex items-center gap-2 mb-3">
                        <img
                          src={skill.authorAvatar}
                          alt={skill.author}
                          className="w-6 h-6 rounded-full bg-slate-100"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="text-xs text-slate-500 font-medium truncate">{skill.author}</span>
                        <span className="text-[10px] text-slate-300">·</span>
                        <span className="text-[10px] text-slate-400">{timeAgo(skill.updatedAt)}</span>
                      </div>

                      {/* Name */}
                      <h4 className="text-sm font-bold text-slate-800 truncate mb-1.5 group-hover:text-orange-700 transition-colors" title={skill.name}>
                        {skill.name}
                      </h4>

                      {/* Description */}
                      <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 mb-4 flex-1" title={skill.description}>
                        {skill.description || t('settings.skills.noDescription')}
                      </p>

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-3 text-[11px] text-slate-400">
                          <span className="flex items-center gap-1" title="Stars">
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                            {formatNumber(skill.stars)}
                          </span>
                          <span className="flex items-center gap-1" title="Forks">
                            <GitFork className="w-3 h-3" />
                            {formatNumber(skill.forks)}
                          </span>
                          <a
                            href={skill.githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-0.5 hover:text-slate-600 transition-colors"
                            title={t('settings.skills.viewOnGithub')}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <button
                          onClick={() => {
                            if (installing || uninstalling) return;
                            if (installed) {
                              setSkillToUninstall(skill);
                            } else {
                              handleInstall(skill);
                            }
                          }}
                          disabled={installing || uninstalling}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                            uninstalling
                              ? 'bg-red-50 text-red-500 border border-red-200 cursor-wait'
                              : installed
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-pointer hover:bg-red-50 hover:text-red-600 hover:border-red-200 group/installed'
                              : failed
                              ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                              : installing
                              ? 'bg-orange-50 text-orange-500 border border-orange-200 cursor-wait'
                              : 'bg-orange-500 text-white hover:bg-orange-600 shadow-sm hover:shadow active:scale-95'
                          }`}
                        >
                          {uninstalling ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />{t('settings.skills.uninstalling')}</>
                          ) : installed ? (
                            <>
                              <span className="flex items-center gap-1.5 group-hover/installed:hidden">
                                <CheckCircle className="w-3.5 h-3.5" />
                                {t('settings.skills.installed')}
                              </span>
                              <span className="hidden items-center gap-1.5 group-hover/installed:flex">
                                <X className="w-3.5 h-3.5 text-red-500" />
                                {t('settings.skills.uninstall')}
                              </span>
                            </>
                          ) : installing ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('settings.skills.installing')}</>
                          ) : failed ? (
                            <><AlertCircle className="w-3.5 h-3.5" />{t('settings.skills.installFailed')}</>
                          ) : (
                            <><Download className="w-3.5 h-3.5" />{t('settings.skills.install')}</>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 5. In-flight loading overlay (displays smoothly over old cards when typing new search queries) */}
            {loading && skills.length > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/10 backdrop-blur-xs gap-3 text-slate-400 z-10">
                <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
                <span className="text-sm font-medium">Loading...</span>
              </div>
            )}
          </div>
        </div>

        {/* Pagination Footer */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50/50 shrink-0">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={!pagination.hasPrev || loading}
              className="flex items-center gap-1 px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {t('settings.skills.prevPage')}
            </button>
            <span className="text-xs text-slate-500 font-medium">
              {page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!pagination.hasNext || loading}
              className="flex items-center gap-1 px-4 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('settings.skills.nextPage')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Uninstall Confirmation Modal */}
        {skillToUninstall && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-slate-100 flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-500 animate-bounce" />
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-2">
                {t('settings.skills.confirmUninstallTitle')}
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-6 px-2">
                {t('settings.skills.confirmUninstallDesc').replace('{name}', skillToUninstall.name)}
              </p>
              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={() => setSkillToUninstall(null)}
                  className="flex-1 px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  {t('settings.skills.confirmUninstallCancel')}
                </button>
                <button
                  onClick={() => {
                    handleUninstall(skillToUninstall);
                    setSkillToUninstall(null);
                  }}
                  className="flex-1 px-4 py-2 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-md shadow-red-500/10 hover:shadow-lg active:scale-95 transition-all"
                >
                  {t('settings.skills.confirmUninstallConfirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
