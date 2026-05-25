import sys
import os

# Add the project root to path
sys.path.append("/Users/huihui/workspace/code-ws/datation")

from datation.utils.i18n import t
from datation.core.config import LANGUAGE

def verify_i18n():
    print(f"Current LANGUAGE setting: {LANGUAGE}")
    
    # Test translations
    title_zh = t('report.title', lang='zh')
    title_en = t('report.title', lang='en')
    
    print(f"ZH Title: {title_zh}")
    print(f"EN Title: {title_en}")
    
    # Test interpolation
    footer_at_zh = t('report.footer.generated_at', lang='zh', time='2026-04-11')
    footer_at_en = t('report.footer.generated_at', lang='en', time='2026-04-11')
    
    print(f"ZH Footer At: {footer_at_zh}")
    print(f"EN Footer At: {footer_at_en}")
    
    # Check default outline
    outline_zh = t('report.default_outline.executive_summary.title', lang='zh')
    outline_en = t('report.default_outline.executive_summary.title', lang='en')
    
    print(f"ZH Outline Title: {outline_zh}")
    print(f"EN Outline Title: {outline_en}")

if __name__ == "__main__":
    verify_i18n()
