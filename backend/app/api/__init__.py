from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.events import router as events_router
from app.api.health import router as health_router
from app.api.social import router as social_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(events_router)
api_router.include_router(social_router)
