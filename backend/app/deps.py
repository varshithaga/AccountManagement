"""FastAPI dependencies: the signed-in user, and page-based access checks."""
from typing import Optional, Sequence, Union

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .access import CREATE, EDIT, METHOD_ACTIONS, user_actions, user_pages
from .database import DEFAULT_COMPANY, get_db
from .errors import APIError
from .models import User
from .security import TokenError, decode_token, token_company
from .services.audit import set_actor

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise APIError(401, {"detail": "Authentication credentials were not provided."})
    try:
        payload = decode_token(credentials.credentials, "access")
    except TokenError as exc:
        raise APIError(401, {"detail": "Given token not valid for any token type",
                             "code": "token_not_valid", "messages": [{"message": str(exc)}]})
    # User ids repeat across company databases: a token is only good for the company it was issued in.
    if token_company(payload) != db.info.get("company", DEFAULT_COMPANY):
        raise APIError(401, {"detail": "This sign-in is for another company - sign in again.",
                             "code": "wrong_company"})
    user = db.get(User, payload.get("user_id"))
    if user is None or not user.is_active:
        raise APIError(401, {"detail": "User not found", "code": "user_not_found"})
    set_actor(db, user)  # the audit log names this user for everything the request changes
    return user


class Access:
    """Dependency that lets a request through when the user's role opens one of `pages`
    and - for a request that changes data - holds the needed right on one of `write_pages`
    (by default the same pages; or a {right: pages} dict).

    action: the right this endpoint needs, overriding the HTTP method's default
    (None after a GET/HEAD means a read). Use action="read" for a POST that only reads.
    inline_create_pages: pages whose create or edit right is enough for a plain create
    (adding a missing account from a dropdown while working on that page).
    pages=() means any signed-in user."""

    def __init__(self, *pages: str, write_pages: Union[Sequence[str], dict, None] = None,
                 action: Optional[str] = None, inline_create_pages: Sequence[str] = ()):
        self.pages = pages
        self.write_pages = write_pages if write_pages is not None else pages
        self.action = action
        self.inline_create_pages = inline_create_pages

    def __call__(self, request: Request, user: User = Depends(get_current_user)) -> User:
        if not self.pages:
            return user
        if not set(self.pages) & set(user_pages(user)):
            raise APIError(403, {"detail": "Your role does not have access to this page."})
        action = self.action or METHOD_ACTIONS.get(request.method)
        if action in (None, "read"):
            return user
        granted = user_actions(user)
        write_pages = self.write_pages
        if isinstance(write_pages, dict):  # a different set of pages per right
            write_pages = write_pages.get(action, ())
        if any(action in granted.get(page, ()) for page in write_pages):
            return user
        if action == CREATE and any({CREATE, EDIT} & set(granted.get(page, ())) for page in self.inline_create_pages):
            return user
        raise APIError(403, {"detail": f"Your role does not have the {action} right on this page."})
