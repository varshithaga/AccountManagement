"""Passwords (bcrypt) and JWT access / refresh tokens (rotated, revocable on logout)."""
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .config import get_settings
from .models import RevokedToken, User

ALGORITHM = "HS256"
settings = get_settings()


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("ascii")


def check_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("ascii"))
    except ValueError:
        return False


COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
    "qwertyuiop", "iloveyou", "admin123", "welcome1", "letmein1", "abc12345", "11111111",
    "00000000", "passw0rd", "sunshine", "football", "baseball", "superman", "trustno1",
}


def password_errors(password: str, username: str = "", email: str = "") -> list[str]:
    """The same rules as the Django validators the old API used."""
    errors = []
    if len(password) < 8:
        errors.append("This password is too short. It must contain at least 8 characters.")
    if password.lower() in COMMON_PASSWORDS:
        errors.append("This password is too common.")
    if password.isdigit():
        errors.append("This password is entirely numeric.")
    for attr in (username, email.split("@")[0] if email else ""):
        if attr and len(attr) >= 3 and attr.lower() in password.lower():
            errors.append("The password is too similar to the username." if attr == username
                          else "The password is too similar to the email address.")
            break
    return errors


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------

class TokenError(Exception):
    pass


def _encode(user_id: int, company: str, token_type: str, lifetime: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": user_id,
        "company": company,
        "token_type": token_type,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def token_company(payload: dict) -> str:
    # Tokens issued before there were several companies carry none - they belong to "default".
    return payload.get("company") or "default"


def create_token_pair(user: User, company: str) -> dict:
    """Tokens for a user of `company` - only accepted on requests to that company."""
    return {
        "access": _encode(user.id, company, "access", timedelta(minutes=settings.access_token_minutes)),
        "refresh": _encode(user.id, company, "refresh", timedelta(days=settings.refresh_token_days)),
    }


def decode_token(token: str, token_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise TokenError("Token is expired")
    except jwt.PyJWTError:
        raise TokenError("Token is invalid")
    if payload.get("token_type") != token_type:
        raise TokenError("Token has wrong type")
    return payload


def revoke(db: Session, payload: dict) -> None:
    if not db.get(RevokedToken, payload["jti"]):
        db.add(RevokedToken(jti=payload["jti"], expires_at=datetime.fromtimestamp(payload["exp"], timezone.utc)))
    # Expired entries can never be presented again - no need to keep them.
    db.execute(delete(RevokedToken).where(RevokedToken.expires_at < datetime.now(timezone.utc)))


def is_revoked(db: Session, payload: dict) -> bool:
    return db.get(RevokedToken, payload["jti"]) is not None


def rotate_refresh_token(db: Session, refresh: str) -> dict:
    """Validates a refresh token, revokes it, and returns a new access + refresh pair."""
    payload = decode_token(refresh, "refresh")
    company = db.info.get("company", "default")
    if token_company(payload) != company:
        raise TokenError("Token is for another company")
    if is_revoked(db, payload):
        raise TokenError("Token is blacklisted")
    user = db.get(User, payload["user_id"])
    if user is None or not user.is_active:
        raise TokenError("User not found")
    revoke(db, payload)
    db.commit()
    return create_token_pair(user, company)


# ---------------------------------------------------------------------------
# Rate limiting for login / register (in-memory, per client IP)
# ---------------------------------------------------------------------------

_attempts: dict[str, deque] = defaultdict(deque)


def rate_limited(key: Optional[str]) -> bool:
    """True when `key` already made the allowed number of attempts in the last minute."""
    key = key or "unknown"
    window = _attempts[key]
    cutoff = time.monotonic() - 60
    while window and window[0] < cutoff:
        window.popleft()
    if len(window) >= settings.auth_rate_limit_per_minute:
        return True
    window.append(time.monotonic())
    return False


def reset_rate_limits() -> None:
    _attempts.clear()
