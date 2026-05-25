import os
import re
import tempfile
from pathlib import Path

import core.state as state
from core.config import SAVER_TYPE, WORKSPACES_DIR
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from typing import List, Optional

router = APIRouter(prefix="/files", tags=["files"])

async def get_workspace_path(thread_id: str) -> str:
    workspace_dir = os.path.abspath(WORKSPACES_DIR)
    target_workspace = None
    
    if SAVER_TYPE == "postgres" and state.postgres_pool:
        try:
            async with state.postgres_pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT workspace_path FROM thread_metadata WHERE thread_id = %s", (thread_id,))
                    row = await cur.fetchone()
                    if row:
                        target_workspace = row[0]
        except Exception:
            pass
    else:
        if thread_id in state.global_memory_meta:
            target_workspace = state.global_memory_meta[thread_id].get("workspace_path")

    if not target_workspace:
        # Fallback to default thread directory naming convention
        target_workspace = os.path.join(workspace_dir, f"thread_{thread_id}")
    
    return target_workspace

@router.get("/list")
async def list_files(thread_id: str):
    """
    List all files in the outputs folder under the workspace directory corresponding to the specified session.
    """
    workspace_path = await get_workspace_path(thread_id)
    outputs_dir = os.path.join(workspace_path, "outputs")
    
    if not os.path.exists(outputs_dir):
        return {"files": []}

    def natural_sort_key(s):
        return [int(text) if text.isdigit() else text.lower()
                for text in re.split('([0-9]+)', s)]

    def scan_dir(path):
        items = []
        try:
            for entry in os.scandir(path):
                rel_path = os.path.relpath(entry.path, outputs_dir)
                if entry.is_dir():
                    items.append({
                        "name": entry.name,
                        "type": "directory",
                        "path": rel_path,
                        "children": scan_dir(entry.path)
                    })
                else:
                    items.append({
                        "name": entry.name,
                        "type": "file",
                        "path": rel_path,
                        "size": entry.stat().st_size
                    })
        except Exception:
            pass
        return sorted(items, key=lambda x: (x["type"] != "directory", natural_sort_key(x["name"])))

    files_tree = scan_dir(outputs_dir)

    return {"files": files_tree}

@router.get("/content")
async def get_file_content(thread_id: str, file_path: str):
    """
    Get the content of the specified file.
    """
    workspace_path = await get_workspace_path(thread_id)
    outputs_dir = os.path.join(workspace_path, "outputs")
    full_path = os.path.abspath(os.path.join(outputs_dir, file_path))
    
    # Security check: prevent directory traversal
    if not full_path.startswith(os.path.abspath(outputs_dir)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    # Check if it's an image
    ext = os.path.splitext(full_path)[1].lower()
    img_types = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                 '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'}
    if ext in img_types:
        return FileResponse(full_path, media_type=img_types[ext],
                            content_disposition_type="inline")
    
    MAX_PREVIEW_LINES = 2000
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            lines = []
            total = 0
            for line in f:
                total += 1
                if total <= MAX_PREVIEW_LINES:
                    lines.append(line)
            content = ''.join(lines)
            truncated = total > MAX_PREVIEW_LINES
        result = {"content": content, "filename": os.path.basename(full_path)}
        if truncated:
            result["truncated"] = True
            result["total_lines"] = total
            result["shown_lines"] = MAX_PREVIEW_LINES
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/local-path")
async def get_local_path(thread_id: str, file_path: str):
    """
    Get the local absolute path of the file.
    """
    workspace_path = await get_workspace_path(thread_id)
    outputs_dir = os.path.join(workspace_path, "outputs")
    full_path = os.path.abspath(os.path.join(outputs_dir, file_path))

    if not full_path.startswith(os.path.abspath(outputs_dir)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    return {"local_path": full_path}

@router.get("/raw")
async def get_raw_file(thread_id: str, file_path: str):
    """
    Get the raw binary content of the specified file (used for image preview, etc.).
    """
    import json
    workspace_path = await get_workspace_path(thread_id)
    outputs_dir = os.path.join(workspace_path, "outputs")
    full_path = os.path.abspath(os.path.join(outputs_dir, file_path))

    # If the file is not found in the current thread and is not an explicit cross-directory relative path, try to search in the outputs of the selected historical conversation
    if not (os.path.exists(full_path) and os.path.isfile(full_path)) and ".." not in file_path:
        messages_meta_file = os.path.join(workspace_path, "messages_meta.jsonl")
        history_thread_ids = []
        if os.path.exists(messages_meta_file):
            try:
                with open(messages_meta_file, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            try:
                                entry = json.loads(line)
                                if "history_thread_ids" in entry and entry["history_thread_ids"]:
                                    history_thread_ids = entry["history_thread_ids"]
                            except:
                                pass
            except Exception as e:
                print(f"[files] Error reading messages_meta.jsonl: {e}")
        
        for hist_id in history_thread_ids:
            hist_workspace = await get_workspace_path(hist_id)
            hist_outputs_dir = os.path.join(hist_workspace, "outputs")
            candidate_path = os.path.abspath(os.path.join(hist_outputs_dir, file_path))
            # Security check: ensure the candidate path is indeed under the outputs directory of the corresponding historical thread
            if candidate_path.startswith(os.path.abspath(hist_outputs_dir)):
                if os.path.exists(candidate_path) and os.path.isfile(candidate_path):
                    full_path = candidate_path
                    break

    # Security check: prevent directory traversal leaking outside of the workspace directory
    # Allow access to the current thread's outputs directory, or any thread_*/outputs/ directory inside WORKSPACES_DIR
    allowed = False
    if full_path.startswith(os.path.abspath(outputs_dir)):
        allowed = True
    else:
        workspaces_base = os.path.abspath(WORKSPACES_DIR)
        if full_path.startswith(workspaces_base):
            rel_to_base = os.path.relpath(full_path, workspaces_base)
            parts = rel_to_base.replace("\\", "/").split("/")
            if len(parts) >= 3 and parts[0].startswith("thread_") and parts[1] == "outputs":
                allowed = True

    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    filename = os.path.basename(full_path)
    ext = os.path.splitext(full_path)[1].lower()

    # HTML files are returned directly, but relative paths within them need to be replaced so that charts and other resources load properly in the browser
    if ext == '.html':
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Calculate the directory where the HTML resides for resolving relative paths
            dir_name = os.path.dirname(file_path)
            
            def replace_path(match):
                attr = match.group(1)
                original_path = match.group(2)
                
                # Already an absolute path, external link, anchor, or Data URI; skip
                if original_path.startswith(('http://', 'https://', '/', '#', 'data:')):
                    return match.group(0)
                
                # Handle relative paths, calculating their paths relative to the outputs root directory
                # normpath will handle symbols like ./ and ../
                target_path = os.path.normpath(os.path.join(dir_name, original_path))
                # Uniformly use forward slashes as URL paths
                target_path = target_path.replace("\\", "/")
                
                return f'{attr}="/files/raw?thread_id={thread_id}&file_path={target_path}"'
            
            # Match src="..." or href="..."
            # Use non-greedy matching to capture path content
            pattern = re.compile(r'(src|href)=["\'](.*?)["\']', re.IGNORECASE)
            new_content = pattern.sub(replace_path, content)
            
            return Response(
                content=new_content,
                media_type='text/html',
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                    "Content-Disposition": "inline"
                }
            )
        except Exception:
            # Fall back to original FileResponse when reading or replacing fails
            pass

    # Determine the correct MIME type
    mime_types = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.csv': 'text/csv', '.json': 'application/json', '.md': 'text/markdown',
        '.txt': 'text/plain', '.pdf': 'application/pdf',
        # Audio
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.aac': 'audio/aac', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.wma': 'audio/x-ms-wma',
        # Video
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
        '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    }
    media_type = mime_types.get(ext, 'application/octet-stream')
    is_inline = ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.html',
                        '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a',
                        '.mp4', '.webm', '.ogv', '.mov')

    # Handle Chinese filenames: HTTP headers only support latin-1, use RFC 5987 encoding
    from urllib.parse import quote
    safe_filename = quote(filename)
    disposition = "inline" if is_inline else f"attachment; filename*=UTF-8''{safe_filename}"

    return FileResponse(
        full_path,
        media_type=media_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Content-Disposition": disposition,
        }
    )

@router.get("/export-pdf")
async def export_html_to_pdf(thread_id: str, file_path: str):
    """
    Convert the HTML file to PDF and return for download.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise HTTPException(status_code=500, detail="playwright not installed")

    workspace_path = await get_workspace_path(thread_id)
    outputs_dir = os.path.join(workspace_path, "outputs")
    full_path = os.path.abspath(os.path.join(outputs_dir, file_path))

    if not full_path.startswith(os.path.abspath(outputs_dir)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        pdf_filename = Path(file_path).stem + '.pdf'
        temp_pdf = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')

        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(f'file://{full_path}')
            await page.pdf(path=temp_pdf.name, format='A4')
            await browser.close()

        return FileResponse(
            temp_pdf.name,
            filename=pdf_filename,
            media_type='application/pdf',
            background=lambda: os.unlink(temp_pdf.name)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")
