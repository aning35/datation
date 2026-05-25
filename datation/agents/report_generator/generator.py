"""
Report Generator - Multi-chapter report generator
Elegant multi-turn generation scheme, breaking through single-turn token limits
"""
from typing import Any, List, Literal
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from .state import ReportGeneratorState, ChapterOutline, GeneratedChapter
import json
import os
from core.config import get_language_directive, LANGUAGE
from datation.utils.i18n import t
from datation.utils.json_parser import extract_json


def _build_report_html(html_body: str, report_time: str) -> str:
    """Build a complete, beautiful HTML report page"""
    return f"""<!DOCTYPE html>
<html lang="{t('report.html_lang', lang=LANGUAGE)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{t('report.title', lang=LANGUAGE)}</title>
<style>
/* ===== Base Reset & Global ===== */
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ font-size: 16px; scroll-behavior: smooth; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
               'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%);
  color: #334155;
  line-height: 1.8;
  min-height: 100vh;
}}

/* ===== Report Container ===== */
.report-wrap {{
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 20px 80px;
}}
.report-card {{
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  padding: 48px 56px;
  position: relative;
  overflow: hidden;
}}
.report-card::before {{
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 4px;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
}}

/* ===== Footer ===== */
.report-footer {{
  text-align: center;
  padding: 24px 0 0;
  margin-top: 48px;
  border-top: 1px solid #e2e8f0;
  color: #94a3b8;
  font-size: 0.8rem;
}}

/* ===== Heading Hierarchy ===== */
h1 {{
  font-size: 2rem;
  font-weight: 800;
  background: linear-gradient(135deg, #1e40af, #7c3aed);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #e2e8f0;
  line-height: 1.3;
}}
h2 {{
  font-size: 1.45rem;
  font-weight: 700;
  color: #1e293b;
  margin: 40px 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  gap: 8px;
}}
h2::before {{
  content: '';
  display: inline-block;
  width: 4px; height: 20px;
  background: linear-gradient(180deg, #3b82f6, #8b5cf6);
  border-radius: 2px;
  flex-shrink: 0;
}}
h3 {{
  font-size: 1.15rem;
  font-weight: 600;
  color: #334155;
  margin: 28px 0 12px;
}}
h4, h5, h6 {{
  font-size: 1rem;
  font-weight: 600;
  color: #475569;
  margin: 20px 0 8px;
}}

/* ===== Paragraph & Text ===== */
p {{ margin: 12px 0; }}
strong {{ color: #1e293b; font-weight: 600; }}
em {{ color: #6366f1; font-style: italic; }}
a {{ color: #3b82f6; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
hr {{
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, #cbd5e1, transparent);
  margin: 32px 0;
}}

/* ===== List ===== */
ul, ol {{
  margin: 12px 0;
  padding-left: 24px;
}}
li {{
  margin: 6px 0;
  line-height: 1.7;
}}
li::marker {{ color: #6366f1; }}

/* ===== Blockquote ===== */
blockquote {{
  border-left: 4px solid #6366f1;
  background: linear-gradient(135deg, #f0f0ff, #faf5ff);
  padding: 16px 20px;
  margin: 16px 0;
  border-radius: 0 12px 12px 0;
  color: #4338ca;
  font-style: italic;
}}
blockquote p {{ margin: 4px 0; }}

/* ===== Table ===== */
table {{
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 20px 0;
  font-size: 0.9rem;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}}
thead th {{
  background: linear-gradient(135deg, #1e293b, #334155);
  color: #fff;
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}}
tbody td {{
  padding: 10px 16px;
  border-bottom: 1px solid #f1f5f9;
}}
tbody tr:nth-child(even) {{ background: #f8fafc; }}
tbody tr:hover {{ background: #eff6ff; }}

/* ===== Code ===== */
code {{
  background: #f1f5f9;
  color: #e11d48;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.88em;
  font-family: 'SF Mono', 'Fira Code', Menlo, Consolas, monospace;
}}
pre {{
  background: #1e293b;
  color: #e2e8f0;
  padding: 20px 24px;
  border-radius: 12px;
  overflow-x: auto;
  margin: 16px 0;
  font-size: 0.85rem;
  line-height: 1.6;
  box-shadow: inset 0 2px 8px rgba(0,0,0,0.15);
}}
pre code {{
  background: none;
  color: inherit;
  padding: 0;
  font-size: inherit;
}}

/* ===== Image ===== */
img {{
  max-width: 100%;
  height: auto;
  border-radius: 12px;
  margin: 16px 0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  display: block;
}}

/* ===== Print Style ===== */
@media print {{
  body {{ background: #fff; }}
  .report-card {{ box-shadow: none; padding: 0; }}
  .report-card::before {{ display: none; }}
  h1 {{
    -webkit-text-fill-color: #1e40af;
    color: #1e40af;
  }}
  img {{ box-shadow: none; }}
  pre {{ background: #f8f8f8; color: #333; box-shadow: none; }}
}}

/* ===== Responsive ===== */
@media (max-width: 768px) {{
  .report-card {{ padding: 24px 20px; }}
  h1 {{ font-size: 1.5rem; }}
  h2 {{ font-size: 1.2rem; }}
  table {{ font-size: 0.8rem; }}
  thead th, tbody td {{ padding: 8px 10px; }}
}}
</style>
</head>
<body>
<div class="report-wrap">
  <div class="report-card">
    {html_body}
    <div class="report-footer">
      <p>{t('report.footer.generated_by', lang=LANGUAGE)}</p>
      <p>{t('report.footer.generated_at', lang=LANGUAGE, time=report_time)}</p>
    </div>
  </div>
</div>
</body>
</html>"""


def _write_report_to_disk(html_content: str) -> None:
    """Write HTML report to outputs/report.html"""
    try:
        from tools.data_computation.sandbox import sandbox_thread_id
        from core.config import WORKSPACES_DIR

        thread_id = sandbox_thread_id.get(None)
        if not thread_id:
            print("[ReportGen] ⚠️ No thread_id in context, cannot persist report.html")
            return

        outputs_dir = os.path.join(
            os.path.expanduser(WORKSPACES_DIR),
            f"thread_{thread_id}",
            "outputs"
        )
        os.makedirs(outputs_dir, exist_ok=True)
        report_path = os.path.join(outputs_dir, "report.html")

        with open(report_path, "w", encoding="utf-8") as f:
            f.write(html_content)

        print(f"[ReportGen] ✅ HTML report saved: {report_path} ({len(html_content)} bytes)")
    except Exception as e:
        print(f"[ReportGen] ⚠️ Failed to write report.html: {e}")


def _write_markdown_to_disk(markdown_content: str) -> None:
    """Write Markdown report to outputs/report_html.md (the Markdown source file of report.html)"""
    try:
        from tools.data_computation.sandbox import sandbox_thread_id
        from core.config import WORKSPACES_DIR

        thread_id = sandbox_thread_id.get(None)
        if not thread_id:
            print("[ReportGen] ⚠️ No thread_id in context, cannot persist report_html.md")
            return

        outputs_dir = os.path.join(
            os.path.expanduser(WORKSPACES_DIR),
            f"thread_{thread_id}",
            "outputs"
        )
        os.makedirs(outputs_dir, exist_ok=True)
        md_path = os.path.join(outputs_dir, "report_html.md")

        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown_content)

        print(f"[ReportGen] ✅ Markdown source saved: {md_path} ({len(markdown_content)} bytes)")
    except Exception as e:
        print(f"[ReportGen] ⚠️ Failed to write report_html.md: {e}")

def create_report_generator_graph(
    llm: BaseChatModel,
    tools: List[Any],
    skills_context: str = ""
):
    """Create the multi-chapter report generation graph"""

    # ========== Node 1: Collect Files ==========
    def collect_files(state: ReportGeneratorState) -> ReportGeneratorState:
        """Collect all available analysis output files, supporting loading artifacts from the current session and selected historical session workspaces"""
        import os
        from tools.data_computation.sandbox import sandbox_thread_id, sandbox_history_thread_ids
        from core.config import WORKSPACES_DIR

        thread_id = sandbox_thread_id.get(None)
        history_ids = sandbox_history_thread_ids.get([])
        
        available_files = []
        
        def scan_dir(base_dir: str, prefix: str = ""):
            if not os.path.exists(base_dir):
                return []
            res = []
            for root, _, files in os.walk(base_dir):
                for f in files:
                    if f.startswith('.'):
                        continue
                    full_path = os.path.join(root, f)
                    rel = os.path.relpath(full_path, base_dir)
                    res.append(f"{prefix}{rel}")
            return sorted(res)

        # 1. Scan the current session's outputs directory
        if thread_id:
            cur_outputs = os.path.join(os.path.expanduser(WORKSPACES_DIR), f"thread_{thread_id}", "outputs")
            available_files.extend(scan_dir(cur_outputs, ""))

        # 2. Scan the selected historical session's outputs directory (exposed as ../../thread_{id}/outputs/ relative path for cross-directory reading via ShellExecutor)
        for hist_id in history_ids:
            hist_outputs = os.path.join(os.path.expanduser(WORKSPACES_DIR), f"thread_{hist_id}", "outputs")
            available_files.extend(scan_dir(hist_outputs, f"../../thread_{hist_id}/outputs/"))

        print(f"[ReportGen] Collected {len(available_files)} files: {available_files}")
        return {**state, "available_files": available_files}

    # ========== Node 2: Generate Outline ==========
    def generate_outline(state: ReportGeneratorState) -> ReportGeneratorState:
        """Analyze data to generate a report outline"""

        # Find ShellExecutor tool to read key files
        shell_tool = None
        for tool in tools:
            if hasattr(tool, 'name') and 'shell' in tool.name.lower():
                shell_tool = tool
                break

        # Read mission_plan.md and other key files
        mission_plan = ""
        if shell_tool:
            try:
                mission_plan = shell_tool.invoke("cat mission_plan.md 2>/dev/null || echo ''")
            except:
                pass

        files_summary = "\n".join(state["available_files"][:50])

        from datation.agents.prompts import REPORT_OUTLINE_PROMPT_TEMPLATE
        
        prompt = REPORT_OUTLINE_PROMPT_TEMPLATE.format(
            user_request=state["messages"][-1].content if state["messages"] else t('report.title', lang=LANGUAGE),
            mission_plan=mission_plan[:2000] if mission_plan else "None",
            files_summary=files_summary,
            skills_context=skills_context,
            language_directive=get_language_directive()
        )

        response = llm.invoke([SystemMessage(content=prompt)])

        try:
            outline = extract_json(response.content)
            return {**state, "outline": outline, "current_chapter_index": 0, "chapters": []}
        except Exception as e:
            print(f"[ReportGen] Outline parsing failed: {e}")
            # Use default outline
            default_outline = [
                {
                    "title": t('report.default_outline.executive_summary.title', lang=LANGUAGE),
                    "description": t('report.default_outline.executive_summary.description', lang=LANGUAGE),
                    "key_points": [
                        t('report.default_outline.executive_summary.key_metrics', lang=LANGUAGE),
                        t('report.default_outline.executive_summary.main_trends', lang=LANGUAGE)
                    ]
                },
                {
                    "title": t('report.default_outline.data_analysis.title', lang=LANGUAGE),
                    "description": t('report.default_outline.data_analysis.description', lang=LANGUAGE),
                    "key_points": [
                        t('report.default_outline.data_analysis.data_overview', lang=LANGUAGE),
                        t('report.default_outline.data_analysis.deep_analysis', lang=LANGUAGE)
                    ]
                },
                {
                    "title": t('report.default_outline.conclusions.title', lang=LANGUAGE),
                    "description": t('report.default_outline.conclusions.description', lang=LANGUAGE),
                    "key_points": [
                        t('report.default_outline.conclusions.core_findings', lang=LANGUAGE),
                        t('report.default_outline.conclusions.action_items', lang=LANGUAGE)
                    ]
                }
            ]
            return {**state, "outline": default_outline, "current_chapter_index": 0, "chapters": []}

    # ========== Node 3: Generate Single Chapter (with deduplication optimization) ==========
    def generate_chapter(state: ReportGeneratorState) -> ReportGeneratorState:
        """Generate content for the current chapter, injecting summaries of completed chapters to avoid duplication"""

        current_idx = state["current_chapter_index"]
        outline = state["outline"]

        if not outline or current_idx >= len(outline):
            return state

        chapter_info = outline[current_idx]

        # Find tool to read relevant files
        shell_tool = None
        for tool in tools:
            if hasattr(tool, 'name') and 'shell' in tool.name.lower():
                shell_tool = tool
                break

        # ---- Intelligent Data Routing: filter the most relevant files based on the chapter topic ----
        relevant_data = ""
        if shell_tool:
            try:
                all_files = state["available_files"]
                chapter_title_lower = chapter_info["title"].lower()
                chapter_desc_lower = chapter_info["description"].lower()

                # Match files by chapter topic (keyword matching)
                csv_files = [f for f in all_files if f.endswith('.csv')]
                md_files = [f for f in all_files if f.endswith('.md') and 'mission_plan' not in f]
                img_files = [f for f in all_files if f.endswith(('.png', '.jpg', '.svg'))]

                # Read CSV data: prioritize topic-matched files, fallback to all
                files_to_read = csv_files[:3]  # Default to reading the first 3 files
                for csv_f in csv_files:
                    csv_base = csv_f.lower().replace('.csv', '').replace('_', ' ')
                    # Topic keyword matching
                    if any(kw in csv_base for kw in chapter_desc_lower.split()):
                        if csv_f not in files_to_read:
                            files_to_read.insert(0, csv_f)

                for data_file in files_to_read[:4]:
                    try:
                        content = shell_tool.invoke(f"head -20 {data_file} 2>/dev/null || echo ''")
                        if content.strip():
                            relevant_data += f"\n### {data_file}:\n{content}\n"
                    except:
                        pass

                # If it is a deep insight/conclusion chapter, also read .md analysis files
                insight_keywords = ["洞察", "结论", "建议", "总结", "报告", "分析", "summary", "insight", "conclusion", "report", "analysis", "final"]
                if any(kw in chapter_title_lower or kw in chapter_desc_lower for kw in insight_keywords):
                    for md_f in md_files[:3]:
                        try:
                            content = shell_tool.invoke(f"head -100 {md_f} 2>/dev/null || echo ''")
                            if content.strip():
                                relevant_data += f"\n### {md_f}:\n{content}\n"
                        except:
                            pass
            except Exception as e:
                print(f"[ReportGen] Data routing exception: {e}")

        # ---- Build rolling summary of completed chapters and image deduplication (deduplication core) ----
        previous_chapters_summary = ""
        used_images = []
        if state["chapters"]:
            summaries = []
            for i, ch in enumerate(state["chapters"]):
                # Extract the first 300 characters of each chapter as summary seeds
                ch_preview = ch["content"][:300].replace("\n", " ").strip()
                summaries.append(t('report.duplicate_avoidance.chapter_prefix', lang=LANGUAGE, index=i+1, title=ch['title'], preview=ch_preview))
                
                # Gather images already used in previous chapters
                for img in img_files:
                    img_name = img.split('/')[-1] if '/' in img else img
                    if img_name in ch["content"]:
                        used_images.append(img)
                        
            previous_chapters_summary = "\n".join(summaries)

        # Filter used charts to prevent the LLM from repeatedly inserting them
        unused_files = []
        for f in state["available_files"][:40]:
            if f in used_images:
                continue
            unused_files.append(f)

        files_list = "\n".join(unused_files)
        user_request = state["messages"][-1].content if state["messages"] else ""
        total_chapters = len(outline)

        prev_summary_block = ""
        if previous_chapters_summary:
            prev_summary_block = t('report.duplicate_avoidance.instruction', lang=LANGUAGE, previous_chapters_summary=previous_chapters_summary)

        from datation.agents.prompts import REPORT_CHAPTER_PROMPT_TEMPLATE
        prompt = REPORT_CHAPTER_PROMPT_TEMPLATE.format(
            user_request=user_request,
            chapter_index=f"{current_idx + 1}/{total_chapters}",
            chapter_title=chapter_info["title"],
            chapter_description=chapter_info["description"],
            key_points=", ".join(chapter_info["key_points"]),
            files_list=files_list,
            relevant_data=relevant_data[:2000],
            previous_chapters_summary=prev_summary_block,
            skills_context=skills_context,
            language_directive=get_language_directive()
        )

        response = llm.invoke([SystemMessage(content=prompt)])

        chapter = GeneratedChapter(
            title=chapter_info["title"],
            content=response.content.strip()
        )

        new_chapters = state["chapters"] + [chapter]
        new_index = current_idx + 1

        return {**state, "chapters": new_chapters, "current_chapter_index": new_index}

    # ========== Node 4: Merge Report ==========
    def merge_report(state: ReportGeneratorState) -> ReportGeneratorState:
        """Merge all chapters into a complete report"""

        chapters = state["chapters"]
        if not chapters:
            return {**state, "final_markdown": f"# {t('report.failed', lang=LANGUAGE)}\n\n{t('report.no_chapters', lang=LANGUAGE)}"}

        # Build complete Markdown
        markdown_parts = [f"# {t('report.title', lang=LANGUAGE)}\n\n"]

        for chapter in chapters:
            markdown_parts.append(f"## {chapter['title']}\n\n")
            markdown_parts.append(f"{chapter['content']}\n\n")
            markdown_parts.append("---\n\n")

        final_markdown = "".join(markdown_parts)
        return {**state, "final_markdown": final_markdown}

    # ========== Node 5: Convert HTML and Write to File ==========
    def convert_html(state: ReportGeneratorState) -> ReportGeneratorState:
        """Convert Markdown to a beautiful HTML report and write it to outputs/report.html"""
        import os
        import time as _time

        markdown_text = state.get("final_markdown", "")
        if not markdown_text:
            return {**state, "final_html": ""}

        # ---- 1. Markdown -> HTML body ----
        try:
            from markdown_it import MarkdownIt
            md = MarkdownIt("commonmark", {"html": True, "breaks": True})
            md.enable("table")
            md.enable("strikethrough")
            html_body = md.render(markdown_text)
        except ImportError:
            print("[ReportGen] ⚠️ markdown-it-py not installed, falling back to plain text wrapping")
            # Minimal fallback: wrap paragraphs and preserve formatting
            import html as _html
            escaped = _html.escape(markdown_text)
            html_body = f"<pre style='white-space:pre-wrap'>{escaped}</pre>"

        # ---- 2. Generate timestamp ----
        report_time = _time.strftime("%Y-%m-%d %H:%M:%S")

        # ---- 3. Build complete HTML (beautiful template) ----
        full_html = _build_report_html(html_body, report_time)

        # ---- 4. Write to disk (HTML + Markdown) ----
        _write_report_to_disk(full_html)
        _write_markdown_to_disk(markdown_text)

        return {**state, "final_html": full_html}

    # ========== Router Function ==========
    def should_continue_chapters(state: ReportGeneratorState) -> Literal["generate_chapter", "merge_report"]:
        """Determine whether to continue generating chapters"""
        current_idx = state["current_chapter_index"]
        outline = state.get("outline", [])

        if current_idx < len(outline):
            return "generate_chapter"
        else:
            return "merge_report"

    # ========== Build Graph ==========
    graph = StateGraph(ReportGeneratorState)

    # Add nodes
    graph.add_node("collect_files", collect_files)
    graph.add_node("generate_outline", generate_outline)
    graph.add_node("generate_chapter", generate_chapter)
    graph.add_node("merge_report", merge_report)
    graph.add_node("convert_html", convert_html)

    # Add edges
    graph.add_edge(START, "collect_files")
    graph.add_edge("collect_files", "generate_outline")
    graph.add_conditional_edges("generate_outline", should_continue_chapters)
    graph.add_conditional_edges("generate_chapter", should_continue_chapters)
    graph.add_edge("merge_report", "convert_html")
    graph.add_edge("convert_html", END)

    return graph.compile()




