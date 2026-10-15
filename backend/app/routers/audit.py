"""Audit Log: read-only history of who changed what."""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Access
from ..models import AuditLog
from ..utils import apply_search, iso, paginate, parse_date

router = APIRouter(prefix="/api/audit-log", tags=["audit log"])
view = Access("audit_log")


def _row(log: AuditLog) -> dict:
    return {"id": log.id, "at": iso(log.at), "user": log.user_id, "username": log.username, "action": log.action,
            "entity": log.entity, "entity_id": log.entity_id, "label": log.label, "changes": log.changes}


@router.get("/", dependencies=[Depends(view)])
def list_log(page: Optional[str] = None, limit: Optional[str] = None, search: Optional[str] = None,
             user: Optional[int] = None, action: Optional[str] = None, entity: Optional[str] = None,
             entity_id: Optional[int] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
             db: Session = Depends(get_db)):
    """Newest first. Filters: ?user= ?action= ?entity= ?entity_id= ?date_from= ?date_to= ?search= (label / user)."""
    stmt = select(AuditLog)
    if user:
        stmt = stmt.where(AuditLog.user_id == user)
    if action:
        stmt = stmt.where(AuditLog.action == action.upper())
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if start := parse_date(date_from):
        stmt = stmt.where(AuditLog.at >= start)
    if end := parse_date(date_to):
        stmt = stmt.where(AuditLog.at < end + timedelta(days=1))
    stmt = apply_search(stmt, search, AuditLog.label, AuditLog.username, AuditLog.entity)
    return paginate(db, stmt.order_by(AuditLog.at.desc(), AuditLog.id.desc()), page, limit, _row)


@router.get("/filters/", dependencies=[Depends(view)])
def filters(db: Session = Depends(get_db)):
    """The actions, record types and users that appear in the log - for the filter dropdowns."""
    return {
        "actions": sorted(db.scalars(select(AuditLog.action).distinct())),
        "entities": sorted(db.scalars(select(AuditLog.entity).distinct())),
        "users": [{"id": uid, "username": name} for uid, name in
                  db.execute(select(AuditLog.user_id, AuditLog.username).where(AuditLog.user_id.is_not(None))
                             .distinct().order_by(AuditLog.username))],
    }
