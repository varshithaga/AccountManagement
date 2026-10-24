# How it works

## The pieces

```
 Browser (React app, :5173)
      │  JSON over HTTP, "Authorization: Bearer <token>", "X-Company: <key>"
      ▼
 FastAPI (:8000)  ── routers/   endpoints, one file per area
      │           ── services/  business logic (posting, GST, reports, parsing ...)
      │           ── access.py  pages, roles and rights
      ▼
 PostgreSQL       one database per company (users, accounts, invoices - everything)
 media/           uploaded bank statements (served only to signed-in users)
```

- The **web app** (`frontend/`) has no business logic of its own. It shows what the API returns and
  sends what the user types.
- The **API** (`backend/`) checks every request: who you are, which company, whether your role allows it.
  It also enforces the rules: balanced entries, closed periods, unique bill numbers, GST splits.
- The **database** is changed only through Alembic migrations, never by the app itself.

## Everything comes from the journal

The most important idea: **every report adds up journal entry lines.** P&L, Balance Sheet, Trial
Balance, Cash Flow, Account Ledger, GST and the dashboard all read the same journal.

Entries reach the journal from:

| Source | When | Entry |
|---|---|---|
| Bank transaction | Made **Final** in the General Ledger | Dr expense / Cr bank (or the reverse for a deposit) |
| Sales invoice | **Posted** | Dr Accounts Receivable, Cr income, Cr output GST |
| Purchase bill | **Posted** | Dr expense, Dr input GST, Cr Accounts Payable (and Cr TDS Payable) |
| Receipt / payment | Saved | Dr bank / Cr receivable, or Dr payable / Cr bank |
| Credit / debit note | Saved | Reverses part of the invoice or bill |
| Opening balance | Client / supplier saved with one | Against "Opening Balance Equity" |
| Manual or imported entry | Saved | Whatever you type or import |

A draft invoice, a draft bill or an unfinalized bank transaction is **not** in the books yet, so it is
in no report. The reports show a banner with how many bank transactions are still outside the books.

Money is never counted twice. Say a receipt is recorded and the same money also arrives on the bank
statement: the two are matched in Bank Reconciliation, and the bank row is not posted a second time.

## Closing protects finished periods

- **Period Close** locks everything dated up to a chosen day, so signed-off reports can't change.
- **Bank Reconciliation → close month** locks one bank account's matches for a month.
- Only the latest close can be reopened.

## Companies

Each company has a **separate database**. The main database (`DATABASE_URL`) is the company `default`,
and it also holds the list of other companies.

- When there are two or more companies, the sign-in page shows a company picker.
- The web app sends the chosen company in the `X-Company` header with every request.
- A sign-in token is only valid for the company it was issued in.
- Uploaded files are kept apart per company: `MEDIA_ROOT/<key>/`.

## Sign-in and permissions

- Signing in returns an **access token** (30 minutes by default) and a **refresh token** (30 days). The
  web app refreshes the access token on its own. Signing out revokes the token.
- Repeated failed sign-ins are rate-limited (`AUTH_RATE_LIMIT_PER_MINUTE`).
- Every user has one **role**. A role is a list of **pages**, and each page has its own **View / Create /
  Edit / Delete** rights. The sidebar shows only your pages and the screens show only your buttons.
  The API checks the same rights on every request.
- Starter roles:

| Role | Can use |
|---|---|
| Admin | Everything, including User Management, Audit Log and AI Assistant |
| Accountant | Everything except User Management, Audit Log and AI Assistant |
| Bookkeeper | Day-to-day work: statements, ledger, journals, invoices, bills, payments, stock, reconciliation |
| Viewer | Dashboard and reports only, read-only |

## Audit trail

Every change to a business record is written to the **Audit Log** automatically, in the same
transaction as the change. Each row has the user, the time, the old values and the new values.
Sign-ins and bulk actions are logged too. Audit rows can't be edited or deleted.
