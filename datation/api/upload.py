import os
import shutil
import re
import aiofiles

from fastapi import APIRouter, UploadFile
from markitdown import MarkItDown

import core.state as state
from core.config import SAVER_TYPE, WORKSPACES_DIR

router = APIRouter()
md_converter = MarkItDown()

@router.post("/upload/{thread_id}")
async def upload_file(thread_id: str, file: "UploadFile"):
    """
    Upload a file to the workspace directory corresponding to the specified session.
    - If the workspace already exists in registry.json, upload to workspace/uploads/
    - If there is no workspace yet (the session has not started analysis), upload to workspaces/{thread_id}/uploads/
    """
    from fastapi import UploadFile
    import shutil
    import aiofiles

    workspace_dir = os.path.abspath(WORKSPACES_DIR)
    
    # Find the corresponding workspace
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
        # Temporarily create the upload directory for this thread
        target_workspace = os.path.join(workspace_dir, f"thread_{thread_id}")

    upload_dir = os.path.join(target_workspace, "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    # Secure filename processing
    import re
    safe_name = re.sub(r'[^\w.\-]', '_', file.filename or "upload")
    save_path = os.path.join(upload_dir, safe_name)

    # Avoid overwriting files with the same name
    base, ext = os.path.splitext(safe_name)
    counter = 1
    while os.path.exists(save_path):
        save_path = os.path.join(upload_dir, f"{base}_{counter}{ext}")
        counter += 1

    file_size = 0
    async with aiofiles.open(save_path, 'wb') as out_file:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            await out_file.write(chunk)
            file_size += len(chunk)

    # Use the unified DocumentProcessor to convert to markdown
    convertible_exts = ['.docx', '.xlsx', '.pptx', '.pdf', '.doc', '.xls', '.ppt', '.txt', '.csv', '.html', '.json', '.xml', '.parquet', '.tsv']
    file_ext = os.path.splitext(save_path)[1].lower()

    if file_ext in convertible_exts:
        try:
            from utils.document_processor import processor
            content = processor.to_markdown(save_path)
            if content:
                md_path = os.path.splitext(save_path)[0] + '.md'
                async with aiofiles.open(md_path, 'w', encoding='utf-8') as f:
                    await f.write(content)
                print(f"[Upload] Converted {file.filename} → {os.path.basename(md_path)} using DocumentProcessor")
            else:
                print(f"[Upload] No markdown conversion available for {file.filename}, skipping.")
        except Exception as e:
            print(f"[Upload] Conversion failed for {file.filename}: {e}")

    rel_path = os.path.relpath(save_path, workspace_dir)
    print(f"[Upload] Saved {file.filename} → {save_path} ({file_size} bytes)")

    return {
        "success": True,
        "thread_id": thread_id,
        "filename": os.path.basename(save_path),
        "original_name": file.filename,
        "size": file_size,
        "path": save_path,
        "rel_path": rel_path,
    }
