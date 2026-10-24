# Administration

## Users and roles

User Management has two tabs. Only administrators can open it.

- **Users:** add, edit, deactivate or delete users, give each one a role, and reset passwords.
- **Roles & Permissions:** each role is a list of pages, and each page has its own View / Create / Edit
  / Delete rights.

People who sign up by themselves have **no role**, so they see nothing until an administrator gives them
one. The starter roles (Admin, Accountant, Bookkeeper, Viewer) are described in
[How it works](02-how-it-works.md#sign-in-and-permissions). You can edit them or add your own.

Passwords need at least 8 characters, can't be all numbers or a common password, and can't contain the
username or email name.

## Audit Log

The Audit Log records every create, change, post, cancel and delete of business records, with the
user, the time, and the old and new values. It also records sign-ins, failed sign-ins, password changes
(never the password itself) and bulk actions. Only roles given the Audit Log page can read it.

## Companies

Each company has its own database:

```bash
python cli.py create-company acme "Acme Traders"     # creates account_management_acme and migrates it
python cli.py create-admin admin --company acme       # its first administrator
python cli.py seed --company acme                     # starter accounts and GST rates
python cli.py companies                               # list them
```

- Once there are two or more companies, the sign-in page shows a company picker.
- To hide a company, set `is_active = false` on its row in the main database's `companies` table.
- There is no screen for adding companies yet. Use the command line.

## Backups

```bash
python cli.py backup --keep 14
```

- Each run writes `BACKUP_DIR/<date_time>/`, containing:
  - each company's database (a `pg_dump` file)
  - `media.zip` with the uploaded statements
  - a `RESTORE.txt` with the exact restore steps
- Schedule it daily with Windows Task Scheduler or cron.
- Copy the backup folder to another machine or cloud storage. A backup on the same disk doesn't
  survive a disk failure.
- If `pg_dump` isn't found, set `PG_BIN_DIR` in `.env`, e.g. `C:/Program Files/PostgreSQL/18/bin`.

## Recurring invoices

The server raises due recurring invoices every `RECURRING_CHECK_MINUTES` (default 60) and at start-up.
Periods missed while the server was off are caught up. With the setting at 0, schedule
`python cli.py run-recurring` instead.

## Email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` and `SMTP_SECURITY` in
`.env`. With email set up, invoices can be emailed with the PDF attached and payment reminders can be
sent. For Gmail, use `smtp.gmail.com`, port 587, `starttls` and an **App Password**.

## AI Assistant

```
GEMINI_API_KEY=...      # asked first
OPENAI_API_KEY=...      # used when Gemini fails (optional)
```

- The assistant is **read-only**. It can only call the same report and list endpoints as the screens,
  with the asking user's own rights.
- The figures it looks up are **sent to Google / OpenAI**. Give the AI Assistant page only to roles that
  should share data that way.
- Chats are saved per user, and each user sees only their own.

## Testing tools

`TESTING_TOOLS=true` in `.env` shows the **Testing** menu (Delete Month Journals) to administrators.
Restart the API after changing it. Leave it `false` on live books: with it off, the menu is hidden and
the API refuses the requests.
