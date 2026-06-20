import React, { useEffect, useRef } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import type { McpServerInfo } from './ChatInput';

interface McpSelectorProps {
  mcpServers: McpServerInfo[];
  enabledMcpServers: string[];
  setEnabledMcpServers: (servers: string[]) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const McpSelector: React.FC<McpSelectorProps> = ({
  mcpServers,
  enabledMcpServers,
  setEnabledMcpServers,
  isOpen,
  onClose
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

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

  if (!isOpen) return null;

  const toggleServer = (server: McpServerInfo) => {
    if (server.status === 'error') return; // Cannot toggle servers in error state
    if (enabledMcpServers.includes(server.name)) {
      setEnabledMcpServers(enabledMcpServers.filter(s => s !== server.name));
    } else {
      setEnabledMcpServers([...enabledMcpServers, server.name]);
    }
  };

  const toggleAll = () => {
    const validServers = mcpServers.filter(s => s.status !== 'error').map(s => s.name);
    // If all valid servers are enabled, disable them all.
    // Otherwise, enable all valid servers.
    const allValidEnabled = validServers.length > 0 && validServers.every(name => enabledMcpServers.includes(name));
    
    if (allValidEnabled) {
      setEnabledMcpServers([]);
    } else {
      setEnabledMcpServers(validServers);
    }
  };

  return (
    <div ref={containerRef} className="absolute bottom-full mb-2 right-0 bg-white rounded-lg shadow-lg border border-slate-200 p-3 min-w-[280px] z-50">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
        <span className="text-sm font-medium text-slate-700">{t('chat.selectMcp')}</span>
        <button
          onClick={toggleAll}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          {enabledMcpServers.length >= mcpServers.filter(s => s.status !== 'error').length && mcpServers.filter(s => s.status !== 'error').length > 0 ? t('chat.deselectAll') : t('chat.selectAll')}
        </button>
      </div>
      <div className="space-y-1 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
        {mcpServers.map(server => (
          <button
            key={server.name}
            onClick={() => toggleServer(server)}
            disabled={server.status === 'error'}
            title={server.error || undefined}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left ${
              server.status === 'error' ? 'opacity-60 cursor-not-allowed bg-red-50/50' : 'hover:bg-slate-50'
            }`}
          >
            <div className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
              enabledMcpServers.includes(server.name) && server.status !== 'error'
                ? 'bg-blue-500 border-blue-500'
                : server.status === 'error'
                  ? 'border-red-300 bg-red-100'
                  : 'border-slate-300 bg-white'
            }`}>
              {enabledMcpServers.includes(server.name) && server.status !== 'error' && (
                <Check className="w-3 h-3 text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-sm block truncate ${server.status === 'error' ? 'text-red-700' : 'text-slate-700'}`}>
                {server.name}
              </span>
              {server.status === 'error' && (
                <span className="text-[10px] text-red-500 block truncate" title={server.error || ''}>
                  {server.error || 'Connection failed'}
                </span>
              )}
            </div>
            {server.status === 'error' && (
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            )}
          </button>
        ))}
        {mcpServers.length === 0 && (
          <div className="text-sm text-slate-500 text-center py-4">No MCP servers found</div>
        )}
      </div>
    </div>
  );
};
