import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, GitBranch, Maximize2, Minimize2, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

interface WorkflowTabProps {
    graphSvg: string;
    graphLoading: boolean;
    loadGraph: (forceReload?: boolean) => void;
    activeNode?: string | null;
    setActiveNode?: (node: string | null) => void;
    isActive?: boolean;
}

export const WorkflowTab: React.FC<WorkflowTabProps> = ({
    graphSvg,
    graphLoading,
    loadGraph,
    activeNode,
    setActiveNode,
    isActive,
}) => {
    const { t } = useTranslation();
    const [isFullScreen, setIsFullScreen] = useState(false);

    // Zoom & Pan state
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const graphSvgRef = useRef<string>(graphSvg);

    const toggleFullScreen = () => {
        const nextFs = !isFullScreen;
        setIsFullScreen(nextFs);
        if (nextFs) {
            // Default to 200% zoom when entering fullscreen
            setScale(1.0);
            setPosition({ x: 0, y: 0 });
            // Mark as fitted so auto-fit doesn't fight our manual 200%
            hasBeenFitted.current = true;
        }
    };

    const fitView = useCallback((force?: boolean) => {
        if (!containerRef.current || !graphSvg) return;

        // If already have a non-default scale and not forcing, don't reset
        if (!force && scale !== 1) return;

        // Use a slight timeout to ensure SVG is rendered in DOM
        setTimeout(() => {
            const svg = containerRef.current?.querySelector('svg');
            if (!svg) return;

            const containerWidth = containerRef.current?.clientWidth || 800;
            const containerHeight = containerRef.current?.clientHeight || 600;

            // Get the actual SVG content dimensions
            const viewBox = svg.viewBox.baseVal;
            const svgWidth = viewBox.width || svg.clientWidth || 800;
            const svgHeight = viewBox.height || svg.clientHeight || 600;

            const padding = 40;
            const scaleX = (containerWidth - padding) / svgWidth;
            const scaleY = (containerHeight - padding) / svgHeight;

            // We want to fit within the screen, so take the minimum scale
            const newScale = Math.min(scaleX, scaleY);

            // Limit scale: 
            // In fullscreen, allow a bit more zoom (min 0.2, max 3.0)
            const finalScale = isFullScreen
                ? Math.max(0.4, Math.min(newScale, 3.0))
                : Math.max(0.2, Math.min(newScale, 1.5));

            setScale(finalScale);
            setPosition({ x: 0, y: 0 });
        }, 50);
    }, [graphSvg, isFullScreen, scale]);

    // Initial load fit
    const hasBeenFitted = useRef(false);
    useEffect(() => {
        if (graphSvg && !hasBeenFitted.current && !isFullScreen) {
            fitView(true);
            hasBeenFitted.current = true;
        }
    }, [graphSvg, isFullScreen]); // eslint-disable-line react-hooks/exhaustive-deps

    const getNodeNameFromId = (id: string): string => {
        if (!id) return '';
        let name = id;
        if (name.startsWith('cluster_')) {
            name = name.replace('cluster_', '');
        }
        // Strip common prefixes
        name = name.replace(/^(graph-diagram-flowchart-|graph-diagram-|flowchart-)/, '');
        // Strip trailing number IDs
        name = name.replace(/-\d+$/, '');
        // Replace colon escaping variants
        return name.replace(/_3a_/gi, ':')
            .replace(/\\3a/gi, ':')
            .replace(/%3a/gi, ':');
    };

    const findBoundaryShapes = (group: Element, isCluster: boolean): Element[] => {
        const shapes: Element[] = [];
        if (isCluster) {
            // Direct child shapes for cluster outline
            const direct = group.querySelectorAll(':scope > rect, :scope > path, :scope > polygon');
            if (direct.length > 0) {
                direct.forEach(el => shapes.push(el));
            } else {
                const allRectsPath = group.querySelectorAll('rect, path');
                if (allRectsPath.length > 0) {
                    shapes.push(allRectsPath[0]);
                }
            }
        } else {
            // Custom Mermaid shapes by class first
            const basic = group.querySelectorAll('.basic, .label-container');
            if (basic.length > 0) {
                basic.forEach(el => shapes.push(el));
            }
            // Direct child shapes
            const direct = group.querySelectorAll(':scope > rect, :scope > circle, :scope > polygon, :scope > ellipse');
            if (direct.length > 0) {
                direct.forEach(el => shapes.push(el));
            }
            // Direct first path
            if (shapes.length === 0) {
                const firstPath = group.querySelector(':scope > path');
                if (firstPath) {
                    shapes.push(firstPath);
                }
            }
            // Deep nested shapes fallback
            if (shapes.length === 0) {
                const anyShape = group.querySelector('rect, circle, polygon, ellipse');
                if (anyShape) {
                    shapes.push(anyShape);
                }
            }
        }
        return shapes;
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !graphSvg) return;

        // 1. Clear any existing active classes/attributes
        const existingActiveShapes = container.querySelectorAll('.node-active-highlight');
        existingActiveShapes.forEach(el => {
            el.classList.remove('node-active-highlight');
            (el as HTMLElement | SVGElement).style.removeProperty('stroke');
            (el as HTMLElement | SVGElement).style.removeProperty('stroke-width');
            (el as HTMLElement | SVGElement).style.removeProperty('filter');
        });

        const existingActiveGroups = container.querySelectorAll('[data-active="true"]');
        existingActiveGroups.forEach(el => el.removeAttribute('data-active'));

        if (!activeNode) return;

        // 2. Filter out garbage activeNode values
        if (/^\d+:/.test(activeNode) || activeNode === 'False' || activeNode === 'True') return;

        const activeClean = activeNode.trim().toLowerCase();
        const activeParts = activeClean.split(':').filter(Boolean);
        const genericLeaves = ['agent', 'tools', '__start__', '__end__'];

        // 3. Find all groups first to resolve path mismatches
        const allGroups = container.querySelectorAll('g[id]');
        
        // 🚀 Self-healing path resolution:
        // If activeNode is a simple leaf name (e.g. "generate_chapter"), check if there's a fully qualified node in the SVG (e.g. "ReportGenerator:generate_chapter")
        // and resolve activeNode to it. This automatically bridges flat backend events to nested Mermaid subgraphs!
        let resolvedActiveNode = activeNode;
        if (activeParts.length === 1 && !genericLeaves.includes(activeClean)) {
            for (const group of allGroups) {
                const id = group.getAttribute('id') || '';
                const groupName = getNodeNameFromId(id);
                const groupClean = groupName.trim().toLowerCase();
                if (groupClean.endsWith(':' + activeClean)) {
                    resolvedActiveNode = groupName;
                    break;
                }
            }
        }

        const resolvedClean = resolvedActiveNode.trim().toLowerCase();
        const resolvedParts = resolvedClean.split(':').filter(Boolean);
        const resolvedLeaf = resolvedParts[resolvedParts.length - 1];
        let matchCount = 0;

        allGroups.forEach((group) => {
            const id = group.getAttribute('id') || '';
            const groupName = getNodeNameFromId(id).trim().toLowerCase();
            if (!groupName) return;

            const groupParts = groupName.split(':').filter(Boolean);
            const isCluster = id.startsWith('cluster_') || group.classList.contains('cluster');

            let isMatch = false;
            if (groupName === resolvedClean) {
                isMatch = true;
            } else if (isCluster) {
                if (groupParts.length <= resolvedParts.length) {
                    isMatch = groupParts.every((part, idx) => part === resolvedParts[idx]);
                }
            } else if (resolvedParts.length > 1 && !genericLeaves.includes(resolvedLeaf)) {
                isMatch = groupName === resolvedLeaf;
            } else if (resolvedParts.length > 1 && genericLeaves.includes(resolvedLeaf)) {
                // Parent path fallback for nested nodes that don't have explicit agent/tools SVG sub-nodes
                const parentPath = resolvedParts.slice(0, -1).join(':');
                isMatch = groupName === parentPath;
            }

            if (isMatch) {
                matchCount++;
                group.setAttribute('data-active', 'true');

                // Find shape elements to apply style class to
                const shapes = findBoundaryShapes(group, isCluster);
                shapes.forEach(shape => {
                    shape.classList.add('node-active-highlight');
                    // Direct inline style overwrite to completely beat Mermaid inline stroke-width overrides (specificity 1000)
                    (shape as HTMLElement | SVGElement).style.setProperty('stroke', '#00ffff', 'important');
                    (shape as HTMLElement | SVGElement).style.setProperty('stroke-width', '4px', 'important');
                    (shape as HTMLElement | SVGElement).style.setProperty('filter', 'drop-shadow(0 0 6px rgba(0, 255, 255, 0.9)) drop-shadow(0 0 12px rgba(0, 255, 255, 0.4))', 'important');
                });
            }
        });

        console.log(`[HighlightDOM] activeNode="${activeNode}" matched ${matchCount} groups`);
    }, [graphSvg, activeNode, isFullScreen, isActive]);

    // Zoom handlers
    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.2, 5));
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.2));
    const handleReset = () => {
        setScale(1);
        setPosition({ x: 0, y: 0 });
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (!isFullScreen) return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setScale(prev => Math.min(Math.max(prev + delta, 0.2), 5));
        }
    };

    // Panning handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        if (!isFullScreen) return;
        if (e.button !== 0) return; // Only left click
        setIsDragging(true);
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || !isFullScreen) return;

        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;

        setPosition(prev => ({
            x: prev.x + dx,
            y: prev.y + dy
        }));

        lastMousePos.current = { x: e.clientX, y: e.clientY };
    }, [isDragging, isFullScreen]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Register click handlers only when graphSvg changes (SVG DOM is remounted)
    useEffect(() => {
        if (!graphSvg) return;
        const container = document.getElementById('mermaid-container') || document.getElementById('mermaid-container-fullscreen');
        if (!container) return;

        const allGroups = container.querySelectorAll('g.node, g.cluster');
        allGroups.forEach((group) => {
            // @ts-ignore
            group.style.cursor = 'pointer';
            (group as SVGElement | HTMLElement).onclick = (e: MouseEvent) => {
                e.stopPropagation();
                const id = group.getAttribute('id') || '';
                const nodeName = getNodeNameFromId(id);
                if (nodeName && setActiveNode) {
                    setActiveNode(activeNode === nodeName ? null : nodeName);
                }
            };
        });
    }, [graphSvg, isFullScreen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep graphSvgRef in sync so the highlight effect always sees latest SVG
    useEffect(() => {
        graphSvgRef.current = graphSvg;
    }, [graphSvg]);

    const renderGraph = (isFs: boolean) => (
        <div
            id={isFs ? "mermaid-container-fullscreen" : "mermaid-container"}
            dangerouslySetInnerHTML={{ __html: graphSvg }}
            style={{
                transform: isFs ? `translate(${position.x}px, ${position.y}px) scale(${scale})` : 'none',
                transformOrigin: 'center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                cursor: isFs ? (isDragging ? 'grabbing' : 'grab') : 'default'
            }}
            className={`w-full h-full [&_svg]:w-full [&_svg]:h-full [&_svg]:max-w-none flex items-center justify-center`}
        />
    );

    const highlightStyles = `
        @keyframes nodeActivePulse {
            0%, 100% {
                stroke: #00ffff !important;
                stroke-width: 4px !important;
                filter: drop-shadow(0 0 6px rgba(0, 255, 255, 0.9)) drop-shadow(0 0 12px rgba(0, 255, 255, 0.4)) !important;
            }
            50% {
                stroke: #ffffff !important;
                stroke-width: 4px !important;
                filter: drop-shadow(0 0 10px rgba(0, 255, 255, 1.0)) drop-shadow(0 0 20px rgba(0, 255, 255, 0.6)) !important;
            }
        }
        
        /* High specificity selectors to guarantee animation overrides SVG/Mermaid stylesheets */
        svg#graph-diagram .node-active-highlight,
        svg#graph-diagram * .node-active-highlight,
        .node-active-highlight {
            animation: nodeActivePulse 1.5s ease-in-out infinite !important;
        }

        /* 🚀 High-Contrast Premium Edge Styles (Crisp 1px White Border Halo) */
        svg#graph-diagram .edgePath .path,
        svg#graph-diagram .edgePath path,
        svg#graph-diagram .edge-path,
        .edgePath .path {
            stroke: #1e1b4b !important; /* Premium ultra-dark indigo */
            stroke-width: 2px !important;
            filter: drop-shadow(1px 0px 0px #ffffff) 
                    drop-shadow(-1px 0px 0px #ffffff) 
                    drop-shadow(0px 1px 0px #ffffff) 
                    drop-shadow(0px -1px 0px #ffffff) !important;
        }

        /* 🚀 High-Contrast Premium Arrowheads/Markers (Crisp 1px White Border Halo) */
        svg#graph-diagram marker path,
        svg#graph-diagram .marker,
        svg#graph-diagram .arrowheadPath,
        marker path {
            fill: #1e1b4b !important;
            stroke: #1e1b4b !important;
            stroke-width: 1px !important;
            filter: drop-shadow(1px 0px 0px #ffffff) 
                    drop-shadow(-1px 0px 0px #ffffff) 
                    drop-shadow(0px 1px 0px #ffffff) 
                    drop-shadow(0px -1px 0px #ffffff) !important;
        }
    `;

    const workflowContent = (
        <div className={`bg-white flex flex-col ${isFullScreen ? 'fixed inset-0 z-[9999]' : 'h-full'}`}>
            <style dangerouslySetInnerHTML={{ __html: highlightStyles }} />
            {/* Header */}
            <div className={`p-4 bg-slate-50 border-b flex items-center justify-between shrink-0`}>
                <div className="flex flex-col">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <GitBranch className="w-4 h-4 text-indigo-500" />
                        {t('workflow.title')}
                    </h3>
                    <span className="text-[10px] text-slate-500">
                        {isFullScreen ? t('workflow.clickNode') : t('workflow.subtitle')}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {isFullScreen && (
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 mr-2">
                            <button onClick={handleZoomOut} className="p-1.5 hover:bg-slate-50 rounded text-slate-500" title={t('workflow.zoomOut')}><ZoomOut className="w-4 h-4" /></button>
                            <span className="text-[10px] font-mono w-10 text-center text-slate-600">{Math.round(scale * 100)}%</span>
                            <button onClick={handleZoomIn} className="p-1.5 hover:bg-slate-50 rounded text-slate-500" title={t('workflow.zoomIn')}><ZoomIn className="w-4 h-4" /></button>
                            <div className="w-px h-4 bg-slate-100 mx-1" />
                            <button onClick={handleReset} className="p-1.5 hover:bg-slate-50 rounded text-slate-500" title={t('workflow.resetView')}><RotateCcw className="w-4 h-4" /></button>
                        </div>
                    )}

                    <button
                        onClick={() => loadGraph(true)}
                        className="text-xs px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-sm text-slate-600 transition-colors flex items-center gap-1.5"
                    >
                        <Loader2 className={`w-3.5 h-3.5 ${graphLoading ? 'animate-spin text-indigo-500' : 'text-slate-400'}`} />
                        {t('workflow.refresh')}
                    </button>

                    <button
                        onClick={toggleFullScreen}
                        className="text-xs px-3 py-1.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 rounded-lg shadow-sm text-indigo-700 transition-colors flex items-center gap-1.5 font-medium"
                    >
                        {isFullScreen ? (
                            <><Minimize2 className="w-3.5 h-3.5" /> {t('workflow.title')}</>
                        ) : (
                            <><Maximize2 className="w-3.5 h-3.5" /> {t('workflow.fullscreen')}</>
                        )}
                    </button>
                </div>
            </div>

            {/* Canvas Area */}
            <div
                ref={containerRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                className={`flex-1 overflow-hidden flex justify-center items-center bg-slate-50/50 relative ${isFullScreen ? 'cursor-grab' : 'p-4 overflow-auto min-h-[300px]'}`}
            >
                {graphSvg ? (
                    <>
                        {renderGraph(isFullScreen)}
                        {graphLoading && (
                            <div className="absolute top-4 right-4 bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-slate-200 shadow-sm flex items-center gap-2 z-20">
                                <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('workflow.updating')}</span>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="m-auto text-center flex flex-col items-center text-slate-400 gap-3 py-20">
                        {graphLoading ? (
                            <>
                                <Loader2 className="w-10 h-10 text-indigo-300 animate-spin" />
                                <p className="text-sm text-slate-500">{t('workflow.loading')}</p>
                            </>
                        ) : (
                            <>
                                <GitBranch className="w-10 h-10 text-slate-200" />
                                <p className="text-sm text-slate-500">{t('workflow.waitGraph')}</p>
                            </>
                        )}
                    </div>
                )}

                {isFullScreen && (
                    <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                        <button
                            onClick={toggleFullScreen}
                            className="p-3 bg-slate-900/80 backdrop-blur text-white rounded-full shadow-2xl hover:bg-slate-800 transition-all border border-white/10"
                            title={t('workflow.closeFullscreen')}
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    return isFullScreen ? createPortal(workflowContent, document.body) : workflowContent;
};

