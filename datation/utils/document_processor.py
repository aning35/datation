import os
import pandas as pd
from typing import Dict, Any, Optional
from core.config import DATA_SOURCES_DIR, WORKSPACES_DIR

# Optional dependencies
try:
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter
    HAS_DOCLING = True
except ImportError:
    HAS_DOCLING = False

try:
    from markitdown import MarkItDown
    HAS_MARKITDOWN = True
except ImportError:
    HAS_MARKITDOWN = False

class DocumentProcessor:
    def __init__(self):
        self._doc_converter = None
        self._md_converter = None

    @property
    def doc_converter(self):
        if not self._doc_converter and HAS_DOCLING:
            # Initialize Docling only when needed to save memory/time
            try:
                self._doc_converter = DocumentConverter()
            except Exception as e:
                print(f"[DocumentProcessor] Failed to initialize Docling: {e}")
        return self._doc_converter

    @property
    def md_converter(self):
        if not self._md_converter and HAS_MARKITDOWN:
            try:
                self._md_converter = MarkItDown()
            except Exception as e:
                print(f"[DocumentProcessor] Failed to initialize MarkItDown: {e}")
        return self._md_converter

    def to_markdown(self, file_path: str) -> str:
        """Convert various files to Markdown formatted strings."""
        if not os.path.exists(file_path):
            return f"Error: File not found at {file_path}"

        ext = os.path.splitext(file_path)[1].lower()

        # 1. Process structured documents (PDF, Word, PPT, etc.) - Docling is prioritized
        if ext in ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.html']:
            if self.doc_converter:
                try:
                    result = self.doc_converter.convert(file_path)
                    return result.document.export_to_markdown()
                except Exception as e:
                    print(f"[DocumentProcessor] Docling conversion failed for {file_path}: {e}")
            
            # Fallback to MarkItDown
            if self.md_converter:
                try:
                    result = self.md_converter.convert(file_path)
                    return result.text_content
                except Exception as e:
                    print(f"[DocumentProcessor] MarkItDown fallback failed for {file_path}: {e}")

        # 2. Process tabular data (Excel, CSV, Parquet) - Pandas is prioritized for more precise structures
        if ext in ['.csv', '.xlsx', '.xls', '.parquet', '.tsv']:
            try:
                if ext == '.csv':
                    df = pd.read_csv(file_path)
                elif ext == '.parquet':
                    df = pd.read_parquet(file_path)
                elif ext == '.tsv':
                    df = pd.read_csv(file_path, sep='\t')
                else:
                    df = pd.read_excel(file_path)
                
                # Convert the first few rows to a Markdown table as a preview
                metadata = self.get_metadata(file_path)
                preview = df.head(50).to_markdown(index=False)
                return f"### File Metadata\n{metadata}\n\n### Data Preview (Top 50 rows)\n{preview}"
            except Exception as e:
                print(f"[DocumentProcessor] Pandas reading failed for {file_path}: {e}")

        # 3. Process plain text types (TXT, MD, JSON, XML)
        if ext in ['.txt', '.md', '.json', '.xml', '.log']:
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    return f.read()
            except Exception as e:
                return f"Error reading text file: {e}"

        # 4. Final fallback: try MarkItDown or raise an error directly
        if self.md_converter:
            try:
                result = self.md_converter.convert(file_path)
                return result.text_content
            except:
                pass

        return None

    def get_preview(self, file_path: str, max_chars: int = 4000) -> str:
        """Get a short preview of the file content, suitable for the LLM context."""
        content = self.to_markdown(file_path)
        if content is None:
            # If the content cannot be parsed, provide at least a metadata summary
            meta = self.get_metadata(file_path)
            return f"No content available for this file type. Metadata: {meta}"
            
        if len(content) > max_chars:
            return content[:max_chars] + "\n\n...(content truncated)"
        return content

    def get_metadata(self, file_path: str) -> Dict[str, Any]:
        """Get file metadata (such as column names, row count, sheet names, etc.)."""
        ext = os.path.splitext(file_path)[1].lower()
        meta = {"filename": os.path.basename(file_path), "extension": ext}
        
        try:
            if ext in ['.csv', '.xlsx', '.xls', '.parquet', '.tsv']:
                if ext == '.csv':
                    df = pd.read_csv(file_path, nrows=0)
                elif ext == '.parquet':
                    df = pd.read_parquet(file_path) # Parquet is fast to read metadata
                elif ext == '.tsv':
                    df = pd.read_csv(file_path, sep='\t', nrows=0)
                else:
                    xl = pd.ExcelFile(file_path)
                    meta["sheet_names"] = xl.sheet_names
                    df = xl.parse(xl.sheet_names[0], nrows=0)
                
                meta["columns"] = df.columns.tolist()
                meta["column_count"] = len(df.columns)
            
            # TODO: Extract more metadata for PDF/Word using Docling/PyMuPDF if needed
        except Exception:
            pass
            
        return meta

# Global instance for easy reuse
processor = DocumentProcessor()
