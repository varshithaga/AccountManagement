"""The singleton settings rows (always id=1), created on first read."""
from sqlalchemy.orm import Session

from ..models import AccountingSettings, CategorizationSettings, ReconciliationSettings


def _solo(db: Session, model):
    obj = db.get(model, 1)
    if obj is None:
        obj = model(id=1)
        db.add(obj)
        db.flush()
    return obj


def categorization_settings(db: Session) -> CategorizationSettings:
    return _solo(db, CategorizationSettings)


def reconciliation_settings(db: Session) -> ReconciliationSettings:
    return _solo(db, ReconciliationSettings)


def accounting_settings(db: Session) -> AccountingSettings:
    return _solo(db, AccountingSettings)
