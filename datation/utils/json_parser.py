import re
import json

def extract_json(text: str, fallback=None) -> dict | list:
    """
    Robustly extract and parse JSON from the mixed output of large language models.
    Compatible with all the following scenarios:
      1. Pure JSON output.
      2. ```json ... ``` Markdown code blocks.
      3. Mixed natural language + JSON (takes the last {...} or [...]).
      4. Outputs with reasoning/thinking prefixes.
      
    If a fallback parameter is provided, it returns the fallback when parsing fails without throwing an exception.
    If no fallback is provided, parsing failure will throw a ValueError.
    """
    if not text or not text.strip():
        if fallback is not None:
            return fallback
        raise ValueError("LLM returned empty output")

    text = text.strip()

    # Solution 1: the entire block is valid JSON
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass

    # Solution 2: extract ```json ... ``` or ``` ... ``` code blocks
    md_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', text, re.DOTALL)
    if md_match:
        try:
            return json.loads(md_match.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            pass

    # Solution 3: find the outermost {...} or [...] block (greedy matching, handling nesting)
    # Prioritize {} 
    brace_depth = 0
    start_idx = None
    candidates = []
    
    for i, ch in enumerate(text):
        if ch == '{':
            if brace_depth == 0:
                start_idx = i
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
            if brace_depth == 0 and start_idx is not None:
                candidates.append(text[start_idx:i+1])
                start_idx = None

    # If no {} is found, try to find []
    if not candidates:
        bracket_depth = 0
        b_start_idx = None
        for i, ch in enumerate(text):
            if ch == '[':
                if bracket_depth == 0:
                    b_start_idx = i
                bracket_depth += 1
            elif ch == ']':
                bracket_depth -= 1
                if bracket_depth == 0 and b_start_idx is not None:
                    candidates.append(text[b_start_idx:i+1])
                    b_start_idx = None

    # Try from the last candidate (usually the last appearing one is the final answer)
    for candidate in reversed(candidates):
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue

    if fallback is not None:
        return fallback

    raise ValueError(f"Cannot extract JSON from LLM output (first 300 chars): {text[:300]}")
