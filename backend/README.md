# Accounting API (FastAPI + SQLAlchemy 2.0)

FastAPI port of `accounting_prototype/backend_v2` (Django), with clients, suppliers, products,
sales invoices, purchase bills and payments added. URLs and JSON shapes match the Django API,
so the existing frontend can point at it.

## Run

```bash
python -m venv venv
venv\Scripts\activate            # Windows  (source venv/bin/activate elsewhere)
pip install -r requirements.txt
copy .env.example .env           # then set SECRET_KEY (32+ characters)

python cli.py init-db            # tables + default roles (Admin, Accountant, Bookkeeper, Viewer)
python cli.py seed               # optional: starter Chart of Accounts, GST rates, BAI codes, sample banks
uvicorn app.main:app --reload    # http://127.0.0.1:8000/docs
```

The first account registered through `POST /api/auth/register/` becomes the administrator
(or create one with `python cli.py create-admin <username>`). Later sign-ups have no page
access until an administrator gives them a role.

Tests: `pytest tests`

## Layout

| Path | What's in it |
|---|---|
| `app/models.py` | SQLAlchemy models |
| `app/schemas.py` | Request bodies (Pydantic) |
| `app/serializers.py` | Response shapes |
| `app/access.py`, `app/deps.py` | Pages, roles and the `Access(...)` permission dependency |
| `app/services/` | Business logic: statement parsing, categorization, transfers, duplicates, continuity, journal import, reconciliation, period close, reports, invoicing |
| `app/routers/` | Endpoints, one file per area |
| `cli.py` | Setup commands |

## API (all under `/api`, JWT `Authorization: Bearer <access>`)

- **Auth** `auth/token/`, `auth/token/refresh/`, `auth/register/`, `auth/logout/`, `auth/me/`, `auth/change-password/`
- **Users** `users/`, `users/{id}/reset-password/`, `roles/`
- **Chart of Accounts** `categories/` (+ `summary/`, `bulk-import/`, `clear-all/`), `subcategories/`, `lookups/categories|subcategories|bank-accounts/`
- **Rules** `category-keywords/` (+ `bulk-create/`, `coa-tree/`, `summary/`, `clear-all/`), `bai-codes/` (+ `seed-defaults/`), `categorization-settings/`
- **Banking** `bank-accounts/`, `bank-statements/` (multipart upload; `{id}/reparse/`, `{id}/categorize/`, `check-duplicates/`, `summary/`), `continuity/...`
- **General Ledger** `transactions/` (+ `summary/`, `bulk-update/`, `bulk-confirm/`, `bulk-delete/`, `finalize/`, `reopen/`, `detect-transfers/`, `{id}/confirm/`, `{id}/accept-suggestion/`, `{id}/create-rule/`)
- **Journal** `journal-entries/` (+ `import/`, `summary/`, `month-scope/`, `month-delete/`), `journal-import-batches/`
- **Clients & suppliers** `clients/`, `suppliers/` (+ `{id}/statement/`), `tax-rates/`, `products/`
- **Sales** `sales-invoices/` (+ `{id}/post/`, `{id}/cancel/`, `summary/`, `next-number/`)
- **Purchases** `purchase-bills/` (+ `{id}/post/`, `{id}/cancel/`, `summary/`)
- **Payments** `payments/` (+ `{id}/allocate/`, `{id}/allocations/{allocation_id}/`)
- **Reconciliation** `reconciliation/summary|bank-transactions|book-lines|auto-match|match|match-pair|unmatch|candidates|opening-balance|periods|periods/close|periods/reopen|settings/`
- **Reports** `reports/profit-and-loss|balance-sheet|trial-balance|cash-flow|account-ledger|comparison|comparison/export|financial-pack|line-item-transactions|receivables-aging|payables-aging/`
- **Period close** `period-close/` (financial year + default receivable / payable / cash accounts), `period-close/readiness|close|reopen/`
- **Dashboard** `dashboard/overview|kpis|cash-position|attention|top-expenses|recent-statements|cash-flow-forecast|reconciliation-status/`, `workflow/status/`

## How invoices, bills and payments reach the books

Posting an invoice, bill or payment creates its own journal entry (`JournalEntry.origin` says which),
checked against closed periods and signed-off reconciliation months like an imported entry:

- **Sales invoice:** Dr Accounts Receivable, Cr each line's income account, Cr the tax rate's output GST account.
- **Purchase bill:** Dr each line's expense account and the input GST account, Cr Accounts Payable. When the tax rate has no input account, the GST is added to the expense.
- **Receipt:** Dr the bank's GL account (or Cash), Cr Receivable.
- **Payment to a supplier:** Dr Payable, Cr the bank's GL account (or Cash).

Bank lines from payments are matched against bank statements in Bank Reconciliation like any other entry.

The default Receivable, Payable and Cash accounts can be set with `PUT period-close/`. Otherwise
the sub-categories named "Accounts Receivable", "Accounts Payable" and "Cash" are used.
