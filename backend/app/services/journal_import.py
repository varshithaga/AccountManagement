"""
Journal entry import - how journal entries arrive from files and external systems.
(Entries posted from invoices, bills and payments are created by services.invoicing.)

The Excel and JSON file importers (the browser reads the file) and external
systems all call POST /api/journal-entries/import/ with the same payload:

    {
      "source": "EXCEL" | "JSON" | "API",
      "source_name": "tally_export_march.xlsx",
      "bank_account": 3,                  (optional - the bank account these entries belong to)
      "dry_run": false,                   (true = analyse only, save nothing)
      "entries": [
        {
          "entry_number": "JV-0001",
          "date": "2026-03-31",
          "narration": "March rent",
          "lines": [
            {"sub_category_name": "Office Rent", "category_name": "Rent", "debit": "25000.00", "description": ""},
            {"sub_category_id": 12, "credit": 25000}
          ]
        }
      ]
    }

A line's account is `sub_category_id` when it exists - any `sub_category_name` /
`category_name` on the same line must then agree with it, or the line is an error.
Otherwise (no id, or an id that doesn't exist) it is `sub_category_name`
(case-insensitive), with optional `category_name` to disambiguate a
sub-category name that exists under several categories. When a bank account is
given, `sub_category_name` "Bank" (or the bank account's own name) means that
bank account's GL account, unless a real sub-category has that name.

analyse_journal_entries() checks every entry against the database and gives
each one a status - READY, WARNING (will import, but look at it), SKIPPED
(entry number already imported), DUPLICATE (same date, accounts and amounts as
another entry under a different number - left out unless include_duplicates)
or ERROR. import_journal_entries() runs the same analysis and saves nothing
unless no entry has an error.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
from difflib import get_close_matches
from types import SimpleNamespace
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from ..models import BankAccount, Category, JournalEntry, JournalEntryLine, JournalImportBatch, JournalImportSource, SubCategory
from .period_close import closed_through, journal_entry_error
from .reconciliation import bank_gl_locks, journal_lock_error

MAX_ENTRIES_PER_IMPORT = 5000
TWO_PLACES = Decimal('0.01')
ZERO = Decimal('0.00')
MAX_NUMBER_LEN = 100
MAX_TEXT_LEN = 500

STATUS_READY = 'READY'
STATUS_WARNING = 'WARNING'
STATUS_SKIPPED = 'SKIPPED'
STATUS_DUPLICATE = 'DUPLICATE'
STATUS_ERROR = 'ERROR'
IMPORTABLE = (STATUS_READY, STATUS_WARNING)
SOURCES = [s.value for s in JournalImportSource]


class JournalImportError(Exception):
    def __init__(self, errors):
        super().__init__('; '.join(errors))
        self.errors = errors


def _parse_amount(value):
    """Returns (Decimal, error). Blank/None counts as 0."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return Decimal('0'), None
    if isinstance(value, bool):
        return None, 'must be a number'
    try:
        amount = Decimal(str(value).replace(',', '').strip())
    except InvalidOperation:
        return None, 'must be a number'
    if not amount.is_finite():
        return None, 'must be a number'
    if amount < 0:
        return None, 'cannot be negative'
    if amount != amount.quantize(TWO_PLACES):
        return None, 'cannot have more than 2 decimal places'
    if amount >= Decimal('1e12'):
        return None, 'is too large'
    return amount, None


class _AccountResolver:
    """Resolves a line's account reference to a SubCategory, loading the Chart of Accounts once."""

    def __init__(self, db: Session, bank_account: Optional[BankAccount] = None):
        subs = db.scalars(select(SubCategory).options(joinedload(SubCategory.category))).unique().all()
        self.by_id = {s.id: s for s in subs}
        self.by_name: dict = {}
        self.by_category_and_name: dict = {}
        self.names_by_category: dict = {}
        for s in subs:
            name = s.name.strip().lower()
            self.by_name.setdefault(name, []).append(s)
            self.by_category_and_name[(s.category.name.strip().lower(), name)] = s
            self.names_by_category.setdefault(s.category.name.strip().lower(), []).append(s.name)
        # Every category, including ones without sub-categories yet, by lower-cased name.
        self.categories = {c.strip().lower(): c for c in db.scalars(select(Category.name)).all()}
        self.all_names = sorted({s.name for s in subs})
        self.bank_account = bank_account
        self.bank_aliases = {'bank', bank_account.name.strip().lower()} if bank_account else set()

    @staticmethod
    def _did_you_mean(text, choices):
        """' - did you mean "X"?' for a likely typo, or ''."""
        by_lower = {c.lower(): c for c in choices}
        close = get_close_matches(text.lower(), list(by_lower), n=2, cutoff=0.75)
        if not close:
            return ''
        return ' - did you mean ' + ' or '.join(f'"{by_lower[c]}"' for c in close) + '?'

    def _resolve_in_category(self, name, category_name):
        """The sub category when a Category was given: the category must exist and hold it."""
        category_key = category_name.lower()
        if category_key not in self.categories:
            return None, (f'category "{category_name}" does not exist in the Chart of Accounts'
                          + self._did_you_mean(category_name, self.categories.values()))
        sub = self.by_category_and_name.get((category_key, name.lower()))
        if sub:
            return sub, None
        category = self.categories[category_key]
        elsewhere = sorted(m.category.name for m in self.by_name.get(name.lower(), []))
        if elsewhere:
            where = ' or '.join(f'"{c}"' for c in elsewhere)
            return None, f'sub category "{name}" is not under category "{category}" - it is under {where}'
        return None, (f'sub category "{name}" does not exist under category "{category}"'
                      + self._did_you_mean(name, self.names_by_category.get(category_key, [])))

    def resolve(self, line):
        """(SubCategory or None, error or None, how) - how is 'id', 'name' or 'bank' when found.
        sub_category_id wins when it exists; an id that doesn't exist falls back to the name."""
        sub_category_id = line.get('sub_category_id')
        has_name = bool(str(line.get('sub_category_name') or '').strip())
        if sub_category_id not in (None, ''):
            try:
                sub = self.by_id.get(int(sub_category_id))
            except (TypeError, ValueError):
                sub = None
            if sub:
                conflict = self._conflicts_with_id(sub, sub_category_id, line)
                return (None, conflict, None) if conflict else (sub, None, 'id')
            id_error = f'sub category id "{sub_category_id}" does not exist'
            if not has_name:
                return None, id_error, None
            sub, err, how = self._resolve_name(line)
            return (sub, None, how) if sub else (None, f'{id_error}, and {err}', None)
        return self._resolve_name(line)

    def _conflicts_with_id(self, sub, sub_category_id, line):
        """Why the line's Category / Sub Category Name contradict the account its id points to, or None."""
        category_name = str(line.get('category_name') or '').strip()
        if category_name:
            if category_name.lower() not in self.categories:
                return (f'category "{category_name}" does not exist in the Chart of Accounts'
                        + self._did_you_mean(category_name, self.categories.values()))
            if category_name.lower() != sub.category.name.strip().lower():
                return (f'sub category id "{sub_category_id}" is "{sub.name}" under category "{sub.category.name}", '
                        f'not under "{category_name}" - correct the Category or leave it empty')
        name = str(line.get('sub_category_name') or '').strip()
        if name and name.lower() != sub.name.strip().lower():
            is_bank = (name.lower() in self.bank_aliases and self.bank_account.gl_account_id == sub.id)
            if not is_bank:
                return (f'sub category id "{sub_category_id}" is "{sub.name}", but the sub category name says "{name}" - '
                        'make them match, or leave one of them empty')
        return None

    def _resolve_name(self, line):
        name = str(line.get('sub_category_name') or '').strip()
        if not name:
            return None, 'sub category is required (give "sub_category_id" or "sub_category_name")', None
        category_name = str(line.get('category_name') or '').strip()
        if category_name:
            sub, err = self._resolve_in_category(name, category_name)
            return sub, err, 'name' if sub else None
        matches = self.by_name.get(name.lower(), [])
        if not matches and name.lower() in self.bank_aliases:
            if not self.bank_account.gl_account_id:
                return None, (f'sub category "{name}" means bank account "{self.bank_account.name}", '
                              'which is not linked to a GL account yet'), None
            return self.by_id.get(self.bank_account.gl_account_id), None, 'bank'
        if not matches:
            return None, (f'sub category "{name}" does not exist in the Chart of Accounts'
                          + self._did_you_mean(name, self.all_names)), None
        if len(matches) > 1:
            categories = ' or '.join(f'"{c}"' for c in sorted(m.category.name for m in matches))
            return None, (f'sub category "{name}" exists under more than one category - fill in the Category column '
                          f'(category_name in the API) with {categories}'), None
        return matches[0], None, 'name'


def _check_request(entries, source):
    if source not in SOURCES:
        raise JournalImportError([f'Invalid source "{source}" - use one of: {", ".join(SOURCES)}.'])
    if not isinstance(entries, list) or not entries:
        raise JournalImportError(['A non-empty list of entries is required.'])
    if len(entries) > MAX_ENTRIES_PER_IMPORT:
        raise JournalImportError([f'At most {MAX_ENTRIES_PER_IMPORT} entries can be imported at once.'])


def resolve_bank_account(db: Session, value) -> Optional[BankAccount]:
    """The BankAccount for an optional id, or a JournalImportError."""
    if value in (None, ''):
        return None
    try:
        account = db.get(BankAccount, int(value))
    except (TypeError, ValueError):
        account = None
    if account is None:
        raise JournalImportError([f'Bank account "{value}" does not exist.'])
    return account


def analyse_journal_entries(db: Session, entries, bank_account: Optional[BankAccount] = None) -> list[dict]:
    """Checks every entry without saving. Returns one result per entry, in order:
    {'index', 'entry_number', 'date', 'narration', 'status', 'errors', 'warnings',
     'line_count', 'total_debit', 'total_credit', '_objects'} - `_objects` is the
    (entry fields, [line fields]) pair to save, present only when importable."""
    numbers = [str(e.get('entry_number') or '').strip() for e in entries if isinstance(e, dict)]
    existing = set(db.scalars(select(JournalEntry.entry_number).where(JournalEntry.entry_number.in_(numbers))).all())
    resolver = _AccountResolver(db, bank_account)
    bank_gl = bank_account.gl_account if bank_account else None
    gl_locks = bank_gl_locks(db)
    books_closed = closed_through(db)

    results, seen = [], set()
    for i, entry in enumerate(entries, start=1):
        result = {
            'index': i, 'entry_number': '', 'date': None, 'narration': '', 'status': STATUS_READY,
            'errors': [], 'warnings': [], 'line_count': 0, 'total_debit': ZERO, 'total_credit': ZERO,
            'accounts': [],
        }
        results.append(result)
        if not isinstance(entry, dict):
            result['errors'].append('must be an object')
            result['status'] = STATUS_ERROR
            continue
        errors = result['errors']
        number = str(entry.get('entry_number') or '').strip()
        result['entry_number'] = number
        result['narration'] = narration = str(entry.get('narration') or '').strip()

        if not number:
            errors.append('entry_number is required')
        elif len(number) > MAX_NUMBER_LEN:
            errors.append(f'entry_number is longer than {MAX_NUMBER_LEN} characters')
        elif number in seen:
            errors.append('entry_number appears more than once in this import')
        elif number in existing:
            result['status'] = STATUS_SKIPPED
            result['warnings'].append('already imported earlier - left unchanged')
            seen.add(number)
            continue
        seen.add(number)

        try:
            entry_date = date.fromisoformat(str(entry.get('date') or '').strip())
            result['date'] = entry_date.isoformat()
        except ValueError:
            entry_date = None
            errors.append(f'date "{entry.get("date") or ""}" is not a valid YYYY-MM-DD date')

        if len(narration) > MAX_TEXT_LEN:
            errors.append(f'narration is longer than {MAX_TEXT_LEN} characters')

        lines = entry.get('lines')
        if not isinstance(lines, list) or len(lines) < 2:
            errors.append('needs at least 2 lines (a debit and a credit)')
            lines = lines if isinstance(lines, list) else []
        result['line_count'] = len(lines)

        total_debit = total_credit = ZERO
        new_lines = []
        first_line_with = {}  # identical (account, debit, credit, description) -> first line number
        for j, line in enumerate(lines, start=1):
            if not isinstance(line, dict):
                errors.append(f'line {j}: must be an object')
                continue
            line_errors = []
            sub, err, how = resolver.resolve(line)
            # Which account the line posts to - shown next to each line, so an unknown one can be fixed.
            result['accounts'].append({
                'line': j, 'matched_by': how,
                'sub_category_id': sub.id if sub else None,
                'sub_category_name': sub.name if sub else None,
                'category_name': sub.category.name if sub else None,
                'error': err,
            })
            if err:
                line_errors.append(err)
            elif how == 'name' and line.get('sub_category_id') not in (None, ''):
                result['warnings'].append(
                    f'line {j}: sub category id "{line.get("sub_category_id")}" does not exist - '
                    f'used the sub category name "{sub.name}" instead')
            debit, err = _parse_amount(line.get('debit'))
            if err:
                line_errors.append(f'debit {err}')
            credit, err = _parse_amount(line.get('credit'))
            if err:
                line_errors.append(f'credit {err}')
            if debit is not None and credit is not None and (debit > 0) == (credit > 0):
                line_errors.append('enter either a debit or a credit amount (exactly one, greater than 0)')
            description = str(line.get('description') or '').strip()
            if len(description) > MAX_TEXT_LEN:
                line_errors.append(f'description is longer than {MAX_TEXT_LEN} characters')
            if line_errors:
                errors.append(f'line {j}: ' + ', '.join(line_errors))
                continue
            total_debit += debit
            total_credit += credit
            new_lines.append(SimpleNamespace(sub_category_id=sub.id, description=description, debit=debit, credit=credit))
            same = first_line_with.setdefault((sub.id, debit, credit, description.lower()), j)
            if same != j:
                result['warnings'].append(f'line {j}: identical to line {same} - check it was not pasted twice')

        result['total_debit'], result['total_credit'] = total_debit, total_credit
        if not errors and total_debit != total_credit:
            errors.append(f'is not balanced - total debit {total_debit} vs total credit {total_credit}')
        if not errors and books_closed:
            closed = journal_entry_error(entry_date, books_closed)
            if closed:
                errors.append(closed)
        if not errors and gl_locks:
            # A bank line dated in a signed-off month would change that month's reconciled figures.
            locked = journal_lock_error(entry_date, [l.sub_category_id for l in new_lines], gl_locks)
            if locked:
                errors.append(locked)

        if errors:
            result['status'] = STATUS_ERROR
            continue
        if bank_gl and not any(l.sub_category_id == bank_gl.id for l in new_lines):
            result['warnings'].append(
                f'has no line on "{bank_gl.name}" (the GL account of {bank_account.name}), '
                'so it will not appear in that bank\'s reconciliation'
            )
        if result['warnings']:
            result['status'] = STATUS_WARNING
        result['_objects'] = ({'entry_number': number, 'date': entry_date, 'narration': narration}, new_lines)
        result['_fingerprint'] = fingerprint(entry_date, new_lines)

    _flag_duplicate_content(db, results)
    return results


def fingerprint(entry_date, lines):
    """What makes two entries the same transaction regardless of their entry numbers:
    the date plus every line's account and amounts."""
    return (entry_date, tuple(sorted(
        (l.sub_category_id, Decimal(l.debit).quantize(TWO_PLACES), Decimal(l.credit).quantize(TWO_PLACES))
        for l in lines
    )))


def _flag_duplicate_content(db: Session, results):
    """Marks importable entries that repeat an entry already saved, or an earlier entry in the
    same import, under a different entry number (e.g. a re-export with new numbering)."""
    candidates = [r for r in results if '_fingerprint' in r]
    if not candidates:
        return
    dates = {r['_fingerprint'][0] for r in candidates}
    saved = {}
    for je in db.scalars(select(JournalEntry).where(JournalEntry.date.in_(dates))
                         .options(selectinload(JournalEntry.lines))):
        saved.setdefault(fingerprint(je.date, je.lines), je.entry_number)

    in_file = {}
    for r in candidates:
        fp = r['_fingerprint']
        if fp in saved:
            r['warnings'].append(f'possible duplicate - same date, accounts and amounts as entry {saved[fp]} already imported')
        elif fp in in_file:
            r['warnings'].append(f'possible duplicate - same date, accounts and amounts as entry {in_file[fp]} in this file')
        else:
            in_file[fp] = r['entry_number']
            continue
        r['status'] = STATUS_DUPLICATE


def summarize(results, bank_account: Optional[BankAccount] = None) -> dict:
    importable = [r for r in results if r['status'] in IMPORTABLE]
    dates = sorted(r['date'] for r in importable if r['date'])

    def count(status):
        return sum(1 for r in results if r['status'] == status)

    summary = {
        'entries': len(results),
        'ready': count(STATUS_READY),
        'warnings': count(STATUS_WARNING),
        'skipped': count(STATUS_SKIPPED),
        'duplicates': count(STATUS_DUPLICATE),
        'errors': count(STATUS_ERROR),
        'importable': len(importable),
        'lines': sum(r['line_count'] for r in importable),
        'total_debit': sum((r['total_debit'] for r in importable), ZERO),
        'total_credit': sum((r['total_credit'] for r in importable), ZERO),
        'date_from': dates[0] if dates else None,
        'date_to': dates[-1] if dates else None,
        'bank_account': None,
    }
    if bank_account:
        summary['bank_account'] = {
            'id': bank_account.id, 'name': bank_account.name,
            'gl_account': bank_account.gl_account_id,
            'gl_account_name': bank_account.gl_account.name if bank_account.gl_account_id else None,
        }
    return summary


def public_results(results):
    """Analysis results without the internal keys (unsaved objects, fingerprints)."""
    return [{k: v for k, v in r.items() if not k.startswith('_')} for r in results]


def _error_message(result):
    number = result['entry_number']
    label = f'Entry {number}' if number else f'Entry #{result["index"]}'
    return f'{label}: ' + '; '.join(result['errors']) + '.'


def import_journal_entries(db: Session, entries, source, source_name='', bank_account: Optional[BankAccount] = None,
                           include_duplicates=False, commit=True) -> dict:
    """Validates and saves `entries` (see module docstring) as one batch. All-or-nothing:
    raises JournalImportError listing every entry with an error. Possible duplicates (same
    date, accounts and amounts as another entry under a different number) are left out and
    listed in "duplicates" unless include_duplicates is true. Returns
    {'batch_id', 'created', 'lines_created', 'skipped', 'duplicates', 'warnings'}."""
    _check_request(entries, source)
    results = analyse_journal_entries(db, entries, bank_account)

    errors = [_error_message(r) for r in results if r['status'] == STATUS_ERROR]
    if errors:
        raise JournalImportError(errors)

    wanted = IMPORTABLE + ((STATUS_DUPLICATE,) if include_duplicates else ())
    skipped = [r['entry_number'] for r in results if r['status'] == STATUS_SKIPPED]
    duplicates = [r['entry_number'] for r in results if r['status'] == STATUS_DUPLICATE and not include_duplicates]
    warnings = [f'Entry {r["entry_number"]}: ' + '; '.join(r['warnings']) + '.'
                for r in results if r['status'] in wanted and r['warnings']]
    to_create = [r['_objects'] for r in results if r['status'] in wanted]
    if not to_create:
        return {'batch_id': None, 'created': 0, 'lines_created': 0, 'skipped': skipped,
                'duplicates': duplicates, 'warnings': warnings}

    batch = JournalImportBatch(source=JournalImportSource(source), source_name=str(source_name or '').strip()[:255],
                               bank_account_id=bank_account.id if bank_account else None)
    db.add(batch)
    lines_created = 0
    for fields, lines in to_create:
        entry = JournalEntry(batch=batch, **fields)
        entry.lines = [JournalEntryLine(sub_category_id=l.sub_category_id, description=l.description,
                                        debit=l.debit, credit=l.credit) for l in lines]
        lines_created += len(lines)
        db.add(entry)
    db.flush()
    if commit:
        db.commit()

    return {
        'batch_id': batch.id, 'created': len(to_create), 'lines_created': lines_created,
        'skipped': skipped, 'duplicates': duplicates, 'warnings': warnings,
    }


def analyse_import_request(db: Session, entries, source, bank_account: Optional[BankAccount] = None) -> dict:
    """dry_run: the per-entry analysis plus a summary. Raises JournalImportError only for a bad request."""
    _check_request(entries, source)
    results = analyse_journal_entries(db, entries, bank_account)
    return {'summary': summarize(results, bank_account), 'entries': public_results(results)}
