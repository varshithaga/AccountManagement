"""Sign-up, sign-in (JWT), token refresh, sign-out, and the signed-in user's own profile."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import serializers as ser
from ..database import DEFAULT_COMPANY, get_db
from ..deps import get_current_user
from ..errors import APIError, bad_request
from ..models import Role, User
from ..schemas import ChangePasswordIn, LoginIn, ProfileIn, RefreshIn, RegisterIn
from ..security import (
    TokenError, check_password, create_token_pair, decode_token, hash_password, password_errors, rate_limited,
    revoke, rotate_refresh_token, token_company,
)
from ..services import audit
from ..services.companies import list_companies
from ..utils import now

router = APIRouter(prefix="/api/auth", tags=["auth"])
companies_router = APIRouter(prefix="/api/companies", tags=["auth"])


def _throttle(request: Request) -> None:
    if rate_limited(request.client.host if request.client else None):
        raise APIError(429, {"detail": "Request was throttled. Expected available in 60 seconds."})


@router.post("/token/")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    """{"username", "password"} -> {"access", "refresh"}."""
    _throttle(request)
    user = db.scalars(select(User).where(User.username == body.username)).first()
    if user is None or not user.is_active or not check_password(body.password, user.hashed_password):
        audit.record(db, "LOGIN_FAILED", "User", label=(body.username or "")[:150], entity_id=user.id if user else None,
                     username=(body.username or "")[:150])
        db.commit()
        raise APIError(401, {"detail": "No active account found with the given credentials"})
    user.last_login = now()
    audit.record(db, "LOGIN", "User", label=user.username, entity_id=user.id, user=user)
    db.commit()
    return create_token_pair(user, db.info["company"])


@router.post("/token/refresh/")
def refresh_token(body: RefreshIn, db: Session = Depends(get_db)):
    """{"refresh"} -> a new {"access", "refresh"} pair; the old refresh token stops working."""
    if not body.refresh:
        raise APIError(400, {"refresh": ["This field is required."]})
    try:
        return rotate_refresh_token(db, body.refresh)
    except TokenError:
        raise APIError(401, {"detail": "Token is invalid or expired", "code": "token_not_valid"})


@router.post("/register/", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    """Anyone can sign up. The very first account becomes the administrator; everyone after that
    has no role (no page access) until an administrator gives them one."""
    _throttle(request)
    username = (body.username or "").strip()
    password = (body.password or "").strip()
    email = (body.email or "").strip()
    if not username:
        raise APIError(400, {"error": "Username is required."})
    if not password:
        raise APIError(400, {"error": "Password is required."})
    if db.scalar(select(User.id).where(func.lower(User.username) == username.lower())):
        raise APIError(400, {"error": "Username is already taken. Please choose another username."})
    errors = password_errors(password, username, email)
    if errors:
        raise APIError(400, {"error": " ".join(errors)})

    first_user = not db.scalar(select(User.id).limit(1))
    role = db.scalars(select(Role).where(Role.is_admin.is_(True))).first() if first_user else None
    user = User(username=username, hashed_password=hash_password(password), email=email,
                first_name=(body.first_name or "").strip(), last_name=(body.last_name or "").strip(),
                role_id=role.id if role else None)
    db.info["actor"] = (None, username)  # logged as signing themselves up
    db.add(user)
    db.commit()
    tokens = create_token_pair(user, db.info["company"])
    return {
        "message": "Account created successfully!",
        **tokens,
        "user": {"id": user.id, "username": user.username, "email": user.email,
                 "first_name": user.first_name, "last_name": user.last_name},
    }


@router.post("/logout/", status_code=205)
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    """Revokes the given refresh token. No access token needed - holding the refresh token is the proof."""
    if not body.refresh:
        raise bad_request("refresh token is required.")
    try:
        payload = decode_token(body.refresh, "refresh")
        if token_company(payload) == db.info["company"]:
            revoke(db, payload)
            db.commit()
    except TokenError:
        pass  # already invalid / expired - logout still succeeds
    return Response(status_code=205)


@router.get("/me/")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The signed-in user, their role and the pages it opens, and the company they are signed in to."""
    key = db.info["company"]
    name = next((c["name"] for c in list_companies() if c["key"] == key), key)
    return {**ser.current_user(user), "company": {"key": key, "name": name}}


@companies_router.get("/")
def companies():
    """The companies one can sign in to, for the sign-in page (public - names only). With just one,
    the page shows no choice."""
    return {"companies": list_companies(), "default": DEFAULT_COMPANY}


@router.patch("/me/")
def update_me(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update their own first name, last name and email (the role is set by an administrator)."""
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value or "")
    db.commit()
    return me(user, db)


@router.post("/change-password/")
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not check_password(body.current_password or "", user.hashed_password):
        raise APIError(400, {"error": "Current password is incorrect."})
    new = body.new_password or ""
    if not new:
        raise APIError(400, {"error": "New password is required."})
    errors = password_errors(new, user.username, user.email)
    if errors:
        raise APIError(400, {"error": " ".join(errors)})
    user.hashed_password = hash_password(new)
    db.commit()
    return {"message": "Password changed."}
