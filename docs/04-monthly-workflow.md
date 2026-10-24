# Monthly workflow

The **Workflow** page in the app follows these same steps and ticks them off from your data.

## One-time setup

1. **Chart of Accounts.** `python cli.py seed` gives you a starter set. Add the accounts your business
   needs.
2. **Auto-Categorization Rules.** Add keywords that appear in your bank narrations, for example
   `BESCOM` → Electricity or `SALARY` → Salaries.
3. **BAI Codes** (optional). Map the codes your bank uses to sub-categories.
4. **Bank Accounts.** Add each account and link it to its GL account. Without the link, transactions
   can't be posted to the books or reconciled.
5. **Opening balances.**
   - For each bank, use Bank Reconciliation → **Book opening balance**.
   - For clients and suppliers, enter their opening balance on their record.
   - For stock, use Inventory → **Opening stock**.

## Every month, for each statement

```
 Upload ─► Continuity ─► Auto-Categorize ─► Review ─► Confirm ─► Make Final ─► Reconcile ─► Close
```

| Step | Where | What to do |
|---|---|---|
| 1. Upload | Bank Statements | Pick the bank account and upload the CSV / Excel / PDF. A file whose running balance doesn't add up is rejected, and the error names the row |
| 2. Continuity | Statement Continuity | The opening balance should equal the last statement's closing balance. Upload any missing period |
| 3. Duplicates | Bank Statements | Rows with the same date, narration and amount on the same account are marked **possible duplicate**. Delete the extra copy or keep it: nothing is removed for you |
| 4. Auto-Categorize | Statement → Categorize | Each row is scored against keywords, BAI codes and past choices: **auto-assigned**, **needs review**, or **uncategorized** |
| 5. Review | General Ledger | Accept or change the suggestions, and categorize the rest, one by one or in bulk |
| 6. Confirm | General Ledger | Confirmed rows are never changed by Auto-Categorize again, and future statements learn from them |
| 7. Make Final | General Ledger | Locks the rows and posts them to the journal. From now on they count in the reports |
| 8. Reconcile | Bank Reconciliation | Auto-Match, match the rest by hand, then close the month when the difference is zero or explained |
| 9. Close | Period Close | When the month (or quarter or year) is finished, close the books through its last day |

## Sales and purchases (any time)

1. Add clients, suppliers and products.
2. Raise invoices and record bills. **Post** them to put them in the books.
3. Record receipts and payments and allocate them to invoices and bills.
4. Follow up what is overdue in Receivables & Payables → Reminders.

## Month end

1. GST Summary: check the month's figures, then download **GSTR-1** and **GSTR-3B** JSON and fix
   anything in the warnings list.
2. TDS Summary: see what TDS is due to the government.
3. Reports: P&L, Balance Sheet, Trial Balance and Cash Flow.
4. Back up: `python cli.py backup`.
5. Period Close.
