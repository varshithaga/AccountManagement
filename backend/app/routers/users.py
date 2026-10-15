"""User Management: users and roles."""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import serializers as ser
from ..access import EDIT, PAGE_ACTIONS, PAGE_KEYS, clean_actions, is_admin
from ..database import get_db
from ..deps import Access
from ..errors import APIError, bad_request
from ..models import Role, User
from ..schemas import ResetPasswordIn, RoleIn, UserIn
from ..security import hash_password, password_errors
from ..utils import apply_search, get_or_404, is_true, paginate

router = APIRouter(prefix="/api", tags=["users"])
can = Access("user_management")


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

def _validate_role(db: Session, data: dict, role: Optional[Role] = None) -> dict:
    errors = {}
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            errors["name"] = ["This field may not be blank."]
        else:
            clash = select(Role.id).where(func.lower(Role.name) == name.lower())
            if role:
                clash = clash.where(Role.id != role.id)
            if db.scalar(clash):
                errors["name"] = ["A role with this name already exists."]
            data["name"] = name
    elif role is None:
        errors["name"] = ["This field is required."]
    if data.get("pages") is not None:
        unknown = [k for k in data["pages"] if k not in PAGE_KEYS]
        if unknown:
            errors["pages"] = [f'Unknown page(s): {", ".join(unknown)}.']
        else:
            data["pages"] = [k for k in PAGE_KEYS if k in data["pages"]]
    if data.get("actions") is not None:
        for page, granted in data["actions"].items():
            if page not in PAGE_KEYS:
                errors["actions"] = [f"Unknown page: {page}."]
                break
            bad = [a for a in granted if a not in PAGE_ACTIONS.get(page, ())]
            if bad:
                errors["actions"] = [f'{page} has no such right(s): {", ".join(bad)}.']
                break
    if errors:
        raise APIError(400, errors)
    # Rights only count on pages the role opens - dropping a page drops its rights too.
    if "pages" in data or "actions" in data:
        pages = data.get("pages") if data.get("pages") is not None else (role.pages if role else [])
        actions = data.get("actions") if data.get("actions") is not None else (role.actions if role else {})
        data["pages"] = pages
        data["actions"] = clean_actions(actions, pages)
    return data


def _user_counts(db: Session) -> dict:
    return dict(db.execute(select(User.role_id, func.count(User.id)).group_by(User.role_id)).all())


@router.get("/roles/", dependencies=[Depends(can)])
def list_roles(db: Session = Depends(get_db)):
    counts = _user_counts(db)
    roles = db.scalars(select(Role).order_by(Role.is_admin.desc(), Role.name)).all()
    return [ser.role(r, counts.get(r.id, 0)) for r in roles]


@router.post("/roles/", status_code=201, dependencies=[Depends(can)])
def create_role(body: RoleIn, db: Session = Depends(get_db)):
    data = _validate_role(db, body.model_dump(exclude_unset=True))
    role = Role(name=data["name"], description=data.get("description") or "",
                pages=data.get("pages") or [], actions=data.get("actions") or {})
    db.add(role)
    db.commit()
    return ser.role(role, 0)


@router.get("/roles/{role_id}/", dependencies=[Depends(can)])
def get_role(role_id: int, db: Session = Depends(get_db)):
    return ser.role(get_or_404(db, Role, role_id), _user_counts(db).get(role_id, 0))


@router.put("/roles/{role_id}/", dependencies=[Depends(can)])
@router.patch("/roles/{role_id}/", dependencies=[Depends(can)])
def update_role(role_id: int, body: RoleIn, db: Session = Depends(get_db)):
    role = get_or_404(db, Role, role_id)
    if role.is_admin:
        raise bad_request("The Admin role always has full access and cannot be edited.")
    for field, value in _validate_role(db, body.model_dump(exclude_unset=True), role).items():
        setattr(role, field, value if value is not None else ("" if field == "description" else getattr(role, field)))
    db.commit()
    return ser.role(role, _user_counts(db).get(role.id, 0))


@router.delete("/roles/{role_id}/", status_code=204, dependencies=[Depends(can)])
def delete_role(role_id: int, db: Session = Depends(get_db)):
    role = get_or_404(db, Role, role_id)
    if role.is_admin:
        raise bad_request("The Admin role cannot be deleted.")
    n = _user_counts(db).get(role.id, 0)
    if n:
        raise bad_request(f'"{role.name}" is still assigned to {n} user(s). Give them another role first.')
    db.delete(role)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def _other_admin_exists(db: Session, user: User) -> bool:
    admin_role_ids = select(Role.id).where(Role.is_admin.is_(True))
    return bool(db.scalar(select(User.id).where(
        User.is_active.is_(True), User.id != user.id,
        or_(User.is_superuser.is_(True), User.role_id.in_(admin_role_ids)),
    ).limit(1)))


def _check_username(db: Session, username: str, user: Optional[User] = None) -> str:
    username = (username or "").strip()
    if not username:
        raise APIError(400, {"username": ["This field may not be blank."]})
    clash = select(User.id).where(func.lower(User.username) == username.lower())
    if user:
        clash = clash.where(User.id != user.id)
    if db.scalar(clash):
        raise APIError(400, {"username": ["Username is already taken."]})
    return username


def _check_role(db: Session, role_id) -> Optional[int]:
    if role_id is None:
        return None
    if not db.get(Role, role_id):
        raise APIError(400, {"role": [f'Invalid pk "{role_id}" - object does not exist.']})
    return role_id


@router.get("/users/", dependencies=[Depends(can)])
def list_users(db: Session = Depends(get_db), search: Optional[str] = None, role: Optional[int] = None,
               is_active: Optional[str] = None, page: Optional[str] = None, limit: Optional[str] = None):
    """?search= matches username, name and email; ?role=<id> and ?is_active=true|false filter."""
    stmt = select(User)
    stmt = apply_search(stmt, search, User.username, User.first_name, User.last_name, User.email)
    if role:
        stmt = stmt.where(User.role_id == role)
    if is_active:
        stmt = stmt.where(User.is_active.is_(is_true(is_active)))
    return paginate(db, stmt.order_by(User.username), page, limit, ser.user)


@router.post("/users/", status_code=201, dependencies=[Depends(can)])
def create_user(body: UserIn, db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    username = _check_username(db, data.get("username"))
    password = data.get("password")
    if not password:
        raise APIError(400, {"password": ["Password is required."]})
    errors = password_errors(password, username, data.get("email") or "")
    if errors:
        raise APIError(400, {"password": errors})
    user = User(username=username, hashed_password=hash_password(password), email=data.get("email") or "",
                first_name=data.get("first_name") or "", last_name=data.get("last_name") or "",
                is_active=data.get("is_active", True), role_id=_check_role(db, data.get("role")))
    db.add(user)
    db.commit()
    return ser.user(user)


@router.get("/users/{user_id}/", dependencies=[Depends(can)])
def get_user(user_id: int, db: Session = Depends(get_db)):
    return ser.user(get_or_404(db, User, user_id))


@router.put("/users/{user_id}/")
@router.patch("/users/{user_id}/")
def update_user(user_id: int, body: UserIn, db: Session = Depends(get_db), me: User = Depends(can)):
    """An administrator can't deactivate themselves, and the last active administrator can't be
    deactivated or demoted. A password sent here is ignored - use reset-password."""
    user = get_or_404(db, User, user_id)
    was_admin = user.is_active and is_admin(user)
    data = body.model_dump(exclude_unset=True)
    data.pop("password", None)
    if user.id == me.id and data.get("is_active") is False:
        raise bad_request("You cannot deactivate your own account.")
    if "username" in data:
        data["username"] = _check_username(db, data["username"], user)
    if "role" in data:
        user.role_id = _check_role(db, data.pop("role"))
    for field, value in data.items():
        setattr(user, field, value if value is not None else "")
    db.flush()
    db.refresh(user, ["role"])
    if was_admin and not (user.is_active and is_admin(user)) and not _other_admin_exists(db, user):
        db.rollback()
        raise bad_request("This is the last active administrator - assign another one first.")
    db.commit()
    return ser.user(user)


@router.delete("/users/{user_id}/", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), me: User = Depends(can)):
    user = get_or_404(db, User, user_id)
    if user.id == me.id:
        raise bad_request("You cannot delete your own account.")
    if user.is_active and is_admin(user) and not _other_admin_exists(db, user):
        raise bad_request("This is the last active administrator - assign another one first.")
    db.delete(user)
    db.commit()
    return Response(status_code=204)


@router.post("/users/{user_id}/reset-password/", dependencies=[Depends(Access("user_management", action=EDIT))])
def reset_password(user_id: int, body: ResetPasswordIn, db: Session = Depends(get_db)):
    """An administrator sets a new password for the user."""
    user = get_or_404(db, User, user_id)
    new = body.new_password or ""
    if not new:
        raise APIError(400, {"error": "New password is required."})
    errors = password_errors(new, user.username, user.email)
    if errors:
        raise APIError(400, {"error": " ".join(errors)})
    user.hashed_password = hash_password(new)
    db.commit()
    return {"message": f"Password reset for {user.username}."}
