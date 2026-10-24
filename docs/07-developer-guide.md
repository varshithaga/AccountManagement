# Developer guide

## Code layout

```
backend/
  app/
    main.py            FastAPI app, routers, CORS, scheduler start-up
    config.py          settings, read from .env
    database.py        engine, one session per company, migrations
    models.py          SQLAlchemy models
    schemas.py         request bodies (Pydantic)
    serializers.py     response shapes
    access.py, deps.py pages, roles, rights, the Access(...) dependency
    utils.py           pagination helpers (page_params, paginate ...)
    routers/           endpoints, one file per area
    services/          business logic:
                         parsing, categorization, duplicates, continuity, transfers   bank statements
                         posting, invoicing, tds, inventory                           documents to journal
                         reports, gst, gst_returns                                    reports and GST
                         reconciliation, period_close, recurring, backup, audit, ...
                         seed, demo_data                                              starter and sample data
  migrations/versions/ Alembic migrations
  tests/               pytest, end to end through HTTP
  cli.py               setup and maintenance commands

frontend/src/
  App.tsx              routes
  access/pages.ts      sidebar pages and rights (keys must match backend/app/access.py)
  components/          layout, shared UI (tw/), pagination, dialogs
  context/             AuthContext (signed-in user, tokens, company)
  pages/<Page>/        one folder per screen, each with its own *api.ts
```

## API

- Every endpoint is under `/api`. Interactive docs: http://127.0.0.1:8000/docs.
- Requests need `Authorization: Bearer <access token>`, plus `X-Company: <key>` for any company other
  than `default`.
- List endpoints are paged with `?page=` and `?limit=`. They return `count`, `next`, `previous`,
  `current_page`, `total_pages` and `results`.
- Errors are JSON, e.g. `{"error": [...]}` or `{"field": ["message"]}`, with a 400, 401, 403, 404 or 409
  status.
- The full endpoint list is in [`backend/README.md`](../backend/README.md) (section "API").

## Database migrations

```bash
# 1. change app/models.py
python cli.py makemigrations "add website to clients"
# 2. read the generated file in migrations/versions/:
#    - autogenerate can't see renames (it drops and re-adds)
#    - a new NOT NULL column on a table that has rows needs server_default=
python cli.py migrate          # upgrades the main database and every company's
```

## Tests and checks

```bash
# backend
cd backend
venv\Scripts\python -m pytest -q        # temporary SQLite database, every test starts clean

# frontend
cd frontend
npm test                # Vitest
npm run typecheck       # TypeScript
npm run lint            # oxlint
npm run build           # production build into dist/
```

Set `TEST_DATABASE_URL` to run the backend tests on a throwaway PostgreSQL database. **Every test drops
and recreates all tables there.**

## Adding a feature: the usual path

1. **Model:** change `app/models.py`, then run `makemigrations` and `migrate`.
2. **Logic:** add a function in `app/services/`. Keep routers thin.
3. **Endpoint:** add it in `app/routers/<area>.py`, guarded by `Depends(Access("<page>", action=...))`.
   Write the request body in `schemas.py` and the response in `serializers.py`.
4. **Tests:** add them in `backend/tests/`, through the `admin` fixture (a signed-in administrator).
5. **Screen:** add API calls in `pages/<Page>/<page>api.ts` and the page component. Add the route in
   `App.tsx`. For a new page, add its key in both `access/pages.ts` and `backend/app/access.py`.
6. **Docs:** update the Menu Guide text (`pages/MenuGuide/menuGuideData.tsx`), the Workflow step if
   needed, and these documents.

## Rules the code keeps

- Anything that reaches the books goes through `services/posting.py`. It checks that the entry balances
  and that its dates aren't in a closed period or a reconciled month.
- Reports read journal lines only, never invoices or transactions directly.
- The audit log is written automatically on flush (`services/audit.py`). Don't write audit rows by hand.
- Delete nothing silently. Duplicates are **flagged**, never removed or merged.
