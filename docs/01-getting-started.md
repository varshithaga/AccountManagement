# Getting started

## What you need

- **Python 3.11+** for the API
- **Node.js 20.19+ or 22+** for the web app
- **PostgreSQL 14+**. Or use SQLite to try it out: a single file, no server needed.

## 1. Set up the API

```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows   (macOS / Linux: source venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env           # macOS / Linux: cp .env.example .env
```

Edit `backend/.env`. Only two settings are required:

| Setting | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres:PASSWORD@localhost:5432/account_management` | Create the empty database first. For SQLite: `sqlite:///./accounting.db` |
| `SECRET_KEY` | 48 random characters | Generate one: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |

Optional settings (all described in `.env.example`):

| Setting | What it does |
|---|---|
| `SMTP_*` | Outgoing email for invoices and payment reminders. Leave `SMTP_HOST` empty to turn email off |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | Turn on the AI Assistant |
| `RECURRING_CHECK_MINUTES` | How often the server raises due recurring invoices (0 = off) |
| `MEDIA_ROOT`, `BACKUP_DIR`, `PG_BIN_DIR` | Where uploads and backups go, and where `pg_dump` is |
| `TESTING_TOOLS` | `true` shows the admin-only Testing menu (Delete Month Journals). Keep it `false` on live books |

Then create the tables and the starter data:

```bash
python cli.py init-db     # applies migrations and creates the roles Admin, Accountant, Bookkeeper, Viewer
python cli.py seed        # starter Chart of Accounts, keyword rules, GST rates, BAI codes, sample banks
```

`seed` only adds what is missing, so running it again is safe.

Start the API:

```bash
uvicorn app.main:app --reload
```

You can browse the interactive API docs at http://127.0.0.1:8000/docs.

## 2. Set up the web app

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

The web app expects the API at `http://127.0.0.1:8000`. To change this, set `VITE_API_URL` in
`frontend/.env`.

## 3. First sign-in

1. Open http://localhost:5173 and click **Sign up**.
2. **The first account becomes the administrator.** Later sign-ups can't see any pages until an
   administrator gives them a role (see [Administration](06-administration.md)).
   You can also create an administrator from the command line: `python cli.py create-admin <username>`.
3. Open **Workflow** in the sidebar. It shows what is set up, what isn't, and your next step.
4. Go to **Period Close → Company details** and enter the company name, GSTIN, state and address.
   The state decides whether each invoice is charged CGST + SGST or IGST, and the GSTIN is needed for
   GST returns.

## 4. Sample data (optional)

To try the app with realistic data:

```bash
cd backend
python cli.py demo-data                  # main company
python cli.py demo-data --company acme   # another company
```

Run it after `seed` and after you have signed up as administrator. It adds the following, spread over
the last three months:

- 5 clients, 3 suppliers, 4 products (2 of them stock-tracked)
- 9 sales invoices and 4 purchase bills, including drafts, paid, part-paid and unpaid ones
- 5 payments, 1 credit note and 2 journal entries
- 2 bank statements

It also adds duplicates on purpose:

- **Bank rows:** one repeated row, plus two statements that cover the same 3 days. The Bank Statements
  page shows 8 rows as possible duplicates.
- **Near-duplicate clients:** "Sharma Traders" and "Sharma Traders Pvt Ltd" have the same email and
  phone.
- **Refused exact duplicates:** the command also tries a second client with the same name, the same
  bill number twice and the same statement file twice. It reports that the app refused each one.

All sample records have codes starting with `DEMO-`. The command won't run twice on the same company.
**Use it on a test database only**: the sample data has to be removed by hand.

## Everyday commands

| Command | What it does |
|---|---|
| `python cli.py migrate` | Apply new database migrations (all companies) |
| `python cli.py backup --keep 14` | Back up every company's database and uploads |
| `python cli.py run-recurring` | Raise due recurring invoices now |
| `python cli.py companies` | List the companies |
| `python cli.py --help` | All commands |
