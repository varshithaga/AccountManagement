import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { Lock, NotebookText, RefreshCw } from 'lucide-react'
import { accountLedgerApi, type AccountLedgerReport } from './accountledgerapi'
import { Alert, IconButton, Panel, Select, Spinner } from '../../components/tw'
import SearchableSelect, { type SearchableOption } from '../../components/SearchableSelect'
import BankAccountSelect from '../../components/BankAccountSelect'
import DatePicker2 from '../../components/DatePicker2'
import Pagination from '../../components/Pagination'
import { categoryLookupApi } from '../../api/resources'
import type { AccountType } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { exportToExcel } from '../../utils/excelExport'
import { exportTableToPdf } from '../../utils/pdfExport'
import { ReportExportButtons } from '../../components/ReportExport'
import { REPORT_PERIOD_OPTIONS, formatMoney, isReportPeriod, type ReportPeriod } from '../../utils/periods'

/** The five Chart of Accounts types, in statement order. */
const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'ASSET', label: 'Assets' },
  { value: 'LIABILITY', label: 'Liabilities' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expenses' },
]

/** What a picked sub-category carries, so picking one directly can fill in its category and type. */
interface SubCategoryMeta {
  category: number
  category_name: string
  account_type: AccountType
}

const withCode = (code: string | null | undefined, name: string) => `${code ? code + ' · ' : ''}${name}`

/** Every transaction posted to one Chart of Accounts account, with a running balance.
 * Opened from the sidebar, or from a report line (?sub_category=&period=&date_from=&date_to=). */
export default function AccountLedgerPage() {
  const navigate = useNavigate()
  const { hasPage } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialPeriod = searchParams.get('period')
  // Narrow down Type -> Category -> Sub-Category, or search a sub-category directly.
  // The ledger is for the sub-category when one is picked, otherwise for the whole category.
  const [accountType, setAccountType] = useState<AccountType | ''>('')
  const [category, setCategory] = useState<SearchableOption | null>(null)
  const [subCategory, setSubCategory] = useState<SearchableOption | null>(null)
  const account = subCategory || category
  const [period, setPeriod] = useState<ReportPeriod>(isReportPeriod(initialPeriod) ? initialPeriod : 'this_fiscal_year')
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '')
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '')
  const [bankAccount, setBankAccount] = useState<number | ''>('')
  const [page, setPage] = useState(0) // 0-based, as the Pagination bar counts
  const [rowsPerPage, setRowsPerPage] = useState(50)
  const [report, setReport] = useState<AccountLedgerReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  // An account handed over in the URL (from a report line): show its name once fetched.
  const urlSubCategory = Number(searchParams.get('sub_category')) || null
  const urlCategory = Number(searchParams.get('category')) || null
  useEffect(() => {
    if (!urlSubCategory || subCategory?.id === urlSubCategory) return
    let cancelled = false
    categoryLookupApi.subCategories({ ids: String(urlSubCategory) })
      .then((res) => {
        const sc = res.results[0]
        if (cancelled || !sc) return
        setSubCategory({ id: sc.id, label: withCode(sc.code, sc.name) })
        setCategory({ id: sc.category, label: withCode(sc.category_code, sc.category_name), meta: sc.account_type })
        setAccountType(sc.account_type)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [urlSubCategory, subCategory?.id])
  useEffect(() => {
    if (urlSubCategory || !urlCategory || category?.id === urlCategory) return
    let cancelled = false
    categoryLookupApi.categories({ ids: String(urlCategory) })
      .then((res) => {
        const c = res.results[0]
        if (cancelled || !c) return
        setCategory({ id: c.id, label: withCode(c.code, c.name), meta: c.account_type })
        setAccountType(c.account_type)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [urlSubCategory, urlCategory, category?.id])

  const fetchCategories = useCallback(async ({ search, page }: { search: string; page: number }) => {
    const res = await categoryLookupApi.categories({ search, page, account_type: accountType || undefined })
    return {
      options: res.results.map((c) => ({
        id: c.id,
        label: accountType ? withCode(c.code, c.name) : `${withCode(c.code, c.name)} (${c.account_type_label})`,
        meta: c.account_type,
      })),
      hasMore: !!res.next,
    }
  }, [accountType])

  const fetchSubCategories = useCallback(async ({ search, page }: { search: string; page: number }) => {
    const res = await categoryLookupApi.subCategories({
      search, page, account_type: accountType || undefined, category: category?.id,
    })
    return {
      options: res.results.map((sc) => ({
        id: sc.id,
        // Inside a chosen category its name is noise; otherwise it tells same-named accounts apart.
        label: category
          ? withCode(sc.code, sc.name)
          : `${withCode(sc.code, sc.name)} — ${sc.category_name}${accountType ? '' : ` (${sc.account_type_label})`}`,
        meta: {
          category: sc.category,
          category_name: withCode(sc.category_code, sc.category_name),
          account_type: sc.account_type,
        } satisfies SubCategoryMeta,
      })),
      hasMore: !!res.next,
    }
  }, [accountType, category])

  const params = useCallback(() => ({
    sub_category: subCategory?.id,
    category: subCategory ? undefined : category?.id,
    period,
    date_from: period === 'custom' ? dateFrom || undefined : undefined,
    date_to: period === 'custom' ? dateTo || undefined : undefined,
    account: bankAccount || undefined,
  }), [subCategory, category, period, dateFrom, dateTo, bankAccount])

  const fetchReport = useCallback(async () => {
    if (!account) {
      setReport(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      setReport(await accountLedgerApi.get({ ...params(), page: page + 1, page_size: rowsPerPage }))
    } catch {
      setError('Failed to load the account ledger.')
    } finally {
      setLoading(false)
    }
  }, [account, params, page, rowsPerPage])

  useEffect(() => { fetchReport() }, [fetchReport])

  /** Keeps ?category= / ?sub_category= in the URL so the view can be bookmarked or shared. */
  const syncUrl = (cat: SearchableOption | null, sub: SearchableOption | null) => {
    const next = new URLSearchParams(searchParams)
    if (sub) next.set('sub_category', String(sub.id))
    else next.delete('sub_category')
    if (cat && !sub) next.set('category', String(cat.id))
    else next.delete('category')
    setSearchParams(next, { replace: true })
  }

  const changeAccountType = (value: AccountType | '') => {
    setAccountType(value)
    setPage(0)
    // Keep the picks only if they belong to the new type.
    const keepCategory = !value || !category || category.meta === value
    const nextCat = keepCategory ? category : null
    const nextSub = keepCategory ? subCategory : null
    setCategory(nextCat)
    setSubCategory(nextSub)
    syncUrl(nextCat, nextSub)
  }

  const changeCategory = (option: SearchableOption | null) => {
    setCategory(option)
    setSubCategory(null)
    if (option?.meta) setAccountType(option.meta as AccountType)
    setPage(0)
    syncUrl(option, null)
  }

  const changeSubCategory = (option: SearchableOption | null) => {
    setSubCategory(option)
    setPage(0)
    const meta = option?.meta as SubCategoryMeta | undefined
    let cat = category
    if (meta && category?.id !== meta.category) {
      // Picked directly: fill in its category and type.
      cat = { id: meta.category, label: meta.category_name, meta: meta.account_type }
      setCategory(cat)
    }
    if (meta) setAccountType(meta.account_type)
    syncUrl(cat, option)
  }

  const clearSelection = () => {
    setAccountType('')
    setCategory(null)
    setSubCategory(null)
    setPage(0)
    syncUrl(null, null)
  }

  const changePeriod = (value: ReportPeriod) => {
    if (value === 'custom' && (!dateFrom || !dateTo)) {
      setDateFrom(dayjs().startOf('month').format('YYYY-MM-DD'))
      setDateTo(dayjs().format('YYYY-MM-DD'))
    }
    setPeriod(value)
    setPage(0)
  }

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (!report) return
    setExporting(true)
    try {
      // Every row, not just this page.
      const all = await accountLedgerApi.get({ ...params(), page: 1, page_size: 5000 })
      const rows = [
        { date: all.date_from || '', description: 'Opening balance', balance: Number(all.opening_balance) },
        ...all.rows.map((r) => ({
          date: r.date, description: r.description, bank_account: r.bank_account, sub_category: r.sub_category_name,
          debit: Number(r.debit) || '', credit: Number(r.credit) || '', balance: Number(r.balance),
        })),
        { description: 'Totals', debit: Number(all.total_debit), credit: Number(all.total_credit) },
        { date: all.date_to || '', description: 'Closing balance', balance: Number(all.closing_balance) },
      ]
      const columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Description', key: 'description', width: 48 },
        { header: 'Entry', key: 'bank_account', width: 22 },
        { header: 'Sub-Category', key: 'sub_category', width: 24 },
        { header: 'Debit', key: 'debit', width: 16 },
        { header: 'Credit', key: 'credit', width: 16 },
        { header: 'Balance', key: 'balance', width: 18 },
      ]
      const baseName = `Account_Ledger_${all.account.name.replace(/\W+/g, '_')}`
      if (format === 'excel') {
        await exportToExcel(`${baseName}.xlsx`, 'Account Ledger', columns, rows)
      } else {
        const range = all.date_from && all.date_to
          ? `${dayjs(all.date_from).format('DD MMM YYYY')} – ${dayjs(all.date_to).format('DD MMM YYYY')}`
          : 'All dates'
        await exportTableToPdf(`${baseName}.pdf`, 'Account Ledger', [['Account', all.account.name], ['Period', range]], columns, rows, {
          amountKeys: ['debit', 'credit', 'balance'],
          rowStyle: (r) => (['Opening balance', 'Totals', 'Closing balance'].includes(String(r.description)) ? 'total' : 'normal'),
          landscape: true,
        })
      }
    } catch {
      setError('Failed to export the account ledger.')
    } finally {
      setExporting(false)
    }
  }

  const sideLabel = report?.normal_balance === 'DEBIT' ? 'Dr' : 'Cr'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-ink">Account Ledger</h1>
          <p className="mt-1.5 max-w-3xl text-[15px] text-muted">
            Every confirmed transaction posted to one account, with its running balance
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportExportButtons
            onExcel={() => handleExport('excel')}
            onPdf={() => handleExport('pdf')}
            disabled={!report || exporting}
            onError={setError}
          />
        </div>
      </div>

      <Panel className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold text-muted">Account Type</span>
          {[{ value: '' as const, label: 'All' }, ...ACCOUNT_TYPES].map((t) => (
            <button
              key={t.value || 'all'}
              type="button"
              onClick={() => changeAccountType(t.value)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                accountType === t.value
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'border-border bg-white text-muted hover:border-violet-300 hover:text-violet-700 dark:bg-white/5 dark:hover:text-violet-300'
              }`}
            >
              {t.label}
            </button>
          ))}
          {(accountType || category || subCategory) && (
            <button
              type="button"
              onClick={clearSelection}
              className="ml-1 text-xs font-semibold text-slate-500 underline-offset-2 hover:text-ink hover:underline dark:text-muted "
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <IconButton title="Refresh" onClick={() => fetchReport()} disabled={loading || !account}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
          <div className="min-w-[220px] flex-1">
            <SearchableSelect
              label="Category"
              placeholder={accountType ? `Search ${ACCOUNT_TYPES.find((t) => t.value === accountType)?.label.toLowerCase()} categories` : 'Search a category'}
              value={category}
              onChange={changeCategory}
              fetchOptions={fetchCategories}
              resetKey={accountType || 'all'}
            />
          </div>
          <div className="min-w-[260px] flex-1">
            <SearchableSelect
              label="Sub-Category (Account)"
              placeholder={category ? 'All sub-categories in this category' : 'Search any account by name or code'}
              value={subCategory}
              onChange={changeSubCategory}
              fetchOptions={fetchSubCategories}
              resetKey={`${accountType || 'all'}-${category?.id ?? 'all'}`}
            />
          </div>
          <Select id="ledger-period" label="Period" value={period} onChange={(e) => changePeriod(e.target.value as ReportPeriod)} className="min-w-[180px]">
            {REPORT_PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          {period === 'custom' && (
            <>
              <DatePicker2 id="ledger-from" label="From Date" value={dateFrom} onChange={(d: string) => { setDateFrom(d); setPage(0) }} fullWidth={false} className="min-w-[160px]" />
              <DatePicker2 id="ledger-to" label="To Date" value={dateTo} onChange={(d: string) => { setDateTo(d); setPage(0) }} fullWidth={false} className="min-w-[160px]" />
            </>
          )}
          <div className="min-w-[220px]">
            <BankAccountSelect value={bankAccount} onChange={(id) => { setBankAccount(id ?? ''); setPage(0) }} />
          </div>
        </div>
      </Panel>

      {error && <Alert>{error}</Alert>}

      {!account ? (
        <Panel className="flex flex-col items-center gap-3 py-16 text-center">
          <NotebookText className="h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-muted">
            Pick an account type, then a category (its whole ledger) or a sub-category, or search a sub-category directly.
          </p>
        </Panel>
      ) : loading && !report ? (
        <div className="flex items-center justify-center p-16"><Spinner size={32} /></div>
      ) : report && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
            {[
              { label: 'Opening Balance', value: report.opening_balance, hint: report.date_from ? `before ${dayjs(report.date_from).format('DD MMM YYYY')}` : 'start of records' },
              { label: 'Total Debits', value: report.total_debit, hint: `${report.count} transaction${report.count === 1 ? '' : 's'}` },
              { label: 'Total Credits', value: report.total_credit, hint: report.date_from && report.date_to ? `${dayjs(report.date_from).format('DD MMM')} – ${dayjs(report.date_to).format('DD MMM YYYY')}` : 'all dates' },
              { label: 'Closing Balance', value: report.closing_balance, hint: `${report.account.account_type.toLowerCase()} · normal balance ${sideLabel}` },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-border bg-surface p-5 ">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">{card.label}</span>
                <p className="num mt-2 text-[26px] font-semibold text-ink">{formatMoney(card.value)}</p>
                <p className="mt-1 text-xs text-muted">{card.hint}</p>
              </div>
            ))}
          </div>

          <Panel className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-6 py-4 ">
              <div>
                <h2 className="text-base font-bold text-ink">
                  {report.account.code ? `${report.account.code} · ` : ''}{report.account.name}
                </h2>
                <p className="text-xs text-muted">
                  {report.account.kind === 'category'
                    ? `Whole category · all sub-categories (${report.account.account_type.toLowerCase()})`
                    : `${report.account.category_name} (${report.account.account_type.toLowerCase()})`}
                </p>
              </div>
              {loading && <Spinner size={20} />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-slate-100/50 text-xs font-bold uppercase text-slate-500 dark:bg-white/5 dark:text-muted">
                  <tr>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Description</th>
                    <th className="px-6 py-3">Entry</th>
                    <th className="px-6 py-3 text-right">Debit</th>
                    <th className="px-6 py-3 text-right">Credit</th>
                    <th className="px-6 py-3 text-right">Balance ({sideLabel})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.page === 1 && (
                    <tr className="bg-slate-50/60 dark:bg-white/5">
                      <td className="px-6 py-3 text-slate-500">{report.date_from ? dayjs(report.date_from).format('DD MMM YYYY') : '—'}</td>
                      <td className="px-6 py-3 font-bold text-ink" colSpan={4}>Opening balance</td>
                      <td className="px-6 py-3 text-right font-bold">{formatMoney(report.opening_balance)}</td>
                    </tr>
                  )}
                  {report.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-sm italic text-muted">
                        No confirmed transactions posted to this account in the period.
                      </td>
                    </tr>
                  )}
                  {report.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-surface-muted">
                      <td className="whitespace-nowrap px-6 py-3 text-muted">{dayjs(row.date).format('DD MMM YYYY')}</td>
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          className="text-left font-semibold text-ink hover:text-violet-600 hover:underline disabled:no-underline "
                          disabled={row.statement_id ? !hasPage('bank_statements') : !hasPage('journal_entries')}
                          onClick={() => navigate(row.statement_id ? `/bank-statements/${row.statement_id}`
                            : `/journal-entries?entry=${encodeURIComponent(row.entry_number)}`)}
                        >
                          {row.description}
                        </button>
                        {row.is_final && <Lock className="ml-1.5 inline h-3 w-3 text-muted" aria-label="Final" />}
                        {report.account.kind === 'category' && (
                          <span className="mt-0.5 block text-xs font-medium text-primary">{row.sub_category_name}</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-muted">{row.bank_account}</td>
                      <td className="px-6 py-3 text-right font-semibold text-primary">{Number(row.debit) ? formatMoney(row.debit) : '—'}</td>
                      <td className="px-6 py-3 text-right font-semibold text-success-text">{Number(row.credit) ? formatMoney(row.credit) : '—'}</td>
                      <td className="px-6 py-3 text-right font-bold text-ink">{formatMoney(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                {report.page === report.pages && (
                  <tfoot className="border-t-2 border-border bg-slate-50 font-bold dark:bg-slate-900/60">
                    <tr>
                      <td colSpan={3} className="px-6 py-3 text-xs uppercase tracking-wider text-slate-500">Totals / closing balance</td>
                      <td className="px-6 py-3 text-right text-primary">{formatMoney(report.total_debit)}</td>
                      <td className="px-6 py-3 text-right text-success-text">{formatMoney(report.total_credit)}</td>
                      <td className="px-6 py-3 text-right">{formatMoney(report.closing_balance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {report.count > 0 && (
              <Pagination
                count={report.count}
                page={page}
                rowsPerPage={rowsPerPage}
                onPageChange={setPage}
                onRowsPerPageChange={(rpp) => { setRowsPerPage(rpp); setPage(0) }}
              />
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
