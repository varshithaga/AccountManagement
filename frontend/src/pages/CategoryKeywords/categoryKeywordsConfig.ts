/** Auto-Categorization Rules page: Excel import template and account-type colours. */
import type { ImportColumnGuide, ImportExcelColumn } from '../../components/ImportExcelDialog'
import type { AccountType } from '../../types'
import type { Tone } from '../../components/tw'

export const TYPE_TONE: Record<AccountType, Tone> = {
  ASSET: 'info',
  LIABILITY: 'warning',
  EQUITY: 'secondary',
  INCOME: 'success',
  EXPENSE: 'error',
}

export interface KeywordImportRow {
  keyword: string
  sub_category: number
  is_active: boolean
  auto_assign: boolean
}

/** Reads a yes/no Excel cell. Blank gives the fallback; an unrecognised value gives null. */
export const parseYesNo = (value: string, fallback: boolean): boolean | null => {
  const v = value.trim().toLowerCase()
  if (!v) return fallback
  if (['true', '1', 'yes', 'y', 'active', 'direct assign', 'direct'].includes(v)) return true
  if (['false', '0', 'no', 'n', 'inactive', 'paused', 'scoring'].includes(v)) return false
  return null
}

export const IMPORT_TEMPLATE_COLUMNS: ImportExcelColumn[] = [
  { key: 'account_type', header: 'Account Type', width: 16 },
  { key: 'category', header: 'Category', width: 22 },
  { key: 'sub_category', header: 'Sub-Category', width: 25 },
  { key: 'keyword', header: 'Keyword / Pattern', width: 25 },
  { key: 'auto_assign', header: 'Auto Assign', width: 14 },
  { key: 'is_active', header: 'Active', width: 12 },
]

export const IMPORT_COLUMN_GUIDE: ImportColumnGuide[] = [
  {
    column: 'Account Type',
    description: 'For your reference only - it is not read on import (the account type comes from the Sub-Category).',
    example: 'EXPENSE',
  },
  {
    column: 'Category',
    description: 'Name of an existing Chart of Accounts category (not case-sensitive). Only needed when the same sub-category name exists under more than one category.',
    example: 'Operating Expenses',
  },
  {
    column: 'Sub-Category', required: true,
    description: 'Name of an existing Chart of Accounts sub-category (not case-sensitive). Transactions matching the keyword are categorized here.',
    example: 'Rent',
  },
  {
    column: 'Keyword / Pattern', required: true,
    description: 'Word or phrase to look for in transaction descriptions, max 200 characters. Matched as a whole word/phrase and not case-sensitive (e.g. "rent" matches "OFFICE RENT JAN" but not "CURRENT"). Must be unique.',
    example: 'office rent',
  },
  {
    column: 'Auto Assign',
    description: 'TRUE = a match assigns this sub-category directly and skips scoring (use for exact vendor names). FALSE = a match only adds points during scoring, alongside other clues. Also accepts YES/NO, Y/N, 1/0. Blank means FALSE.',
    example: 'FALSE',
  },
  {
    column: 'Active',
    description: 'TRUE / FALSE (also YES/NO, Y/N, 1/0). Blank means TRUE. Inactive rules are imported but not used for categorization.',
    example: 'TRUE',
  },
]

export const IMPORT_ROW_GUIDE: string[] = [
  'Row 1 is the header row - keep the column names exactly as in the template. Your data starts from row 2.',
  'One keyword per row. To map several keywords to the same sub-category, add one row for each.',
  'Keywords that already exist, or appear more than once in the file (not case-sensitive), are skipped as duplicates.',
  'Rows with a missing Keyword or Sub-Category, a Sub-Category that is not found in the Chart of Accounts, or an Auto Assign / Active value other than TRUE or FALSE are marked incorrect and not imported.',
  'The sample rows in the template are examples - replace or delete them before importing.',
]

export const IMPORT_TEMPLATE_SAMPLE_ROWS: Record<string, string>[] = [
  { account_type: 'EXPENSE', category: 'Operating Expenses', sub_category: 'Office Rent & Lease', keyword: 'RENT', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Operating Expenses', sub_category: 'Office Rent & Lease', keyword: 'LEASE PAYMENT', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Operating Expenses', sub_category: 'Internet & WiFi', keyword: 'AIRTEL BROADBAND', auto_assign: 'TRUE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Operating Expenses', sub_category: 'Internet & WiFi', keyword: 'ACT FIBERNET', auto_assign: 'TRUE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Software & Tools', sub_category: 'SaaS Subscriptions', keyword: 'AWS EMEA', auto_assign: 'TRUE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Software & Tools', sub_category: 'SaaS Subscriptions', keyword: 'GITHUB', auto_assign: 'TRUE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Software & Tools', sub_category: 'SaaS Subscriptions', keyword: 'SLACK', auto_assign: 'TRUE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Software & Tools', sub_category: 'SaaS Subscriptions', keyword: 'ZOOM.US', auto_assign: 'TRUE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Employee & Staff Costs', sub_category: 'Salaries & Monthly Wages', keyword: 'SALARY DISBURSAL', auto_assign: 'TRUE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Employee & Staff Costs', sub_category: 'Salaries & Monthly Wages', keyword: 'PAYROLL', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Administrative Expenses', sub_category: 'Travel & Conveyance', keyword: 'UBER', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Administrative Expenses', sub_category: 'Travel & Conveyance', keyword: 'OLA CABS', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Administrative Expenses', sub_category: 'Meals & Entertainment', keyword: 'STARBUCKS', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'EXPENSE', category: 'Administrative Expenses', sub_category: 'Meals & Entertainment', keyword: 'SWIGGY', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'INCOME', category: 'Sales & Client Revenue', sub_category: 'Software Service Revenue', keyword: 'CLIENT DEPOSIT', auto_assign: 'FALSE', is_active: 'TRUE' },
  { account_type: 'INCOME', category: 'Sales & Client Revenue', sub_category: 'Software Service Revenue', keyword: 'INVOICE PAYMENT', auto_assign: 'FALSE', is_active: 'TRUE' },
]
