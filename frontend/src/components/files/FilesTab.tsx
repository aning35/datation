import React, { useState, useEffect, useRef, useMemo } from 'react';
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, FileText, Loader2, Search, Download, FileDown, Table2, ZoomIn, ZoomOut, RotateCcw, Sun, Moon, Printer } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Virtuoso } from 'react-virtuoso';
import { useTranslation } from '../../i18n/useTranslation';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:18321';

interface FileNode {
    name: string;
    type: 'file' | 'directory';
    path: string;
    size?: number;
    children?: FileNode[];
}

interface FlatNode extends FileNode {
    depth: number;
}

interface FilesTabProps {
    threadId: string | null;
    isActive?: boolean;
}

export const FilesTab: React.FC<FilesTabProps> = ({ threadId, isActive }) => {
    const { t } = useTranslation();
    const [files, setFiles] = useState<FileNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [contentLoading, setContentLoading] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));
    const [csvViewMode, setCsvViewMode] = useState<'text' | 'table'>('table');
    const [processedHtml, setProcessedHtml] = useState<string>('');
    const [truncationInfo, setTruncationInfo] = useState<{totalLines: number; shownLines: number} | null>(null);
    const htmlPreviewRef = useRef<HTMLDivElement>(null);
    // SVG preview state
    const [svgZoom, setSvgZoom] = useState(100);
    const [svgDarkBg, setSvgDarkBg] = useState(false);

    const handleDownload = async () => {
        if (!threadId || !selectedFile) return;
        try {
            const url = `${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${encodeURIComponent(selectedFile)}`;
            const filename = selectedFile.split('/').pop() || 'download';

            // Browser environment download logic
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e) {
            console.error('Download failed:', e);
            alert(t('files.download') + ' failed');
        }
    };

    const handleOpenInNewTab = async () => {
        if (!threadId || !selectedFile) return;
        const url = `${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${encodeURIComponent(selectedFile)}`;
        window.open(url, '_blank');
    };

    const handlePrint = () => {
        if (!selectedFile) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const filename = selectedFile.split('/').pop() || 'Print';

        if (isHtmlFile) {
            let htmlToPrint = processedHtml || fileContent || '';
            if (htmlToPrint.includes('</body>')) {
                htmlToPrint = htmlToPrint.replace('</body>', '<script>window.onload = function() { window.print(); };</script></body>');
            } else {
                htmlToPrint += '<script>window.onload = function() { window.print(); };</script>';
            }
            printWindow.document.write(htmlToPrint);
            printWindow.document.close();
            return;
        }

        const escapeHtml = (text: string) => {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        let bodyHtml = '';

        if (isMarkdown) {
            const mdEl = document.querySelector('.markdown-content');
            bodyHtml = mdEl ? mdEl.innerHTML : `<pre style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(fileContent || '')}</pre>`;
        } else if (isCsvFile && csvViewMode === 'table') {
            const tableEl = document.querySelector('table');
            bodyHtml = tableEl ? tableEl.outerHTML : `<pre style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(fileContent || '')}</pre>`;
        } else {
            bodyHtml = `<pre style="white-space: pre-wrap; font-family: monospace; font-size: 13px; line-height: 1.5; color: #334155; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">${escapeHtml(fileContent || '')}</pre>`;
        }

        printWindow.document.write(`
            <html>
                <head>
                    <title>${filename}</title>
                    <style>
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                            line-height: 1.6;
                            color: #1e293b;
                            padding: 40px;
                            max-width: 800px;
                            margin: 0 auto;
                        }
                        pre {
                            white-space: pre-wrap;
                            word-wrap: break-word;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin: 20px 0;
                        }
                        th, td {
                            border: 1px solid #e2e8f0;
                            padding: 8px 12px;
                            text-align: left;
                        }
                        tr:nth-child(even) {
                            background-color: #f8fafc;
                        }
                        img {
                            max-width: 100%;
                            height: auto;
                        }
                        h1, h2, h3, h4, h5, h6 {
                            color: #0f172a;
                            margin-top: 24px;
                            margin-bottom: 12px;
                            font-weight: 700;
                        }
                        h1 { font-size: 2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
                        h2 { font-size: 1.5em; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
                        h3 { font-size: 1.25em; }
                        ul, ol { padding-left: 20px; }
                        code {
                            background-color: #f1f5f9;
                            padding: 2px 4px;
                            border-radius: 4px;
                            font-family: monospace;
                            font-size: 0.9em;
                        }
                        blockquote {
                            border-left: 4px solid #cbd5e1;
                            padding-left: 16px;
                            color: #64748b;
                            margin-left: 0;
                            font-style: italic;
                        }
                        @media print {
                            body {
                                padding: 20px 0;
                                max-width: 100%;
                                width: 100%;
                            }
                            button, .no-print {
                                display: none !important;
                            }
                        }
                    </style>
                </head>
                <body>
                    ${bodyHtml}
                    <script>
                        window.onload = function() {
                            window.print();
                        };
                    </script>
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    useEffect(() => {
        setFiles([]);
        setSelectedFile(null);
        setFileContent(null);
        setExpandedFolders(new Set(['']));

        if (threadId) {
            fetchFiles();
        }
    }, [threadId]);

    // Auto-refresh when tab becomes active
    useEffect(() => {
        if (isActive && threadId) {
            fetchFiles();
        }
    }, [isActive]);

    const fetchFiles = async () => {
        if (!threadId) return;
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/files/list?thread_id=${threadId}`);
            const data = await res.json();
            setFiles(data.files || []);
        } catch (e) {
            console.error('Failed to fetch files:', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchFileContent = async (path: string) => {
        if (!threadId) return;

        const isImg = isImage(path);
        const isSvgPath = isSvg(path);
        const isPdfPath = isPdf(path);
        const isOfficePath = isOffice(path);
        setSelectedFile(path);
        setProcessedHtml('');

        // Images, SVGs, audio, video, PDF, Office files use raw URL for direct display, no need to fetch text content
        if (isImg || isSvgPath || isAudio(path) || isVideo(path) || isPdfPath || isOfficePath) {
            setFileContent(null);
            if (isSvgPath) { setSvgZoom(100); }
            return;
        }

        setContentLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/files/content?thread_id=${threadId}&file_path=${path}`);
            const data = await res.json();
            setFileContent(data.content);
            setTruncationInfo(data.truncated ? { totalLines: data.total_lines, shownLines: data.shown_lines } : null);

            if (path.toLowerCase().endsWith('.html')) {
                setProcessedHtml(processHtmlContent(data.content, path));
            }
        } catch (e) {
            console.error('Failed to fetch file content:', e);
            setFileContent('Error loading file content.');
        } finally {
            setContentLoading(false);
        }
    };

    const toggleFolder = (path: string) => {
        const newExpanded = new Set(expandedFolders);
        if (newExpanded.has(path)) {
            newExpanded.delete(path);
        } else {
            newExpanded.add(path);
        }
        setExpandedFolders(newExpanded);
    };

    const isImage = (path: string | null) => {
        const ext = path?.toLowerCase().split('.').pop();
        return ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '');
    };
    const isSvg = (path: string | null) => path?.toLowerCase().endsWith('.svg');
    const isAudio = (path: string | null) => {
        const ext = path?.toLowerCase().split('.').pop();
        return ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'].includes(ext || '');
    };
    const isVideo = (path: string | null) => {
        const ext = path?.toLowerCase().split('.').pop();
        return ['mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv'].includes(ext || '');
    };

    const isHtml = (path: string | null) => path?.toLowerCase().endsWith('.html');
    const isCsv = (path: string | null) => path?.toLowerCase().endsWith('.csv');
    const isPdf = (path: string | null) => path?.toLowerCase().endsWith('.pdf');
    const isOffice = (path: string | null) => {
        const ext = path?.toLowerCase().split('.').pop();
        return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext || '');
    };

    const parseCsv = (content: string) => {
        const lines = content.trim().split('\n');
        return lines.map(line => {
            const cells: string[] = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    cells.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            cells.push(current.trim());
            return cells;
        });
    };

    const processHtmlContent = (html: string, filePath: string) => {
        if (!threadId || !filePath) return html;
        const baseDir = filePath.substring(0, filePath.lastIndexOf('/'));
        return html.replace(
            /(src|href)=["'](?!http|data:)([^"']+)["']/gi,
            (match, attr, path) => {
                if (path.includes('/files/raw?')) return match;
                let fullPath = path;
                if (!path.startsWith('/')) {
                    fullPath = baseDir ? `${baseDir}/${path}` : path;
                } else {
                    fullPath = path.slice(1);
                }
                fullPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
                return `${attr}="${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${encodeURIComponent(fullPath)}"`;
            }
        );
    };

    const processMarkdownContent = (markdown: string) => {
        if (!threadId || !selectedFile) return markdown;
        const baseDir = selectedFile.substring(0, selectedFile.lastIndexOf('/'));
        return markdown.replace(
            /!\[([^\]]*)\]\((?!http|data:)([^)]+)\)/g,
            (_match, alt, path) => {
                let fullPath = path;
                if (!path.startsWith('/')) {
                    fullPath = baseDir ? `${baseDir}/${path}` : path;
                } else {
                    fullPath = path.slice(1);
                }
                fullPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
                return `![${alt}](${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${encodeURIComponent(fullPath)})`;
            }
        );
    };

    const flattenTree = (nodes: FileNode[], depth = 0): FlatNode[] => {
        const result: FlatNode[] = [];
        for (const node of nodes) {
            result.push({ ...node, depth });
            if (node.type === 'directory' && expandedFolders.has(node.path) && node.children) {
                result.push(...flattenTree(node.children, depth + 1));
            }
        }
        return result;
    };

    const flatNodes = useMemo(() => flattenTree(files), [files, expandedFolders]);

    const hasReport = useMemo(() => {
        const findReport = (nodes: FileNode[]): boolean => {
            for (const node of nodes) {
                if (node.type === 'file' && node.name.toLowerCase() === 'report.html') {
                    return true;
                }
                if (node.type === 'directory' && node.children) {
                    if (findReport(node.children)) return true;
                }
            }
            return false;
        };
        return findReport(files);
    }, [files]);

    const openReport = () => {
        if (!threadId) return;
        const findReportPath = (nodes: FileNode[]): string | null => {
            for (const node of nodes) {
                if (node.type === 'file' && node.name.toLowerCase() === 'report.html') {
                    return node.path;
                }
                if (node.type === 'directory' && node.children) {
                    const found = findReportPath(node.children);
                    if (found) return found;
                }
            }
            return null;
        };
        const reportPath = findReportPath(files);
        if (!reportPath) return;

        const url = `${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${encodeURIComponent(reportPath)}`;
        window.open(url, '_blank');
    };

    const renderTreeNodes = (nodes: FileNode[], depth = 0) => {
        return nodes.map((node) => {
            const isExpanded = expandedFolders.has(node.path);
            const isSelected = selectedFile === node.path;

            if (node.type === 'directory') {
                return (
                    <div key={node.path}>
                        <div
                            onClick={() => toggleFolder(node.path)}
                            className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-100 rounded cursor-pointer text-sm text-slate-700 transition-colors"
                            style={{ paddingLeft: `${depth * 16 + 8}px` }}
                        >
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                            {isExpanded ? <FolderOpen className="w-4 h-4 text-blue-500" /> : <Folder className="w-4 h-4 text-blue-500" />}
                            <span className="truncate font-medium">{node.name}</span>
                        </div>
                        {isExpanded && node.children && renderTreeNodes(node.children, depth + 1)}
                    </div>
                );
            } else {
                return (
                    <div
                        key={node.path}
                        onClick={() => fetchFileContent(node.path)}
                        className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer text-sm transition-colors ${isSelected ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-50 text-slate-600'
                            }`}
                        style={{ paddingLeft: `${depth * 16 + 28}px` }}
                    >
                        <FileText className={`w-4 h-4 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                        <span className="truncate">{node.name}</span>
                        {node.size !== undefined && (
                            <span className="ml-auto text-[10px] text-slate-400 font-normal">
                                {(node.size / 1024).toFixed(1)} KB
                            </span>
                        )}
                    </div>
                );
            }
        });
    };

    const isMarkdown = selectedFile?.toLowerCase().endsWith('.md');
    const isImg = isImage(selectedFile);
    const isSvgFile = isSvg(selectedFile);
    const isAudioFile = isAudio(selectedFile);
    const isVideoFile = isVideo(selectedFile);
    const isHtmlFile = isHtml(selectedFile);
    const isCsvFile = isCsv(selectedFile);
    const isPdfFile = isPdf(selectedFile);
    const isOfficeFile = isOffice(selectedFile);

    return (
        <div className="flex bg-white border-t border-slate-200 overflow-hidden h-full">
            {/* Sidebar: File Tree */}
            <div className="w-1/3 border-r border-slate-200 flex flex-col bg-slate-50/50">
                <div className="h-11 px-3 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Folder className="w-4 h-4 text-slate-500" />
                        {t('files.title')}
                    </h3>
                    <div className="flex items-center gap-2">
                        {hasReport && (
                            <button
                                onClick={openReport}
                                className="text-xs px-2.5 py-1 bg-green-50 border border-green-200 hover:bg-green-100 rounded-lg text-green-700 transition-colors flex items-center gap-1.5 font-medium"
                                title="Open Report"
                            >
                                <FileDown className="w-3.5 h-3.5" />
                                Report
                            </button>
                        )}
                        <button
                            onClick={fetchFiles}
                            className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors"
                            title={t('workflow.refresh')}
                        >
                            <Loader2 className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-hidden p-2">
                    {loading && files.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-slate-400 text-sm gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('files.loading')}
                        </div>
                    ) : files.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm gap-2 py-10">
                            <Search className="w-8 h-8 text-slate-200" />
                            {t('files.noFiles')}
                        </div>
                    ) : (
                        <Virtuoso
                            data={flatNodes}
                            itemContent={(_index, node) => {
                                const isExpanded = expandedFolders.has(node.path);
                                const isSelected = selectedFile === node.path;

                                if (node.type === 'directory') {
                                    return (
                                        <div
                                            onClick={() => toggleFolder(node.path)}
                                            className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-100 rounded cursor-pointer text-sm text-slate-700 transition-colors"
                                            style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
                                        >
                                            {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                            {isExpanded ? <FolderOpen className="w-4 h-4 text-blue-500" /> : <Folder className="w-4 h-4 text-blue-500" />}
                                            <span className="truncate font-medium">{node.name}</span>
                                        </div>
                                    );
                                } else {
                                    return (
                                        <div
                                            onClick={() => fetchFileContent(node.path)}
                                            className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer text-sm transition-colors ${isSelected ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-50 text-slate-600'}`}
                                            style={{ paddingLeft: `${node.depth * 16 + 28}px` }}
                                        >
                                            <FileText className={`w-4 h-4 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                                            <span className="truncate">{node.name}</span>
                                            {node.size !== undefined && (
                                                <span className="ml-auto text-[10px] text-slate-400 font-normal">
                                                    {(node.size / 1024).toFixed(1)} KB
                                                </span>
                                            )}
                                        </div>
                                    );
                                }
                            }}
                        />
                    )}
                </div>
            </div>

            {/* Main Area: Content Viewer */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                <div className="h-11 px-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/30 shrink-0">
                    <span className="text-xs font-medium text-slate-500 truncate mr-2 leading-7">
                        {selectedFile ? `Viewing: ${selectedFile}` : t('files.noFiles')}
                    </span>
                    <div className="flex items-center gap-2">
                        {isCsvFile && (
                            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md overflow-hidden">
                                <button
                                    onClick={() => setCsvViewMode('table')}
                                    className={`flex items-center gap-1 px-2 py-1 text-[11px] font-bold transition-all ${csvViewMode === 'table' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    <Table2 className="w-3.5 h-3.5" />
                                    Table
                                </button>
                                <button
                                    onClick={() => setCsvViewMode('text')}
                                    className={`flex items-center gap-1 px-2 py-1 text-[11px] font-bold transition-all ${csvViewMode === 'text' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    <FileText className="w-3.5 h-3.5" />
                                    Text
                                </button>
                            </div>
                        )}
                        {isSvgFile && (
                            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md overflow-hidden">
                                <button
                                    onClick={() => setSvgZoom(z => Math.max(z - 25, 25))}
                                    className="p-1 text-slate-500 hover:bg-slate-50 transition-colors"
                                    title="Zoom Out"
                                >
                                    <ZoomOut className="w-3.5 h-3.5" />
                                </button>
                                <span className="text-[10px] font-mono text-slate-600 w-8 text-center">{svgZoom}%</span>
                                <button
                                    onClick={() => setSvgZoom(z => Math.min(z + 25, 400))}
                                    className="p-1 text-slate-500 hover:bg-slate-50 transition-colors"
                                    title="Zoom In"
                                >
                                    <ZoomIn className="w-3.5 h-3.5" />
                                </button>
                                <div className="w-px h-4 bg-slate-200" />
                                <button
                                    onClick={() => { setSvgZoom(100); }}
                                    className="p-1 text-slate-500 hover:bg-slate-50 transition-colors"
                                    title="Reset"
                                >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                                <div className="w-px h-4 bg-slate-200" />
                                <button
                                    onClick={() => setSvgDarkBg(v => !v)}
                                    className="p-1 text-slate-500 hover:bg-slate-50 transition-colors"
                                    title="Toggle Background"
                                >
                                    {svgDarkBg ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                                </button>
                            </div>
                        )}
                        {(isHtmlFile || isSvgFile || isPdfFile) && (
                            <button
                                onClick={handleOpenInNewTab}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-green-600 hover:border-green-200 transition-all shadow-sm group"
                                title={t('files.open')}
                            >
                                <FileDown className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                                <span>{t('files.open')}</span>
                            </button>
                        )}
                        {selectedFile && !isImg && !isSvgFile && !isAudioFile && !isVideoFile && !isPdfFile && !isOfficeFile && (
                            <button
                                onClick={handlePrint}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm group"
                                title={t('files.exportPdf') || 'Print / Export PDF'}
                            >
                                <Printer className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                                <span>{t('files.exportPdf') || 'Print'}</span>
                            </button>
                        )}
                        {selectedFile && (
                            <button
                                onClick={handleDownload}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm group"
                                title={t('files.download')}
                            >
                                <Download className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                                <span>{t('files.download')}</span>
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto w-full">
                    {contentLoading ? (
                        <div className="flex items-center justify-center h-full text-slate-400 gap-2">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                            <span>{t('files.loading')}</span>
                        </div>
                    ) : selectedFile ? (
                        <div className={`h-full w-full ${isImg || isSvgFile || isAudioFile || isVideoFile || isOfficeFile ? 'flex items-center justify-center' : ''}`}>
                            {isSvgFile ? (
                                <div className={`w-full h-full overflow-auto flex items-center justify-center transition-colors duration-200 ${svgDarkBg ? 'bg-slate-800' : 'bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:20px_20px]'}`}>
                                    <iframe
                                        src={`${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${selectedFile}`}
                                        title={selectedFile.split('/').pop()}
                                        className="border-0"
                                        style={{
                                            width: `${1280 * svgZoom / 100}px`,
                                            height: `${720 * svgZoom / 100}px`,
                                            maxWidth: 'none',
                                            transformOrigin: 'center',
                                        }}
                                    />
                                </div>
                            ) : isPdfFile ? (
                                <div className="w-full h-full bg-slate-100 overflow-hidden">
                                    <iframe
                                        src={`${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${encodeURIComponent(selectedFile)}`}
                                        className="w-full h-full border-0"
                                        title="PDF Preview"
                                    />
                                </div>
                            ) : isOfficeFile ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 gap-6 p-8 select-none text-center">
                                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-slate-100 flex items-center justify-center shadow-md hover:scale-105 transition-all duration-200">
                                        <div className="relative">
                                            <FileText className="w-12 h-12 text-blue-600 animate-pulse" />
                                            <div className="absolute -bottom-1.5 -right-1.5 px-1.5 py-0.5 bg-blue-600 text-[10px] font-bold text-white rounded font-mono uppercase tracking-wider shadow">
                                                {selectedFile.split('.').pop() || 'DOC'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="max-w-md space-y-2">
                                        <h4 className="text-sm font-semibold text-slate-800 truncate px-4">
                                            {selectedFile.split('/').pop()}
                                        </h4>
                                        <p className="text-xs text-slate-500 leading-relaxed px-6">
                                            {t('files.officeNotSupported')}
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleDownload}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl shadow-lg shadow-blue-100 hover:shadow-blue-200 hover:from-blue-700 hover:to-indigo-700 transition-all font-semibold text-xs active:scale-95 duration-150 transform"
                                    >
                                        <Download className="w-4 h-4" />
                                        <span>{t('files.downloadToView')}</span>
                                    </button>
                                </div>
                            ) : isVideoFile ? (
                                <div className="w-full h-full flex items-center justify-center bg-slate-900 p-4">
                                    <video
                                        src={`${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${selectedFile}`}
                                        controls
                                        className="max-w-full max-h-full rounded-lg shadow-2xl"
                                        style={{ maxHeight: 'calc(100% - 16px)' }}
                                    >
                                        Your browser does not support the video tag.
                                    </video>
                                </div>
                            ) : isAudioFile ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 gap-4 p-8">
                                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-200">
                                        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                        </svg>
                                    </div>
                                    <span className="text-sm font-medium text-slate-600 truncate max-w-[280px]">{selectedFile.split('/').pop()}</span>
                                    <audio
                                        src={`${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${selectedFile}`}
                                        controls
                                        className="w-full max-w-md"
                                    >
                                        Your browser does not support the audio tag.
                                    </audio>
                                </div>
                            ) : isImg ? (
                                <div className="max-w-full max-h-full overflow-auto flex items-center justify-center bg-slate-50 rounded-lg p-4 border border-slate-100">
                                    <img
                                        src={`${API_BASE_URL}/files/raw?thread_id=${threadId}&file_path=${selectedFile}`}
                                        alt={selectedFile.split('/').pop()}
                                        className="max-w-full h-auto shadow-sm rounded shadow-slate-200"
                                    />
                                </div>
                            ) : isHtmlFile ? (
                                <div ref={htmlPreviewRef} className="w-full h-full overflow-auto bg-white">
                                    {processedHtml ? (
                                        <iframe
                                            srcDoc={processedHtml}
                                            className="w-full h-full border-0"
                                            title="HTML Preview"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full">
                                            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                                        </div>
                                    )}
                                </div>
                            ) : isCsvFile && csvViewMode === 'table' ? (
                                <div className="w-full h-full overflow-auto p-4">
                                    <table className="min-w-full border-collapse text-sm">
                                        <tbody>
                                            {parseCsv(fileContent || '').map((row, i) => (
                                                <tr key={i} className={i === 0 ? 'bg-slate-100 font-bold' : 'hover:bg-slate-50'}>
                                                    {row.map((cell, j) => (
                                                        <td key={j} className="border border-slate-200 px-3 py-2 text-slate-700">
                                                            {cell}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : isMarkdown ? (
                                <div className="w-full h-full overflow-auto prose prose-slate prose-sm max-w-none markdown-content p-4">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {processMarkdownContent(fileContent || '')}
                                    </ReactMarkdown>
                                </div>
                            ) : (
                                <>
                                <pre className="w-full font-mono text-[13px] leading-relaxed text-slate-700 bg-slate-50 p-4 rounded-lg border border-slate-100 whitespace-pre-wrap">
                                    {fileContent || ''}
                                </pre>
                                {truncationInfo && (
                                    <div className="sticky bottom-0 px-4 py-2 bg-amber-50 border-t border-amber-200 text-amber-700 text-xs font-medium text-center">
                                        ⚠️ 文件过大，仅显示前 {truncationInfo.shownLines.toLocaleString()} 行（共 {truncationInfo.totalLines.toLocaleString()} 行）。点击下载查看完整文件。
                                    </div>
                                )}
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 py-20">
                            <File className="w-12 h-12 text-slate-100" />
                            <p className="text-sm">{t('files.noFilesHint')}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
