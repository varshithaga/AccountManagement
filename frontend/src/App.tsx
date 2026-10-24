import { lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import RequirePage, { HomeRedirect, RequireTestingTools } from './components/RequirePage'
import AuthPage from './pages/AuthPage'
import NotFoundPage from './pages/NotFoundPage'

// Each page is its own chunk, downloaded the first time it is opened.
const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage'))
const CategoriesPage = lazy(() => import('./pages/Categories/CategoriesPage'))
const CategoryKeywordsPage = lazy(() => import('./pages/CategoryKeywords/CategoryKeywordsPage'))
const BaiCodesPage = lazy(() => import('./pages/BaiCodes/BaiCodesPage'))
const BankAccountsPage = lazy(() => import('./pages/BankAccounts/BankAccountsPage'))
const BankStatementsPage = lazy(() => import('./pages/BankStatements/BankStatementsPage'))
const BankStatementDetailPage = lazy(() => import('./pages/BankStatements/BankStatementDetailPage'))
const StatementContinuityPage = lazy(() => import('./pages/BankStatements/StatementContinuityPage'))
const TransactionsPage = lazy(() => import('./pages/Transactions/TransactionsPage'))
const JournalEntriesPage = lazy(() => import('./pages/JournalEntries/JournalEntriesPage'))
const BankReconciliationPage = lazy(() => import('./pages/BankReconciliation/BankReconciliationPage'))
const ProfitAndLossPage = lazy(() => import('./pages/ProfitAndLoss/ProfitAndLossPage'))
const BalanceSheetPage = lazy(() => import('./pages/BalanceSheet/BalanceSheetPage'))
const TrialBalancePage = lazy(() => import('./pages/TrialBalance/TrialBalancePage'))
const ReportsComparisonPage = lazy(() => import('./pages/ReportsComparison/ReportsComparisonPage'))
const CashFlowPage = lazy(() => import('./pages/CashFlow/CashFlowPage'))
const AccountLedgerPage = lazy(() => import('./pages/AccountLedger/AccountLedgerPage'))
const PeriodClosePage = lazy(() => import('./pages/PeriodClose/PeriodClosePage'))
const MenuGuidePage = lazy(() => import('./pages/MenuGuide/MenuGuidePage'))
const WorkflowPage = lazy(() => import('./pages/Workflow/WorkflowPage'))
const UserManagementPage = lazy(() => import('./pages/UserManagement/UserManagementPage'))
const ProfilePage = lazy(() => import('./pages/Profile/ProfilePage'))
const DeleteMonthJournalsPage = lazy(() => import('./pages/TestingTools/DeleteMonthJournalsPage'))
const PartiesPage = lazy(() => import('./pages/Billing/PartiesPage'))
const ProductsPage = lazy(() => import('./pages/Billing/ProductsPage'))
const DocumentsPage = lazy(() => import('./pages/Billing/DocumentsPage'))
const PaymentsPage = lazy(() => import('./pages/Billing/PaymentsPage'))
const ReceivablesPayablesPage = lazy(() => import('./pages/Billing/ReceivablesPayablesPage'))
const GstSummaryPage = lazy(() => import('./pages/GstSummary/GstSummaryPage'))
const TdsSummaryPage = lazy(() => import('./pages/TdsSummary/TdsSummaryPage'))
const InventoryPage = lazy(() => import('./pages/Inventory/InventoryPage'))
const RecurringInvoicesPage = lazy(() => import('./pages/Billing/RecurringInvoicesPage'))
const AuditLogPage = lazy(() => import('./pages/AuditLog/AuditLogPage'))
const AiAssistantPage = lazy(() => import('./pages/AiAssistant/AiAssistantPage'))

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthPage initialMode="login" />} />
          <Route path="/signup" element={<AuthPage initialMode="signup" />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/dashboard" element={<RequirePage page="dashboard"><DashboardPage /></RequirePage>} />
            <Route path="/workflow" element={<RequirePage page="workflow"><WorkflowPage /></RequirePage>} />
            <Route path="/menu-guide" element={<RequirePage page="menu_guide"><MenuGuidePage /></RequirePage>} />
            <Route path="/ai-assistant" element={<RequirePage page="ai_assistant"><AiAssistantPage /></RequirePage>} />
            <Route path="/categories" element={<RequirePage page="categories"><CategoriesPage /></RequirePage>} />
            <Route path="/category-keywords" element={<RequirePage page="category_keywords"><CategoryKeywordsPage /></RequirePage>} />
            <Route path="/bai-codes" element={<RequirePage page="bai_codes"><BaiCodesPage /></RequirePage>} />
            <Route path="/bank-accounts" element={<RequirePage page="bank_accounts"><BankAccountsPage /></RequirePage>} />
            <Route path="/bank-statements" element={<RequirePage page="bank_statements"><BankStatementsPage /></RequirePage>} />
            <Route path="/bank-statements/continuity" element={<RequirePage page="statement_continuity"><StatementContinuityPage /></RequirePage>} />
            <Route path="/bank-statements/:id" element={<RequirePage page="bank_statements"><BankStatementDetailPage /></RequirePage>} />
            <Route path="/transactions" element={<RequirePage page="transactions"><TransactionsPage /></RequirePage>} />
            <Route path="/journal-entries" element={<RequirePage page="journal_entries"><JournalEntriesPage /></RequirePage>} />
            <Route path="/bank-reconciliation" element={<RequirePage page="bank_reconciliation"><BankReconciliationPage /></RequirePage>} />
            <Route path="/period-close" element={<RequirePage page="period_close"><PeriodClosePage /></RequirePage>} />
            <Route path="/clients" element={<RequirePage page="clients"><PartiesPage key="clients" kind="clients" /></RequirePage>} />
            <Route path="/suppliers" element={<RequirePage page="suppliers"><PartiesPage key="suppliers" kind="suppliers" /></RequirePage>} />
            <Route path="/products" element={<RequirePage page="products"><ProductsPage /></RequirePage>} />
            <Route path="/sales-invoices" element={<RequirePage page="sales_invoices"><DocumentsPage key="sales" kind="sales" /></RequirePage>} />
            <Route path="/purchase-bills" element={<RequirePage page="purchase_bills"><DocumentsPage key="purchase" kind="purchase" /></RequirePage>} />
            <Route path="/payments" element={<RequirePage page="payments"><PaymentsPage /></RequirePage>} />
            <Route path="/recurring-invoices" element={<RequirePage page="recurring_invoices"><RecurringInvoicesPage /></RequirePage>} />
            <Route path="/inventory" element={<RequirePage page="inventory"><InventoryPage /></RequirePage>} />
            <Route path="/receivables-payables" element={<RequirePage page="receivables_payables"><ReceivablesPayablesPage /></RequirePage>} />
            <Route path="/cash-flow" element={<RequirePage page="cash_flow"><CashFlowPage /></RequirePage>} />
            <Route path="/account-ledger" element={<RequirePage page="account_ledger"><AccountLedgerPage /></RequirePage>} />
            <Route path="/profit-and-loss" element={<RequirePage page="profit_and_loss"><ProfitAndLossPage /></RequirePage>} />
            <Route path="/balance-sheet" element={<RequirePage page="balance_sheet"><BalanceSheetPage /></RequirePage>} />
            <Route path="/trial-balance" element={<RequirePage page="trial_balance"><TrialBalancePage /></RequirePage>} />
            <Route path="/reports/comparison" element={<RequirePage page="reports_comparison"><ReportsComparisonPage /></RequirePage>} />
            <Route path="/gst-summary" element={<RequirePage page="gst_summary"><GstSummaryPage /></RequirePage>} />
            <Route path="/tds-summary" element={<RequirePage page="tds_summary"><TdsSummaryPage /></RequirePage>} />
            <Route path="/users" element={<RequirePage page="user_management"><UserManagementPage /></RequirePage>} />
            <Route path="/audit-log" element={<RequirePage page="audit_log"><AuditLogPage /></RequirePage>} />
            <Route path="/testing/delete-month-journals" element={<RequireTestingTools><DeleteMonthJournalsPage /></RequireTestingTools>} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
