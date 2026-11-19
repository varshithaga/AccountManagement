# 📒 LedgerDesk: Accounting for Indian Small Businesses

LedgerDesk is a full-stack **accounting app for Indian small businesses**. The API is FastAPI +
SQLAlchemy and the web app is React + TypeScript.

It covers the whole bookkeeping loop: **upload bank statements → auto-categorize every line →
post to a double-entry journal → raise GST invoices and record bills and payments → reconcile
the bank → close the month → read P&L, Balance Sheet, Cash Flow, GST and TDS reports.** Every figure
in every report comes from one journal. Each user's role decides which pages they can see and
what they can do on each one.

---

## 🎬 Walkthrough

A tour of the running application. Every screen was captured from the real app with the
`demo-data` sample books loaded: sign-in, dashboard, bank statements, general ledger, journal,
reconciliation, invoices, bills, payments, inventory, GST / TDS, all the financial reports, users and
audit log.

| Format | File | Notes |
|--------|------|-------|
| **Video** | [`docs/walkthrough.mp4`](docs/walkthrough.mp4) | 1920×1200 H.264, ~1 min 45 s, one screen every 3 s. Download it or share it anywhere |
| **Animated GIF** | [`docs/walkthrough.gif`](docs/walkthrough.gif) | plays inline below, on GitHub |
| **Slideshow** | [`docs/slideshow.html`](docs/slideshow.html) | open in a browser: autoplay, arrow-key navigation, a caption on every screen |
| **Screenshots** | [`docs/screenshots/`](docs/screenshots/) | 34 full-page images, one per screen (see the [gallery](#-screenshots)) |

![LedgerDesk walkthrough](docs/walkthrough.gif)

### Regenerating the video and screenshots

```bash
python docs/capture.py
```

The script **never touches your own database**. It creates a temporary SQLite database, runs
`init-db` + `seed`, registers a `demo_admin` user, loads `demo-data`, and starts the API on
`:8765` and the web app on `:5199`. Then headless Chrome / Edge signs in through the real
sign-in page and opens every screen. Afterwards it stops both servers and deletes the sandbox. It
needs `backend/venv`, `frontend/node_modules`, Node.js and Chrome or Edge. On the first run it
installs `puppeteer-core` + `ffmpeg-static` into `docs/node_modules` (git-ignored).

---

## Table of contents

- [Walkthrough](#-walkthrough)
- [Screenshots](#-screenshots)
- [Features](#-features)
- [Tech stack](#-tech-stack)
- [Architecture](#-architecture)
- [Getting started](#-getting-started)
- [Demo data](#-demo-data)
- [Roles & permissions](#-roles--permissions)
- [API overview](#-api-overview)
- [Tests](#-tests)
- [Project layout](#-project-layout)
- [Documentation](#-documentation)

---

## 🖼 Screenshots

Click a section to expand it. Every image is a full-page capture at 2× (1440 px wide viewport).

<details open>
<summary><b>Sign-in & Dashboard</b></summary>

| Sign in | Dashboard |
|---|---|
| ![Sign in](docs/screenshots/01-login.jpg) | ![Dashboard](docs/screenshots/03-dashboard.jpg) |

| Sign up | Workflow |
|---|---|
| ![Sign up](docs/screenshots/02-signup.jpg) | ![Workflow](docs/screenshots/04-workflow.jpg) |

</details>

<details>
<summary><b>Banking & bookkeeping</b>: bank accounts, statements, continuity, general ledger, journal, reconciliation</summary>

**Bank Accounts**
![Bank Accounts](docs/screenshots/05-bank-accounts.jpg)

**Bank Statements**
![Bank Statements](docs/screenshots/06-bank-statements.jpg)

**Statement Continuity**
![Statement Continuity](docs/screenshots/07-statement-continuity.jpg)

**General Ledger** (categorize bank transactions, then Make Final)
![General Ledger](docs/screenshots/08-transactions.jpg)

**Journal Entries**
![Journal Entries](docs/screenshots/09-journal-entries.jpg)

**Bank Reconciliation**
![Bank Reconciliation](docs/screenshots/10-bank-reconciliation.jpg)

</details>

<details>
<summary><b>Masters</b>: chart of accounts, auto-categorization rules</summary>

**Chart of Accounts**
![Chart of Accounts](docs/screenshots/11-categories.jpg)

**Auto-Categorization Rules**
![Auto-Categorization Rules](docs/screenshots/12-category-keywords.jpg)

</details>

<details>
<summary><b>Sales & purchases</b>: clients, suppliers, products, invoices, bills, payments, recurring, inventory, aging</summary>

**Clients**
![Clients](docs/screenshots/13-clients.jpg)

**Suppliers**
![Suppliers](docs/screenshots/14-suppliers.jpg)

**Products & Tax Rates**
![Products](docs/screenshots/15-products.jpg)

**Sales Invoices**
![Sales Invoices](docs/screenshots/16-sales-invoices.jpg)

**Purchase Bills**
![Purchase Bills](docs/screenshots/17-purchase-bills.jpg)

**Payments & Receipts**
![Payments](docs/screenshots/18-payments.jpg)

**Recurring Invoices**
![Recurring Invoices](docs/screenshots/19-recurring-invoices.jpg)

**Inventory**
![Inventory](docs/screenshots/20-inventory.jpg)

**Receivables & Payables**
![Receivables & Payables](docs/screenshots/21-receivables-payables.jpg)

</details>

<details>
<summary><b>Tax</b>: GST summary & returns, TDS summary</summary>

**GST Summary** (with the GSTR-1 / GSTR-3B panel)
![GST Summary](docs/screenshots/22-gst-summary.jpg)

**TDS Summary**
![TDS Summary](docs/screenshots/23-tds-summary.jpg)

</details>

<details>
<summary><b>Financial statements</b>: P&L, balance sheet, trial balance, cash flow, account ledger, comparison, period close</summary>

**Profit & Loss**
![Profit & Loss](docs/screenshots/24-profit-and-loss.jpg)

**Balance Sheet**
![Balance Sheet](docs/screenshots/25-balance-sheet.jpg)

**Trial Balance**
![Trial Balance](docs/screenshots/26-trial-balance.jpg)

**Cash Flow Statement**
![Cash Flow](docs/screenshots/27-cash-flow.jpg)

**Account Ledger**
![Account Ledger](docs/screenshots/28-account-ledger.jpg)

**Period Comparison**
![Period Comparison](docs/screenshots/29-reports-comparison.jpg)

**Period Close**
![Period Close](docs/screenshots/30-period-close.jpg)

</details>

<details>
<summary><b>Administration & help</b>: AI assistant, users & roles, audit log, menu guide</summary>

**AI Assistant**
![AI Assistant](docs/screenshots/31-ai-assistant.jpg)

**User Management**
![User Management](docs/screenshots/32-users.jpg)

**Audit Log**
![Audit Log](docs/screenshots/33-audit-log.jpg)

**Menu Guide**
![Menu Guide](docs/screenshots/34-menu-guide.jpg)

</details>

---

## ✨ Features

### Dashboard & guidance (`/dashboard`, `/workflow`, `/menu-guide`)
- Income, expenses, net profit and cash & bank balance for any period, compared with the previous one.
- This month's **sales, purchases and GST payable**; what's due in the next 7 days and what's overdue.
- **Cash flow & runway** chart with a 3-month forecast.
- **Needs your attention**: uncategorized transactions, possible duplicates, unreconciled lines,
  statement gaps, overdue invoices and bills, each with a button that takes you there.
- **Workflow** shows every step of the process as Done / To do / Needs attention from your real data.
  **Menu Guide** explains every screen in plain English.

### Bank statements → books
- **Upload CSV, Excel or PDF statements** per bank account. The running balance is checked row by row,
  the same file can't be uploaded twice, and **possible duplicate rows** are flagged.
- **Statement Continuity** catches balance mismatches, missing periods and overlapping periods.
- **General Ledger**: every bank line is **auto-categorized** from keyword rules + BAI codes. Accept
  suggestions, categorize in bulk, then **Make Final** to post it to the journal (or **Reopen** it).
- **Journal Entries**: manual double entries, bulk import from Excel / JSON (undo a whole batch), and
  every entry posted by invoices, bills, payments and bank lines.
- **Bank Reconciliation**: auto-match bank rows to journal lines, match the rest by hand, close the month.

### Sales, purchases & GST
- **Clients & suppliers** with GSTIN, state, payment terms, opening balance, default TDS section, a
  party statement, and Excel import.
- **Products** with HSN / SAC, prices, GST rate, posting accounts and optional **stock tracking**.
- **Sales invoices**: Draft → Post → receipts. **PDF**, print and **email**, credit notes, cancel.
- **Purchase bills** under the supplier's own number (duplicates refused), input GST, **TDS** deduction,
  debit notes.
- **Payments & receipts** allocated to the invoices / bills they settle. Anything left over stays an advance.
- **Recurring invoices**, monthly to yearly. The server raises them by itself.
- **Inventory**: on hand, average cost, value, low-stock / negative flags, adjustments, movement history.
- **Receivables & payables aging** (0-30 / 31-60 / 61-90 / 90+) with ready-made payment reminders.
- **GST**: automatic CGST + SGST or IGST split by place of supply. **GST Summary** by rate, B2B / B2C,
  HSN and document. **GSTR-1 and GSTR-3B JSON** export.
- **TDS Summary** by section and supplier (with PAN): deducted, paid and outstanding.

### Financial statements
- **Profit & Loss**, **Balance Sheet** (with a balance check), **Trial Balance**, **Cash Flow Statement**
  (operating / investing / financing), **Account Ledger** with a running balance, and **Period Comparison**
  (MoM / YoY). Excel and PDF export.
- **Period Close** locks the books through a date, so signed-off reports can't change.

### Administration
- **Users & roles** with per-page **View / Create / Edit / Delete** rights.
- **Audit Log** of every create / change / post / cancel / delete, with old and new values, plus sign-ins.
- **Several companies**, each in its **own database**, with a company picker on the sign-in page.
- **Backups** (`cli.py backup`) with a `RESTORE.txt` in each one.
- **AI Assistant**: a read-only chat about the books ("net profit this year?", "which invoices are
  overdue?"). Gemini answers first and OpenAI is the fallback.
- **Light / dark theme.**

---

## 🛠 Tech stack

### Backend (`/backend`)
| | |
|---|---|
| Language / framework | Python 3.11+, **FastAPI** |
| ORM / migrations | **SQLAlchemy 2.x**, **Alembic** |
| Validation / settings | Pydantic 2, pydantic-settings (`.env`) |
| Auth | JWT (PyJWT): access 30 min + rotating refresh 30 days, bcrypt passwords, rate-limited sign-in |
| Statement parsing | pandas, openpyxl, pdfplumber |
| Database | **PostgreSQL** (psycopg 3), one database per company. SQLite works for trying it out |
| AI | Gemini / OpenAI over httpx (optional) |
| Tests | pytest |

### Frontend (`/frontend`)
| | |
|---|---|
| Framework | **React 19**, **TypeScript** |
| Build tool | **Vite** |
| Styling | **Tailwind CSS 4**, light and dark themes |
| Routing | React Router 7, lazy-loaded pages |
| HTTP | Axios with JWT refresh + `X-Company` header (`src/api/client.ts`) |
| Export | ExcelJS (Excel import/export), jsPDF + autotable (PDF) |
| Icons | lucide-react |
| Lint / tests | Oxlint, Vitest + Testing Library |

---

## 🏗 Architecture

```
┌──────────────────────────────┐         ┌───────────────────────────────────────────┐
│  React SPA (Vite :5173)      │  HTTP   │  FastAPI (:8000)   /api/…                 │
│                              │ ──────▶ │  routers/   one file per area             │
│  AuthContext + Axios         │  JWT +  │  services/  posting, GST, reports,        │
│  (token refresh, X-Company)  │X-Company│            parsing, reconciliation …      │
│  Pages shown per role        │ ◀────── │  access.py  pages, roles and rights       │
└──────────────────────────────┘  JSON   └───────────────────────────────────────────┘
                                                          │
                                       PostgreSQL: one database per company
                                       media/: uploaded statements (signed-in only)
```

**Everything comes from the journal.** P&L, Balance Sheet, Trial Balance, Cash Flow, Account Ledger,
GST and the dashboard all add up the same journal lines:

| Source | When | Entry |
|---|---|---|
| Bank transaction | Made **Final** in the General Ledger | Dr expense / Cr bank (or the reverse) |
| Sales invoice | **Posted** | Dr Receivable, Cr income, Cr output GST |
| Purchase bill | **Posted** | Dr expense, Dr input GST, Cr Payable (and Cr TDS Payable) |
| Receipt / payment | Saved | Dr bank / Cr receivable, or Dr payable / Cr bank |
| Credit / debit note | Saved | Reverses part of the invoice or bill |
| Manual / imported entry | Saved | Whatever you type or import |

Drafts and unfinalized bank lines are not in the books yet. Bank Reconciliation makes sure no money is
counted twice. More detail is in [How it works](docs/02-how-it-works.md).

---

## 🚀 Getting started

### Prerequisites
- Python **3.11+**
- Node.js **18+** and npm
- PostgreSQL (or set `DATABASE_URL=sqlite:///./accounting.db` to just try it out)

### 1. API

```bash
cd backend
python -m venv venv
venv\Scripts\activate                  # Windows  (source venv/bin/activate elsewhere)
pip install -r requirements.txt
copy .env.example .env                 # set DATABASE_URL and SECRET_KEY (cp on macOS / Linux)

python cli.py init-db                  # tables + default roles
python cli.py seed                     # starter Chart of Accounts, GST rates, BAI codes
uvicorn app.main:app --reload          # http://127.0.0.1:8000/docs
```

### 2. Web app (second terminal)

```bash
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

### 3. First sign-in
Open http://localhost:5173 and sign up. **The first account becomes the administrator.** Later
sign-ups see nothing until an administrator gives them a role. Optional settings (email/SMTP, AI
keys, backups, recurring invoices) are explained, one comment each, in
[`backend/.env.example`](backend/.env.example).

---

## 🌱 Demo data

```bash
cd backend
python cli.py demo-data                # needs `seed` and an administrator first
```

This loads sample books through the API itself, so everything is checked and posted exactly as if
typed in: company details, a bank account, clients, suppliers, products, sales invoices, purchase
bills, payments, a credit note, a journal entry and two bank statements. It also **plants duplicates**
(a repeated bank row, an overlapping statement, a near-duplicate client) so the duplicate checks have
something to flag. Dates are relative to today, so the dashboard and aging always have data.

> **Use a test database only.** Never run `demo-data` on live books.

---

## 👥 Roles & permissions

Every user has one **role**. A role is a list of pages, and each page has its own **View / Create /
Edit / Delete** rights. The sidebar shows only your pages, the screens show only your buttons, and
the API checks the same rights on every request.

| Starter role | Can use |
|---|---|
| **Admin** | Everything, including User Management, Audit Log and AI Assistant |
| **Accountant** | Everything except User Management, Audit Log and AI Assistant |
| **Bookkeeper** | Day-to-day work: statements, ledger, journals, invoices, bills, payments, stock, reconciliation |
| **Viewer** | Dashboard and reports only, read-only |

Roles can be edited, and new ones added, in **User Management → Roles & Permissions**.

---

## 📡 API overview

Base URL `http://127.0.0.1:8000/api/`. Interactive docs are at **`/docs`** (Swagger). Every request
carries `Authorization: Bearer <access>` and, when there are several companies, `X-Company: <key>`.

| Area | Router | Examples |
|---|---|---|
| Auth | `auth.py` | `POST /auth/token/`, `/auth/token/refresh/`, `/auth/register/`, `/auth/logout/` |
| Masters | `masters.py` | categories, sub-categories, keywords, BAI codes, bank accounts, tax rates |
| Statements | `statements.py` | upload / list bank statements, continuity, duplicates |
| Transactions | `transactions.py` | categorize, bulk update, make final / reopen |
| Journal | `journal.py` | manual entries, Excel / JSON import, undo batch |
| Reconciliation | `reconciliation.py` | auto-match, manual match, close month |
| Billing | `billing.py`, `parties.py` | invoices, bills, notes, payments, clients, suppliers, products |
| Recurring / inventory | `recurring.py`, `inventory.py` | templates, stock movements |
| Reports | `reports.py`, `dashboard.py` | P&L, balance sheet, trial balance, cash flow, ledger, comparison, GST, TDS |
| Period close | `period_close.py` | lock date, company details, defaults |
| Admin | `users.py`, `audit.py` | users, roles, rights, audit log |
| AI | `ai.py` | assistant chats |

The full endpoint list, posting rules and GST rules are in [`backend/README.md`](backend/README.md).

---

## 🧪 Tests

```bash
cd backend && pytest                   # API, GST & returns, companies, demo data, sales tools, AI assistant
cd frontend && npm test                # Vitest: helpers and components
cd frontend && npm run typecheck && npm run lint
```

---

## 📁 Project layout

```
AccountManagement/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, routers, recurring scheduler
│   │   ├── models.py            # SQLAlchemy models
│   │   ├── schemas.py           # Pydantic request bodies
│   │   ├── access.py            # pages, roles and rights
│   │   ├── security.py          # passwords, JWT
│   │   ├── database.py          # engine per company, migrations
│   │   ├── routers/             # one file per area (billing, reports, statements …)
│   │   └── services/            # posting, GST, GSTR returns, TDS, parsing, reconciliation,
│   │                            # reports, inventory, invoicing, mailer, AI assistant, backup …
│   ├── migrations/              # Alembic
│   ├── tests/                   # pytest
│   ├── cli.py                   # init-db, seed, demo-data, create-admin, create-company, backup …
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/                 # axios client (JWT refresh, X-Company)
│   │   ├── access/              # session, company, page rights
│   │   ├── context/             # AuthContext, ThemeModeContext
│   │   ├── components/          # Layout, guards, selects, tw/ UI kit
│   │   ├── pages/               # one folder per screen
│   │   ├── utils/               # Excel / PDF export, periods …
│   │   └── App.tsx              # routes + page guards
│   └── vite.config.ts
└── docs/
    ├── 01-…08-*.md              # user and developer documentation
    ├── screenshots/             # 34 screen captures
    ├── walkthrough.mp4 / .gif   # walkthrough video
    ├── slideshow.html           # captioned slideshow
    └── capture.py, _capture.js  # regenerate all of the above
```

---

## 📚 Documentation

All documentation is in [`docs/`](docs/README.md):

| Document | What it covers |
|---|---|
| [Getting started](docs/01-getting-started.md) | Installing, configuring `.env`, running, first sign-in, sample data |
| [How it works](docs/02-how-it-works.md) | Architecture, the journal, companies, sign-in and roles |
| [Features](docs/03-features.md) | Every menu in the app and what it does |
| [Monthly workflow](docs/04-monthly-workflow.md) | From uploading a bank statement to closing the month |
| [Sales, purchases & GST](docs/05-sales-purchases-gst.md) | Invoices, bills, payments, notes, GST, GSTR-1/3B, TDS, inventory |
| [Administration](docs/06-administration.md) | Users and roles, audit log, companies, backups, email, AI Assistant |
| [Developer guide](docs/07-developer-guide.md) | Code layout, API, migrations, tests, adding a feature |
| [Troubleshooting](docs/08-troubleshooting.md) | Common problems and fixes |

The app also has two built-in guides: **Workflow** (your live progress and next step) and
**Menu Guide** (a plain-English description of every screen).
