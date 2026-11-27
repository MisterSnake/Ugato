import os
from dataclasses import dataclass

DEFAULT_APP_VERSION = "dev"
DEFAULT_ALLOWED_ORIGINS = ("http://localhost:5173",)


@dataclass(frozen=True)
class Settings:
    app_version: str
    allowed_origins: list[str]


def _parse_origins(raw: str) -> list[str]:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def get_settings() -> Settings:
    origins = _parse_origins(os.environ.get("ALLOWED_ORIGINS", ""))
    return Settings(
        app_version=os.environ.get("APP_VERSION") or DEFAULT_APP_VERSION,
        allowed_origins=origins or list(DEFAULT_ALLOWED_ORIGINS),
    )
