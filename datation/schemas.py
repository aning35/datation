from pydantic import BaseModel

class AnalyzeRequest(BaseModel):
    query: str
    thread_id: str | None = None
    is_retry: bool = False
    restore_history: bool = False
