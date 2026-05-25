import json
import os
import re
from typing import Any

# Global dictionary
_locales = {}
_default_lang = "zh"
_loaded = False

def _load_locales():
    global _loaded, _locales
    if _loaded:
        return
    
    # Locate the locales directory relative to this file
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    locales_dir = os.path.join(base_dir, "locales")
    
    if os.path.exists(locales_dir):
        for file in os.listdir(locales_dir):
            if file.endswith(".json"):
                lang = file.split(".")[0]
                with open(os.path.join(locales_dir, file), "r", encoding="utf-8") as f:
                    try:
                        _locales[lang] = json.load(f)
                    except json.JSONDecodeError:
                        _locales[lang] = {}
    _loaded = True

def _get_nested_value(d, key):
    keys = key.split(".")
    val = d
    for k in keys:
        if isinstance(val, dict) and k in val:
            val = val[k]
        else:
            return None
    return val

def t(key: str, lang: str = None, **kwargs) -> str:
    """
    Get translated string for the key based on the language.
    If language is not provided, defaults to 'zh'.
    Supports mustache-style interpolation like: 'Hello {{name}}'.
    """
    _load_locales()
    
    target_lang = lang or _default_lang
    if target_lang not in _locales:
        target_lang = _default_lang
        
    locale_dict = _locales.get(target_lang, {})
    val = _get_nested_value(locale_dict, key)
    
    if val is None:
        # Fallback to default
        if target_lang != _default_lang:
            val = _get_nested_value(_locales.get(_default_lang, {}), key)
        
        # Still none? return key
        if val is None:
            return key
            
    if not isinstance(val, str):
        return str(val)
        
    # Interpolate variables using {{var}} or {var}
    template = val
    for k, v in kwargs.items():
        # Use a function for 'repl' to avoid backslash escape issues (e.g. paths or LaTeX)
        val_str = str(v)
        template = re.sub(r'\{\{\s*' + re.escape(k) + r'\s*\}\}', lambda _, vs=val_str: vs, template)
        template = re.sub(r'\{\s*' + re.escape(k) + r'\s*\}', lambda _, vs=val_str: vs, template)
        
    return template
