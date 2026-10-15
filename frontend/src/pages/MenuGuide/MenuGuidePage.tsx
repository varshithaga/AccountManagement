import { useState } from 'react'
import {
  Folders, Tag, Landmark, Receipt, ArrowLeftRight, Search, Eye, Sparkles, Bell, HelpCircle,
  BookOpen, Upload, FileSpreadsheet, Check, RefreshCw, Key, ListFilter, Download, Link2, Users,
  KeyRound, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { SINGLE_ROLE_MENU } from './menuGuideData'
import type { DemoItem } from './menuGuideData'

export default function MenuGuidePage() {
  const { hasPage } = useAuth()
  const [selectedMenuId, setSelectedMenuId] = useState<string>('chart_accounts')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [uploadSimulated, setUploadSimulated] = useState<boolean>(false)
  const [isSimulating, setIsSimulating] = useState<boolean>(false)

  // Find currently selected menu details
  let currentMenuItem: DemoItem = SINGLE_ROLE_MENU[1].items[0]
  for (const grp of SINGLE_ROLE_MENU) {
    const found = grp.items.find((i) => i.id === selectedMenuId)
    if (found) {
      currentMenuItem = found
      break
    }
  }

  // Filter items by search query
  const filteredData = SINGLE_ROLE_MENU.map((group) => {
    const items = group.items.filter((item) =>
      item.label.toLowerCase().includes(searchQuery.toLowerCase())
      && (!item.requiresPage || hasPage(item.requiresPage))
    )
    return { ...group, items }
  }).filter((group) => group.items.length > 0)

  // Simulate Statement Upload Workflow
  const handleSimulateUpload = () => {
    setIsSimulating(true)
    setTimeout(() => {
      setIsSimulating(false)
      setUploadSimulated(true)
    }, 1200)
  }

  return (
    <div className="space-y-8">
      {/* Banner Header */}
      <div className="relative overflow-hidden rounded-3xl bg-sidebar p-6 sm:p-8 text-white">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold tracking-wide backdrop-blur-md border border-white/20">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            <span>Plain-English Menu & Accounting Guide</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Client Menu Guide & Real Accounting Examples
          </h1>
          <p className="text-sm font-medium leading-relaxed text-indigo-100 sm:text-base">
            Click any menu option on the left to see exactly <strong>what that menu does in plain words</strong>, how Categories, Sub-Categories, Keywords, Bank Accounts, Statements, and Financial Reports work together with real concrete examples.
          </p>
        </div>
        <div className="absolute right-[-40px] bottom-[-40px] h-64 w-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      </div>

      {/* 6 Core Workflow Steps */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          {
            title: '1. Chart of Accounts',
            badge: 'Categories & Sub-Cats',
            desc: 'Create Categories (e.g. Operating Expenses) and Sub-Categories (e.g. Rent, Salary) where transactions are categorized.',
            icon: <Folders className="h-4 w-4 text-primary" />,
            menuId: 'chart_accounts',
          },
          {
            title: '2. Auto Rules',
            badge: 'Keyword Engine',
            desc: 'Enter keywords under each Sub-Category (e.g. "RENT" under Rent). Bank statement lines are auto-categorized based on these keywords.',
            icon: <Tag className="h-4 w-4 text-success-text" />,
            menuId: 'auto_rules',
          },
          {
            title: '3. Bank Accounts',
            badge: 'N Accounts List',
            desc: 'Enter N number of company bank accounts (HDFC, ICICI, SBI) linked to uploaded statement files.',
            icon: <Landmark className="h-4 w-4 text-info-text" />,
            menuId: 'bank_accounts',
          },
          {
            title: '4. Bank Statements',
            badge: 'Uploaded Statements',
            desc: 'Upload CSV / Excel / PDF statements. Balances are read from the file and broken files are rejected.',
            icon: <Receipt className="h-4 w-4 text-warning-text" />,
            menuId: 'bank_statements',
          },
          {
            title: '5. Continuity Check',
            badge: 'Balance Chain',
            desc: 'Each statement should open where the previous one closed. Gaps, missing months and overlaps are flagged.',
            icon: <Link2 className="h-4 w-4 text-danger-text" />,
            menuId: 'statement_continuity',
          },
          {
            title: '6. General Ledger',
            badge: 'Review & Confirm',
            desc: 'Review every transaction, accept or correct its category and confirm it - then the reports are ready.',
            icon: <ArrowLeftRight className="h-4 w-4 text-primary" />,
            menuId: 'general_ledger',
          },
        ].map((card, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelectedMenuId(card.menuId)}
            className={`text-left rounded-2xl border p-4 transition-all hover:scale-[1.02] bg-surface border-border ${
              selectedMenuId === card.menuId ? 'ring-2 ring-violet-500 shadow-md border-violet-500' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="rounded-xl bg-primary-soft p-2 text-primary">
                {card.icon}
              </div>
              <span className="text-[0.62rem] font-bold bg-surface-muted text-ink px-1.5 py-0.5 rounded">
                {card.badge}
              </span>
            </div>
            <h3 className="text-xs font-bold text-ink">
              {card.title}
            </h3>
            <p className="mt-1 text-[0.7rem] text-muted leading-relaxed">
              {card.desc}
            </p>
          </button>
        ))}
      </div>

      {/* Main Interactive Sandbox Section */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Column: Interactive Client Menu Sandbox (5 Cols) */}
        <div className="space-y-4 lg:col-span-5">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-bold text-ink flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Client Application Menu
            </h2>
            <span className="text-[0.7rem] font-medium text-slate-500">
              Click menu options to inspect
            </span>
          </div>

          {/* Interactive Menu Drawer Component */}
          <div className="overflow-hidden rounded-3xl border border-input bg-surface shadow-xl ">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-4 ">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar text-white font-bold text-sm shadow-md">
                  L
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ink">
                    Ledgerline
                  </h3>
                  <span className="text-[0.62rem] font-bold tracking-wider text-primary bg-primary-soft px-1.5 py-0.5 rounded">
                    PRO ACCOUNTING
                  </span>
                </div>
              </div>
              <Bell className="h-4 w-4 text-muted cursor-pointer hover:text-slate-600" />
            </div>

            {/* Search Filter Input */}
            <div className="p-3 border-b border-border-soft bg-surface-muted ">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" />
                <input
                  type="text"
                  placeholder="Filter menu options..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-ink placeholder-slate-400 focus:outline-hidden "
                />
              </div>
            </div>

            {/* Menu Groups */}
            <div className="p-3 space-y-3 max-h-[500px] overflow-y-auto scrollbar-thin">
              {filteredData.map((group) => (
                <div key={group.title} className="space-y-1">
                  <div className="px-3 py-1 text-[0.65rem] font-bold uppercase tracking-widest text-muted">
                    {group.title}
                  </div>
                  {group.items.map((item) => {
                    const isSelected = selectedMenuId === item.id

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedMenuId(item.id)}
                        className={`group relative flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all ${
                          isSelected
                            ? 'bg-violet-500/15 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 font-bold shadow-xs'
                            : 'text-muted hover:bg-surface-muted '
                        }`}
                      >
                        {/* Active Pill Bar */}
                        {isSelected && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-md bg-primary shadow-xs" />
                        )}

                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={
                              isSelected
                                ? 'text-primary'
                                : 'text-muted'
                            }
                          >
                            {item.icon}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </div>

                        {item.badge && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[0.62rem] ${
                              item.badgeColor || 'bg-primary-soft text-violet-600'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t border-border bg-slate-50/80 p-3 dark:bg-slate-900/90 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sidebar text-white font-bold text-[0.68rem]">
                  AC
                </div>
                <span className="text-xs font-bold text-ink">
                  Client Workspace
                </span>
              </div>
              <HelpCircle className="h-4 w-4 text-muted hover:text-slate-600 cursor-pointer" />
            </div>
          </div>
        </div>

        {/* Right Column: Detailed Written Explanation & Real-World Examples (7 Cols) */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-bold text-ink flex items-center gap-2">
              <Eye className="h-4 w-4 text-violet-500" />
              Menu Functionality & Real Examples:{" "}
              <span className="text-primary">
                {currentMenuItem.label}
              </span>
            </h2>
          </div>

          <div className="rounded-3xl border border-border bg-surface p-6 shadow-xl space-y-6 min-h-[500px]">
            {/* Header Description */}
            <div className="pb-4 border-b border-border-soft space-y-2">
              <div className="flex items-center gap-2 text-primary font-bold text-xs">
                {currentMenuItem.icon}
                <span>Active Menu Explanation</span>
              </div>
              <h3 className="text-xl font-bold text-ink">
                {currentMenuItem.label}
              </h3>
              <p className="text-xs text-muted leading-relaxed font-medium bg-surface-muted/60 p-3.5 rounded-2xl border border-slate-200/60 dark:border-white/10">
                <strong>What this Menu does:</strong> {currentMenuItem.explanation}
              </p>
            </div>

            {/* Real-World Concrete Examples Area per Menu Option */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-2">
                <ListFilter className="h-4 w-4 text-violet-500" />
                {currentMenuItem.examplesTitle}
              </h4>

              {/* 1. CHART OF ACCOUNTS (Categories & Sub-Categories) */}
              {selectedMenuId === 'chart_accounts' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Every <strong>Category</strong> belongs to one of 5 account types - <strong>Asset, Liability, Equity, Income or Expense</strong> - and holds detailed <strong>Sub-Categories</strong>. Bank transactions are assigned to a sub-category; the account type decides whether it lands in the Profit &amp; Loss (Income / Expense) or the Balance Sheet (Asset / Liability / Equity).
                  </div>

                  <div className="space-y-3">
                    {[
                      {
                        category: 'Operating Expenses',
                        type: 'Expense',
                        subCategories: ['Rent', 'Electricity', 'Salaries'],
                      },
                      {
                        category: 'Operating Revenue',
                        type: 'Income',
                        subCategories: ['Consulting Revenue', 'Product Sales'],
                      },
                      {
                        category: 'Current Assets',
                        type: 'Asset',
                        subCategories: ['Cash', 'Accounts Receivable'],
                      },
                      {
                        category: 'Current Liabilities',
                        type: 'Liability',
                        subCategories: ['GST Payable', 'TDS Payable'],
                      },
                    ].map((grp, gi) => (
                      <div key={gi} className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40 space-y-2">
                        <div className="font-bold text-ink flex items-center justify-between">
                          <span>{grp.category} (Category)</span>
                          <span className="text-[0.65rem] text-primary font-bold bg-primary-soft px-2 py-0.5 rounded">
                            {grp.type}
                          </span>
                        </div>
                        <div className="space-y-1.5 pl-3 border-l-2 border-violet-500/30">
                          {grp.subCategories.map((sub, si) => (
                            <div key={si} className="flex justify-between items-center p-2 rounded-lg bg-surface text-ink border border-border-soft">
                              <span>• {sub}</span>
                              <span className="font-bold text-[0.65rem] text-slate-500">Sub-Category</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. AUTO-CATEGORIZATION RULES */}
              {selectedMenuId === 'auto_rules' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-success-soft text-success-text font-medium">
                    <strong>How it works:</strong> You enter <strong>Keywords under each Sub-Category</strong>. When you click <strong>Auto-Categorize</strong> on a statement, each transaction goes through these steps in order:
                  </div>

                  <ol className="space-y-1.5 rounded-2xl border border-border bg-slate-50 p-4 text-ink dark:bg-slate-800/40 ">
                    <li><strong>1. Transfer check</strong> - a matching debit and credit between two of your own bank accounts is marked <em>Transfer</em>.</li>
                    <li><strong>2. Auto-assign keywords</strong> - a keyword marked "Auto-assign" assigns its Sub-Category directly.</li>
                    <li><strong>3. History</strong> - the same narration you already confirmed before is assigned the same way.</li>
                    <li><strong>4. Scoring</strong> - other keywords, the sub-category name, the BAI code and similar past narrations add up to a score.</li>
                    <li><strong>5. Decision</strong> - high and clear score: <em>Auto-assigned</em>; medium: <em>Needs Review</em> (you accept or change it); low: <em>Uncategorized</em>.</li>
                  </ol>

                  <div className="space-y-3">
                    {[
                      {
                        subCategory: 'Rent (Sub-Category)',
                        keywords: ['RENT', 'LEASE'],
                        matchExample: 'Bank Narration: "OFFICE RENT LEASE PAYMENT WAREHOUSE" → Rent',
                      },
                      {
                        subCategory: 'Salaries (Sub-Category)',
                        keywords: ['PAYROLL', 'SALARY', 'GUSTO PAYROLL'],
                        matchExample: 'Bank Narration: "ACH GUSTO PAYROLL RUN SEP 2026" → Salaries',
                      },
                      {
                        subCategory: 'Bank Charges (Sub-Category)',
                        keywords: ['BANK CHARGES', 'SERVICE CHARGE MONTHLY MAINT'],
                        matchExample: 'Bank Narration: "SERVICE CHARGE MONTHLY MAINT" → Bank Charges',
                      },
                    ].map((item, i) => (
                      <div key={i} className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40 space-y-2">
                        <div className="font-bold text-ink flex items-center gap-2">
                          <Key className="h-3.5 w-3.5 text-emerald-500" />
                          <span>Under Sub-Category: <strong>{item.subCategory}</strong></span>
                        </div>

                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <span className="text-slate-500 font-bold self-center mr-1">Entered Keywords:</span>
                          {item.keywords.map((kw, ki) => (
                            <span key={ki} className="font-mono text-[0.68rem] font-bold bg-emerald-500/15 text-success-text px-2 py-0.5 rounded border border-success/40">
                              "{kw}"
                            </span>
                          ))}
                        </div>

                        <div className="p-2 rounded-lg bg-success-soft text-success-text text-[0.72rem] font-medium mt-2">
                          <strong>Keyword match:</strong> {item.matchExample}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. BANK ACCOUNTS */}
              {selectedMenuId === 'bank_accounts' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-info-soft text-info-text dark:text-info-text font-medium">
                    <strong>How it works:</strong> You enter <strong>N number of company bank accounts</strong>. When uploading bank statements, you choose which bank account the statement file belongs to.
                  </div>

                  <div className="space-y-2.5">
                    {[
                      { name: 'Primary HDFC Current Account', accNo: '50200012345678', type: 'Current Account', bal: '₹1,450,000.00', status: 'Active (Primary)' },
                      { name: 'ICICI Operating Expenses Account', accNo: '001105987654', type: 'Operating Account', bal: '₹620,400.00', status: 'Active' },
                      { name: 'State Bank of India (SBI) Tax & Treasury Account', accNo: '30456123987', type: 'Treasury Account', bal: '₹2,890,000.00', status: 'Active' },
                    ].map((bank, i) => (
                      <div key={i} className="flex flex-col sm:flex-row justify-between sm:items-center p-3.5 rounded-2xl border border-border bg-slate-50 dark:bg-slate-800/40 gap-2">
                        <div>
                          <div className="font-bold text-ink flex items-center gap-2">
                            <Landmark className="h-4 w-4 text-info-text" />
                            {bank.name}
                          </div>
                          <div className="text-slate-500 text-[0.7rem] mt-0.5">
                            Acc No: <span className="font-mono">{bank.accNo}</span> • {bank.type}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm text-ink">{bank.bal}</div>
                          <span className="text-[0.62rem] font-bold text-success-text bg-success-soft px-2 py-0.5 rounded">
                            {bank.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. BANK STATEMENTS (Uploaded Statements List) */}
              {selectedMenuId === 'bank_statements' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-warning-soft text-warning-text font-medium">
                    <strong>How it works:</strong> Upload a statement file (<strong>.csv, .xlsx or .pdf</strong>) against a bank account. Opening and closing balances are read from the file's running balance column; if the balance doesn't add up row-to-row, the upload is rejected and the exact row to fix is shown. The list below shows every import.
                  </div>

                  <div className="space-y-3">
                    <div className="font-bold text-ink">
                      Uploaded Statements:
                    </div>

                    {[
                      ...(uploadSimulated
                        ? [{ file: 'HDFC_2026_03_Mar.xlsx', bank: '1001 - HDFC Primary', opening: '₹20,78,363', closing: '₹31,85,495', rows: 21, dups: 0, continuity: 'Continuous', ok: true }]
                        : []),
                      { file: 'HDFC_2026_02_Feb.pdf', bank: '1001 - HDFC Primary', opening: '₹18,00,743', closing: '₹20,78,363', rows: 22, dups: 0, continuity: 'Continuous', ok: true },
                      { file: 'ICICI_2026_04_Apr.xlsx', bank: '1002 - ICICI Corporate', opening: '₹18,74,623', closing: '₹17,86,509', rows: 16, dups: 0, continuity: 'Missing statement · 33d', ok: false },
                      { file: 'AXIS_2026_04_Apr.pdf', bank: '1004 - Axis Payroll', opening: '₹2,98,848', closing: '₹16,08,309', rows: 24, dups: 7, continuity: 'Overlapping period · 12d', ok: false },
                    ].map((stmt, i) => (
                      <div key={i} className="p-3.5 rounded-2xl border border-border bg-slate-50 dark:bg-slate-800/40 space-y-2">
                        <div className="flex justify-between items-center gap-2">
                          <span className="font-bold text-ink flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4 text-amber-500" />
                            {stmt.file}
                          </span>
                          <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded ${stmt.ok ? 'text-success-text bg-emerald-500/15 ' : 'text-danger-text bg-rose-500/15 '}`}>
                            {stmt.continuity}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-3 text-[0.7rem] text-muted pt-1 border-t border-slate-200/60 dark:border-white/5">
                          <span>Account: <strong>{stmt.bank}</strong></span>
                          <span>Opening: <strong>{stmt.opening}</strong></span>
                          <span>Closing: <strong>{stmt.closing}</strong></span>
                          <span>Transactions: <strong>{stmt.rows}</strong></span>
                          <span>Duplicates: <strong className={stmt.dups ? 'text-warning-text' : ''}>{stmt.dups || '—'}</strong></span>
                        </div>
                      </div>
                    ))}

                    {/* Parser Simulator */}
                    <div className="rounded-2xl border-2 border-dashed border-violet-500/30 bg-violet-500/5 p-4 text-center space-y-2">
                      <h5 className="font-bold text-ink">
                        Upload New Bank Statement (.csv, .xlsx or .pdf)
                      </h5>
                      <button
                        type="button"
                        onClick={handleSimulateUpload}
                        disabled={isSimulating}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-md transition-all disabled:opacity-50"
                      >
                        {isSimulating ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            Parsing Statement Rows...
                          </>
                        ) : (
                          <>
                            <Upload className="h-3.5 w-3.5" />
                            Simulate Statement Upload
                          </>
                        )}
                      </button>
                      {uploadSimulated && (
                        <div className="text-[0.72rem] font-bold text-success-text pt-1">
                          Simulated Upload Completed! Statement added to list above.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* STATEMENT CONTINUITY */}
              {selectedMenuId === 'statement_continuity' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-danger-soft text-danger-text font-medium">
                    <strong>How it works:</strong> For each bank account, the <strong>closing balance of one statement must equal the opening balance of the next</strong>. Any difference means a statement or some transactions are missing, or the same period was uploaded twice.
                  </div>

                  <div className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40">
                    <div className="mb-2 font-bold text-ink">1001 - HDFC Primary Account</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { month: 'Jan', open: '12,50,000', close: '18,00,743', link: 'matches', ok: true },
                        { month: 'Feb', open: '18,00,743', close: '20,78,363', link: 'matches', ok: true },
                        { month: 'Mar', open: '20,78,363', close: '31,85,495', link: '+18,750', ok: false },
                        { month: 'Apr', open: '32,04,245', close: '33,36,965', link: '', ok: true },
                      ].map((m) => (
                        <div key={m.month} className="flex items-center gap-1.5">
                          <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 ">
                            <div className="font-bold text-ink">{m.month} 2026</div>
                            <div className="text-[0.65rem] text-slate-500">Open ₹{m.open}</div>
                            <div className="text-[0.65rem] text-slate-500">Close ₹{m.close}</div>
                          </div>
                          {m.link && (
                            <span className={`text-[0.65rem] font-bold ${m.ok ? 'text-success-text' : 'text-danger-text'}`}>
                              {m.link} →
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {[
                      { label: 'Balance mismatch', text: 'March closed at ₹31,85,495 but April opens at ₹32,04,245 - ₹18,750 is unaccounted for.' },
                      { label: 'Missing statement', text: 'No statement covers 1 Mar - 2 Apr and the balance moved - upload that period.' },
                      { label: 'Overlapping period', text: 'April starts on 15 Mar, inside March - those days were uploaded twice (duplicates are flagged).' },
                      { label: 'Math mismatch', text: "Inside one file, opening + credits - debits doesn't equal the closing balance." },
                    ].map((it) => (
                      <div key={it.label} className="flex gap-2 rounded-xl border border-border bg-slate-50 p-3 dark:bg-slate-800/40">
                        <span className="shrink-0 rounded bg-rose-500/15 px-2 py-0.5 text-[0.65rem] font-bold text-danger-text">{it.label}</span>
                        <span className="text-muted">{it.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TRANSACTIONS */}
              {selectedMenuId === 'general_ledger' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Shows <strong>every transaction from every uploaded statement</strong> as soon as it is parsed. Each one has a <strong>status</strong>; you accept suggestions, correct categories (one at a time or in bulk) and <strong>confirm</strong> them (). Confirmed choices are never overwritten by Auto-Categorize.
                  </div>

                  <div className="space-y-2">
                    <div className="font-bold text-ink">
                      Transactions:
                    </div>

                    {[
                      { date: '2026-09-26', narration: 'ACH GUSTO PAYROLL RUN SEP 2026', subCat: 'Operating Expenses › Salaries', status: 'Manually assigned ', tone: 'text-violet-700 bg-violet-500/15 dark:text-violet-300', dr: '₹12,500.00', cr: '—' },
                      { date: '2026-09-18', narration: 'CLIENT CONSULTING REVENUE DIRECT DEPOSIT', subCat: 'Operating Revenue › Consulting Revenue', status: 'Auto-assigned', tone: 'text-success-text bg-emerald-500/15 ', dr: '—', cr: '₹1,20,000.00' },
                      { date: '2026-09-15', narration: 'CLOUD SERVICES AZURE SUBSCRIPTION', subCat: 'Suggested: Cloud Services', status: 'Needs review', tone: 'text-warning-text bg-amber-500/15 ', dr: '₹18,500.00', cr: '—' },
                      { date: '2026-09-04', narration: 'TRANSFER TO AXIS PAYROLL ACCT #4004', subCat: 'Between your own accounts', status: 'Transfer', tone: 'text-info-text bg-info/15 dark:text-info-text', dr: '₹3,50,000.00', cr: '—' },
                    ].map((tx, i) => (
                      <div key={i} className="p-3 rounded-xl border border-border bg-slate-50 dark:bg-slate-800/40 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                        <div>
                          <div className="font-bold text-ink">{tx.narration}</div>
                          <div className="text-slate-500 text-[0.68rem]">
                            {tx.date} • <span className="font-bold text-primary">{tx.subCat}</span>
                            {' '}<span className={`ml-1 rounded px-1.5 py-px font-bold ${tx.tone}`}>{tx.status}</span>
                          </div>
                        </div>
                        <div className="font-mono font-bold text-xs text-right">
                          {tx.dr !== '—' ? <span className="text-danger-text">Debit: {tx.dr}</span> : <span className="text-success-text">Credit: {tx.cr}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* JOURNAL ENTRIES */}
              {selectedMenuId === 'journal_entries' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-info-soft text-info-text dark:text-info-text font-medium">
                    <strong>How it works:</strong> Download the template, fill in one row per line and <strong>import the Excel file</strong>. Each entry must <strong>balance</strong> (total debit = total credit). An import can be <strong>undone</strong> as a whole batch.
                  </div>

                  <div className="rounded-xl border border-border bg-slate-50 p-3 dark:bg-slate-800/40 space-y-2">
                    <div className="font-bold text-ink">JV-1042 • 2026-09-26 • Office rent for September</div>
                    {[
                      { account: 'Operating Expenses › Rent', dr: '₹45,000.00', cr: '—' },
                      { account: 'Bank › HDFC Current Account', dr: '—', cr: '₹45,000.00' },
                    ].map((line) => (
                      <div key={line.account} className="flex justify-between gap-2 font-mono">
                        <span className="font-sans font-semibold text-ink">{line.account}</span>
                        <span><span className="text-danger-text">Dr {line.dr}</span> <span className="ml-3 text-success-text">Cr {line.cr}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BANK RECONCILIATION */}
              {selectedMenuId === 'bank_reconciliation' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-success-soft text-success-text font-medium">
                    <strong>How it works:</strong> Pick a bank account and a month. <strong>Auto-Match</strong> pairs bank transactions with journal lines; match the rest by hand, then <strong>close the month</strong> to sign it off.
                  </div>

                  <div className="space-y-2">
                    {[
                      { bank: 'NEFT OFFICE RENT SEP', book: 'JV-1042 Office rent for September', amount: '₹45,000.00', status: 'Matched', tone: 'text-success-text bg-emerald-500/15 ' },
                      { bank: 'BANK CHARGES Q3', book: '— no journal line yet —', amount: '₹590.00', status: 'Unmatched', tone: 'text-warning-text bg-amber-500/15 ' },
                    ].map((row) => (
                      <div key={row.bank} className="p-3 rounded-xl border border-border bg-slate-50 dark:bg-slate-800/40 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                        <div>
                          <div className="font-bold text-ink">Bank: {row.bank}</div>
                          <div className="text-slate-500 text-[0.68rem]">
                            Books: {row.book} <span className={`ml-1 rounded px-1.5 py-px font-bold ${row.tone}`}>{row.status}</span>
                          </div>
                        </div>
                        <div className="font-mono font-bold text-xs text-right text-ink">{row.amount}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 6. BAI CODES */}
              {selectedMenuId === 'bai_codes' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Banks tag each statement line with a standard numerical <strong>BAI code</strong> (BAI2 format). Give a code a <strong>default Category / Sub-Category</strong> here, and any statement line carrying that code gets a scoring clue towards it during Auto-Categorize.
                  </div>

                  <div className="space-y-2">
                    {[
                      { code: 'BAI 464', name: 'Service Charge', maps: 'Bank Charges' },
                      { code: 'BAI 495', name: 'Outgoing Money Transfer', maps: 'Accounts Payable' },
                      { code: 'BAI 815', name: 'Interest Credit', maps: 'Interest Income' },
                    ].map((bai, i) => (
                      <div key={i} className="flex justify-between items-center gap-2 p-3 rounded-xl border border-border bg-slate-50 dark:bg-slate-800/40">
                        <span className="font-mono font-bold text-primary">{bai.code}</span>
                        <span className="font-bold text-ink">{bai.name}</span>
                        <span className="text-[0.65rem] font-bold text-slate-500 bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">→ {bai.maps}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 7. DASHBOARD */}
              {selectedMenuId === 'dashboard' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-slate-500/10 text-ink font-medium">
                    <strong>How it works:</strong> A summary for the selected period (this month, last month, this quarter or a custom range): income, expenses and profit, cash in each bank account, and what still needs your attention.
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: 'Income', value: '₹4,50,000', tone: 'bg-success-soft border-success/40 text-success-text' },
                      { label: 'Expenses', value: '₹1,80,000', tone: 'bg-danger-soft border-danger-border text-danger-text' },
                      { label: 'Net Profit', value: '₹2,70,000', tone: 'bg-primary-soft border-violet-500/20 text-primary' },
                      { label: 'Cash Balance', value: '₹49,60,400', tone: 'bg-info-soft border-info/40 text-info-text' },
                    ].map((k) => (
                      <div key={k.label} className={`p-3 rounded-2xl border text-center ${k.tone}`}>
                        <div className="text-slate-500 text-[0.7rem] font-bold">{k.label}</div>
                        <div className="text-base font-bold mt-1">{k.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-warning/40 bg-amber-500/5 p-3 space-y-1">
                    <div className="font-bold text-warning-text">Needs Attention</div>
                    <div className="text-muted">• 12 uncategorized transactions (₹38,400) - assign them to a category</div>
                    <div className="text-muted">• 7 possible duplicates across statement uploads - review them</div>
                  </div>
                  <p className="text-[0.7rem] text-slate-500">Also on the dashboard: Cash Flow Forecast &amp; runway, Income vs Expense chart, Cash Position per bank account, Top Expense Categories and Recent Bank Statements.</p>
                </div>
              )}

              {/* WORKFLOW */}
              {selectedMenuId === 'workflow' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Open <strong>Workflow</strong> whenever you're unsure what to do. It checks your data and highlights the next step.
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { n: '1-4', title: 'One-time setup', text: 'Chart of Accounts, Rules, BAI Codes (optional), Bank Accounts' },
                      { n: '5-10', title: 'Every month', text: 'Upload → Continuity check → Auto-Categorize → Review → Confirm → Make Final' },
                      { n: '11', title: 'Reports', text: 'Profit & Loss, Balance Sheet, Trial Balance, Period Comparison' },
                    ].map((row) => (
                      <div key={row.n} className="flex items-center gap-3 rounded-xl border border-border bg-slate-50 p-3 dark:bg-slate-800/40">
                        <span className="rounded-lg bg-violet-600 px-2 py-1 font-bold text-white">{row.n}</span>
                        <div>
                          <div className="font-bold text-ink">{row.title}</div>
                          <div className="text-muted">{row.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 8. MENU GUIDE */}
              {selectedMenuId === 'menu_guide' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Complete interactive menu reference & learning system to help users navigate and understand every feature of Ledgerline.
                  </div>

                  <div className="p-4 rounded-2xl border border-border bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <div className="font-bold text-ink flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-indigo-500" />
                      Workflow Guide Key Takeaways
                    </div>
                    <p className="text-muted text-[0.72rem] leading-relaxed">
                      Learn how Categories, Auto-Categorization Keywords, N Bank Accounts, Uploaded Statements, and Financial Reports seamlessly interconnect to simplify corporate bookkeeping.
                    </p>
                  </div>
                </div>
              )}

              {/* 9. PROFIT & LOSS */}
              {selectedMenuId === 'pnl' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-success-soft text-success-text font-medium">
                    <strong>How it works:</strong> Summarizes total Revenue earned minus total Expenses incurred (grouped by Categories & Sub-Categories). Includes <strong>Export Excel</strong> for formatted multi-sheet financial downloads.
                  </div>

                  <div className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-border">
                      <span className="font-bold text-ink">P&L Report Preview</span>
                      <span className="text-[0.65rem] font-bold text-success-text bg-emerald-500/15 px-2 py-0.5 rounded flex items-center gap-1">
                        <Download className="h-3 w-3" /> Export Excel Available
                      </span>
                    </div>
                    <div className="flex justify-between font-bold text-success-text">
                      <span>Total Revenue (Sales & Client Revenue):</span>
                      <span>+ ₹450,000.00</span>
                    </div>
                    <div className="flex justify-between font-bold text-danger-text">
                      <span>Total Operating Expenses (Rent, Software, Wages):</span>
                      <span>- ₹180,000.00</span>
                    </div>
                    <div className="pt-2 border-t border-border flex justify-between font-bold text-sm text-ink">
                      <span>Net Profit for Period:</span>
                      <span className="text-primary">₹270,000.00 (Margin: 60.00%)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 10. BALANCE SHEET */}
              {selectedMenuId === 'balance_sheet' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-info-soft text-info-text dark:text-info-text font-medium">
                    <strong>How it works:</strong> Verifies that total company Assets equal total Liabilities plus Equity. Features <strong>Export Excel</strong> for formatted multi-tab downloads and balance check verification.
                  </div>

                  <div className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-border">
                      <span className="font-bold text-ink">Balance Sheet Preview</span>
                      <span className="text-[0.65rem] font-bold text-info-text bg-info/15 px-2 py-0.5 rounded flex items-center gap-1">
                        <Download className="h-3 w-3" /> Export Excel Available
                      </span>
                    </div>
                    <div className="flex justify-between font-bold text-ink">
                      <span>Total Assets (Bank Accounts + Cash):</span>
                      <span className="text-info-text">₹4,960,400.00</span>
                    </div>
                    <div className="flex justify-between font-bold text-ink">
                      <span>Total Liabilities (Payables & Tax):</span>
                      <span className="text-warning-text">₹1,200,000.00</span>
                    </div>
                    <div className="flex justify-between font-bold text-ink">
                      <span>Owner Equity & Retained Earnings:</span>
                      <span className="text-indigo-600">₹3,760,400.00</span>
                    </div>
                    <div className="pt-2 border-t border-border flex justify-between font-bold text-xs text-success-text">
                      <span>Balance Check (Assets = Liabilities + Equity):</span>
                      <span>MATCHED (100% Balanced)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 11. TRIAL BALANCE */}
              {selectedMenuId === 'trial_balance' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Lists all Chart of Accounts balances by account type (Asset, Liability, Equity, Income, Expense) verifying that Total Debits equal Total Credits. Includes <strong>Export Excel</strong>.
                  </div>

                  <div className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-border">
                      <span className="font-bold text-ink">Trial Balance Equilibrium</span>
                      <span className="text-[0.65rem] font-bold text-violet-700 bg-violet-500/15 px-2 py-0.5 rounded flex items-center gap-1">
                        <Download className="h-3 w-3" /> Export Excel Available
                      </span>
                    </div>
                    <div className="flex justify-between font-bold text-ink">
                      <span>Total Debit Balances (Assets + Expenses):</span>
                      <span className="text-violet-600">₹5,140,400.00</span>
                    </div>
                    <div className="flex justify-between font-bold text-ink">
                      <span>Total Credit Balances (Liabilities + Equity + Income):</span>
                      <span className="text-success-text">₹5,140,400.00</span>
                    </div>
                    <div className="pt-2 border-t border-border flex justify-between font-bold text-xs text-success-text">
                      <span>Equilibrium Status:</span>
                      <span>BALANCED (Difference: ₹0.00)</span>
                    </div>
                  </div>
                </div>
              )}

              {selectedMenuId === 'period_close' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Finalize every transaction up to the date in the General Ledger, check the reconciliation, then <strong>Close through</strong> the date. Reopen undoes the latest close if something must still change.
                  </div>
                  <div className="rounded-xl border border-border divide-y divide-border">
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Bank transactions up to 31 Mar 2026</span><span className="font-bold text-ink">412 of 412 final </span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Bank accounts reconciled through 31 Mar</span><span className="font-bold text-ink">2 of 2 </span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">After closing</span><span className="font-bold text-ink">Nothing dated ≤ 31 Mar can change</span></div>
                  </div>
                </div>
              )}

              {selectedMenuId === 'cash_flow' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-success-soft text-success-text font-medium">
                    <strong>How it works:</strong> Money in (credits) and out (debits) of the bank, grouped by account type. The sections plus transfers and uncategorized rows add up to the change in cash.
                  </div>
                  <div className="rounded-xl border border-border divide-y divide-border">
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Cash at beginning</span><span className="font-bold text-ink">₹1,20,000.00</span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Net cash from operating activities</span><span className="font-bold text-ink">₹45,500.00</span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Net cash from investing activities (laptops)</span><span className="font-bold text-ink">-₹80,000.00</span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Net cash from financing activities (loan)</span><span className="font-bold text-ink">₹2,00,000.00</span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Cash at end</span><span className="font-bold text-ink">₹2,85,500.00</span></div>
                  </div>
                </div>
              )}

              {selectedMenuId === 'account_ledger' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-info-soft text-info-text dark:text-info-text font-medium">
                    <strong>How it works:</strong> Choose an account and a period; open it straight from a Cash Flow line too.
                  </div>
                  <div className="rounded-xl border border-border divide-y divide-border">
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Opening balance (before 1 Mar)</span><span className="font-bold text-ink">₹50,000.00 Dr</span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">05 Mar · RENT MARCH · Debit ₹25,000.00</span><span className="font-bold text-ink">₹75,000.00 Dr</span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">20 Mar · RENT REFUND · Credit ₹2,000.00</span><span className="font-bold text-ink">₹73,000.00 Dr</span></div>
                    <div className="flex justify-between gap-4 px-3 py-2"><span className="text-muted">Closing balance (31 Mar)</span><span className="font-bold text-ink">₹73,000.00 Dr</span></div>
                  </div>
                </div>
              )}

              {/* 12. PERIOD COMPARISON */}
              {selectedMenuId === 'comparison' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> Compares financial figures side-by-side month-over-month (e.g. Sept 2026 vs Aug 2026). Includes formatted side-by-side <strong>Export Excel</strong>.
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center pb-1">
                      <span className="font-bold text-ink">Side-by-Side Financial Comparison:</span>
                      <span className="text-[0.65rem] font-bold text-indigo-700 bg-indigo-500/15 px-2 py-0.5 rounded flex items-center gap-1">
                        <Download className="h-3 w-3" /> Export Excel Available
                      </span>
                    </div>

                    {[
                      { item: 'Software Subscriptions', aug: '₹14,200', sept: '₹18,500', change: '+30.2%' },
                      { item: 'Office Rent & Lease', aug: '₹45,000', sept: '₹45,000', change: '0.0%' },
                      { item: 'Client Service Revenue', aug: '₹380,000', sept: '₹450,000', change: '+18.4%' },
                    ].map((comp, i) => (
                      <div key={i} className="flex justify-between items-center p-3 rounded-xl border border-border bg-slate-50 dark:bg-slate-800/40">
                        <span className="font-bold text-ink">{comp.item}</span>
                        <div className="text-right space-x-3 text-[0.72rem]">
                          <span className="text-slate-500">Aug: {comp.aug}</span>
                          <span className="font-bold text-ink">Sept: {comp.sept}</span>
                          <span className="font-bold text-success-text">{comp.change}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 13. USER MANAGEMENT (admin only) */}
              {selectedMenuId === 'user_management' && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 rounded-xl bg-primary-soft text-ink font-medium">
                    <strong>How it works:</strong> A <strong>Role</strong> is a list of pages, and for each page whether its users may only <strong>View</strong> it or also <strong>Create</strong>, <strong>Edit</strong> and <strong>Delete</strong>. Give a user a role and they see only those menus and the buttons they may use - the server refuses everything else too, so typing a link doesn't get around it. The <strong>Admin</strong> role always has every page and can't be edited; the other roles are yours to change.
                  </div>

                  <div className="space-y-3">
                    {[
                      { role: 'Admin', tag: 'Fixed', pages: ['All pages, including User Management'] },
                      { role: 'Accountant', tag: 'Editable', pages: ['Everything except User Management'] },
                      { role: 'Bookkeeper', tag: 'Editable', pages: ['Bank Statements', 'General Ledger', 'Journal Entries', 'Bank Reconciliation'] },
                      { role: 'Viewer', tag: 'Editable', pages: ['Dashboard', 'Profit & Loss', 'Balance Sheet', 'Trial Balance'] },
                    ].map((r) => (
                      <div key={r.role} className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40 space-y-2">
                        <div className="font-bold text-ink flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> {r.role} (Role)
                          </span>
                          <span className="text-[0.65rem] text-primary font-bold bg-primary-soft px-2 py-0.5 rounded">
                            {r.tag}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {r.pages.map((p) => (
                            <span key={p} className="rounded-lg bg-surface text-ink border border-border-soft px-2 py-1">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-border bg-slate-50 p-4 dark:bg-slate-800/40 space-y-2">
                    <div className="font-bold text-ink">What you can do on the Users tab</div>
                    {[
                      { icon: <Users className="h-3.5 w-3.5" />, text: 'Add a user with a username, password and role - or assign a role to someone who signed up themselves.' },
                      { icon: <KeyRound className="h-3.5 w-3.5" />, text: 'Reset a forgotten password. The user is not emailed - tell them the new one; they can change it under Profile Settings (top-right menu).' },
                      { icon: <Check className="h-3.5 w-3.5" />, text: 'Deactivate a user to stop them signing in without deleting them.' },
                    ].map((row, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-surface text-ink border border-border-soft">
                        <span className="mt-0.5 text-primary">{row.icon}</span>
                        <span>{row.text}</span>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded-xl bg-warning-soft text-warning-text font-medium">
                    <strong>Safeguards:</strong> You can't delete or deactivate your own account, the last active administrator can't be removed or given a lesser role, and a role that is still assigned to users can't be deleted.
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Callout */}
            <div className="pt-4 border-t border-border-soft flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1.5 font-bold text-success-text">
                <Check className="h-4 w-4" /> Comprehensive Menu Guide Active
              </span>
              <span>Click any menu item on left to view</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
