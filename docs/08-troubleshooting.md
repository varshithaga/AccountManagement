# Troubleshooting

| Problem | Cause and fix |
|---|---|
| API won't start: "DATABASE_URL" or "SECRET_KEY" missing | Copy `backend/.env.example` to `backend/.env` and fill both in |
| `could not connect to server` | PostgreSQL isn't running, or the password or database name in `DATABASE_URL` is wrong. Create the empty database first |
| `relation "..." does not exist` | Tables are missing or out of date. Run `python cli.py migrate` |
| `No module named pytest` / `fastapi` | You're using the system Python. Activate `venv` or run `venv\Scripts\python` |
| Web app shows "Network Error" | The API isn't running on port 8000, or `VITE_API_URL` points elsewhere |
| CORS error in the browser | Add the web app's address to `CORS_ALLOWED_ORIGINS` in `.env` |
| Signed up but see no menus | Only the **first** account becomes administrator. An administrator must give you a role in User Management |
| "This sign-in is for another company" | The token belongs to a different company. Sign out and sign in again, picking the right company |
| Statement upload rejected: running balance doesn't add up | A row in the file is wrong or missing. The message names the row. Fix the file or export it again |
| Statement upload rejected as a duplicate (409) | The same file was already uploaded. For overlapping periods, the app asks you to confirm |
| Rows marked "possible duplicate" | The same date, narration and amount appear twice on one account. Check them and delete the extra copy, or leave them if both are real |
| Transactions don't show in reports | They aren't **Final** yet, or the bank account has no GL account. Link it and use "Post to books" |
| "Period is closed" | The date is on or before the last Period Close. Reopen the latest close (Period Close page) if you really must change it |
| GSTR export: "Set the company GSTIN first" | Enter it under Period Close → Company details |
| Invoice can't be cancelled | It has payments allocated. Remove the allocation or payment first |
| Testing menu missing | Set `TESTING_TOOLS=true` in `.env`, restart the API and sign in as an administrator |
| AI Assistant says it's off | Set `GEMINI_API_KEY` and/or `OPENAI_API_KEY` in `.env` and restart the API |
| Emails aren't sent | `SMTP_HOST` is empty or wrong. For Gmail, use an App Password |
| Backup fails: `pg_dump` not found | Set `PG_BIN_DIR` to PostgreSQL's `bin` folder |
| `demo-data`: "already in company" | The sample data was loaded before. It runs only once per company |
| `demo-data`: "No administrator yet" | Sign up in the app (or run `create-admin`) first |
