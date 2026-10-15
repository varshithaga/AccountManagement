import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, ArrowRight, Folders, Tag, Hash, Landmark, UploadCloud, Link2, Sparkles,
  ClipboardCheck, CheckCheck, Lock, BarChart3, CircleCheck, CircleDashed, AlertTriangle, Hourglass,
  Users, FileText, HandCoins,
} from 'lucide-react'
import { workflowApi } from '../../api/resources'
import type { WorkflowStatus } from '../../api/resources'
import { Button, Panel, Alert, Spinner } from '../../components/tw'

// ---------------------------------------------------------------- step model

/** done: nothing left · todo: needs doing · attention: has items waiting ·
 * optional: can be skipped · waiting: an earlier step must happen first · info: always available */
type StepState = 'done' | 'todo' | 'attention' | 'optional' | 'waiting' | 'info'

interface StepAction { label: string; to: string }

interface Step {
  n: number
  phase: 'setup' | 'monthly' | 'sales' | 'reports'
  title: string
  icon: React.ReactNode
  what: string
  todo: string[]
  state: StepState
  /** One-line live status, e.g. "19 categories · 74 sub-categories". */
  metric: string
  actions: StepAction[]
}

const fmtNum = (n: number) => n.toLocaleString('en-IN')
const fmtInr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const ALL = 'period=all_time'

function buildSteps(s: WorkflowStatus): Step[] {
  const { setup, statements, transactions: t, sales } = s
  const hasStatements = statements.total > 0
  const afterUpload = (state: StepState): StepState => (hasStatements ? state : 'waiting')

  return [
    {
      n: 1, phase: 'setup', title: 'Set up the Chart of Accounts', icon: <Folders className="h-5 w-5" />,
      what: 'The list of Categories and Sub-Categories every transaction is sorted into. Each category has an account type - Asset, Liability, Equity, Income or Expense - which decides whether it appears in the Profit & Loss or the Balance Sheet.',
      todo: [
        'Create a Category for each group you report on (e.g. Operating Expenses - type Expense).',
        'Add Sub-Categories under it (e.g. Rent, Electricity, Salaries).',
        'Or use Import on that page to load them from Excel.',
      ],
      state: setup.sub_categories > 0 ? 'done' : 'todo',
      metric: `${fmtNum(setup.categories)} categories · ${fmtNum(setup.sub_categories)} sub-categories`,
      actions: [{ label: 'Open Chart of Accounts', to: '/categories' }],
    },
    {
      n: 2, phase: 'setup', title: 'Add Auto-Categorization Rules', icon: <Tag className="h-5 w-5" />,
      what: 'Keywords that recognise bank narrations. "RENT" under Rent means any narration containing RENT points to Rent. The more good keywords, the more transactions are categorized for you.',
      todo: [
        'Pick a Sub-Category and add the words that appear in its narrations (e.g. PAYROLL, SALARY under Salaries).',
        'Tick "Auto-assign" for keywords that are always right - they assign directly without scoring.',
        'Optional: adjust the score thresholds on the same page.',
      ],
      state: setup.keywords > 0 ? 'done' : 'todo',
      metric: `${fmtNum(setup.keywords)} active keywords`,
      actions: [{ label: 'Open Rules', to: '/category-keywords' }],
    },
    {
      n: 3, phase: 'setup', title: 'Map BAI Codes (optional)', icon: <Hash className="h-5 w-5" />,
      what: 'Many bank files tag each line with a standard BAI code (e.g. 464 Service Charge). Giving a code a default Sub-Category adds a clue towards it when categorizing.',
      todo: [
        'Load the standard codes, then set a default Category / Sub-Category on the ones your bank uses.',
        'Skip this if your statements have no BAI code column.',
      ],
      state: setup.bai_codes_mapped > 0 ? 'done' : 'optional',
      metric: `${fmtNum(setup.bai_codes_mapped)} of ${fmtNum(setup.bai_codes)} codes mapped`,
      actions: [{ label: 'Open BAI Codes', to: '/bai-codes' }],
    },
    {
      n: 4, phase: 'setup', title: 'Add your Bank Accounts', icon: <Landmark className="h-5 w-5" />,
      what: 'Every statement is uploaded against one bank account, and balances and continuity are tracked per account.',
      todo: ['Add each company bank account (name, bank, account number).'],
      state: setup.bank_accounts > 0 ? 'done' : 'todo',
      metric: `${fmtNum(setup.bank_accounts)} active bank account(s)`,
      actions: [{ label: 'Open Bank Accounts', to: '/bank-accounts' }],
    },
    {
      n: 5, phase: 'monthly', title: 'Upload the bank statement', icon: <UploadCloud className="h-5 w-5" />,
      what: 'Import the statement file (CSV, Excel or PDF). Opening and closing balances are read from the file\'s running balance. A file whose balance doesn\'t add up row-to-row is rejected with the exact row to fix, and the same file can\'t be uploaded twice.',
      todo: [
        'Bank Statements → Import Statement → choose the bank account and the file.',
        'If it is rejected, fix the named row (usually a missing or extra column) and upload again.',
        'Transactions that look like duplicates of earlier uploads are flagged automatically.',
      ],
      state: hasStatements ? 'done' : 'todo',
      metric: `${fmtNum(statements.total)} statement(s) uploaded · ${fmtNum(t.total)} transactions`,
      actions: [{ label: 'Open Bank Statements', to: '/bank-statements' }],
    },
    {
      n: 6, phase: 'monthly', title: 'Check Statement Continuity', icon: <Link2 className="h-5 w-5" />,
      what: 'For each bank account, every statement should open with the previous statement\'s closing balance. A difference means a missing statement, missing transactions, or the same period uploaded twice.',
      todo: [
        'Missing statement: upload the statement for the gap shown.',
        'Balance mismatch: find the missing transactions or the wrong file.',
        'Overlapping period: delete the statement that was uploaded twice.',
      ],
      state: afterUpload(statements.continuity_issues > 0 ? 'attention' : 'done'),
      metric: statements.continuity_issues > 0
        ? `${fmtNum(statements.continuity_issues)} statement(s) with issues · ${fmtInr(statements.unaccounted_balance)} unaccounted`
        : 'Every statement continues from the previous one',
      actions: [{ label: 'Open Statement Continuity', to: '/bank-statements/continuity' }],
    },
    {
      n: 7, phase: 'monthly', title: 'Run Auto-Categorize', icon: <Sparkles className="h-5 w-5" />,
      what: 'Open the statement and click Auto-Categorize. Each transaction is checked in order: transfers between your own accounts → auto-assign keywords → narrations you confirmed before → a score from keywords, sub-category names, BAI codes and similar past narrations. High, clear scores are Auto-assigned, medium ones become Needs Review, low ones stay Uncategorized.',
      todo: ['Bank Statements → open the statement → Auto-Categorize.'],
      state: afterUpload(statements.not_auto_categorized > 0 ? 'attention' : 'done'),
      metric: statements.not_auto_categorized > 0
        ? `${fmtNum(statements.not_auto_categorized)} statement(s) not categorized yet`
        : 'All statements have been categorized',
      actions: [{ label: 'Open Bank Statements', to: '/bank-statements' }],
    },
    {
      n: 8, phase: 'monthly', title: 'Review what the engine couldn\'t decide', icon: <ClipboardCheck className="h-5 w-5" />,
      what: 'Needs Review rows carry a suggestion you accept or change. Uncategorized rows need a category from you. Every choice you make is remembered, and similar narrations are updated to match.',
      todo: [
        'Needs Review: click Accept, or pick the right category.',
        'Uncategorized: pick a Category / Sub-Category (select several rows to assign in bulk).',
        'Duplicates: check flagged rows and delete real duplicates - they are already left out of reports.',
      ],
      state: afterUpload(t.needs_review + t.uncategorized > 0 ? 'attention' : 'done'),
      metric: `${fmtNum(t.needs_review)} need review · ${fmtNum(t.uncategorized)} uncategorized · ${fmtNum(t.duplicates)} flagged duplicates`,
      actions: [
        { label: 'Needs Review', to: `/transactions?status=NEEDS_REVIEW&${ALL}` },
        { label: 'Uncategorized', to: `/transactions?uncategorized=true&${ALL}` },
        { label: 'Duplicates', to: `/transactions?duplicate=true&${ALL}` },
      ],
    },
    {
      n: 9, phase: 'monthly', title: 'Confirm the categories', icon: <CheckCheck className="h-5 w-5" />,
      what: 'Confirming says "this category is right". Confirmed transactions are never changed by a later Auto-Categorize run, and they teach the engine for next month\'s statements.',
      todo: [
        'Check the Auto-assigned rows, then Confirm them - one by one, selected rows, or "Confirm All Categorized" on a statement.',
      ],
      state: afterUpload(t.unconfirmed > 0 ? 'attention' : 'done'),
      metric: t.unconfirmed > 0 ? `${fmtNum(t.unconfirmed)} categorized transaction(s) not confirmed yet` : 'Everything categorized is confirmed',
      actions: [{ label: 'Open Transactions', to: `/transactions?status=AUTO_ASSIGNED&${ALL}` }],
    },
    {
      n: 10, phase: 'monthly', title: 'Make Final (lock and post to the books)', icon: <Lock className="h-5 w-5" />,
      what: 'When a month is done, lock its transactions. Making a transaction final also posts it to the journal (the books) and matches it in Bank Reconciliation - from then on it counts in the reports. Final transactions can\'t be re-categorized or deleted, and their statement can\'t be deleted or re-parsed, until someone Reopens them (which takes them back out of the books).',
      todo: [
        'Transactions → select rows → Make Final, or "Make All Final" on a statement.',
        'A transaction already in the books through an imported entry or a payment is matched, not posted twice.',
        'The bank had no GL account when you made it final? Link it, then use "Post to books" in the General Ledger.',
        'Need a correction later? Reopen, fix, and make it final again.',
      ],
      state: afterUpload(t.ready_to_finalize > 0 ? 'todo' : 'done'),
      metric: `${fmtNum(t.ready_to_finalize)} ready to lock · ${fmtNum(t.final)} final`,
      actions: [{ label: 'Open confirmed transactions', to: `/transactions?confirmed=true&${ALL}` }],
    },
    {
      n: 11, phase: 'sales', title: 'Add clients, suppliers and products', icon: <Users className="h-5 w-5" />,
      what: 'The people you sell to and buy from, and the goods or services you sell. A client or supplier with an opening balance (what was owed before you started) has it booked against "Opening Balance Equity", so it is on the Balance Sheet.',
      todo: [
        'Clients / Suppliers → add each one with its GSTIN and state - the state decides CGST + SGST or IGST.',
        'Set your own company state once under Period Close.',
        'Products & Tax Rates → check the GST rates and add what you sell, with its income account.',
      ],
      state: sales.clients + sales.suppliers > 0 ? 'done' : 'optional',
      metric: `${fmtNum(sales.clients)} clients · ${fmtNum(sales.suppliers)} suppliers · ${fmtNum(sales.products)} products · ${fmtNum(sales.tax_rates)} tax rates`,
      actions: [
        { label: 'Clients', to: '/clients' },
        { label: 'Suppliers', to: '/suppliers' },
        { label: 'Products', to: '/products' },
      ],
    },
    {
      n: 12, phase: 'sales', title: 'Raise invoices and record bills', icon: <FileText className="h-5 w-5" />,
      what: 'A sales invoice stays a draft until you Post it - posting books it (Dr Receivable, Cr income and output GST). A purchase bill is the reverse. Returns and discounts are a credit note (on an invoice) or a debit note (on a bill). Any document can be printed or downloaded as a PDF.',
      todo: [
        'Sales Invoices → New invoice → Post when it is final. Drafts are not in the books.',
        'Purchase Bills → record each supplier bill and Post it.',
        'Goods returned or a price corrected? Open the document → Credit note / Debit note.',
      ],
      state: sales.draft_invoices + sales.draft_bills > 0 ? 'attention' : (sales.invoices + sales.bills > 0 ? 'done' : 'optional'),
      metric: `${fmtNum(sales.invoices)} invoices (${fmtNum(sales.draft_invoices)} draft) · ${fmtNum(sales.bills)} bills (${fmtNum(sales.draft_bills)} draft)`,
      actions: [
        { label: 'Sales Invoices', to: '/sales-invoices' },
        { label: 'Purchase Bills', to: '/purchase-bills' },
      ],
    },
    {
      n: 13, phase: 'sales', title: 'Record payments and follow up what is due', icon: <HandCoins className="h-5 w-5" />,
      what: 'Money received from a client or paid to a supplier is a payment, allocated to the invoices or bills it settles. Receivables & Payables shows who owes what and how overdue it is.',
      todo: [
        'Payments & Receipts → record the payment and allocate it to its invoices / bills.',
        'Receivables & Payables → chase overdue invoices and plan supplier payments.',
        'Bank Reconciliation → match the payment to its line on the bank statement.',
      ],
      state: sales.overdue_invoices + sales.overdue_bills + sales.unallocated_payments > 0
        ? 'attention' : (sales.payments > 0 ? 'done' : 'optional'),
      metric: `${fmtNum(sales.overdue_invoices)} overdue invoices · ${fmtNum(sales.overdue_bills)} overdue bills · ${fmtNum(sales.unallocated_payments)} payments not fully allocated`,
      actions: [
        { label: 'Payments & Receipts', to: '/payments' },
        { label: 'Receivables & Payables', to: '/receivables-payables' },
      ],
    },
    {
      n: 14, phase: 'reports', title: 'Read the reports', icon: <BarChart3 className="h-5 w-5" />,
      what: 'Every report adds up the journal (the books): manual and imported entries, posted invoices, bills, payments and credit notes, opening balances, and bank transactions once they are final. Bank transactions not in the books yet are counted on each report, so nothing is silently missing.',
      todo: [
        'Profit & Loss - income minus expenses for a period.',
        'Balance Sheet - assets = liabilities + equity at a date.',
        'Trial Balance - the balance of every account; debits = credits.',
        'GST Summary - output GST, input credit and the net payable, split CGST / SGST / IGST.',
        'Period Comparison - two periods side by side. Every report exports to Excel.',
      ],
      state: 'info',
      metric: 'Use the period and bank-account filters on each report',
      actions: [
        { label: 'Profit & Loss', to: '/profit-and-loss' },
        { label: 'Balance Sheet', to: '/balance-sheet' },
        { label: 'Trial Balance', to: '/trial-balance' },
        { label: 'GST Summary', to: '/gst-summary' },
        { label: 'Comparison', to: '/reports/comparison' },
      ],
    },
  ]
}

const STATE_STYLE: Record<StepState, { label: string; chip: string; ring: string; icon: React.ReactNode }> = {
  done: { label: 'Done', chip: 'bg-emerald-500/15 text-success-text', ring: 'bg-emerald-500 text-white', icon: <CircleCheck className="h-3.5 w-3.5" /> },
  todo: { label: 'To do', chip: 'bg-violet-500/15 text-primary', ring: 'bg-violet-600 text-white', icon: <CircleDashed className="h-3.5 w-3.5" /> },
  attention: { label: 'Needs attention', chip: 'bg-amber-500/15 text-warning-text', ring: 'bg-amber-500 text-white', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  optional: { label: 'Optional', chip: 'bg-slate-500/15 text-muted', ring: 'bg-slate-400 text-white', icon: <CircleDashed className="h-3.5 w-3.5" /> },
  waiting: { label: 'After upload', chip: 'bg-slate-500/10 text-muted', ring: 'bg-slate-300 text-muted dark:bg-slate-700 ', icon: <Hourglass className="h-3.5 w-3.5" /> },
  info: { label: 'Any time', chip: 'bg-info/15 text-info-text', ring: 'bg-info text-white', icon: <BarChart3 className="h-3.5 w-3.5" /> },
}

const PHASES: { key: Step['phase']; title: string; subtitle: string }[] = [
  { key: 'setup', title: 'One-time setup', subtitle: 'Do these once. Come back whenever you add a category, keyword or bank account.' },
  { key: 'monthly', title: 'Every month - for each new statement', subtitle: 'Repeat for every statement you upload.' },
  { key: 'sales', title: 'Sales & Purchases', subtitle: 'Optional - for invoices you raise and supplier bills you record here.' },
  { key: 'reports', title: 'Reports', subtitle: 'Available at any time.' },
]

/** How one transaction moves through the app, left to right. */
const LIFECYCLE: { label: string; note: string; tone: string }[] = [
  { label: 'Uploaded', note: 'Parsed from the file - Uncategorized', tone: 'bg-slate-500/15 text-ink' },
  { label: 'Auto-Categorize', note: 'Auto-assigned / Needs review / Uncategorized / Transfer', tone: 'bg-violet-500/15 text-primary' },
  { label: 'You review', note: 'Accept a suggestion or pick a category - Manually assigned', tone: 'bg-amber-500/15 text-warning-text' },
  { label: 'Confirmed ', note: 'Never changed by Auto-Categorize; teaches it', tone: 'bg-emerald-500/15 text-success-text' },
  { label: 'Final ', note: 'Locked and posted to the books', tone: 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' },
  { label: 'Reports', note: 'P&L, Balance Sheet, Trial Balance - from the books', tone: 'bg-info/15 text-info-text' },
]

// ---------------------------------------------------------------- UI

function StepCard({ step, isNext, onGo }: { step: Step; isNext: boolean; onGo: (to: string) => void }) {
  const style = STATE_STYLE[step.state]
  return (
    <div
      id={`step-${step.n}`}
      className={`scroll-mt-24 rounded-2xl border bg-white p-5 dark:bg-slate-900/60 ${isNext
        ? 'border-violet-400 ring-2 ring-violet-500/30 dark:border-violet-400/60'
        : 'border-border'}`}
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${style.ring}`}>
          {step.state === 'done' ? <CircleCheck className="h-5 w-5" /> : step.n}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">{step.icon}</span>
            <h3 className="text-base font-bold text-ink">{step.n}. {step.title}</h3>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${style.chip}`}>
              {style.icon} {style.label}
            </span>
            {isNext && (
              <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[0.7rem] font-bold text-white">Next step</span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{step.what}</p>

          <div className="mt-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">What to do</p>
            <ul className="mt-1.5 space-y-1 text-sm text-ink">
              {step.todo.map((line) => (
                <li key={line} className="flex gap-2"><span className="text-violet-500">•</span><span>{line}</span></li>
              ))}
            </ul>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2 ">
            <span className="text-xs font-semibold text-muted">{step.metric}</span>
            <div className="flex flex-wrap gap-2">
              {step.actions.map((a, i) => (
                <Button
                  key={a.to}
                  size="sm"
                  variant={i === 0 && step.state !== 'done' && step.state !== 'waiting' ? 'contained' : 'outlined'}
                  endIcon={<ArrowRight className="h-3.5 w-3.5" />}
                  onClick={() => onGo(a.to)}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function WorkflowPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<WorkflowStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setStatus(await workflowApi.status())
    } catch {
      setError('Could not load your progress. The steps below are still accurate - only the live counts are missing.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const steps = status ? buildSteps(status) : []
  const required = steps.filter((s) => s.state !== 'optional' && s.state !== 'info')
  const doneCount = required.filter((s) => s.state === 'done').length
  const next = steps.find((s) => s.state === 'todo' || s.state === 'attention') ?? null
  const scrollTo = (n: number) => document.getElementById(`step-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <h1 className="text-ink">Workflow</h1>
          </div>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
            How the application works, step by step - and, from your own data, what to do next.
          </p>
        </div>
        <Button variant="outlined" icon={<RefreshCw className="h-4 w-4" />} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading && !status ? (
        <div className="flex justify-center p-12"><Spinner size={28} /></div>
      ) : status && (
        <>
          {/* Next step + progress */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-3xl bg-sidebar p-6 text-white lg:col-span-2">
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-100">Your next step</p>
              {next ? (
                <>
                  <h2 className="mt-1 text-xl font-bold">{next.n}. {next.title}</h2>
                  <p className="mt-1 text-sm text-indigo-100">{next.metric}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/90">{next.todo[0]}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(next.actions[0].to)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
                    >
                      {next.actions[0].label} <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollTo(next.n)}
                      className="rounded-xl border border-white/40 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
                    >
                      Explain this step
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mt-1 text-xl font-bold">You're up to date</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/90">
                    Everything uploaded is categorized, confirmed and final. Upload next month's statement to start again at step 5, or open the reports.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/profit-and-loss')}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
                  >
                    Open Profit &amp; Loss <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            <Panel className="p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Progress</p>
              <p className="mt-1 text-[26px] font-semibold text-ink"><span className="num">{doneCount} / {required.length}</span> <span className="text-sm font-semibold text-muted">steps done</span></p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${required.length ? (doneCount / required.length) * 100 : 0}%` }} />
              </div>
              {/* Compact stepper - click to jump to a step */}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {steps.map((s) => (
                  <button
                    key={s.n}
                    type="button"
                    title={`${s.n}. ${s.title} - ${STATE_STYLE[s.state].label}`}
                    onClick={() => scrollTo(s.n)}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${STATE_STYLE[s.state].ring} ${next?.n === s.n ? 'ring-2 ring-violet-500 ring-offset-2 dark:ring-offset-slate-900' : ''}`}
                  >
                    {s.n}
                  </button>
                ))}
              </div>
            </Panel>
          </div>

          {/* How one transaction moves through the app */}
          <Panel className="p-5">
            <p className="text-sm font-bold text-ink">How a transaction moves through the app</p>
            <div className="mt-3 flex flex-wrap items-stretch gap-2">
              {LIFECYCLE.map((stage, i) => (
                <div key={stage.label} className="flex items-center gap-2">
                  <div className={`w-40 rounded-xl px-3 py-2 ${stage.tone}`}>
                    <p className="text-xs font-bold">{stage.label}</p>
                    <p className="mt-0.5 text-[0.7rem] leading-snug opacity-90">{stage.note}</p>
                  </div>
                  {i < LIFECYCLE.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted" />}
                </div>
              ))}
            </div>
          </Panel>

          {/* Steps by phase */}
          {PHASES.map((phase) => (
            <section key={phase.key} className="space-y-3">
              <div>
                <h2 className="text-lg font-bold text-ink">{phase.title}</h2>
                <p className="text-sm text-muted">{phase.subtitle}</p>
              </div>
              {steps.filter((s) => s.phase === phase.key).map((s) => (
                <StepCard key={s.n} step={s} isNext={next?.n === s.n} onGo={navigate} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  )
}
