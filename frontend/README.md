# Account Management - frontend

React 19 + TypeScript + Vite + Tailwind. Based on `accounting_prototype/frontend_v2`, pointed at the
FastAPI backend in `../backend`, with Sales & Purchases pages added.

## Run

```bash
npm install
copy .env.example .env      # optional - VITE_API_URL defaults to http://127.0.0.1:8000
npm run dev                 # http://localhost:5173
```

Start the backend first (`cd ../backend`, then `uvicorn app.main:app --reload`). The first account you
sign up with becomes the administrator.

Other scripts: `npm run build`, `npm run typecheck`, `npm run lint`.

## Where things are

| Path | What's in it |
|---|---|
| `src/App.tsx` | Routes |
| `src/access/pages.ts` | Sidebar pages and their rights - keys must match `backend/app/access.py` |
| `src/components/` | Layout, shared UI (`tw/`), dropdowns, pagination, import/export dialogs |
| `src/pages/<Page>/` | One folder per screen, each with its own `*api.ts` |
| `src/pages/Billing/` | Clients, Suppliers, Products & Tax Rates, Sales Invoices, Purchase Bills, Payments & Receipts, Receivables & Payables |
