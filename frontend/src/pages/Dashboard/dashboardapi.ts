
// import api from '../../api/client'

import { getAuthHeaders, createApiUrl } from '../../access/access'
import axios from 'axios'

export interface BankStatement {
    id: number
    account: number
    account_name?: string
    file: string
    source_type: 'PDF' | 'EXCEL' | 'CSV'
    opening_balance: number | string | null
    closing_balance: number | string | null
    uploaded_at: string
    transaction_count?: number
    duplicate_count?: number
}


export interface DashboardKPIs {
    period: string
    income_total: number | string
    expense_total: number | string
    net_profit: number | string
    is_profit: boolean
    profit_margin: string
    cash_balance: number | string
    accounts_count: number
    /** Same figures for the period right before this one; null for an open-ended range. */
    previous: {
        date_from: string
        date_to: string
        income_total: number | string
        expense_total: number | string
        /** Signed: negative = loss. */
        net_profit: number | string
    } | null
}

export interface DashboardCashPosition {
    accounts: {
        id: number
        name: string
        bank_name?: string | null
        account_number?: string | null
        balance: number | string
    }[]
    total_cash_balance: number | string
}

export interface DashboardAttention {
    uncategorized: { count: number; amount: number | string }
    duplicates: { count: number; amount: number | string }
    unreconciled: { count: number; amount: number | string; older_than_days: number }
    continuity_issues: { count: number; amount: number | string }
    not_auto_categorized: { count: number }
    pending_attention_count: number
}

export type ReconciliationAccountStatus = 'NOT_LINKED' | 'NO_ACTIVITY' | 'UP_TO_DATE' | 'OPEN'

export interface DashboardReconciliationStatus {
    accounts: {
        id: number
        name: string
        bank_name?: string | null
        status: ReconciliationAccountStatus
        /** Last day of the latest signed-off month. */
        locked_through: string | null
        bank_transactions: number
        bank_matched: number
        matched_percent: number | null
        open_bank: number
        open_book: number
    }[]
}

export interface DashboardTopExpenseItem {
    category_id: number
    category_name: string
    total: number | string
}

export interface DashboardTopExpenses {
    top_expenses: DashboardTopExpenseItem[]
    max_expense: number | string
}

export interface CashFlowMonthItem {
    month: string
    month_name: string
    inflow: number
    outflow: number
    net: number
    projected_balance?: number
    is_forecast: boolean
}

export interface DashboardCashFlowForecast {
    historical: CashFlowMonthItem[]
    forecast: CashFlowMonthItem[]
    metrics: {
        current_balance: number
        avg_monthly_inflow: number
        avg_monthly_outflow: number
        avg_net_flow: number
        net_burn_rate: number
        runway_months: number | null
        burn_status: 'SURPLUS' | 'BURNING' | 'NO_DATA'
    }
}

export interface DashboardRecentStatements {
    count: number
    results: BankStatement[]
}

export interface DashboardOverview {
    kpis: DashboardKPIs
    cash_position: DashboardCashPosition
    attention: DashboardAttention
    top_expenses: DashboardTopExpenses
    recent_statements: DashboardRecentStatements
    cash_flow_forecast?: DashboardCashFlowForecast
    reconciliation_status: DashboardReconciliationStatus
}



export const dashboardApi = {
    getOverview: async (params: { period?: string; date_from?: string; date_to?: string; account?: number } = {}): Promise<DashboardOverview> => {
        const response = await axios.get(createApiUrl('/dashboard/overview/'), {
            headers: await getAuthHeaders(),
            params,
        });
        return response.data;
    },

    getCashFlowForecast: async (): Promise<DashboardCashFlowForecast> => {
        const response = await axios.get(createApiUrl('/dashboard/cash-flow-forecast/'), {
            headers: await getAuthHeaders(),
        });
        return response.data;
    },

    getKpis: async (params: { period?: string; date_from?: string; date_to?: string; account?: number } = {}): Promise<DashboardKPIs> => {
        const response = await axios.get(createApiUrl('/dashboard/kpis/'), {
            headers: await getAuthHeaders(),
            params,
        });
        return response.data;
    },
    getCashPosition: async (): Promise<DashboardCashPosition> => {
        const response = await axios.get(createApiUrl('/dashboard/cash-position/'), {
            headers: await getAuthHeaders(),
        });
        return response.data;
    },
    getAttention: async (): Promise<DashboardAttention> => {
        const response = await axios.get(createApiUrl('/dashboard/attention/'), {
            headers: await getAuthHeaders(),
        });
        return response.data;
    },
    getTopExpenses: async (params: { period?: string; limit?: number } = {}): Promise<DashboardTopExpenses> => {
        const response = await axios.get(createApiUrl('/dashboard/top-expenses/'), {
            headers: await getAuthHeaders(),
            params,
        });
        return response.data;
    },
    getReconciliationStatus: async (): Promise<DashboardReconciliationStatus> => {
        const response = await axios.get(createApiUrl('/dashboard/reconciliation-status/'), {
            headers: await getAuthHeaders(),
        });
        return response.data;
    },
    getRecentStatements: async (limit = 5): Promise<DashboardRecentStatements> => {
        const response = await axios.get(createApiUrl('/dashboard/recent-statements/'), {
            headers: await getAuthHeaders(),
            params: { limit },
        });
        return response.data;
    },
}
