"""
Report Generator State - State for multi-chapter report generation
"""
from typing import TypedDict, List, Optional
from langchain_core.messages import BaseMessage


class ChapterOutline(TypedDict):
    """Chapter outline"""
    title: str
    description: str
    key_points: List[str]


class GeneratedChapter(TypedDict):
    """Generated chapter"""
    title: str
    content: str


class ReportGeneratorState(TypedDict):
    """Report generator state"""
    messages: List[BaseMessage]
    available_files: List[str]  # List of available data files
    outline: Optional[List[ChapterOutline]]  # Report outline
    chapters: List[GeneratedChapter]  # List of generated chapters
    current_chapter_index: int  # Index of the chapter currently being generated
    final_markdown: Optional[str]  # Final merged Markdown
    final_html: Optional[str]  # Final HTML
