import React, { useState, useEffect, useCallback } from 'react';
import { X, Folder, File as FileIcon, ArrowUp, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:18321';

interface FSEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FileBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'directory' | 'file';
  initialPath?: string;
  onSelect: (path: string) => void;
  title?: string;
}

export const FileBrowserModal: React.FC<FileBrowserModalProps> = ({
  isOpen,
  onClose,
  mode,
  initialPath = '',
  onSelect,
  title
}) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FSEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorDesc, setErrorDesc] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setErrorDesc(null);
    try {
      const res = await fetch(`${API_BASE_URL}/config/fs/list?path=${encodeURIComponent(path)}&mode=${mode}`);
      if (!res.ok) {
        throw new Error('Failed to load directory');
      }
      const data = await res.json();
      setCurrentPath(data.current_path);
      setParentPath(data.parent_path);
      setEntries(data.entries);
    } catch (e: any) {
      setErrorDesc(typeof e === 'string' ? e : e.message || '加载目录失败');
    } finally {
      setIsLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath);
    }
  }, [isOpen, initialPath, loadDirectory]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[70vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              {mode === 'directory' ? <Folder className="w-5 h-5" /> : <FileIcon className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 leading-tight">
                {title || (mode === 'directory' ? 'Select Directory' : 'Select File')}
              </h2>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col min-h-0 bg-white">
          <div className="p-4 border-b border-slate-100 bg-white shrink-0 flex items-center gap-3">
            <button
              onClick={() => parentPath && loadDirectory(parentPath)}
              disabled={!parentPath || isLoading}
              className="p-2 text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Go Up"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <div className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 font-mono overflow-x-auto whitespace-nowrap scrollbar-hide">
              {currentPath || '...'}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {errorDesc && (
              <div className="m-2 bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {errorDesc}
              </div>
            )}
            
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <p className="text-sm">Loading...</p>
              </div>
            ) : entries.length === 0 && !errorDesc ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <Folder className="w-8 h-8 text-slate-300" />
                <p className="text-sm">No items found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1">
                {entries.map((entry, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      if (entry.is_dir) {
                        loadDirectory(entry.path);
                      } else {
                        onSelect(entry.path);
                        onClose();
                      }
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg transition-colors text-left"
                  >
                    {entry.is_dir ? (
                      <Folder className="w-5 h-5 text-blue-400 shrink-0" />
                    ) : (
                      <FileIcon className="w-5 h-5 text-slate-400 shrink-0" />
                    )}
                    <span className={`text-sm truncate ${entry.is_dir ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                      {entry.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          {mode === 'directory' && (
            <button
              onClick={() => {
                onSelect(currentPath);
                onClose();
              }}
              disabled={isLoading || !currentPath}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" /> Select Directory
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
