"""Small helpers shared by routers and services: dates, money, query filters, pagination."""
import math
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from .errors import APIError

ZERO = Decimal("0.00")
TWO_PLACES = Decimal("0.01")


def today() -> date:
    """Today's date in UTC (the Django app ran with TIME_ZONE = 'UTC')."""
    return datetime.now(timezone.utc).date()


def now() -> datetime:
    return datetime.now(timezone.utc)


def money(value: Optional[Decimal]) -> Optional[str]:
    """A model DecimalField as the API shows it: a "1234.50" string (None stays None)."""
    if value is None:
        return None
    return str(Decimal(value).quantize(TWO_PLACES))


def q2(value) -> Decimal:
    return Decimal(value).quantize(TWO_PLACES)


def is_true(value: Any) -> bool:
    return str(value).lower() in ("1", "true", "yes")


def parse_date(value) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        return None


def iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def int_list(raw: Optional[str]) -> list[int]:
    """"3,7" -> [3, 7], ignoring anything that isn't a number."""
    if not raw:
        return []
    return [int(x) for x in raw.split(",") if x.strip().isdigit()]


# ---------------------------------------------------------------------------
# DRF-style ?search= and ?ordering=
# ---------------------------------------------------------------------------

def apply_search(stmt: Select, search: Optional[str], *columns) -> Select:
    """Every whitespace/comma separated term must match (contains, any case) at least one
    of `columns`. A column may also be a callable term -> SQL expression (for EXISTS lookups)."""
    if not search:
        return stmt
    for term in search.replace(",", " ").split():
        clauses = [c(term) if callable(c) else c.ilike(f"%{term}%") for c in columns]
        stmt = stmt.where(or_(*clauses))
    return stmt


def apply_ordering(stmt: Select, ordering: Optional[str], allowed: dict, default: list) -> Select:
    """?ordering=name,-code over the `allowed` {name: column} map; unknown names are ignored."""
    clauses = []
    for part in (ordering or "").split(","):
        part = part.strip()
        name = part.lstrip("-")
        if name in allowed:
            col = allowed[name]
            clauses.append(col.desc() if part.startswith("-") else col.asc())
    return stmt.order_by(*(clauses or default))


# ---------------------------------------------------------------------------
# Pagination - same response shape as the Django StandardResultsPagination
# ---------------------------------------------------------------------------

DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 500


def page_params(page: Any, limit: Any, default_size: int = DEFAULT_PAGE_SIZE, max_size: int = MAX_PAGE_SIZE):
    try:
        size = int(limit) if limit not in (None, "") else default_size
    except (TypeError, ValueError):
        size = default_size
    size = max(1, min(size, max_size))
    if page in (None, ""):
        number = 1
    elif str(page) == "last":
        number = -1
    else:
        try:
            number = int(page)
        except (TypeError, ValueError):
            raise APIError(404, {"detail": "Invalid page."})
        if number < 1:
            raise APIError(404, {"detail": "Invalid page."})
    return number, size


def page_response(items: list, count: int, number: int, size: int) -> dict:
    total_pages = max(1, math.ceil(count / size))
    return {
        "count": count,
        "next": number + 1 if number < total_pages else None,
        "previous": number - 1 if number > 1 else None,
        "current_page": number,
        "total_pages": total_pages,
        "results": items,
    }


def paginate(db: Session, stmt: Select, page: Any, limit: Any, serialize=None, *, serialize_many=None,
             default_size: int = DEFAULT_PAGE_SIZE, max_size: int = MAX_PAGE_SIZE) -> dict:
    """Runs `stmt` (a select of one entity) for one page and serializes it - row by row with
    `serialize`, or the whole page at once with `serialize_many` (to batch related lookups)."""
    number, size = page_params(page, limit, default_size, max_size)
    count = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    total_pages = max(1, math.ceil(count / size))
    if number == -1:
        number = total_pages
    if number > total_pages:
        raise APIError(404, {"detail": "Invalid page."})
    rows = db.scalars(stmt.offset((number - 1) * size).limit(size)).unique().all()
    items = serialize_many(list(rows)) if serialize_many else [serialize(r) for r in rows]
    return page_response(items, count, number, size)


def paginate_list(rows: list, page: Any, limit: Any, default_size: int = DEFAULT_PAGE_SIZE) -> dict:
    """Pagination over an already-built Python list."""
    number, size = page_params(page, limit, default_size)
    total_pages = max(1, math.ceil(len(rows) / size))
    if number == -1:
        number = total_pages
    if number > total_pages:
        raise APIError(404, {"detail": "Invalid page."})
    start = (number - 1) * size
    return page_response(rows[start:start + size], len(rows), number, size)


def get_or_404(db: Session, model, obj_id, name: Optional[str] = None):
    obj = db.get(model, obj_id)
    if obj is None:
        raise APIError(404, {"detail": f"No {name or model.__name__} matches the given query."})
    return obj
