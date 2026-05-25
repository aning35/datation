from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import asyncio
import pandas as pd
import os
from litellm import completion
from core.config import MODEL_NAME, LLM_API_BASE, LLM_API_KEY, LANGUAGE

router = APIRouter()

class SuggestionRequest(BaseModel):
    filename: str
    refresh: bool = False
    excluded: List[str] = []

@router.post("/suggestions/from-file")
async def generate_suggestions_from_file(req: SuggestionRequest) -> dict:
    """Generate analysis suggestions based on the uploaded file"""
    try:
        file_path = req.filename

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        ext = os.path.splitext(file_path)[1].lower()

        # Use the unified DocumentProcessor to extract content summaries and metadata
        from utils.document_processor import processor
        content = processor.get_preview(file_path, max_chars=4000)
        metadata = processor.get_metadata(file_path)

        # Use the LLM to generate suggestions
        if content.strip():
            try:
                lang_instruction = "in Chinese (simplified)" if LANGUAGE == "zh" else "in English"
                
                refresh_instruction = ""
                if req.refresh:
                    refresh_instruction = "IMPORTANT: Provide NEW and DIFFERENT suggestions than these (if provided): " + ", ".join(req.excluded)
                
                prompt = f"""Based on this file content/metadata, generate 3 concise, highly relevant, and creative analysis suggestions (each under 60 characters) {lang_instruction}.
The suggestions should be actionable tasks like 'Analyze the correlation between X and Y' or 'Visualize the distribution of Z'.

{refresh_instruction}

File Metadata:
{metadata}

File Content/Preview:
{content}

Return ONLY 3 suggestions, one per line, no numbering, no prefix."""

                # LiteLLM requires a provider prefix when using custom API bases.
                # Fallback to 'openai/' prefix if no prefix is provided.
                litellm_model = MODEL_NAME
                if "/" not in litellm_model:
                    litellm_model = f"openai/{litellm_model}"

                response = await asyncio.to_thread(
                    completion,
                    model=litellm_model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.8 if req.refresh else 0.4,
                    api_base=LLM_API_BASE,
                    api_key=LLM_API_KEY,
                    model_kwargs={
                        "extra_body": {
                            "enable_thinking": False
                        }
                    }
                )

                suggestions = response.choices[0].message.content.strip().split('\n')
                suggestions = [s.strip('- *123.').strip() for s in suggestions if s.strip()][:3]

                if suggestions:
                    return {"suggestions": suggestions}
            except Exception as llm_error:
                print(f"[Suggestions] LLM call failed: {llm_error}")

        # Fallback logic if LLM fails or no content
        ext = os.path.splitext(file_path)[1].lower()
        if ext in ['.csv', '.xlsx', '.xls', '.parquet', '.tsv']:
            # Basic heuristic suggestions
            if LANGUAGE == "zh":
                return {"suggestions": ["分析数据分布", "查看关键统计指标", "探索变量间的相关性"]}
            else:
                return {"suggestions": ["Analyze data distribution", "View key statistics", "Explore correlations"]}
        
        if LANGUAGE == "zh":
            if req.refresh:
                return {"suggestions": ["深入挖掘细节", "识别潜在模式", "生成总结报告"]}
            return {"suggestions": ["总结关键要点", "提取主要见解", "分析核心内容"]}
        
        return {"suggestions": ["Summarize key points", "Extract main insights", "Analyze core content"]}

    except Exception as e:
        print(f"[Suggestions] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
