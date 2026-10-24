# Features: every menu

The menus are grouped as in the sidebar. Your role decides which ones you see. The in-app **Menu
Guide** has the same descriptions, with examples.

## Overview

| Menu | What it does |
|---|---|
| **Dashboard** | Income, expenses, net profit and cash for a period. Also: this month's sales, purchases and GST payable, what is due in the next 7 days or overdue, an income vs expense chart, bank balances, items needing attention (uncategorized and duplicate transactions), top expenses, recent uploads, and a 3-month cash-flow forecast |
| **Workflow** | The whole process in order (setup, monthly cycle, sales and purchases, reports). Each step is marked Done / To do / Needs attention from your real data, with a button to your next step |
| **Menu Guide** | A plain-English explanation of every screen |
| **AI Assistant** | Ask questions such as "net profit this year?" or "which invoices are overdue?". It answers from the same reports you can open and can't change anything. Needs an API key (see [Administration](06-administration.md)) |

## Masters (set up once)

| Menu | What it does |
|---|---|
| **Chart of Accounts** | Categories (e.g. Operating Expenses) and the sub-categories under them (e.g. Rent). Each has an account type: asset, liability, equity, income or expense. Every transaction ends up on a sub-category |
| **Auto-Categorization Rules** | Keywords under each sub-category. When a bank narration contains a keyword, that sub-category scores higher; an "Auto-assign" keyword picks it outright. You can set the score thresholds for auto-assign and review |
| **BAI Codes** | Standard bank transaction codes (e.g. 464 Service Charge), each mapped to a default sub-category. Used as one more clue when categorizing |
| **Bank Accounts** | Your bank accounts. Link each one to its GL account (e.g. "Bank Accounts") so its transactions can be posted to the books and reconciled |

## Operations & Bookkeeping

| Menu | What it does |
|---|---|
| **Bank Statements** | Upload a CSV, Excel or PDF statement against a bank account. The file's running balance is checked row by row, and the exact same file can't be uploaded twice. Each statement shows its opening and closing balance, continuity, transaction count and **possible duplicates** |
| **Statement Continuity** | Checks that each statement opens with the previous statement's closing balance. Flags balance mismatches, missing periods, overlapping periods and math errors inside a file |
| **General Ledger** | Every bank transaction. Filter, accept suggestions, categorize (one at a time or in bulk) and confirm. **Make Final** locks a transaction and posts it to the books; **Reopen** takes it back out |
| **Journal Entries** | The books themselves. Add a manual double entry, import many at once from Excel or JSON (each import can be undone as a batch), and see the entries posted by invoices, bills, payments and bank transactions |
| **Bank Reconciliation** | Matches bank statement rows against journal lines on the bank's GL account. Auto-Match pairs the same amount on a nearby date; match the rest by hand. Close the month when the difference is explained. Also books a bank's opening balance |
| **Period Close** | Locks the books through a date. Also holds the financial year, the default receivable / payable / cash accounts, and the company details (name, GSTIN, state, address) |

## Sales & Purchases

| Menu | What it does |
|---|---|
| **Clients & Suppliers** | Name, GSTIN, state, payment terms, opening balance and default TDS section (suppliers). **Statement** shows every document for one party with a running balance. Excel import is supported |
| **Products & Tax Rates** | Goods and services with HSN / SAC code, unit, prices, GST rate and the accounts they post to. Turn on **Track stock** for goods. GST rates and TDS sections are kept here too |
| **Sales Invoices** | Draft → **Post** (booked, no more editing) → receipts. PDF download, print and email. Credit notes for returns or discounts. Cancel to undo a posted invoice |
| **Purchase Bills** | Suppliers' bills under the supplier's own number (duplicates refused). Posting books the expense and input GST; a TDS section keeps back TDS. Debit notes for returns |
| **Payments & Receipts** | Money in from clients and out to suppliers, allocated to the invoices or bills it settles. Anything not allocated stays as an advance |
| **Receivables & Payables** | Aging: not yet due, 1-30, 31-60, 61-90 and 90+ days, as of any date. The **Reminders** tab writes ready-made payment reminders and tracks which were sent |
| **Recurring Invoices** | Templates raised every month, quarter, half-year or year, as drafts or posted straight away. The server checks hourly; "Create due invoices" runs it now |
| **Inventory** | Stock on hand of tracked products: in, out, on hand, average cost, value, and low-stock and negative flags. Opening stock and adjustments. Click a product for its movements with the running balance (paged) |

## Financial Statements & Insights

| Menu | What it does |
|---|---|
| **Profit & Loss** | Income minus expenses for a period, by category. Excel export |
| **Balance Sheet** | Assets = liabilities + equity at a date, with a balance check. Excel export |
| **Cash Flow Statement** | Money in and out of bank and cash, split into operating, investing and financing |
| **Trial Balance** | Every account's debit or credit balance. The two columns always agree |
| **Account Ledger** | Every line on one account with its opening, running and closing balance |
| **Period Comparison** | Month-over-month or year-over-year side by side. Excel export |
| **GST Summary** | Output GST, input credit and net payable per CGST / SGST / IGST, by rate, B2B / B2C, HSN and document. The **GST returns** panel downloads the GSTR-1 and GSTR-3B JSON for a month |
| **TDS Summary** | TDS kept back by section and supplier (with PAN), what was paid to the government and what is still outstanding |

## Administration

| Menu | What it does |
|---|---|
| **User Management** | Add, edit, deactivate and delete users, reset passwords, and set up roles with their page rights |
| **Audit Log** | Who created, changed, posted, cancelled or deleted what, and when, with old and new values |
| **Testing → Delete Month Journals** | Removes one month's journal entries. **Only shown to administrators when `TESTING_TOOLS=true`**; keep it off on live books |
