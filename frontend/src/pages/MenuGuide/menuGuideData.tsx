/** Menu Guide: every sidebar menu with its description and explanation, grouped as in the sidebar. */
import {
  LayoutDashboard, Folders, Tag, Hash, Landmark, Receipt, ArrowLeftRight, BarChart3, Wallet, Scale,
  GitCompare, BookOpen, FileSpreadsheet, Check, Link2, ListChecks, Users, Lock, Waves,
  NotebookText, Contact, Package, FileText, ShoppingCart, HandCoins, Hourglass, Percent, History,
  Repeat, Boxes, ReceiptIndianRupee, Sparkles,
} from 'lucide-react'
import type { PageKey } from '../../access/pages'

// Single Unified Client Menu Data Structure
export interface DemoItem {
  id: string
  label: string
  icon: React.ReactNode
  badge?: string
  badgeColor?: string
  desc: string
  explanation: string
  examplesTitle: string
  /** Shown only to users whose role opens this page (e.g. admin-only menus). */
  requiresPage?: PageKey
}

export interface DemoGroup {
  title: string
  items: DemoItem[]
}

export const SINGLE_ROLE_MENU: DemoGroup[] = [
  {
    title: 'Overview',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: <LayoutDashboard className="h-4 w-4" />,
        desc: 'High-level financial overview and quick access hub for the client.',
        explanation: 'The Dashboard is the home screen. For the selected period it shows Income, Expenses, Net Profit and Cash Balance; a Sales & purchases panel (always the current month) shows sales, purchases, GST payable, recurring invoices due, and what is due to come in or go out in the next 7 days or is already overdue. Below that come an Income vs Expense chart, the latest balance of every bank account (Cash Position), what Needs Attention (uncategorized and duplicate transactions), the Top Expense Categories, and the most recent statement uploads. The Cash Flow Forecast shows the last six months of money in and out (transfers between your own accounts left out), the average monthly burn, how many months the current cash would last, and a three-month projection.',
        examplesTitle: 'Dashboard Highlights & Widgets',
      },
      {
        id: 'workflow',
        label: 'Workflow',
        icon: <ListChecks className="h-4 w-4" />,
        badge: 'Start here',
        badgeColor: 'bg-violet-500/15 text-primary font-bold',
        desc: 'Step-by-step guide to the whole process, with your live progress and the next thing to do.',
        explanation: 'The Workflow page walks through every step in order - one-time setup (Chart of Accounts, Rules, BAI Codes, Bank Accounts), then the monthly cycle (upload, continuity check, auto-categorize, review, confirm, make final) and finally the reports. It reads your data to mark each step Done, To do or Needs attention, and shows your next step with a button that opens the right page.',
        examplesTitle: 'Steps & Your Next Step',
      },
      {
        id: 'menu_guide',
        label: 'Menu Guide',
        icon: <BookOpen className="h-4 w-4" />,
        desc: 'Interactive guide and real accounting workflow simulator.',
        explanation: 'The Menu Guide provides a plain-English reference for every section of the application, explaining how Categories, Keywords, Bank Accounts, Statements, and Financial Reports work together with interactive examples.',
        examplesTitle: 'Menu Guide & Learning System',
      },
      {
        id: 'ai_assistant',
        label: 'AI Assistant',
        icon: <Sparkles className="h-4 w-4" />,
        desc: 'Ask questions about your books in plain words and get answers from your own reports.',
        explanation: 'The AI Assistant answers questions such as "What is our net profit this year?", "Which invoices are overdue?" or "How much GST do we owe for last month?". To answer, it looks up the same reports you see in LedgerDesk (Profit & Loss, Balance Sheet, GST and TDS Summary, aging, invoices, bills, payments, stock, account ledgers) - only those your role can open - and says which ones it used. It can only read: it never creates, changes or deletes anything. Chats are saved for you alone and can be deleted. Answers are written by Google Gemini, or OpenAI when Gemini is unavailable, so the figures it looks up are sent to that service; an administrator decides which roles get this page. AI can make mistakes - check important figures in the reports.',
        examplesTitle: 'Asking the AI Assistant',
        requiresPage: 'ai_assistant',
      },
    ],
  },
  {
    title: 'Masters',
    items: [
      {
        id: 'chart_accounts',
        label: 'Chart of Accounts',
        icon: <Folders className="h-4 w-4" />,
        desc: 'Master directory of Categories & Sub-Categories used to classify all transactions.',
        explanation: 'In the Chart of Accounts, you define primary Categories (e.g., Operating Expenses, Employee Costs, Revenue) and detailed Sub-Categories under each (e.g., Office Rent, Software & Cloud, Salaries & Wages). Every bank transaction uploaded into the system is categorized into one of these sub-categories.',
        examplesTitle: 'Categories & Sub-Categories Directory',
      },
      {
        id: 'auto_rules',
        label: 'Auto-Categorization Rules',
        icon: <Tag className="h-4 w-4" />,
        badge: 'Keyword Engine',
        badgeColor: 'bg-emerald-500/15 text-success-text font-bold',
        desc: 'Enter bank narration keywords under each Sub-Category to auto-categorize bank statements.',
        explanation: 'Here you enter Keywords under each Sub-Category. When you run Auto-Categorize, every transaction narration is checked: a keyword marked "Auto-assign" assigns its Sub-Category directly; other keywords are one scoring clue alongside the sub-category name, the BAI code and past confirmed transactions. A high, clear score is Auto-assigned, a medium score is marked Needs Review for you to accept, and a low score stays Uncategorized. The score thresholds can be adjusted on this page.',
        examplesTitle: 'Keywords Entered Under Sub-Categories',
      },
      {
        id: 'bai_codes',
        label: 'BAI Codes',
        icon: <Hash className="h-4 w-4" />,
        desc: 'Standardized bank transaction code mappings (BAI2 format).',
        explanation: 'Bank files often carry a standard numerical BAI code on each line (e.g. 108 Credit, 464 Service Charge, 495 Outgoing Money Transfer, 815 Interest Credit). Here you give each code a default Category / Sub-Category; when a statement line carries that code, it counts as a clue towards that Sub-Category during Auto-Categorize.',
        examplesTitle: 'BAI Code Definitions & Mappings',
      },
      {
        id: 'bank_accounts',
        label: 'Bank Accounts',
        icon: <Landmark className="h-4 w-4" />,
        desc: 'Enter N number of corporate bank accounts used for statement upload and tracking.',
        explanation: 'Here you can add and manage N number of company bank accounts (e.g., HDFC Current Account, ICICI Operating Account, SBI Treasury Account). When uploading a bank statement, you select which bank account the statement belongs to.',
        examplesTitle: 'Registered Corporate Bank Accounts',
      },
    ],
  },
  {
    title: 'Operations & Bookkeeping',
    items: [
      {
        id: 'bank_statements',
        label: 'Bank Statements',
        icon: <Receipt className="h-4 w-4" />,
        badge: 'Core step',
        badgeColor: 'bg-amber-500/15 text-warning-text font-bold',
        desc: 'Upload statements (CSV, Excel or PDF) and see every import with its balances, gaps and duplicates.',
        explanation: "Upload a bank statement (CSV, Excel or PDF) against a bank account. Opening and closing balances are read from the file's own running balance, and a file whose running balance doesn't add up row-to-row is rejected with the exact row to check. The list shows each import's opening and closing balance, whether it continues from the previous statement, its transaction count and duplicates. Open a statement to auto-categorize, review and confirm its transactions.",
        examplesTitle: 'List of Uploaded Bank Statements & Parser Simulator',
      },
      {
        id: 'statement_continuity',
        label: 'Statement Continuity',
        icon: <Link2 className="h-4 w-4" />,
        desc: "Checks each statement opens with the previous statement's closing balance, per bank account.",
        explanation: "For every bank account, statements are lined up by their transaction dates. Each statement's opening balance should equal the previous statement's closing balance. Differences are flagged as a Balance Mismatch, a Missing Statement (a gap in dates with the balance jumping - upload the missing period), an Overlapping Period (the same days uploaded twice) or a Math Mismatch inside one file.",
        examplesTitle: 'Balance Chain Between Monthly Statements',
      },
      {
        id: 'general_ledger',
        label: 'General Ledger',
        icon: <ArrowLeftRight className="h-4 w-4" />,
        desc: 'Every bank transaction from every statement, to categorize, review and confirm.',
        explanation: 'The General Ledger lists every transaction from all uploaded statements as soon as they are parsed, with date, narration, debit, credit, category and status. Filter by account, period, category, status or source; accept suggestions, assign categories one at a time or in bulk, and confirm them. Confirmed choices are never overwritten by Auto-Categorize and are learned from for future statements. When a transaction is done, Make Final locks it and posts it to the books (a journal entry, matched in Bank Reconciliation) - from then on it counts in the reports. A final transaction can no longer be re-categorized or deleted until you Reopen it, which also takes it back out of the books. "Post to books" posts final transactions that could not be posted earlier, e.g. because the bank account had no GL account yet.',
        examplesTitle: 'Transactions & Their Categorization Status',
      },
      {
        id: 'journal_entries',
        label: 'Journal Entries',
        icon: <FileSpreadsheet className="h-4 w-4" />,
        desc: "The company's books: every double entry - typed in, imported, or posted by invoices, bills, payments and bank transactions.",
        explanation: "Journal Entries holds the company's books, and every report is added up from them. New journal entry opens a double-entry form: add debit and credit lines on any accounts until both sides are equal, then save - manual entries can be edited or deleted later. Many entries at once come from an Excel or JSON import; each import is kept as a batch, so a wrong file can be undone in one step. Posted invoices, bills, payments, credit notes, opening balances and final bank transactions add their own entries here too (shown by their source) - those change only through their own page. Lines on a bank account's GL account are what Bank Reconciliation matches against the bank statement.",
        examplesTitle: 'An Imported, Balanced Journal Entry',
      },
      {
        id: 'bank_reconciliation',
        label: 'Bank Reconciliation',
        icon: <Check className="h-4 w-4" />,
        desc: 'Match bank statement transactions to journal lines and sign off each month.',
        explanation: "Bank Reconciliation compares the bank's record with the books for one bank account. Auto-Match pairs bank transactions with journal lines of the same amount and a nearby date; anything left over you match by hand, or leave as a reconciling item. Once the month's difference is explained you close the month, which locks its matches until it is reopened. The account must be linked to its GL account first.",
        examplesTitle: 'Bank Side vs Book Side',
      },
      {
        id: 'period_close',
        label: 'Period Close',
        icon: <Lock className="h-4 w-4" />,
        desc: 'Close the books through a date so a finished period can no longer change.',
        explanation: "Once a month, quarter or year is finished, close the books through its last day. From then on nothing dated in it can be added, changed or deleted - bank transactions, statements and journal entries - so its reports stay exactly as signed off. Every bank transaction up to the date must be final first; the page lists what is still open and whether each bank account is reconciled. Only the latest close can be reopened. The financial year (the month it starts in) is set here too.",
        examplesTitle: 'Closing the Books Through 31 Mar 2026',
        requiresPage: 'period_close',
      },
    ],
  },
  {
    title: 'Sales & Purchases',
    items: [
      {
        id: 'clients_suppliers',
        label: 'Clients & Suppliers',
        icon: <Contact className="h-4 w-4" />,
        desc: 'The people you sell to and buy from, with GSTIN, state, payment terms and opening balance.',
        explanation: 'Clients are who you invoice; suppliers are who bill you. Each has a GSTIN, a state (picked from the list - the GSTIN fills it in), payment terms that set the due date of new invoices and bills, and an opening balance: what they owed you, or you owed them, on the day you started. The opening balance is booked as a journal entry against "Opening Balance Equity", so it shows on the Balance Sheet. A supplier can have a default TDS section, which their new bills pick up. Statement opens every invoice, bill, payment and note of one party with the running balance. Import from Excel adds many at once: download the template, fill it in, and the file is checked row by row - nothing is saved unless every row is right.',
        examplesTitle: 'A Client and Its Statement',
        requiresPage: 'clients',
      },
      {
        id: 'products',
        label: 'Products & Tax Rates',
        icon: <Package className="h-4 w-4" />,
        desc: 'What you sell and buy, with HSN / SAC code, prices, GST rate and the accounts they post to.',
        explanation: 'A product (goods) or service carries its HSN / SAC code, unit, sale and purchase price, GST rate and the income and expense accounts it posts to - picking it on an invoice line fills all of that in. Tax rates (GST 5%, 12%, 18%, 28%...) name the account their output GST is credited to and the account input GST is claimed in. A rate without an input account means the GST on purchases is added to the expense instead of being claimed. Turn on "Track stock" for goods to follow their quantity on the Inventory page, with a reorder level to be warned when it runs low. The TDS sections tab holds the sections (194C, 194J...) and rates that bills keep back. Products can be imported from Excel too.',
        examplesTitle: 'A Product With Its GST Rate',
        requiresPage: 'products',
      },
      {
        id: 'sales_invoices',
        label: 'Sales Invoices',
        icon: <FileText className="h-4 w-4" />,
        badge: 'GST',
        badgeColor: 'bg-emerald-500/15 text-success-text font-bold',
        desc: 'Invoices to clients: draft, post to the books, print as PDF, credit notes for returns.',
        explanation: 'An invoice starts as a draft you can change freely. Post it when it is final: it is booked (Dr Accounts Receivable, Cr income, Cr output GST) and can no longer be edited - cancel it to undo. GST is split automatically from the client\'s state: the same state as your company is CGST + SGST (half each), another state IGST. Open an invoice to download or print it as a PDF, email it to the client with the PDF attached, record a receipt, or raise a credit note for goods returned or a discount - the note reverses the income and GST and lowers what is due. Invoice numbers are handed out one at a time, so two people saving at once never get the same number.',
        examplesTitle: 'An Invoice, Its GST and Its Journal Entry',
        requiresPage: 'sales_invoices',
      },
      {
        id: 'purchase_bills',
        label: 'Purchase Bills',
        icon: <ShoppingCart className="h-4 w-4" />,
        desc: "Suppliers' bills, recorded with their own bill number and posted to the books.",
        explanation: 'Record each bill a supplier sends you under the supplier\'s own bill number (the same number can\'t be entered twice for one supplier). Posting it books Dr expense, Dr input GST (the credit you can claim) and Cr Accounts Payable. With a TDS section, the bill keeps back that rate of the taxable value (before GST): the supplier is owed the rest, and the TDS is credited to TDS Payable until you pay it to the government. A debit note on a bill records goods sent back or an overcharge, and lowers what you owe.',
        examplesTitle: 'A Supplier Bill With Input GST',
        requiresPage: 'purchase_bills',
      },
      {
        id: 'payments',
        label: 'Payments & Receipts',
        icon: <HandCoins className="h-4 w-4" />,
        desc: 'Money received from clients and paid to suppliers, allocated to the invoices and bills it settles.',
        explanation: 'A receipt (from a client) or payment (to a supplier) is booked as soon as it is saved: Dr bank / Cr receivable, or Dr payable / Cr bank. Allocate it to one or more invoices or bills - they become Partly paid or Paid. Anything not allocated stays on the party\'s account as an advance. The bank side is matched to the bank statement in Bank Reconciliation, so the same money is never counted twice.',
        examplesTitle: 'One Receipt Settling Two Invoices',
        requiresPage: 'payments',
      },
      {
        id: 'receivables_payables',
        label: 'Receivables & Payables',
        icon: <Hourglass className="h-4 w-4" />,
        desc: 'Who owes you, whom you owe, and how long it has been due.',
        explanation: 'The aging report lists every client with something outstanding (Receivables) or every supplier you owe (Payables), split by how far past the due date it is: not yet due, 1-30, 31-60, 61-90 and over 90 days, as of any date. Expand a party to see the invoices or bills behind the figures. Exports to Excel. The Reminders tab lists every client with overdue invoices and a ready-made reminder: copy the text, email it, or mark it as sent when you reminded them by phone - each invoice counts its reminders.',
        examplesTitle: 'Receivables Aging',
        requiresPage: 'receivables_payables',
      },
      {
        id: 'recurring_invoices',
        label: 'Recurring Invoices',
        icon: <Repeat className="h-4 w-4" />,
        desc: 'Invoices raised on a schedule - rent, retainers, AMCs, subscriptions.',
        explanation: 'A recurring invoice is a template: a client, the lines, and how often (every month, quarter, 6 months or year) from a start date, optionally until an end date. Every due date raises one sales invoice dated on its own day - as a draft to check, or posted straight away. The server checks for due invoices every hour (and "Create due invoices" does it now); periods missed while it was off are caught up. A template started on the 31st falls on the last day of shorter months. If one fails (e.g. the period is closed), its error is shown on it and the others carry on.',
        examplesTitle: 'A Monthly Retainer',
        requiresPage: 'recurring_invoices',
      },
      {
        id: 'inventory',
        label: 'Inventory',
        icon: <Boxes className="h-4 w-4" />,
        desc: 'Stock on hand of the products you track, with every movement and its value.',
        explanation: 'For products marked "Track stock", posting a purchase bill adds its quantity, posting a sales invoice takes it out, and credit / debit notes move returns back in or out - cancelling the document takes its movement away again. Enter what you had when you started as Opening stock, and use Adjust stock after a count, damage or samples. Each product shows quantity in and out, on hand, average cost and value, and is flagged at or below its reorder level or when it goes negative. Click a product for its movements with the running balance. Stock is tracked in quantity and value only - purchases are still expensed when the bill is posted.',
        examplesTitle: 'Stock of One Product',
        requiresPage: 'inventory',
      },
    ],
  },
  {
    title: 'Financial Statements & Insights',
    items: [
      {
        id: 'pnl',
        label: 'Profit & Loss',
        icon: <BarChart3 className="h-4 w-4" />,
        desc: 'Income vs. Expense financial performance report with multi-tab Excel export.',
        explanation: 'The Profit & Loss statement adds up the books (the journal) for a period: total income minus total expenses, grouped by Categories and Sub-Categories, gives your Net Profit or Loss. It includes posted invoices and bills, manual and imported entries and final bank transactions; bank transactions not in the books yet are counted in a banner so nothing is silently missing. Includes formatted multi-tab Excel export.',
        examplesTitle: 'Profit & Loss Statement & Excel Export',
      },
      {
        id: 'balance_sheet',
        label: 'Balance Sheet',
        icon: <Wallet className="h-4 w-4" />,
        desc: 'Financial snapshot of Total Assets = Total Liabilities + Owner Equity with Excel export.',
        explanation: 'The Balance Sheet shows the financial health of the business at a specific point in time, verifying that total Assets equal total Liabilities plus Equity. Features formatted multi-tab Excel export and balance check status.',
        examplesTitle: 'Balance Sheet Statement & Equilibrium Check',
      },
      {
        id: 'cash_flow',
        label: 'Cash Flow Statement',
        icon: <Waves className="h-4 w-4" />,
        desc: 'Where the money came from and went to: operating, investing and financing.',
        explanation: 'The Cash Flow Statement takes every journal entry that moves money in or out of a bank or cash account in a period and groups it by the account on the other side: income and expense accounts are operating activities, asset accounts investing, liability and equity accounts financing. Transfers between your own accounts are shown on their own line, so the statement adds up from the cash at the beginning to the cash at the end. Book each bank\'s opening balance (Bank Reconciliation) so the money you started with is counted. Click a line to open that account\'s ledger.',
        examplesTitle: 'Cash Flow for March 2026',
        requiresPage: 'cash_flow',
      },
      {
        id: 'trial_balance',
        label: 'Trial Balance',
        icon: <Scale className="h-4 w-4" />,
        desc: 'Verification report ensuring Total Debits equal Total Credits with Excel export.',
        explanation: 'The Trial Balance lists the balance of every account in the books for the period - on the debit side for assets and expenses, on the credit side for liabilities, equity and income. Because every journal entry balances, the two columns are always equal; a difference means something is wrong. Includes formatted Excel export.',
        examplesTitle: 'Trial Balance Debit & Credit Breakdown',
      },
      {
        id: 'account_ledger',
        label: 'Account Ledger',
        icon: <NotebookText className="h-4 w-4" />,
        desc: 'Every transaction posted to one account, with its running balance.',
        explanation: 'Pick any Chart of Accounts account to see every journal line posted to it in the period, oldest first: the opening balance carried in from before the period, each entry with its debit or credit and the running balance, and the closing balance. Click an entry to open it in Journal Entries (or its bank statement). The balance follows the account\'s normal side - debit for assets and expenses, credit for liabilities, equity and income. Exports to Excel.',
        examplesTitle: 'Office Rent Ledger',
        requiresPage: 'account_ledger',
      },
      {
        id: 'comparison',
        label: 'Period Comparison',
        icon: <GitCompare className="h-4 w-4" />,
        desc: 'Compare financial performance month-over-month or year-over-year.',
        explanation: 'Allows side-by-side comparison of expenses, revenues, and bank balances between different months or financial quarters to identify trends and cost increases. Includes formatted side-by-side Excel export.',
        examplesTitle: 'Month-over-Month Comparison Report',
      },
      {
        id: 'gst_summary',
        label: 'GST Summary',
        icon: <Percent className="h-4 w-4" />,
        desc: 'Output GST, input tax credit and the net GST payable - split CGST, SGST and IGST.',
        explanation: 'For any period, the GST Summary adds up the GST on posted sales invoices (output tax) and posted purchase bills (input tax credit), less credit and debit notes in the period, and shows what is payable for each of CGST, SGST and IGST. Tabs break it down by rate, by B2B (clients with a GSTIN) and B2C, by HSN / SAC code and document by document - the figures you need for GSTR-1 and GSTR-3B. Drafts and cancelled documents are left out. Exports to CSV. The GST returns panel downloads GSTR-1 and GSTR-3B for a month as the JSON file the GST offline tool takes, and lists what to fix first (missing HSN codes, invalid GSTINs, drafts not posted); check the 3B input credit against GSTR-2B before filing.',
        examplesTitle: 'GST for September 2026',
        requiresPage: 'gst_summary',
      },
      {
        id: 'tds_summary',
        label: 'TDS Summary',
        icon: <ReceiptIndianRupee className="h-4 w-4" />,
        desc: 'TDS kept back on supplier bills, by section and supplier, and what is still to pay the government.',
        explanation: 'For any period, the TDS Summary adds up the TDS on posted purchase bills by section (194C, 194J...) and by supplier with their PAN - the figures for the quarterly TDS return - and lists the bills. It also shows what was paid to the government in the period (debits to the TDS accounts, i.e. a journal entry Dr TDS Payable / Cr Bank) and what is still outstanding at the end of it. Suppliers without a PAN are flagged. Exports to CSV.',
        examplesTitle: 'TDS for the Quarter',
        requiresPage: 'tds_summary',
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        id: 'user_management',
        label: 'User Management',
        icon: <Users className="h-4 w-4" />,
        badge: 'Admin',
        badgeColor: 'bg-violet-500/15 text-primary font-bold',
        desc: 'Add users, assign roles, and choose which pages each role can open and change.',
        explanation: 'User Management is where an administrator controls who can sign in and what they can see. The Users tab lists every account - add a user, edit their details, give them a role, deactivate or delete them, or reset their password. The Roles & Permissions tab lists the roles; each role is a set of ticked pages, each with its own View, Create, Edit and Delete rights, and a user sees only the menus of their role and only the buttons they may use. Someone who signs up on their own has no role, so they see no pages until you assign one here.',
        examplesTitle: 'Roles, Page Permissions & Users',
        requiresPage: 'user_management',
      },
      {
        id: 'audit_log',
        label: 'Audit Log',
        icon: <History className="h-4 w-4" />,
        badge: 'Admin',
        badgeColor: 'bg-violet-500/15 text-primary font-bold',
        desc: 'Who created, changed, posted, cancelled or deleted what, and when.',
        explanation: 'Every change to the business records - invoices, bills, payments, credit notes, manual journal entries, clients, suppliers, products, the Chart of Accounts, bank accounts and statements, users, roles and settings - is written to the Audit Log automatically, with the user, the time and the old and new values. Sign-ins (and failed ones), password changes and bulk actions such as Make Final are logged too. Passwords are never stored in it, and entries can\'t be edited or deleted. Only roles given the Audit Log page can open it.',
        examplesTitle: 'Recent Changes',
        requiresPage: 'audit_log',
      },
    ],
  },
]
