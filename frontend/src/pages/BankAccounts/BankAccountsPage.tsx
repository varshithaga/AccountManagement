import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Landmark, Plus, Pencil, Trash2, CheckCircle2, PauseCircle,
  Receipt, RefreshCw, FileSpreadsheet, Download, UploadCloud,
} from 'lucide-react'
import { bankAccountsApi } from './bankaccountsapi'
import { usePageSummary } from '../../hooks/usePageSummary'
import Pagination, { DEFAULT_ROWS_PER_PAGE } from '../../components/Pagination'
import ImportExcelDialog from '../../components/ImportExcelDialog'
import GlAccountSelect from '../../components/GlAccountSelect'
import type { ImportColumnGuide } from '../../components/ImportExcelDialog'
import type { BankAccount } from '../../types'
import { exportToExcel } from '../../utils/excelExport'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, IconButton, Modal, Panel, Spinner, TextField } from '../../components/tw'
import { EmptyState, KpiTile, PageHeader, RowAction, SearchBox } from '../../components/PageParts'

const IMPORT_COLUMN_GUIDE: ImportColumnGuide[] = [
  {
    column: 'Account Name', required: true,
    description: 'A name for this bank account, max 150 characters. Must be unique (not case-sensitive).',
    example: 'HDFC Operating Account',
  },
  { column: 'Bank Name', description: 'Name of the bank, max 150 characters.', example: 'HDFC Bank' },
  {
    column: 'Account Number',
    description: 'Bank account number, max 50 characters. Format the cell as Text if the number is long or starts with 0, so Excel keeps every digit.',
    example: '50200012345678',
  },
]

const IMPORT_ROW_GUIDE: string[] = [
  'Row 1 is the header row - keep the column names exactly as in the template. Your data starts from row 2.',
  'One bank account per row.',
  'Account names that already exist, or appear more than once in the file, are skipped as duplicates.',
  'Rows without an Account Name are marked incorrect and not imported.',
  'Imported accounts are Active. The GL account used for bank reconciliation is not imported - link it afterwards with Edit.',
  'The sample rows in the template are examples - replace or delete them before importing.',
]


/** "HDFC Bank" -> "HB", "ICICI" -> "IC". */
function monogram(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

export default function BankAccountsPage() {
  const { can, hasPage } = useAuth()
  const canCreate = can('bank_accounts', 'create')
  const canEdit = can('bank_accounts', 'edit')
  const navigate = useNavigate()
  const canOpenStatements = hasPage('bank_statements')
  const canDelete = can('bank_accounts', 'delete')
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [count, setCount] = useState(0)
  // Card totals cover every bank account, not just the filtered page.
  const [summary, refreshSummary] = usePageSummary(bankAccountsApi.summary)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE)

  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<BankAccount | null>(null)
  const [form, setForm] = useState<{ name: string; bank_name: string; account_number: string; gl_account: number | null }>({
    name: '', bank_name: '', account_number: '', gl_account: null,
  })

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await bankAccountsApi.search({ search: search.trim() || undefined, page: page + 1, limit: rowsPerPage })
      setAccounts(data.results)
      setCount(data.count)
    } catch {
      setError('Failed to load bank accounts.')
    } finally {
      setLoading(false)
    }
  }, [search, page, rowsPerPage])

  useEffect(() => {
    const handle = setTimeout(fetchAccounts, 300)
    return () => clearTimeout(handle)
  }, [fetchAccounts])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', bank_name: '', account_number: '', gl_account: null })
    setError('')
    setDialog(true)
  }

  const openEdit = (acc: BankAccount) => {
    setEditing(acc)
    setForm({
      name: acc.name, bank_name: acc.bank_name || '', account_number: acc.account_number || '',
      gl_account: acc.gl_account ?? null,
    })
    setError('')
    setDialog(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setError('Please enter an account name.')
      return
    }
    setError('')
    try {
      if (editing) await bankAccountsApi.update(editing.id, form)
      else await bankAccountsApi.create(form)
      setDialog(false)
      await fetchAccounts()
      refreshSummary()
    } catch (err: any) {
      const data = err.response?.data
      setError(
        data?.name?.[0]
        || (data?.gl_account?.[0] ? 'That GL account is already linked to another bank account.' : '')
        || 'Failed to save bank account (name may already exist).',
      )
    }
  }

  const remove = async (acc: BankAccount) => {
    if (!window.confirm(`Delete bank account "${acc.name}"? Its statements and transactions will also be deleted.`)) return
    try {
      await bankAccountsApi.remove(acc.id)
      await fetchAccounts()
      refreshSummary()
    } catch {
      alert('Failed to delete bank account.')
    }
  }

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [existingAccountNames, setExistingAccountNames] = useState<Set<string>>(new Set())

  const openImportDialog = useCallback(async () => {
    try {
      const all = await bankAccountsApi.list()
      setExistingAccountNames(new Set(all.map((a) => a.name.trim().toLowerCase())))
    } catch {
      setExistingAccountNames(new Set())
    }
    setImportDialogOpen(true)
  }, [])

  const parseImportRow = useCallback((raw: Record<string, string>, rowNumber: number) => {
    const name = (raw['account name'] || raw['name'] || '').trim()
    const bank_name = (raw['bank name'] || raw['bank_name'] || '').trim()
    const account_number = (raw['account number'] || raw['account_number'] || '').trim()

    const errors: string[] = []
    if (!name) errors.push('Account Name is required.')

    const label = name || `Row ${rowNumber}`
    if (errors.length > 0) return { data: null, label, errors }

    return {
      data: { name, bank_name, account_number } as { name: string; bank_name: string; account_number: string },
      label,
      errors: [],
    }
  }, [])

  const checkImportDuplicate = useCallback((data: { name: string }, acceptedSoFar: { name: string }[]) => {
    const nameLower = data.name.trim().toLowerCase()
    if (existingAccountNames.has(nameLower)) return 'A bank account with this name already exists.'
    if (acceptedSoFar.some((d) => d.name.trim().toLowerCase() === nameLower)) return 'Duplicate account name within this file.'
    return null
  }, [existingAccountNames])

  const submitImportRows = useCallback(async (accepted: { name: string; bank_name: string; account_number: string }[]) => {
    await bankAccountsApi.bulkCreate(accepted)
  }, [])

  const handleExportExcel = async () => {
    try {
      const all = await bankAccountsApi.list()
      const rows = all.map((acc) => ({
        name: acc.name,
        bank_name: acc.bank_name || '',
        account_number: acc.account_number || '',
        status: acc.is_active ? 'Active' : 'Inactive',
      }))

      const columns = [
        { header: 'Account Name', key: 'name', width: 30 },
        { header: 'Bank Name', key: 'bank_name', width: 25 },
        { header: 'Account Number', key: 'account_number', width: 25 },
        { header: 'Status', key: 'status', width: 15 },
      ]

      await exportToExcel('Bank_Accounts.xlsx', 'Bank Accounts', columns, rows)
    } catch {
      alert('Failed to export bank accounts to Excel.')
    }
  }

  const activeCount = summary?.active ?? 0
  const inactiveCount = summary?.inactive ?? 0

  return (
    <div className="flex flex-col gap-6">
      {/* 1. HEADER & ACTIONS */}
      <PageHeader
        title="Bank accounts"
        description="Bank accounts connected for statement import and reconciliation."
        actions={
          <>
            {canCreate && (
              <Button variant="outlined" icon={<FileSpreadsheet />} onClick={openImportDialog}>
                Import Excel
              </Button>
            )}
            <Button variant="outlined" icon={<Download />} onClick={handleExportExcel}>
              Export
            </Button>
            <IconButton title="Refresh accounts list" onClick={() => { fetchAccounts(); refreshSummary() }} disabled={loading}>
              <RefreshCw className={`h-[18px] w-[18px] stroke-[1.8] ${loading ? 'animate-spin' : ''}`} />
            </IconButton>
            {canCreate && (
              <Button variant="contained" icon={<Plus />} onClick={openCreate}>
                Add bank account
              </Button>
            )}
          </>
        }
      />

      {/* 2. SUMMARY KPI TILES */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile tone="primary" icon={<Landmark />} label="Total accounts" value={summary?.total ?? count} caption="Registered in the system" />
        <KpiTile tone="success" icon={<CheckCircle2 />} label="Active accounts" value={activeCount} caption="Ready for statements" />
        <KpiTile tone="neutral" icon={<PauseCircle />} label="Inactive" value={inactiveCount} caption="Paused or archived" />
        <KpiTile dark icon={<Receipt />} label="Imports ready" value={count > 0 ? 'Active' : 'Setup'} valueClassName="font-display" caption="Statement parsing and reconciliation" />
      </div>

      {/* 3. SEARCH */}
      <SearchBox
        value={search}
        onChange={handleSearchChange}
        placeholder="Search bank accounts by name, bank name, or account number..."
      />

      {/* 4. ACCOUNT CARDS / EMPTY STATE */}
      {loading && accounts.length === 0 ? (
        <div className="flex items-center justify-center p-16">
          <Spinner size={32} />
        </div>
      ) : accounts.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex flex-col rounded-[18px] border border-border bg-surface">
                <div className="flex items-start gap-3.5 p-5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft font-display text-sm font-bold text-primary-hover dark:text-primary">
                    {monogram(acc.bank_name || acc.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-display text-[15px] font-semibold text-ink" title={acc.name}>{acc.name}</p>
                      {acc.is_active ? (
                        <span className="shrink-0 rounded-[20px] bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success-text">Active</span>
                      ) : (
                        <span className="shrink-0 rounded-[20px] bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-muted">Inactive</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-muted">{acc.bank_name || 'Bank name not set'}</p>
                    <p className="num mt-2 text-sm text-ink">
                      {acc.account_number ? <>•••• {acc.account_number.slice(-4)}</> : <span className="font-sans text-[13px] text-muted">No account number</span>}
                    </p>
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-2 border-t border-border-soft px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">GL account</p>
                    {acc.gl_account_name ? (
                      <p className="truncate text-[13px] font-semibold text-ink" title={`${acc.gl_account_name} · ${acc.gl_account_category_name ?? ''}`}>
                        {acc.gl_account_name}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-warning-text">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning" /> Not linked
                      </p>
                    )}
                  </div>
                  {canEdit && <RowAction onClick={() => openEdit(acc)} title="Edit account"><Pencil /></RowAction>}
                  {canDelete && <RowAction danger onClick={() => remove(acc)} title="Delete account"><Trash2 /></RowAction>}
                  {canOpenStatements && (
                    <Button variant="contained" color="secondary" size="sm" icon={<UploadCloud className="h-4 w-4" />} onClick={() => navigate('/bank-statements')}>
                      Statement
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {canCreate && !search && (
              <button
                type="button"
                onClick={openCreate}
                className="flex min-h-[176px] flex-col items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-primary-border bg-primary-soft/40 p-5 text-primary-hover transition-colors hover:bg-primary-soft dark:text-primary"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-primary">
                  <Plus className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold">Add another bank account</span>
              </button>
            )}
          </div>

          {count > 0 && (
            <div className="rounded-[18px] border border-border bg-surface">
              <Pagination
                position="top"
                className="border-0"
                count={count}
                page={page}
                rowsPerPage={rowsPerPage}
                onPageChange={setPage}
                onRowsPerPageChange={(rpp) => {
                  setRowsPerPage(rpp)
                  setPage(0)
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <Panel className="p-0">
          <EmptyState
            icon={<Landmark />}
            title={search ? 'No bank accounts match your search.' : 'No bank accounts added yet.'}
            text={search ? 'Try clearing your search or searching for another keyword.' : canCreate ? 'Get started by connecting your first bank account.' : 'Nothing to show yet.'}
            action={!search && canCreate && (
              <Button variant="contained" icon={<Plus />} onClick={openCreate}>
                Add your first bank account
              </Button>
            )}
          />
        </Panel>
      )}

      {/* 5. ADD / EDIT DIALOG */}
      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        icon={<Landmark />}
        title={editing ? 'Edit bank account' : 'Add bank account'}
        subtitle="Used for statement uploads and bank reconciliation."
        widthClassName="max-w-lg"
        footer={
          <>
            <Button variant="outlined" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="contained" onClick={save}>Save account</Button>
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        <TextField
          id="ba-name"
          label="Account name"
          required
          autoFocus
          placeholder="e.g. HDFC Current A/c 1234"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <TextField
          id="ba-bank"
          label="Bank name (optional)"
          placeholder="e.g. HDFC Bank, ICICI Bank, SBI"
          value={form.bank_name}
          onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
        />
        <TextField
          id="ba-number"
          label="Account number (optional)"
          placeholder="e.g. 50200012345678"
          value={form.account_number}
          onChange={(e) => setForm({ ...form, account_number: e.target.value })}
          inputClassName="num"
        />
        <div>
          <GlAccountSelect
            value={form.gl_account}
            fallbackLabel={editing?.gl_account_name}
            onChange={(id) => setForm({ ...form, gl_account: id })}
            bankAccountId={editing?.id ?? null}
            newLedgerName={form.name}
          />
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            This bank's own ledger in the Chart of Accounts - needed for bank reconciliation and for "Bank" in
            journal imports. Each bank needs a separate ledger; use "Create a new ledger for this bank" at the
            bottom of the list if it doesn't have one yet.
          </p>
        </div>
      </Modal>

      {/* Import Excel Dialog */}
      <ImportExcelDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title="Import Bank Accounts from Excel"
        instructions="One bank account per row. See the column and row guide below."
        itemLabel="bank account"
        templateFilename="bank_accounts_template.xlsx"
        templateColumns={[
          { key: 'name', header: 'Account Name' },
          { key: 'bank_name', header: 'Bank Name' },
          { key: 'account_number', header: 'Account Number' },
        ]}
        templateSampleRows={[
          { name: 'HDFC Operating Account', bank_name: 'HDFC Bank', account_number: '50200012345678' },
          { name: 'ICICI Treasury Account', bank_name: 'ICICI Bank', account_number: '001105987654' },
        ]}
        columnGuide={IMPORT_COLUMN_GUIDE}
        rowGuide={IMPORT_ROW_GUIDE}
        parseRow={parseImportRow}
        checkDuplicate={checkImportDuplicate}
        onSubmit={submitImportRows}
        onImported={() => { fetchAccounts(); refreshSummary() }}
      />
    </div>
  )
}


