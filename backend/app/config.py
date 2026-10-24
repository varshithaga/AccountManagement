"""Settings, read from environment variables (or a .env file next to the backend)."""
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    # Both come only from the environment / .env (see .env.example) - never from code, so no password
    # or signing key ends up in git. The app refuses to start without them.
    database_url: str = Field(description="e.g. postgresql+psycopg://user:password@localhost:5432/account_management")
    secret_key: str = Field(min_length=32, description="Signs the login tokens - a long random string")
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    # Comma-separated, e.g. "http://localhost:5173,http://127.0.0.1:5173"
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
    # Also allowed: these origins as a regex. By default any port on localhost / 127.0.0.1, because Vite
    # moves to 5174, 5175... when 5173 is busy. Set to "" in production to allow only the list above.
    cors_allowed_origin_regex: str = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
    media_root: Path = BASE_DIR / "media"
    # Login / register attempts allowed per client IP per minute
    auth_rate_limit_per_minute: int = 20

    # Outgoing email (invoices, payment reminders). Leave SMTP_HOST empty to turn email off.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""                 # e.g. "Accounts <accounts@example.com>"; default: SMTP_USERNAME
    smtp_security: str = "starttls"     # starttls (port 587), ssl (port 465) or none
    smtp_timeout_seconds: int = 20

    # How often the server raises recurring invoices that have fallen due (0 = only on demand /
    # `python cli.py run-recurring`).
    recurring_check_minutes: int = 60

    # Where `python cli.py backup` writes backups (default: backend/backups)
    backup_dir: Path = BASE_DIR / "backups"
    # Folder with pg_dump / pg_restore when they are not on PATH, e.g. "C:/Program Files/PostgreSQL/18/bin"
    pg_bin_dir: str = ""

    # AI Assistant: a read-only chat about the books. Gemini is asked first; OpenAI answers when Gemini
    # fails (error, quota, timeout) or has no key. Leave both keys empty to turn the assistant off.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    ai_timeout_seconds: int = 60

    # Testing tools (Delete Month Journals: wipes a bank's journal entries for a month or for all
    # time). Off by default; when on, only administrators can use them. Keep off on live books.
    testing_tools: bool = False

    @field_validator("secret_key")
    @classmethod
    def _not_placeholder(cls, value: str) -> str:
        if "change-me" in value:
            raise ValueError("SECRET_KEY is still the placeholder from .env.example - set a long random string")
        return value

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_host and (self.smtp_from or self.smtp_username))

    @property
    def ai_providers(self) -> list[str]:
        """The AI services with a key, in the order they are tried."""
        return [name for name, key in (("gemini", self.gemini_api_key), ("openai", self.openai_api_key)) if key]

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except Exception as exc:
        raise SystemExit(
            f"Configuration error: {exc}\n\nCopy backend/.env.example to backend/.env and set DATABASE_URL and SECRET_KEY "
            '(generate a key with: python -c "import secrets; print(secrets.token_urlsafe(48))").'
        ) from None
