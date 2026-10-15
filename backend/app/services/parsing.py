"""Parses uploaded bank statements (Excel, CSV or PDF) into a normalized list of rows.

Real bank statement exports are messy: a title/period banner above the header,
an "Opening Balance" row, a "TOTAL" row at the end, and (for PDFs) the header
repeated on every page. This module absorbs all of that so the rest of the
pipeline only ever sees clean Transaction-shaped rows.
"""
import csv as csv_module
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

import pandas as pd
import pdfplumber

COLUMN_ALIASES = {
    'date': [
        'date', 'txn date', 'transaction date', 'value date', 'posting date',
        'post date', 'book date', 'tran date',
    ],
    'description': [
        'description / narration', 'description', 'narration', 'particulars',
        'transaction details', 'transaction remarks', 'remarks', 'details', 'narrative',
    ],
    'debit': [
        'debit', 'withdrawal', 'debit amount', 'withdrawal amt', 'withdrawal amt.',
        'withdrawal amount', 'paid out', 'dr',
    ],
    'credit': [
        'credit', 'deposit', 'credit amount', 'deposit amt', 'deposit amt.',
        'deposit amount', 'paid in', 'cr',
    ],
    'balance': ['balance', 'closing balance', 'running balance', 'available balance', 'ledger balance'],
    # Some banks export a single amount column instead of separate debit/credit
    # columns - either alongside a Dr/Cr flag column, or (see AMOUNT_FIELD_SETS
    # and _row_to_parsed) as a bare signed amount, where the sign itself is the
    # convention: negative = money out (debit), positive = money in (credit).
    'amount': ['amount', 'transaction amount', 'txn amount'],
    'type': ['dr/cr', 'cr/dr', 'type', 'transaction type', 'd/c'],
    'bai_code': ['bai', 'bai code', 'bai_code', 'baicode', 'bai transaction code', 'transaction type code', 'txn type code'],
}

# _map_columns() accepts a header as valid if it has date+description plus
# either of these alternatives for the amount side.
AMOUNT_FIELD_SETS = [{'debit'}, {'credit'}, {'amount', 'type'}, {'amount'}]

IGNORED_DESCRIPTION_VALUES = {'opening balance', 'total', 'closing balance'}
BLANK_AMOUNT_VALUES = {'', '-', '--', '—', 'nan', 'nil', 'n/a', 'na'}
DEBIT_FLAG_VALUES = {'d', 'dr', 'debit'}


class StatementParsingError(Exception):
    pass


@dataclass
class ParsedRow:
    date: date
    description: str
    debit: Decimal
    credit: Decimal
    balance: Optional[Decimal]
    bai_code: str = ''


def _normalize_header(value) -> str:
    text = re.sub(r'\s+', ' ', str(value or '')).strip().lower()
    # Drop a trailing currency annotation like "(inr)", "(rs.)", "(₹)" - banks
    # append these inconsistently and they'd otherwise block an exact alias match.
    return re.sub(r'\s*\([^)]*\)\s*$', '', text).strip()


def _clean_text(value) -> str:
    """Stringifies a cell value, treating None/NaN as empty (NaN is truthy, so a bare
    `str(value or '')` would otherwise turn a blank cell into the string 'nan')."""
    if value is None:
        return ''
    if isinstance(value, float) and pd.isna(value):
        return ''
    return str(value).strip()


TWO_PLACES = Decimal('0.01')


def _clean_amount(value) -> Decimal:
    if value is None:
        return Decimal('0')
    if isinstance(value, (int, float, Decimal)):
        if pd.isna(value):
            return Decimal('0')
        return Decimal(str(value)).quantize(TWO_PLACES)
    text = str(value).strip()
    if text.lower() in BLANK_AMOUNT_VALUES:
        return Decimal('0')
    text = text.replace('\n', ' ').replace(',', '').replace('₹', '').replace('Rs.', '').replace('INR', '').replace('$', '').strip()
    text = re.sub(r'^\((.*)\)$', r'-\1', text)  # (100.00) -> -100.00
    try:
        return Decimal(text).quantize(TWO_PLACES)
    except InvalidOperation:
        # PDF table extraction can bleed stray characters into an otherwise-numeric
        # cell (e.g. a diagonal watermark overlapping the column) - pull out just
        # the numeric token rather than giving up and silently recording a 0.
        m = re.search(r'-?\d+\.\d{2}', text)
        if m:
            try:
                return Decimal(m.group(0)).quantize(TWO_PLACES)
            except InvalidOperation:
                pass
        return Decimal('0')


def _clean_optional_amount(value) -> Optional[Decimal]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    if text.lower() in BLANK_AMOUNT_VALUES:
        return None
    return _clean_amount(value)


DATE_FORMATS_DAY_FIRST = ['%d-%b-%Y', '%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%d %b %Y', '%m/%d/%Y']
DATE_FORMATS_MONTH_FIRST = ['%d-%b-%Y', '%m/%d/%Y', '%Y-%m-%d', '%d-%m-%Y', '%d %b %Y', '%d/%m/%Y']

SLASH_DATE_RE = re.compile(r'^(\d{1,2})/(\d{1,2})/\d{4}$')


def _detect_month_first(date_values) -> bool:
    """A bare 09/03/2026 is ambiguous - decide the column's convention (US
    MM/DD/YYYY vs. day-first DD/MM/YYYY) from whichever row in the column has
    a component that can only be a month or only be a day. Defaults to
    day-first (Indian/European bank exports) when every value is ambiguous."""
    for value in date_values:
        text = str(value).strip() if value is not None else ''
        m = SLASH_DATE_RE.match(text)
        if not m:
            continue
        first, second = int(m.group(1)), int(m.group(2))
        if first > 12:
            return False  # first component must be the day
        if second > 12:
            return True  # second component must be the day -> month-first
    return False


def _parse_date(value, month_first: bool = False) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text or text == '-':
        return None
    # A narrow PDF date column can wrap the last digit of the year onto its own
    # line (e.g. "01-Mar-202\n6") - close that gap, but only strictly between two
    # digits, so a legitimate "01 Mar 2026"-style format still matches below.
    text = re.sub(r'(?<=\d)\s+(?=\d)', '', text)
    formats = DATE_FORMATS_MONTH_FIRST if month_first else DATE_FORMATS_DAY_FIRST
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        parsed = pd.to_datetime(text, dayfirst=not month_first, errors='raise')
        return parsed.date()
    except Exception:
        return None


def _map_columns(header_cells) -> Optional[dict]:
    """Given a row of header cell values, return {field: column_index} or None if it's not a header row."""
    normalized = [_normalize_header(c) for c in header_cells]
    mapping = {}
    for field, aliases in COLUMN_ALIASES.items():
        for idx, cell in enumerate(normalized):
            if cell in aliases:
                mapping[field] = idx
                break
    has_amount_side = any(fields <= mapping.keys() for fields in AMOUNT_FIELD_SETS)
    if 'date' in mapping and 'description' in mapping and has_amount_side:
        return mapping
    return None


def _row_to_parsed(mapping: dict, cells: list, month_first: bool = False) -> Optional[ParsedRow]:
    def cell(field):
        idx = mapping.get(field)
        if idx is None or idx >= len(cells):
            return None
        return cells[idx]

    description = _clean_text(cell('description'))
    if description.lower() in IGNORED_DESCRIPTION_VALUES:
        return None

    bai_code = _clean_text(cell('bai_code'))
    if bai_code in ('-', '—', 'nan', 'None'):
        bai_code = ''
    elif bai_code.endswith('.0') and bai_code.replace('.0', '').isdigit():
        bai_code = bai_code[:-2]  # pandas reads a numeric BAI code column as float (e.g. 464.0)

    # A row with no description is normally a stray banner/footer line and gets
    # dropped - unless it carries a BAI code, which is itself a usable signal
    # (Transaction.description will be blank and BAI-code fallback categorization applies).
    if not description and not bai_code:
        return None

    txn_date = _parse_date(cell('date'), month_first=month_first)
    if txn_date is None:
        return None

    if 'amount' in mapping and 'type' in mapping:
        amount = abs(_clean_amount(cell('amount')))
        is_debit = _clean_text(cell('type')).lower() in DEBIT_FLAG_VALUES
        debit = amount if is_debit else Decimal('0')
        credit = Decimal('0') if is_debit else amount
    elif 'amount' in mapping:
        # No separate flag column - the sign itself carries the direction.
        amount = _clean_amount(cell('amount'))
        debit = abs(amount) if amount < 0 else Decimal('0')
        credit = amount if amount > 0 else Decimal('0')
    else:
        debit = _clean_amount(cell('debit'))
        credit = _clean_amount(cell('credit'))

    return ParsedRow(
        date=txn_date,
        description=re.sub(r'\s+', ' ', description),
        debit=debit,
        credit=credit,
        balance=_clean_optional_amount(cell('balance')),
        bai_code=bai_code,
    )


def _check_amount_column_unambiguous(mapping: dict, body_rows: list[list]) -> None:
    """A bare 'amount' column (no separate debit/credit columns and no Dr/Cr
    flag column) only tells us the transaction direction if its values are
    actually signed (some negative, some positive). If every value is
    unsigned/positive, there's no way to know which rows are money in vs.
    money out - don't guess (that would silently miscategorize income as
    the same as expenses), raise instead so the file gets fixed or re-exported
    with a Debit/Credit or Type column."""
    if 'type' in mapping or 'amount' not in mapping:
        return
    idx = mapping['amount']
    if any(_clean_amount(r[idx] if idx < len(r) else None) < 0 for r in body_rows):
        return
    raise StatementParsingError(
        "This file has a single 'Amount' column with no Debit/Credit or Dr/Cr "
        "Type column, and every amount is positive - there's no way to tell which "
        "transactions are money in vs. money out. Please re-export the statement "
        "with separate Debit/Credit columns, a Dr/Cr Type column, or signed amounts."
    )


def _rows_from_grid(grid: list[list]) -> list[ParsedRow]:
    """grid: a list of rows (each a list of cell values). Rows may be ragged
    (different lengths) - real bank exports routinely have a short banner/title
    row before the actual header."""
    mapping = None
    header_row_idx = None
    best_score = 0
    for i in range(min(15, len(grid))):
        candidate = _map_columns(grid[i])
        if candidate and len(candidate) > best_score:
            mapping, header_row_idx, best_score = candidate, i, len(candidate)
    if mapping is None:
        raise StatementParsingError(
            'Could not detect a header row with Date/Description/Debit/Credit columns in the file.'
        )

    body_rows = grid[header_row_idx + 1:]
    _check_amount_column_unambiguous(mapping, body_rows)
    date_idx = mapping['date']
    month_first = _detect_month_first(r[date_idx] if date_idx < len(r) else None for r in body_rows)

    rows = []
    for r in body_rows:
        parsed = _row_to_parsed(mapping, r, month_first=month_first)
        if parsed:
            rows.append(parsed)
    return rows


def parse_excel(file) -> list[ParsedRow]:
    raw = pd.read_excel(file, header=None, dtype=object)
    return _rows_from_grid(raw.values.tolist())


def parse_csv(file) -> list[ParsedRow]:
    content = file.read()
    if isinstance(content, bytes):
        content = content.decode('utf-8-sig', errors='replace')
    grid = [row for row in csv_module.reader(content.splitlines()) if any(cell.strip() for cell in row)]
    return _rows_from_grid(grid)


DATE_TOKEN_RE = re.compile(r'^(\d{1,2}[-/][A-Za-z]{3}[-/]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{4})')
AMOUNT_TOKEN_RE = re.compile(r'-?[\d,]+\.\d{2}')


def _extract_pdf_line_candidates(page_text: str) -> list[tuple]:
    """Fallback for PDFs whose layout doesn't extract cleanly as a table.
    Returns (date_text, description, amounts) tuples for lines that look like
    a transaction row, deferring date parsing so the caller can first decide
    the file's day-first vs. month-first convention."""
    candidates = []
    for line in page_text.splitlines():
        line = line.strip()
        m = DATE_TOKEN_RE.match(line)
        if not m:
            continue
        amounts = AMOUNT_TOKEN_RE.findall(line)
        if not amounts:
            continue
        remainder = line[m.end():].strip()
        for amt in amounts:
            remainder = remainder.replace(amt, '').strip()
        description = re.sub(r'\s+', ' ', remainder).strip(' -/')
        if not description or description.lower() in IGNORED_DESCRIPTION_VALUES:
            continue
        candidates.append((m.group(1), description, amounts))
    return candidates


def _rows_from_pdf_line_candidates(candidates: list[tuple]) -> list[ParsedRow]:
    month_first = _detect_month_first(date_text for date_text, _, _ in candidates)
    rows: list[ParsedRow] = []
    prev_balance: Optional[Decimal] = None

    for date_text, description, amounts in candidates:
        txn_date = _parse_date(date_text, month_first=month_first)
        if txn_date is None:
            continue
        if len(amounts) >= 3:
            debit, credit, balance = _clean_amount(amounts[0]), _clean_amount(amounts[1]), _clean_amount(amounts[-1])
        elif len(amounts) == 2:
            amt = _clean_amount(amounts[0])
            balance = _clean_amount(amounts[-1])
            if prev_balance is not None and balance is not None:
                delta = balance - prev_balance
                if delta > 0:
                    debit, credit = Decimal('0'), abs(amt) if amt > 0 else abs(delta)
                else:
                    debit, credit = abs(amt) if amt > 0 else abs(delta), Decimal('0')
            else:
                # Fallback: if amt is negative or explicitly debit-like
                if amt < 0:
                    debit, credit = abs(amt), Decimal('0')
                else:
                    debit, credit = amt, Decimal('0')
        else:
            debit = credit = Decimal('0')
            balance = _clean_amount(amounts[-1])

        if balance is not None:
            prev_balance = balance

        rows.append(ParsedRow(date=txn_date, description=description, debit=debit, credit=credit, balance=balance))
    return rows


def _drop_rotated_text(page):
    """Strip out any character drawn with a rotation/shear (a diagonal watermark,
    a 'DUPLICATE'/'COPY' stamp) before table/text extraction. Real statement
    content is always axis-aligned; a rotated overlay's characters can otherwise
    land inside a cell's bounding box and corrupt that cell's extracted text."""
    def keep(obj):
        if obj['object_type'] != 'char':
            return True
        m = obj.get('matrix', (1, 0, 0, 1, 0, 0))
        return abs(m[1]) < 0.01 and abs(m[2]) < 0.01
    return page.filter(keep)


def parse_pdf(file) -> list[ParsedRow]:
    table_grid: list[list] = []
    mapping = None
    any_table_found = False
    any_text_layer = False
    regex_candidates: list[tuple] = []

    with pdfplumber.open(file) as pdf:
        for raw_page in pdf.pages:
            page = _drop_rotated_text(raw_page)
            if page.extract_text():
                any_text_layer = True
            table = page.extract_table()
            if table:
                any_table_found = True
                start_idx = 0
                if mapping is None:
                    candidate = _map_columns(table[0])
                    if candidate:
                        mapping = candidate
                        start_idx = 1
                if mapping is None:
                    continue
                for row_cells in table[start_idx:]:
                    if _map_columns(row_cells):
                        continue  # repeated header row on this page
                    cleaned_cells = [c.replace('\n', ' ') if isinstance(c, str) else c for c in row_cells]
                    table_grid.append(cleaned_cells)
            else:
                text = page.extract_text() or ''
                regex_candidates.extend(_extract_pdf_line_candidates(text))

    rows: list[ParsedRow] = []
    if mapping and table_grid:
        _check_amount_column_unambiguous(mapping, table_grid)
        date_idx = mapping['date']
        month_first = _detect_month_first(r[date_idx] if date_idx < len(r) else None for r in table_grid)
        for row_cells in table_grid:
            parsed = _row_to_parsed(mapping, row_cells, month_first=month_first)
            if parsed:
                rows.append(parsed)
    rows.extend(_rows_from_pdf_line_candidates(regex_candidates))

    if not any_table_found and not rows:
        if not any_text_layer:
            raise StatementParsingError(
                'This PDF appears to be a scanned/image copy with no selectable text. '
                'Please upload a text-based statement (e.g. export a CSV/Excel version, or a '
                "non-scanned PDF) - scanned statements aren't supported."
            )
        raise StatementParsingError('Could not extract any transactions from the PDF.')
    return rows


def parse_bank_statement(file_obj, name: str) -> list[ParsedRow]:
    """file_obj: a file-like object (already at position 0). name: the original filename,
    used only to pick the right parser by extension."""
    name = (name or '').lower()
    if hasattr(file_obj, 'seek'):
        try:
            file_obj.seek(0)
        except Exception:
            pass

    if name.endswith('.xlsx') or name.endswith('.xls'):
        rows = parse_excel(file_obj)
    elif name.endswith('.csv'):
        rows = parse_csv(file_obj)
    elif name.endswith('.pdf'):
        rows = parse_pdf(file_obj)
    else:
        raise StatementParsingError('Unsupported file type. Please upload a .csv, .xlsx or .pdf bank statement.')

    if not rows:
        raise StatementParsingError('No transactions could be parsed from this file.')
    validate_running_balance(rows)
    return rows


BALANCE_TOLERANCE = Decimal('0.01')


def _balance_chain_breaks(rows_oldest_first: list[ParsedRow]) -> list[tuple[int, Decimal]]:
    """Walks rows in chronological order and returns (index, expected_balance)
    for every row whose stated balance doesn't equal the previous balance
    - debit + credit. Rows without a balance (some banks only print an
    end-of-day balance) carry the expected balance forward instead of breaking."""
    breaks = []
    running = None
    for i, r in enumerate(rows_oldest_first):
        if running is not None:
            running = running - r.debit + r.credit
            if r.balance is not None and abs(r.balance - running) > BALANCE_TOLERANCE:
                breaks.append((i, running))
        if r.balance is not None:
            running = r.balance
    return breaks


def _is_descending(rows: list[ParsedRow]) -> bool:
    """True if the export lists newest transactions first. Decided by dates when
    first/last differ; for single-day files, by whichever order the running
    balance actually chains in (ascending on a tie - the common export order)."""
    dated = [r for r in rows if r.balance is not None] or rows
    if dated[0].date != dated[-1].date:
        return dated[0].date > dated[-1].date
    return len(_balance_chain_breaks(rows[::-1])) < len(_balance_chain_breaks(rows))


def validate_running_balance(rows: list[ParsedRow]) -> None:
    """Rejects a file whose running balance doesn't add up row-to-row. That's
    almost always a malformed row (a missing/extra column shifting the amount
    into the wrong field) or a dropped row - either way the stored transactions
    would silently disagree with the bank's own balance."""
    if not any(r.balance is not None for r in rows):
        return
    ordered = rows[::-1] if _is_descending(rows) else rows
    breaks = _balance_chain_breaks(ordered)
    if not breaks:
        return
    details = []
    for i, expected in breaks[:3]:
        r = ordered[i]
        prev = ordered[i - 1]
        details.append(
            f"{r.date} '{r.description[:40]}' shows balance {r.balance:,.2f} but the rows before it "
            f"add up to {expected:,.2f} (previous row: {prev.date} '{prev.description[:40]}', "
            f"debit {prev.debit:,.2f}, credit {prev.credit:,.2f}, balance "
            f"{'missing' if prev.balance is None else f'{prev.balance:,.2f}'})"
        )
    more = f' (+{len(breaks) - 3} more)' if len(breaks) > 3 else ''
    raise StatementParsingError(
        f"The running balance doesn't add up in {len(breaks)} place(s){more}: "
        + '; '.join(details)
        + '. Check these rows for a missing or extra column, or a missing transaction, then re-upload.'
    )


def derive_opening_closing_balance(rows: list[ParsedRow]) -> tuple[Optional[Decimal], Optional[Decimal]]:
    """Every transaction row already carries the bank's own running balance -
    there's no need to ask the user to retype the opening/closing balance,
    since they're already sitting right there in the file:
        closing_balance = the latest row's balance.
        opening_balance = the earliest row's balance, reversed by that row's own
        effect (opening_balance = earliest_balance - credit + debit).

    Handles both ascending (oldest first) and descending (newest first) statement exports.
    Returns (None, None) if the file's rows don't carry a balance column.
    """
    if not rows:
        return None, None

    rows_with_bal = [r for r in rows if r.balance is not None]
    if not rows_with_bal:
        return None, None

    if _is_descending(rows):
        earliest_row = rows_with_bal[-1]
        latest_row = rows_with_bal[0]
    else:
        earliest_row = rows_with_bal[0]
        latest_row = rows_with_bal[-1]

    opening = earliest_row.balance - earliest_row.credit + earliest_row.debit
    closing = latest_row.balance
    return opening, closing

