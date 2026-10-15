/** Menu Guide: every sidebar menu with its description and explanation, grouped as in the sidebar. */
import {
  LayoutDashboard, Folders, Tag, Hash, Landmark, Receipt, ArrowLeftRight, BarChart3, Wallet, Scale,
  GitCompare, BookOpen, FileSpreadsheet, Check, Link2, ListChecks, Users, Lock, Waves,
  NotebookText,
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
        explanation: 'The Dashboard is the home screen. For the selected period it shows Income, Expenses, Net Profit and Cash Balance, an Income vs Expense chart, the latest balance of every bank account (Cash Position), what Needs Attention (uncategorized and duplicate transactions), the Top Expense Categories, and the most recent statement uploads. The Cash Flow Forecast shows the last six months of money in and out (transfers between your own accounts left out), the average monthly burn, how many months the current cash would last, and a three-month projection.',
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
        explanation: 'The General Ledger lists every transaction from all uploaded statements as soon as they are parsed, with date, narration, debit, credit, category and status. Filter by account, period, category, status or source; accept suggestions, assign categories one at a time or in bulk, and confirm them. Confirmed choices are never overwritten by Auto-Categorize and are learned from for future statements. When a transaction is done, Make Final locks it: its category can no longer be changed and it cannot be deleted (nor its statement) until you Reopen it.',
        examplesTitle: 'Transactions & Their Categorization Status',
      },
      {
        id: 'journal_entries',
        label: 'Journal Entries',
        icon: <FileSpreadsheet className="h-4 w-4" />,
        desc: "The company's own books, imported from an Excel or JSON file as balanced debit and credit entries.",
        explanation: "Journal Entries holds the company's books - what the accounts say happened, as opposed to what the bank says. Entries are never typed in one by one: you download the Excel or JSON sample, fill it in and import the file, and each entry's debits must equal its credits. Every import is kept as a batch, so a wrong file can be undone in one step. Lines posted to a bank account's GL account are what Bank Reconciliation matches against the bank statement.",
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
    title: 'Financial Statements & Insights',
    items: [
      {
        id: 'pnl',
        label: 'Profit & Loss',
        icon: <BarChart3 className="h-4 w-4" />,
        desc: 'Income vs. Expense financial performance report with multi-tab Excel export.',
        explanation: 'The Profit & Loss statement calculates total Revenue earned minus total Expenses incurred (grouped by Categories and Sub-Categories) over a selected time period to determine your Net Profit or Loss. Includes formatted multi-tab Excel export capability.',
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
        explanation: 'The Cash Flow Statement takes the money in and out of the bank in a period and groups it by what each transaction was categorized as: income and expense accounts are operating activities, asset accounts investing, liability and equity accounts financing. Transfers between your own accounts and uncategorized rows are shown on their own lines, so the statement always adds up from the cash at the beginning to the cash at the end. Click a line to open that account\'s ledger.',
        examplesTitle: 'Cash Flow for March 2026',
        requiresPage: 'cash_flow',
      },
      {
        id: 'trial_balance',
        label: 'Trial Balance',
        icon: <Scale className="h-4 w-4" />,
        desc: 'Verification report ensuring Total Debits equal Total Credits with Excel export.',
        explanation: 'The Trial Balance lists all Chart of Accounts categories with their total debit and credit balances to verify double-entry accounting equality before financial period closing. Includes formatted Excel export.',
        examplesTitle: 'Trial Balance Debit & Credit Breakdown',
      },
      {
        id: 'account_ledger',
        label: 'Account Ledger',
        icon: <NotebookText className="h-4 w-4" />,
        desc: 'Every transaction posted to one account, with its running balance.',
        explanation: 'Pick any Chart of Accounts account to see every confirmed transaction posted to it in the period, oldest first: the opening balance carried in from before the period, each transaction with its debit or credit and the running balance, and the closing balance. The balance follows the account\'s normal side - debit for assets and expenses, credit for liabilities, equity and income. Exports to Excel.',
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
    ],
  },
]
