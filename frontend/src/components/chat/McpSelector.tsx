import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

interface McpSelectorProps {
  mcpServers: string[];
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

  const toggleServer = (server: string) => {
    if (enabledMcpServers.includes(server)) {
      setEnabledMcpServers(enabledMcpServers.filter(s => s !== server));
    } else {
      setEnabledMcpServers([...enabledMcpServers, server]);
    }
  };

  const toggleAll = () => {
    if (enabledMcpServers.length === mcpServers.length) {
      setEnabledMcpServers([]);
    } else {
      setEnabledMcpServers(mcpServers);
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
          {enabledMcpServers.length === mcpServers.length ? t('chat.deselectAll') : t('chat.selectAll')}
        </button>
      </div>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {mcpServers.map(server => (
          <button
            key={server}
            onClick={() => toggleServer(server)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-left"
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center ${
              enabledMcpServers.includes(server)
                ? 'bg-blue-500 border-blue-500'
                : 'border-slate-300'
            }`}>
              {enabledMcpServers.includes(server) && (
                <Check className="w-3 h-3 text-white" />
              )}
            </div>
            <span className="text-sm text-slate-700">{server}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
