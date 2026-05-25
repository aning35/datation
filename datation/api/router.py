from fastapi import APIRouter

from api.base import router as base_router
from api.history import router as history_router
from api.upload import router as upload_router
from api.analyze import router as analyze_router
from api.files import router as files_router
from api.suggestions import router as suggestions_router

api_router = APIRouter()

api_router.include_router(base_router)
api_router.include_router(history_router)
api_router.include_router(upload_router)
api_router.include_router(analyze_router)
api_router.include_router(files_router)
api_router.include_router(suggestions_router)
