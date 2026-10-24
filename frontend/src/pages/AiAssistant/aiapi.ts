import api from '../../api/client'

export interface AiMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** Answers: which service wrote it - "gemini" or "openai". */
  provider: string
  /** Answers: the reports it looked up (tool names). */
  tools: string[]
  created_at: string
}

export interface AiConversation {
  id: number
  title: string
  created_at: string
  updated_at: string
  messages?: AiMessage[]
}

export interface AiStatus {
  enabled: boolean
  providers: string[]
  /** The lookups this user's role allows. */
  tools: string[]
}

export const aiApi = {
  status: async (): Promise<AiStatus> => (await api.get('/ai/status/')).data,
  conversations: async (): Promise<AiConversation[]> => (await api.get('/ai/conversations/')).data.results,
  conversation: async (id: number): Promise<AiConversation> => (await api.get(`/ai/conversations/${id}/`)).data,
  remove: async (id: number): Promise<void> => { await api.delete(`/ai/conversations/${id}/`) },
  /** Asks a question - in a chat, or (no id) in a new one. Returns the chat and the question + answer saved. */
  chat: async (message: string, conversation?: number | null): Promise<{ conversation: AiConversation; messages: AiMessage[] }> =>
    (await api.post('/ai/chat/', { message, conversation: conversation ?? undefined })).data,
}

export const PROVIDER_LABEL: Record<string, string> = { gemini: 'Google Gemini', openai: 'OpenAI' }

export const TOOL_LABEL: Record<string, string> = {
  dashboard_overview: 'Dashboard',
  sales_overview: 'Sales overview',
  profit_and_loss: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
  trial_balance: 'Trial Balance',
  cash_flow: 'Cash Flow',
  gst_summary: 'GST Summary',
  tds_summary: 'TDS Summary',
  receivables_aging: 'Receivables aging',
  payables_aging: 'Payables aging',
  list_sales_invoices: 'Sales invoices',
  list_purchase_bills: 'Purchase bills',
  list_payments: 'Payments',
  find_clients: 'Clients',
  find_suppliers: 'Suppliers',
  stock_summary: 'Stock',
  find_accounts: 'Chart of Accounts',
  account_ledger: 'Account Ledger',
  needs_attention: 'Needs attention',
  cash_flow_forecast: 'Cash Flow Forecast',
  workflow_status: 'Workflow',
  compare_periods: 'Period Comparison',
  gstr1: 'GSTR-1',
  gstr3b: 'GSTR-3B',
  search_transactions: 'General Ledger',
  transactions_summary: 'General Ledger totals',
  search_journal_entries: 'Journal Entries',
  journal_entries_summary: 'Journal Entries totals',
  list_credit_notes: 'Credit / debit notes',
  list_recurring_invoices: 'Recurring invoices',
  find_products: 'Products',
  list_bank_accounts: 'Bank Accounts',
  list_bank_statements: 'Bank Statements',
  statement_continuity: 'Statement Continuity',
  bank_reconciliation: 'Bank Reconciliation',
  reconciliation_months: 'Reconciliation months',
  unmatched_bank_transactions: 'Unmatched bank transactions',
  unmatched_book_lines: 'Unmatched book lines',
  period_close_status: 'Period Close',
  period_close_readiness: 'Period Close readiness',
  chart_of_accounts: 'Chart of Accounts',
  categorization_rules: 'Auto-Categorization Rules',
  bai_codes: 'BAI Codes',
  list_users: 'Users',
  list_roles: 'Roles',
  audit_log: 'Audit Log',
}

/** Starter questions, each shown only when the user's role allows the report it needs. */
export const SUGGESTIONS: { tool: string; text: string }[] = [
  { tool: 'profit_and_loss', text: 'What is our net profit this financial year so far?' },
  { tool: 'list_sales_invoices', text: 'Which sales invoices are overdue, and by how much?' },
  { tool: 'receivables_aging', text: 'Which clients owe us the most?' },
  { tool: 'gst_summary', text: 'How much GST do we have to pay for last month?' },
  { tool: 'dashboard_overview', text: 'What needs my attention this month?' },
  { tool: 'stock_summary', text: 'Which products are below their reorder level?' },
  { tool: 'payables_aging', text: 'Which supplier bills are due or overdue?' },
  { tool: 'search_transactions', text: 'What were our 10 largest payments last month?' },
  { tool: 'compare_periods', text: 'How does this month compare with last month?' },
  { tool: 'cash_flow_forecast', text: 'How many months of cash runway do we have?' },
  { tool: 'workflow_status', text: 'What should I do next?' },
  { tool: 'bank_reconciliation', text: 'Is our main bank account reconciled?' },
]
