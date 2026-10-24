# LedgerDesk

LedgerDesk is an accounting app for Indian small businesses. It turns bank statements into categorized
books, and it also does sales invoices, purchase bills, payments, GST (CGST / SGST / IGST, GSTR-1 and
GSTR-3B export), TDS, inventory and the full set of financial reports. Every figure comes from one
double-entry journal.

| Part | Technology | Folder |
|---|---|---|
| API | Python, FastAPI, SQLAlchemy 2.0, Alembic | [`backend/`](backend/) |
| Web app | React 19, TypeScript, Vite, Tailwind | [`frontend/`](frontend/) |
| Database | PostgreSQL (SQLite works for trying it out) | one database per company |

## Quick start

```bash
# 1. API
cd backend
python -m venv venv
venv\Scripts\activate                  # Windows (source venv/bin/activate elsewhere)
pip install -r requirements.txt
copy .env.example .env                 # set DATABASE_URL and SECRET_KEY
python cli.py init-db                  # tables + default roles
python cli.py seed                     # starter Chart of Accounts, GST rates, BAI codes
uvicorn app.main:app --reload          # http://127.0.0.1:8000/docs

# 2. Web app (second terminal)
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

Open http://localhost:5173 and sign up. **The first account becomes the administrator.**
To get sample data to try things on, run `python cli.py demo-data` in `backend/`. Do this on a test
database only.

## Documentation

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

The app has two built-in guides too: **Workflow** (your live progress and next step) and **Menu Guide**
(a plain-English description of every screen).
