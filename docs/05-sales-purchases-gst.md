# Sales, purchases & GST

## Document life cycle

```
 Draft ──Post──► Posted ──receipt/payment──► Partly paid ──► Paid
   │               │
 edit/delete     Cancel (only with no payments) ──► Cancelled
```

- **Draft:** you can change or delete it freely. It is not in the books or in GST.
- **Posted:** the journal entry is made and the document can no longer be edited. To undo it, cancel
  it, after removing any payment allocations first.
- Invoice numbers are given out one at a time, so two people saving at once never get the same number.
- A supplier's bill number can't be entered twice for the same supplier.

## What each document posts

| Document | Debit | Credit |
|---|---|---|
| Sales invoice | Accounts Receivable | Income account of each line, output GST |
| Purchase bill | Expense account of each line, input GST | Accounts Payable (and TDS Payable) |
| Receipt | Bank GL account (or Cash) | Accounts Receivable |
| Supplier payment | Accounts Payable | Bank GL account (or Cash) |
| Credit note | Income, output GST | Accounts Receivable |
| Debit note | Accounts Payable | Expense, input GST |

Without a default set in Period Close, "Accounts Receivable", "Accounts Payable" and "Cash" are used. If
a tax rate has no input account, the GST on purchases is added to the expense instead of being claimed.

## Payments and allocation

- One receipt can settle several invoices, and one invoice can be paid in parts.
- An amount you don't allocate stays on the party's account as an advance. You can allocate it later.
- A receipt can't allocate more than is still due on an invoice.
- The bank side of each payment is matched with the bank statement row in Bank Reconciliation, so the
  money is counted only once.

## GST: CGST + SGST or IGST

The company's state (Period Close → Company details) is compared with the party's state:

| Company state vs party state | Tax |
|---|---|
| Same state | CGST + SGST, half each |
| Different state | IGST |
| Either state unknown | Treated as the same state |

The split is worked out when the document is saved and again when it is posted. Each line keeps its
CGST / SGST / IGST, and the document keeps its place of supply. If the Chart of Accounts has
sub-categories named "Output CGST", "Input IGST" and so on, each part posts there. Otherwise it goes to
the tax rate's own account, such as "GST Payable".

## GST Summary

For any period, the GST Summary shows:

- output tax and input credit for posted documents, less credit and debit notes
- net payable per component
- breakdowns by rate, B2B / B2C, HSN / SAC code and document

## GSTR-1 and GSTR-3B export

GST Summary → **GST returns**: pick a month, then click **GSTR-1 JSON** or **GSTR-3B JSON**. The file
downloads in the format the GST portal's offline tool takes. The screen then lists anything to fix.

**GSTR-1 sections:**

| Section | What goes in it |
|---|---|
| B2B | Invoices to clients with a GSTIN |
| B2CL | Out-of-state invoices over ₹1 lakh to unregistered buyers |
| B2CS | Other sales to unregistered buyers, summed by state and rate |
| CDNR / CDNUR | Credit notes to registered / unregistered buyers |
| Nil | Nil-rated supplies |
| HSN | Summary by HSN / SAC code, split B2B and B2C |

**GSTR-3B:** outward supplies, inter-state supplies to unregistered buyers, eligible input tax credit and
inward supplies.

**Warnings to fix before filing:**

- an invalid GSTIN on a client
- a missing place of supply
- a line without an HSN / SAC code
- draft documents that were left out

Before you file:

1. **The company GSTIN must be set**, or the export is refused.
2. **Check the 3B input credit against GSTR-2B.** The export uses what your books claim, not what your
   suppliers filed.
3. LedgerDesk doesn't record cess, exports / SEZ, reverse charge, advances or amendments, so these are
   sent as zero.
4. Open the file in the GST offline tool and check it there before filing. The format hasn't been
   validated against the live portal yet.

## TDS

- Set up TDS sections (194C, 194J ...) under Products & Tax Rates → **TDS sections**.
- A supplier can have a default section, which their new bills pick up.
- A bill with a section keeps back that rate of the taxable value (before GST). The supplier is owed
  the rest, and the TDS sits in **TDS Payable**.
- Paying it to the government is a journal entry: Dr TDS Payable / Cr Bank.
- The **TDS Summary** shows TDS by section and supplier (flagging missing PANs), what was paid and what
  is still due.

## Inventory

Only products with **Track stock** turned on are counted.

| Event | Stock |
|---|---|
| Purchase bill posted | In |
| Sales invoice posted | Out |
| Credit note | Back in |
| Debit note | Out |
| Document cancelled | Its movement is removed |
| Opening stock / Adjust stock | In or out, for counts, damage or samples |

- Stock is tracked in quantity and value (average cost). Purchases are still expensed when the bill is
  posted.
- Products at or below their reorder level, or below zero, are flagged.
- The stock list and each product's movements are paged. The running balance carries across pages.
