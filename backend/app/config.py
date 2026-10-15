"""Settings, read from environment variables (or a .env file next to the backend)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    # PostgreSQL database "account_management". Override with DATABASE_URL in .env.
    database_url: str = "postgresql+psycopg://postgres:1234@localhost:5432/account_management"
    secret_key: str = "change-me-in-production"
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    # Comma-separated, e.g. "http://localhost:5173,http://127.0.0.1:5173"
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
    media_root: Path = BASE_DIR / "media"
    # Login / register attempts allowed per client IP per minute
    auth_rate_limit_per_minute: int = 20

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
