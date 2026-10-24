# LedgerDesk API (FastAPI + SQLAlchemy 2.0)

FastAPI port of `accounting_prototype/backend_v2` (Django), with clients, suppliers, products,
sales invoices, purchase bills and payments added. URLs and JSON shapes match the Django API,
so the existing frontend can point at it.

## Run

```bash
python -m venv venv
venv\Scripts\activate            # Windows  (source venv/bin/activate elsewhere)
pip install -r requirements.txt
copy .env.example .env           # then set SECRET_KEY (32+ characters)

python cli.py init-db            # apply migrations + default roles (Admin, Accountant, Bookkeeper, Viewer)
python cli.py seed               # optional: starter Chart of Accounts, GST rates, BAI codes, sample banks
python cli.py demo-data          # optional, for trying it out (after registering the admin): sample clients,
                                 # invoices, bills, payments, stock and bank statements - with planted duplicates
uvicorn app.main:app --reload    # http://127.0.0.1:8000/docs
```

The database is PostgreSQL `account_management` (`DATABASE_URL` in `.env`).

## Migrations (Alembic)

The app never creates or alters tables itself - Alembic does, from the files in `migrations/versions/`.

```bash
# 1. change app/models.py
python cli.py makemigrations "add website to clients"   # writes migrations/versions/<date>-<id>_add_website_to_clients.py
# 2. read the generated file - autogenerate can't see renames (it drops + adds) and needs
#    server_default= on a new NOT NULL column when the table already has rows
python cli.py migrate                                   # applies it
```

Plain Alembic works too: `alembic upgrade head`, `alembic downgrade -1`, `alembic history`, `alembic current`.

The first account registered through `POST /api/auth/register/` becomes the administrator
(or create one with `python cli.py create-admin <username>`). Later sign-ups have no page
access until an administrator gives them a role.

## Running it day to day

- **Recurring invoices** are raised by the server itself every `RECURRING_CHECK_MINUTES` (default 60; at
  start-up too). With it set to 0, run `python cli.py run-recurring` from Task Scheduler / cron instead.
  Several server processes are fine - on PostgreSQL only one of them runs it at a time.
- **Backups**: `python cli.py backup --keep 14` writes `BACKUP_DIR/<date_time>/` with the database
  (`pg_dump`, custom format), `media.zip` (uploaded statements) and a `RESTORE.txt` with the exact restore
  steps for that backup. Schedule it daily. If `pg_dump` is not on PATH, set `PG_BIN_DIR` in `.env`. Copy
  the backup folder off the machine - a backup on the same disk doesn't survive the disk.
- **Uploaded files** are not served publicly: a statement downloads through
  `GET /api/bank-statements/{id}/file/`, which needs a login with the Bank Statements page.

## Several companies

Each company has a database of its own - users, roles, accounts, invoices, everything. The main database
(`DATABASE_URL`) is the company `default` and also holds the list of the others (the `companies` table).

```bash
python cli.py create-company acme "Acme Traders"    # creates account_management_acme, migrates it, adds the roles
python cli.py create-admin admin --company acme      # its first user (or the first sign-up becomes admin)
python cli.py seed --company acme                    # optional: starter accounts, GST rates ...
python cli.py companies                              # list them
```

- The key is 2-40 lowercase letters, digits or `_`, starting with a letter. The database goes next to the
  main one on the same server (SQLite: `<file>_<key>.db`); pass `--database-url URL` to put it elsewhere.
- Once there is more than one company, the sign-in page shows a company picker. The frontend sends the
  choice in the `X-Company` header; the login token carries the company too and is refused in any other.
- Uploads are kept in `MEDIA_ROOT/<key>/`; `backup` and `run-recurring` (and the server's recurring run) cover
  every company.
- **Migrations:** use `python cli.py migrate` - it upgrades the main database and every company's. Plain
  `alembic upgrade head` only touches `DATABASE_URL`.
- Companies are added from the command line only; there is no screen for it yet. To take one out of the
  picker, set `is_active` to false on its row in the main database's `companies` table.

## AI Assistant

A chat (sidebar → AI Assistant) that answers questions about the books: "net profit this year?", "which
invoices are overdue?", "GST payable for last month?". Set it up in `.env`:

```
GEMINI_API_KEY=...        # asked first
OPENAI_API_KEY=...        # answers when Gemini fails (error, quota, timeout) - optional
GEMINI_MODEL=gemini-3.8-flash
OPENAI_MODEL=gpt-5-mini
```

- **Read-only by construction** (`app/services/ai_assistant.py`): the model can only call a fixed list of
  tools, and each tool is a GET to one of our own report / list endpoints, sent in-process with the asking
  user's own token. So the figures are the screens' figures, the role limits what it can look up exactly as
  on the screens, and nothing can be created or changed.
- **Access:** the `ai_assistant` page. Admin roles have it; give it to other roles in User Management. The
  figures it looks up are sent to Google / OpenAI, so decide per role.
- **Chats** are saved per user (`ai_conversations`, `ai_messages`); a user sees and deletes only their own.
  A question that gets no answer is not saved.
- Tests replace the AI services with a fake (`PROVIDER_TRANSPORT`) - no key or network needed.

Tests: `pytest tests` (a temporary SQLite file; set `TEST_DATABASE_URL` to a throwaway PostgreSQL database to
run them there - every test drops and recreates the tables).

## Layout

| Path | What's in it |
|---|---|
| `app/models.py` | SQLAlchemy models |
| `app/schemas.py` | Request bodies (Pydantic) |
| `app/serializers.py` | Response shapes |
| `app/access.py`, `app/deps.py` | Pages, roles and the `Access(...)` permission dependency |
| `app/services/` | Business logic: statement parsing, categorization, transfers, duplicates, continuity, journal import, reconciliation, period close, reports, invoicing, GST summary, audit log, AI assistant |
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
- **Credit / debit notes** `credit-notes/` (+ `{id}/cancel/`)
- **Reconciliation** `reconciliation/summary|bank-transactions|book-lines|auto-match|match|match-pair|unmatch|candidates|opening-balance|periods|periods/close|periods/reopen|settings/`
- **Reports** `reports/profit-and-loss|balance-sheet|trial-balance|cash-flow|account-ledger|comparison|comparison/export|financial-pack|line-item-transactions|receivables-aging|payables-aging|gst-summary/`, `reports/gst-returns/gstr1|gstr3b/?month=YYYY-MM`
- **Period close** `period-close/` (financial year, default receivable / payable / cash accounts, company details), `period-close/readiness|close|reopen|company/`
- **Audit log** `audit-log/` (+ `filters/`)
- **AI Assistant** `ai/status/`, `ai/chat/`, `ai/conversations/` (+ `{id}/`)
- **Dashboard** `dashboard/overview|kpis|cash-position|attention|top-expenses|recent-statements|cash-flow-forecast|reconciliation-status/`, `workflow/status/`

## Reports come from the books (the journal)

P&L, Balance Sheet, Trial Balance, Cash Flow, the Account Ledger and the dashboard figures all sum
journal entry lines. Entries reach the journal from:

- **Manual entries** (Journal Entries → New journal entry) and **imports** (Excel / JSON / API).
- **Sales invoices, purchase bills, payments, and credit / debit notes**, when they are posted.
- **Client / supplier opening balances**, booked as `OB-C-<id>` / `OB-S-<id>` against "Opening Balance Equity".
- **Bank transactions:** making a categorized transaction final posts it as `BT-<id>` (withdrawal:
  Dr category / Cr bank GL; deposit: the reverse) and matches it in Bank Reconciliation. A transaction
  already matched to an imported or payment entry is *not* posted again, so nothing is counted twice.
  Reopening it takes the entry out.

Bank transactions not in the books yet (not final, or no GL account on the bank) are in no total;
each report shows how many there are. "Post to books" in the General Ledger posts final transactions
that couldn't be posted earlier (e.g. the bank's GL account was linked later).

The money already in the bank before the first statement only appears once its opening balance is
booked (Bank Reconciliation → Book opening balance).

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

## GST: CGST + SGST or IGST

The company's state (Period Close → Company details, `company_state`) is compared with the client's or
supplier's state when an invoice, bill or note is saved and again when it is posted. The same state means
CGST + SGST, half each; another state means IGST; an unknown state on either side counts as the same state.
Each line keeps its split (`cgst_amount`, `sgst_amount`, `igst_amount`) and the document its
`place_of_supply` and `is_interstate`.

When posting, each component goes to a sub-category named "Output CGST", "Output SGST", "Output IGST"
(sales) or "Input CGST" ... (purchases) if the Chart of Accounts has one; otherwise to the tax rate's own
output / input account. So one "GST Payable" account works, and separate ledgers per component work too.

`reports/gst-summary/` adds up posted documents for a period: output tax by rate, B2B / B2C, within /
across states, an HSN / SAC summary, input tax credit (lines whose tax rate has no input account are
shown as ineligible) and the net payable per component.

`reports/gst-returns/gstr1/` and `gstr3b/` build one month's return (`?month=2026-09`) as the JSON the GST
portal's offline tool takes, plus warnings to fix first (missing HSN codes, bad GSTINs, drafts left out);
`?format=json` downloads the file alone. The company GSTIN must be set. Not recorded in LedgerDesk, so sent
as zero: cess, exports / SEZ, reverse charge, advances, amendments. The 3B input tax credit is what the books
claim - check it against GSTR-2B. Code: `app/services/gst_returns.py`.

The Testing menu (Delete Month Journals, `journal-entries/month-scope|month-delete/`) only works with
`TESTING_TOOLS=true` in `.env`, and only for administrators.

## Audit log

`app/services/audit.py` watches every flush: creating, changing or deleting an invoice, bill, note,
payment, allocation, manual journal entry, client, supplier, product, tax rate, account, keyword, bank
account, statement, user, role or setting writes an `audit_log` row in the same transaction - with the
user (from the access token), the old and new values, and POST / CANCEL for status changes. Sign-ins,
failed sign-ins, password changes (never the password) and bulk actions (make final, reopen, post to
books, bulk delete) are logged too. Many records of one kind in one request (an import) become one row
with the count. Only roles given the "Audit Log" page can read it; the default Accountant role is not.

