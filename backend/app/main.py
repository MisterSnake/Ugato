from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.games import ws
from app.settings import Settings, get_settings

router = APIRouter()


@router.get("/api/health")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str]:
    return {"status": "ok", "version": settings.app_version}


def create_app() -> FastAPI:
    application = FastAPI(title="backend")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(ws.router)
    application.include_router(router)
    return application


app = create_app()
