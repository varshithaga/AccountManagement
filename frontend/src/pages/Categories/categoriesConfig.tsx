/** Chart of Accounts page: Excel import template, sample data and the look of each account type. */
import type { ReactNode } from 'react'
import { Landmark, TrendingUp, TrendingDown, PieChart, Receipt } from 'lucide-react'
import type { ImportColumnGuide, ImportExcelColumn } from '../../components/ImportExcelDialog'
import type { AccountType } from '../../types'
import type { Tone } from '../../components/tw'

export interface CategoryImportSubCategory {
  name: string
  code?: string
  description?: string
}

export interface CategoryImportRow {
  category_name: string
  account_type: AccountType
  category_code: string
  category_description: string
  sub_categories: CategoryImportSubCategory[]
}

export interface SampleCategory {
  account_type: AccountType
  code: string
  name: string
  description: string
  /** [code, name, description] */
  subs: [string, string, string][]
}

/** One row per category in the import template, with every sub-category in its own
 * Sub-Category N Code / Sub-Category N / Sub-Category N Description columns. */
export const IMPORT_TEMPLATE_SAMPLE_CATEGORIES: SampleCategory[] = [
  {
    account_type: 'ASSET', code: '1000', name: 'Current Assets',
    description: 'Short-term assets expected to be converted to cash or used within the operating cycle',
    subs: [
      ['1001', 'Cash', 'Physical cash held by the business'],
      ['1002', 'Petty Cash', 'Small cash fund for minor expenses'],
      ['1003', 'Cash on Hand', 'Physical business cash'],
      ['1004', 'Bank Accounts', 'Business bank accounts'],
      ['1005', 'Checking Account', 'Operating checking account'],
      ['1006', 'Savings Account', 'Business savings account'],
      ['1007', 'Current Account', 'Business current account'],
      ['1008', 'Accounts Receivable', 'Amounts owed by customers'],
      ['1009', 'Trade Receivables', 'Customer invoices outstanding'],
      ['1010', 'Customer Receivables', 'Amounts due from customers'],
      ['1011', 'Inventory', 'Goods held for sale or production'],
      ['1012', 'Finished Goods', 'Completed goods ready for sale'],
      ['1013', 'Raw Materials', 'Materials used in production'],
      ['1014', 'Work in Progress', 'Partially completed goods'],
      ['1015', 'Prepaid Expenses', 'Expenses paid before they are incurred'],
      ['1016', 'Prepaid Insurance', 'Insurance paid in advance'],
      ['1017', 'Prepaid Rent', 'Rent paid in advance'],
      ['1018', 'Prepaid Subscriptions', 'Subscriptions paid in advance'],
      ['1019', 'Short-Term Investments', 'Temporary investments'],
      ['1020', 'Marketable Securities', 'Short-term investment holdings'],
      ['1021', 'Employee Advances', 'Amounts recoverable from employees'],
      ['1022', 'Travel Advances', 'Travel funds advanced to employees'],
      ['1023', 'Fixed Deposits (Short-Term)', 'Bank deposits maturing within one year'],
      ['1024', 'Accrued Income', 'Income earned but not yet received'],
      ['1025', 'Unbilled Revenue', 'Work done but not yet invoiced'],
      ['1026', 'Undeposited Funds', 'Receipts not yet deposited in the bank'],
      ['1027', 'Other Current Assets', 'Miscellaneous short-term assets'],
    ],
  },
  {
    account_type: 'ASSET', code: '1050', name: 'Fixed Assets',
    description: 'Long-term physical assets used in business operations',
    subs: [
      ['1051', 'Land', 'Land owned by the business'],
      ['1052', 'Buildings', 'Business buildings'],
      ['1053', 'Office Building', 'Office property'],
      ['1054', 'Equipment', 'Business equipment'],
      ['1055', 'Production Equipment', 'Production machinery'],
      ['1056', 'Office Equipment', 'Office equipment'],
      ['1057', 'Computers', 'Computer hardware'],
      ['1058', 'Laptops', 'Business laptops'],
      ['1059', 'Desktop Computers', 'Business desktops'],
      ['1060', 'Servers', 'Business servers'],
      ['1061', 'Furniture & Fixtures', 'Furniture and fixtures'],
      ['1062', 'Office Furniture', 'Desks, chairs and cabinets'],
      ['1063', 'Vehicles', 'Business vehicles'],
      ['1064', 'Cars', 'Business cars'],
      ['1065', 'Trucks & Vans', 'Business trucks and vans'],
      ['1066', 'Leasehold Improvements', 'Improvements to leased property'],
      ['1067', 'Plant & Machinery', 'Industrial plant and machinery'],
      ['1068', 'Electrical Installations', 'Wiring, fittings and electrical systems'],
      ['1069', 'Air Conditioners', 'Air-conditioning units'],
      ['1070', 'Mobile Phones', 'Business mobile handsets'],
      ['1071', 'Networking Equipment', 'Routers, switches and network hardware'],
      ['1072', 'Printers & Scanners', 'Printing and scanning equipment'],
      ['1073', 'Capital Work in Progress', 'Assets under construction or installation'],
    ],
  },
  {
    account_type: 'ASSET', code: '1100', name: 'Accumulated Depreciation',
    description: 'Contra-assets representing accumulated depreciation',
    subs: [
      ['1101', 'Accumulated Depreciation', 'Total depreciation recorded'],
      ['1102', 'Buildings', 'Building depreciation'],
      ['1103', 'Equipment', 'Equipment depreciation'],
      ['1104', 'Vehicles', 'Vehicle depreciation'],
      ['1105', 'Computers', 'Computer depreciation'],
      ['1106', 'Furniture & Fixtures', 'Furniture and fixtures depreciation'],
      ['1107', 'Office Equipment', 'Office equipment depreciation'],
      ['1108', 'Leasehold Improvements', 'Leasehold improvements depreciation'],
      ['1109', 'Plant & Machinery', 'Plant and machinery depreciation'],
      ['1110', 'Accumulated Amortization', 'Total amortization of intangible assets'],
    ],
  },
  {
    account_type: 'ASSET', code: '1150', name: 'Other Assets',
    description: 'Long-term or miscellaneous assets',
    subs: [
      ['1151', 'Security Deposits', 'Refundable deposits'],
      ['1152', 'Rental Deposits', 'Property rental deposits'],
      ['1153', 'Vendor Deposits', 'Vendor security deposits'],
      ['1154', 'Long-Term Investments', 'Investments held for longer periods'],
      ['1155', 'Equity Investments', 'Long-term equity holdings'],
      ['1156', 'Intangible Assets', 'Non-physical assets'],
      ['1157', 'Software', 'Capitalized software'],
      ['1158', 'Patents', 'Patent rights'],
      ['1159', 'Trademarks', 'Trademark rights'],
      ['1160', 'Other Receivables', 'Amounts receivable other than customer invoices'],
      ['1161', 'Interest Receivable', 'Interest due'],
      ['1162', 'Vendor Advances', 'Amounts paid to vendors in advance'],
      ['1163', 'Goodwill', 'Goodwill from business acquisitions'],
      ['1164', 'Copyrights', 'Copyright rights'],
      ['1165', 'Website Development', 'Capitalized website development costs'],
      ['1166', 'Long-Term Fixed Deposits', 'Bank deposits maturing after one year'],
      ['1167', 'Long-Term Loans & Advances', 'Loans given, recoverable after one year'],
      ['1168', 'Deferred Tax Asset', 'Taxes recoverable in future periods'],
    ],
  },
  {
    account_type: 'ASSET', code: '1200', name: 'Tax Receivables',
    description: 'Taxes paid in advance or recoverable from authorities',
    subs: [
      ['1201', 'Input CGST', 'Central GST paid on purchases'],
      ['1202', 'Input SGST', 'State GST paid on purchases'],
      ['1203', 'Input IGST', 'Integrated GST paid on purchases'],
      ['1204', 'TDS Receivable', 'Tax deducted by customers, claimable'],
      ['1205', 'Advance Income Tax', 'Income tax paid in advance'],
      ['1206', 'GST Refund Receivable', 'GST refunds due from authorities'],
    ],
  },
  {
    account_type: 'LIABILITY', code: '2000', name: 'Current Liabilities',
    description: 'Short-term obligations normally due within one operating cycle',
    subs: [
      ['2001', 'Accounts Payable', 'Amounts owed to suppliers'],
      ['2002', 'Trade Payables', 'Supplier invoices outstanding'],
      ['2003', 'Vendor Payables', 'Amounts due to vendors'],
      ['2004', 'Salaries Payable', 'Employee compensation accrued but unpaid'],
      ['2005', 'GST Payable', 'GST collected or due to authorities'],
      ['2006', 'Output GST', 'GST charged on sales'],
      ['2007', 'Input GST Payable', 'GST-related payable balance'],
      ['2008', 'TDS Payable', 'Tax deducted at source payable'],
      ['2009', 'Sales Tax Payable', 'Sales tax collected and payable'],
      ['2010', 'Payroll Taxes Payable', 'Payroll-related taxes payable'],
      ['2011', 'Customer Advances', 'Money received before goods/services are delivered'],
      ['2012', 'Deferred Revenue', 'Revenue received before it is earned'],
      ['2013', 'Subscription Revenue', 'Prepaid subscription revenue'],
      ['2014', 'Accrued Expenses', 'Expenses incurred but not yet paid'],
      ['2015', 'Interest Payable', 'Interest accrued'],
      ['2016', 'Utilities Payable', 'Utilities accrued'],
      ['2017', 'Credit Cards Payable', 'Outstanding business credit card balances'],
      ['2018', 'Business Credit Card', 'Business card balance'],
      ['2019', 'Short-Term Loans', 'Borrowings due within one year'],
      ['2020', 'Bonus Payable', 'Employee bonuses accrued but unpaid'],
      ['2021', 'PF Payable', 'Provident fund contributions payable'],
      ['2022', 'ESI Payable', 'Employee state insurance contributions payable'],
      ['2023', 'Professional Tax Payable', 'Professional tax deducted and payable'],
      ['2024', 'Rent Payable', 'Rent accrued but unpaid'],
      ['2025', 'Audit Fees Payable', 'Audit fees accrued but unpaid'],
      ['2026', 'Dividend Payable', 'Dividends declared but unpaid'],
      ['2027', 'Current Portion of Long-Term Debt', 'Loan repayments due within one year'],
      ['2028', 'Bank Overdraft', 'Overdrawn bank balance'],
      ['2029', 'Cash Credit', 'Cash credit facility from bank'],
    ],
  },
  {
    account_type: 'LIABILITY', code: '2050', name: 'Long-Term Liabilities',
    description: 'Obligations due after one year',
    subs: [
      ['2051', 'Bank Loans', 'Loans from banks'],
      ['2052', 'Term Loan', 'Long-term bank term loan'],
      ['2053', 'Business Loans', 'Business borrowings'],
      ['2054', 'Working Capital Loan', 'Working capital borrowing'],
      ['2055', 'Long-Term Borrowings', 'Long-term debt obligations'],
      ['2056', 'Lease Liabilities', 'Lease obligations'],
      ['2057', 'Equipment Lease', 'Equipment lease liability'],
      ['2058', 'Vehicle Loan', 'Loan taken to buy vehicles'],
      ['2059', 'Mortgage Loan', 'Loan secured against property'],
      ['2060', 'Loans from Directors', 'Borrowings from directors or partners'],
      ['2061', 'Debentures', 'Debentures issued'],
      ['2062', 'Deferred Tax Liability', 'Taxes payable in future periods'],
      ['2063', 'Security Deposits Received', 'Refundable deposits received from customers or tenants'],
    ],
  },
  {
    account_type: 'LIABILITY', code: '2100', name: 'Other Liabilities',
    description: 'Miscellaneous obligations',
    subs: [
      ['2101', 'Deferred Revenue', 'Unearned revenue'],
      ['2102', 'Other Payables', 'Miscellaneous amounts payable'],
      ['2103', 'Provisions', 'Estimated future obligations'],
      ['2104', 'Provision for Tax', 'Estimated tax obligation'],
      ['2105', 'Provision for Gratuity', 'Estimated gratuity obligation'],
      ['2106', 'Provision for Leave Encashment', 'Estimated leave encashment obligation'],
      ['2107', 'Provision for Bonus', 'Estimated bonus obligation'],
      ['2108', 'Suspense Account', 'Temporary holding account for unidentified items'],
    ],
  },
  {
    account_type: 'LIABILITY', code: '2150', name: 'Duties & Taxes',
    description: 'Taxes collected or deducted and payable to authorities',
    subs: [
      ['2151', 'Output CGST', 'Central GST collected on sales'],
      ['2152', 'Output SGST', 'State GST collected on sales'],
      ['2153', 'Output IGST', 'Integrated GST collected on sales'],
      ['2154', 'TDS on Salary', 'Tax deducted from salaries'],
      ['2155', 'TDS on Contractors', 'Tax deducted from contractor payments'],
      ['2156', 'TDS on Professional Fees', 'Tax deducted from professional fees'],
      ['2157', 'Income Tax Payable', 'Income tax due to authorities'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3000', name: 'Owner\'s Equity',
    description: 'Owner\'s ownership interest in the business',
    subs: [
      ['3001', 'Owner Capital', 'Capital contributed by owner'],
      ['3002', 'Additional Capital', 'Additional owner investment'],
      ['3003', 'Partner Capital', 'Capital contributed by partners'],
      ['3004', 'Capital Introduced', 'Fresh capital brought in during the year'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3050', name: 'Drawings',
    description: 'Amounts withdrawn by owners',
    subs: [
      ['3051', 'Owner Drawings', 'Money or assets withdrawn by owner'],
      ['3052', 'Personal Withdrawals', 'Owner personal withdrawals'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3100', name: 'Retained Earnings',
    description: 'Accumulated profits retained in the business',
    subs: [
      ['3101', 'Retained Earnings', 'Accumulated retained profits'],
      ['3102', 'Prior Period Adjustments', 'Corrections relating to earlier periods'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3150', name: 'Share Capital',
    description: 'Capital contributed by shareholders',
    subs: [
      ['3151', 'Common Stock', 'Common shares issued'],
      ['3152', 'Preferred Stock', 'Preferred shares issued'],
      ['3153', 'Equity Share Capital', 'Equity shares issued and paid up'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3200', name: 'Additional Paid-In Capital',
    description: 'Capital received above stated share value',
    subs: [
      ['3201', 'Paid-In Capital', 'Additional shareholder contributions'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3250', name: 'Current Year Earnings',
    description: 'Current-period profit or loss',
    subs: [
      ['3251', 'Current Year Profit', 'Current-period net income'],
      ['3252', 'Current Year Loss', 'Current-period net loss'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3300', name: 'Treasury Stock',
    description: 'Company shares repurchased by the company',
    subs: [
      ['3301', 'Treasury Shares', 'Repurchased company shares'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3350', name: 'Reserves & Surplus',
    description: 'Profits and premiums set aside in reserves',
    subs: [
      ['3351', 'General Reserve', 'Profits transferred to general reserve'],
      ['3352', 'Securities Premium', 'Amount received above share face value'],
      ['3353', 'Capital Reserve', 'Reserve from capital gains'],
      ['3354', 'Revaluation Reserve', 'Gain from revaluing assets'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3400', name: 'Opening Balance Equity',
    description: 'Balancing account for opening balances when starting the books',
    subs: [
      ['3401', 'Opening Balance Equity', 'Offset for opening balances entered'],
    ],
  },
  {
    account_type: 'EQUITY', code: '3450', name: 'Dividends',
    description: 'Profits distributed to shareholders',
    subs: [
      ['3451', 'Interim Dividend', 'Dividend paid during the year'],
      ['3452', 'Final Dividend', 'Dividend declared at year end'],
    ],
  },
  {
    account_type: 'INCOME', code: '4000', name: 'Operating Revenue',
    description: 'Revenue generated from normal business operations',
    subs: [
      ['4001', 'Product Sales', 'Revenue from product sales'],
      ['4002', 'Retail Sales', 'Retail product revenue'],
      ['4003', 'Wholesale Sales', 'Wholesale product revenue'],
      ['4004', 'Service Revenue', 'Revenue from services'],
      ['4005', 'Professional Services', 'Professional service revenue'],
      ['4006', 'Other Sales', 'Other product or operating sales'],
      ['4007', 'Export Sales', 'Revenue from sales outside the country'],
      ['4008', 'Online Sales', 'Revenue from e-commerce sales'],
      ['4009', 'Installation Revenue', 'Revenue from installation services'],
      ['4010', 'Maintenance & Support Revenue', 'Revenue from maintenance and support contracts'],
    ],
  },
  {
    account_type: 'INCOME', code: '4050', name: 'Consulting Revenue',
    description: 'Revenue earned from consulting services',
    subs: [
      ['4051', 'IT Consulting', 'Revenue from IT consulting services'],
      ['4052', 'Software Consulting', 'Revenue from software development and consulting'],
      ['4053', 'Business Consulting', 'Business advisory revenue'],
      ['4054', 'Management Consulting', 'Management consulting revenue'],
      ['4055', 'Training Revenue', 'Revenue from training services'],
      ['4056', 'Implementation Services', 'Revenue from implementation projects'],
    ],
  },
  {
    account_type: 'INCOME', code: '4100', name: 'Subscription Revenue',
    description: 'Recurring subscription revenue',
    subs: [
      ['4101', 'Monthly Subscriptions', 'Monthly subscription income'],
      ['4102', 'Annual Subscriptions', 'Annual subscription income'],
      ['4103', 'Quarterly Subscriptions', 'Quarterly subscription income'],
      ['4104', 'License Fees', 'Software or content license income'],
      ['4105', 'Usage-Based Billing', 'Revenue billed on usage'],
    ],
  },
  {
    account_type: 'INCOME', code: '4150', name: 'Rental Income',
    description: 'Revenue earned from renting assets',
    subs: [
      ['4151', 'Property Rental', 'Property rental income'],
      ['4152', 'Equipment Rental', 'Equipment rental income'],
      ['4153', 'Vehicle Rental', 'Vehicle rental income'],
    ],
  },
  {
    account_type: 'INCOME', code: '4200', name: 'Commission Income',
    description: 'Income earned from commissions',
    subs: [
      ['4201', 'Sales Commission', 'Commission received from sales'],
      ['4202', 'Referral Commission', 'Commission received for referrals'],
      ['4203', 'Agency Commission', 'Commission received as an agent'],
    ],
  },
  {
    account_type: 'INCOME', code: '4250', name: 'Other Income',
    description: 'Income outside primary operating activities',
    subs: [
      ['4251', 'Commission Income', 'Commission received'],
      ['4252', 'Discount Received', 'Discounts received from suppliers'],
      ['4253', 'Scrap Sales', 'Income from sale of scrap'],
      ['4254', 'Insurance Claims Received', 'Insurance claim settlements'],
      ['4255', 'Foreign Exchange Gain', 'Gain from foreign currency movements'],
      ['4256', 'Late Payment Charges Received', 'Interest or penalties charged to customers'],
      ['4257', 'Bad Debts Recovered', 'Recovery of debts previously written off'],
      ['4258', 'Government Grants', 'Grants and subsidies received'],
      ['4259', 'Interest Income', 'Interest received (BAI interest codes map here)'],
    ],
  },
  {
    account_type: 'INCOME', code: '4300', name: 'Interest Income',
    description: 'Interest earned on deposits or investments',
    subs: [
      ['4301', 'Bank Interest', 'Interest earned on bank deposits'],
      ['4302', 'Investment Interest', 'Interest from investments'],
      ['4303', 'Fixed Deposit Interest', 'Interest earned on fixed deposits'],
      ['4304', 'Interest on Loans Given', 'Interest earned on loans given'],
      ['4305', 'Interest on Tax Refund', 'Interest received on tax refunds'],
    ],
  },
  {
    account_type: 'INCOME', code: '4350', name: 'Dividend Income',
    description: 'Dividends received from investments',
    subs: [
      ['4351', 'Investment Dividends', 'Dividend income'],
      ['4352', 'Mutual Fund Dividends', 'Dividends from mutual funds'],
    ],
  },
  {
    account_type: 'INCOME', code: '4400', name: 'Gain on Asset Sale',
    description: 'Gain arising from disposal of assets',
    subs: [
      ['4401', 'Fixed Asset Gain', 'Gain on disposal of fixed assets'],
      ['4402', 'Investment Gain', 'Gain on sale of investments'],
    ],
  },
  {
    account_type: 'INCOME', code: '4450', name: 'Other Revenue',
    description: 'Miscellaneous operating revenue',
    subs: [
      ['4451', 'Other Revenue', 'Miscellaneous business revenue'],
    ],
  },
  {
    account_type: 'INCOME', code: '4500', name: 'Sales Returns & Discounts',
    description: 'Reductions in revenue for returns and discounts given',
    subs: [
      ['4501', 'Sales Returns', 'Goods returned by customers'],
      ['4502', 'Discounts Allowed', 'Discounts given to customers'],
      ['4503', 'Sales Allowances', 'Price reductions after sale'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5000', name: 'Cost of Goods Sold',
    description: 'Direct costs associated with goods sold',
    subs: [
      ['5001', 'Purchases', 'Goods purchased for resale'],
      ['5002', 'Raw Materials', 'Materials used in production'],
      ['5003', 'Direct Labour', 'Labor directly attributable to production'],
      ['5004', 'Freight Inward', 'Freight and shipping on purchases'],
      ['5005', 'Packaging', 'Product packaging directly attributable to goods'],
      ['5006', 'Customs & Import Duty', 'Duties paid on imported goods'],
      ['5007', 'Subcontracting Charges', 'Work outsourced for production'],
      ['5008', 'Production Supplies', 'Consumables used in production'],
      ['5009', 'Manufacturing Overheads', 'Factory overhead costs'],
      ['5010', 'Purchase Returns', 'Goods returned to suppliers'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5050', name: 'Cost of Services',
    description: 'Direct costs associated with services delivered',
    subs: [
      ['5051', 'Direct Labour', 'Labor directly related to service delivery'],
      ['5052', 'Contractors', 'External contractors used for service delivery'],
      ['5053', 'Client Hosting Costs', 'Hosting costs for client projects'],
      ['5054', 'Third-Party Software for Clients', 'Software bought for client delivery'],
      ['5055', 'Project Expenses', 'Other direct project costs'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5100', name: 'Administrative Expenses',
    description: 'General administrative and office expenses',
    subs: [
      ['5101', 'Accounting Fees', 'Accounting and bookkeeping fees'],
      ['5102', 'Legal Fees', 'Legal services and legal advice'],
      ['5103', 'Professional Fees', 'Professional advisory fees'],
      ['5104', 'Office Supplies', 'General office consumables'],
      ['5105', 'Advertisement', 'Advertising costs'],
      ['5106', 'AWS', 'AWS cloud infrastructure expenses'],
      ['5107', 'Cloud Services', 'Cloud hosting and infrastructure'],
      ['5108', 'Bank Administration', 'Administrative bank costs'],
      ['5109', 'Printing & Stationery', 'Printing and stationery costs'],
      ['5110', 'Postage & Courier', 'Postage and courier charges'],
      ['5111', 'Office Maintenance', 'General office upkeep'],
      ['5112', 'Memberships & Subscriptions', 'Professional memberships and subscriptions'],
      ['5113', 'Books & Periodicals', 'Books, newspapers and journals'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5150', name: 'Operating Expenses',
    description: 'General costs required to operate the business',
    subs: [
      ['5151', 'Rent', 'Office or premises rent'],
      ['5152', 'Electricity', 'Electricity expense'],
      ['5153', 'Water', 'Water expense'],
      ['5154', 'AC', 'Air-conditioning expense'],
      ['5155', 'Insurance', 'Business insurance'],
      ['5156', 'Internet', 'Internet service expense'],
      ['5157', 'Broadband', 'Internet connection charges'],
      ['5158', 'Office Supplies', 'Office consumables'],
      ['5159', 'Repairs & Maintenance', 'Repairs and maintenance'],
      ['5160', 'Salaries', 'Employee salaries'],
      ['5161', 'Team Lunch', 'Team meals and lunch'],
      ['5162', 'Cloud Services', 'Cloud service costs'],
      ['5163', 'Pantry Expenses', 'Tea, coffee and office refreshments'],
      ['5164', 'Housekeeping', 'Housekeeping services'],
      ['5165', 'Generator Fuel', 'Diesel for power backup'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5200', name: 'Selling & Marketing Expenses',
    description: 'Costs of selling and marketing',
    subs: [
      ['5201', 'Advertising', 'Advertising expenses'],
      ['5202', 'Marketing', 'Marketing expenses'],
      ['5203', 'Promotion Expenses', 'Promotional activities'],
      ['5204', 'Sales Commission', 'Sales commissions'],
      ['5205', 'Digital Advertising', 'Online advertising'],
      ['5206', 'Social Media Advertising', 'Social media advertising'],
      ['5207', 'Events & Sponsorships', 'Marketing events and sponsorships'],
      ['5208', 'Freight Outward', 'Shipping costs on sales'],
      ['5209', 'Trade Shows', 'Exhibition and trade show costs'],
      ['5210', 'Customer Gifts', 'Gifts to customers'],
      ['5211', 'Brochures & Printing', 'Marketing print material'],
      ['5212', 'SEO Services', 'Search engine optimisation services'],
      ['5213', 'Affiliate Commission', 'Commission paid to affiliates'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5250', name: 'Financial Expenses',
    description: 'Banking, payment and financing costs',
    subs: [
      ['5251', 'Bank Charges', 'Bank service charges'],
      ['5252', 'Loan Interest', 'Interest on loans'],
      ['5253', 'Payment Gateway Charges', 'Payment gateway processing fees'],
      ['5254', 'Credit Card Fees', 'Credit card processing charges'],
      ['5255', 'Foreign Exchange Loss', 'Loss from foreign currency movements'],
      ['5256', 'Loan Processing Fees', 'Fees charged on loans'],
      ['5257', 'Overdraft Interest', 'Interest on overdraft and cash credit'],
      ['5258', 'Late Payment Penalties', 'Penalties for late payments'],
      ['5259', 'Cheque Bounce Charges', 'Charges for returned cheques'],
      ['5260', 'Forex Conversion Charges', 'Currency conversion charges'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5300', name: 'Software & Tools',
    description: 'SaaS subscriptions and software licenses',
    subs: [
      ['5301', 'SaaS Subscriptions', 'Recurring software and online service subscriptions'],
      ['5302', 'Business Software', 'Software used for business operations'],
      ['5303', 'Software Licenses', 'Purchased software licenses'],
      ['5304', 'Developer Tools', 'Development tools and services'],
      ['5305', 'Cloud Hosting', 'Cloud hosting subscriptions'],
      ['5306', 'Domain & Website Hosting', 'Domain names and website hosting'],
      ['5307', 'Email Services', 'Business email services'],
      ['5308', 'Antivirus & Security', 'Security software'],
      ['5309', 'Design Tools', 'Design and creative software'],
      ['5310', 'Collaboration Tools', 'Team communication and collaboration software'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5350', name: 'Payroll Expenses',
    description: 'Employee compensation and related costs',
    subs: [
      ['5351', 'Salaries', 'Employee salary expense'],
      ['5352', 'Wages', 'Hourly or temporary wages'],
      ['5353', 'Bonuses', 'Employee bonuses'],
      ['5354', 'Employee Benefits', 'Employee benefits'],
      ['5355', 'Health Insurance', 'Employee health insurance'],
      ['5356', 'Retirement Benefits', 'Retirement contributions'],
      ['5357', 'Payroll Taxes', 'Employer payroll taxes'],
      ['5358', 'Overtime', 'Overtime pay'],
      ['5359', 'Provident Fund Contribution', 'Employer provident fund contribution'],
      ['5360', 'ESI Contribution', 'Employer ESI contribution'],
      ['5361', 'Gratuity', 'Gratuity expense'],
      ['5362', 'Leave Encashment', 'Leave encashment expense'],
      ['5363', 'Staff Welfare', 'Employee welfare costs'],
      ['5364', 'Contract Staff', 'Temporary and contract staff costs'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5400', name: 'Travel & Transportation',
    description: 'Business travel and transportation',
    subs: [
      ['5401', 'Airfare', 'Business flights'],
      ['5402', 'Hotel & Lodging', 'Business accommodation'],
      ['5403', 'Taxi & Rideshare', 'Business taxi and rideshare'],
      ['5404', 'Local Transportation', 'Local business transportation'],
      ['5405', 'Mileage', 'Business mileage reimbursement'],
      ['5406', 'Parking & Tolls', 'Parking and toll expenses'],
      ['5407', 'Meals While Travelling', 'Meals during business travel'],
      ['5408', 'Train & Bus Fares', 'Rail and bus travel'],
      ['5409', 'Visa & Passport Fees', 'Visa and passport charges'],
      ['5410', 'Travel Insurance', 'Insurance for business trips'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5450', name: 'Occupancy Expenses',
    description: 'Costs of premises and facilities',
    subs: [
      ['5451', 'Office Rent', 'Office rental expense'],
      ['5452', 'Warehouse Rent', 'Warehouse rental expense'],
      ['5453', 'Utilities', 'Utility costs'],
      ['5454', 'Cleaning', 'Cleaning and janitorial costs'],
      ['5455', 'Security', 'Security services'],
      ['5456', 'Repairs & Maintenance', 'Premises repairs and maintenance'],
      ['5457', 'Building Maintenance Charges', 'Society or building maintenance charges'],
      ['5458', 'Pest Control', 'Pest control services'],
      ['5459', 'Co-working Space', 'Co-working space fees'],
      ['5460', 'Property Insurance', 'Insurance on premises'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5500', name: 'Professional Services',
    description: 'External professional service costs',
    subs: [
      ['5501', 'Legal Fees', 'Legal services'],
      ['5502', 'Accounting Fees', 'Accounting and bookkeeping services'],
      ['5503', 'Consulting Fees', 'External consulting services'],
      ['5504', 'Audit Fees', 'Audit services'],
      ['5505', 'Recruitment Fees', 'Recruitment agency fees'],
      ['5506', 'IT Services', 'External IT services'],
      ['5507', 'Company Secretary Fees', 'Company secretarial services'],
      ['5508', 'Tax Consultancy', 'Tax advisory and filing services'],
      ['5509', 'Valuation Fees', 'Asset or business valuation fees'],
      ['5510', 'Notary & Documentation', 'Notary and documentation charges'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5550', name: 'Taxes & Licenses',
    description: 'Business taxes, permits and licenses',
    subs: [
      ['5551', 'Business Taxes', 'Business-related taxes'],
      ['5552', 'GST', 'GST-related expense'],
      ['5553', 'TDS', 'Tax-related charges where applicable'],
      ['5554', 'Property Tax', 'Property taxes'],
      ['5555', 'Licenses & Permits', 'Government licenses and permits'],
      ['5556', 'Registration Fees', 'Business registration fees'],
      ['5557', 'Stamp Duty', 'Stamp duty on documents'],
      ['5558', 'Professional Tax', 'Professional tax paid by the business'],
      ['5559', 'Trade License', 'Trade license fees'],
      ['5560', 'GST Late Fees', 'Late fees for GST filings'],
      ['5561', 'Interest on Late Tax Payment', 'Interest on delayed tax payments'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5600', name: 'Depreciation & Amortization',
    description: 'Non-cash allocation of asset costs',
    subs: [
      ['5601', 'Depreciation', 'Depreciation of fixed assets'],
      ['5602', 'Equipment Depreciation', 'Equipment depreciation'],
      ['5603', 'Vehicle Depreciation', 'Vehicle depreciation'],
      ['5604', 'Computer Depreciation', 'Computer depreciation'],
      ['5605', 'Amortization', 'Amortization of intangible assets'],
      ['5606', 'Software Amortization', 'Software amortization'],
      ['5607', 'Building Depreciation', 'Building depreciation'],
      ['5608', 'Furniture Depreciation', 'Furniture and fixtures depreciation'],
      ['5609', 'Leasehold Amortization', 'Amortization of leasehold improvements'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5650', name: 'Other Expenses',
    description: 'Other business expenses',
    subs: [
      ['5651', 'Bad Debt Expense', 'Uncollectible customer balances'],
      ['5652', 'Miscellaneous Expense', 'Miscellaneous business expenses'],
      ['5653', 'Loss on Asset Sale', 'Loss on disposal of fixed assets'],
      ['5654', 'Foreign Exchange Loss', 'Foreign currency losses'],
      ['5655', 'Donations', 'Business donations'],
      ['5656', 'Penalties & Fines', 'Penalties and fines paid'],
      ['5657', 'Inventory Write-off', 'Damaged or obsolete stock written off'],
      ['5658', 'Prior Period Expenses', 'Expenses relating to earlier periods'],
      ['5659', 'Round Off', 'Small rounding differences'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5700', name: 'Vehicle Expenses',
    description: 'Running costs of company vehicles',
    subs: [
      ['5701', 'Fuel', 'Petrol and diesel for company vehicles'],
      ['5702', 'Vehicle Repairs', 'Vehicle servicing and repairs'],
      ['5703', 'Vehicle Insurance', 'Insurance on company vehicles'],
      ['5704', 'Vehicle Registration & Tax', 'Road tax and registration'],
      ['5705', 'Driver Salary', 'Salaries of drivers'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5750', name: 'Communication Expenses',
    description: 'Telephone, mobile and data costs',
    subs: [
      ['5751', 'Telephone', 'Landline charges'],
      ['5752', 'Mobile Phone Bills', 'Mobile phone charges'],
      ['5753', 'Data Cards', 'Mobile data and dongles'],
      ['5754', 'Video Conferencing', 'Video conferencing services'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5800', name: 'Research & Development',
    description: 'Costs of developing new products and services',
    subs: [
      ['5801', 'R&D Salaries', 'Salaries of research staff'],
      ['5802', 'Prototyping', 'Prototype building costs'],
      ['5803', 'Testing & Certification', 'Product testing and certification'],
      ['5804', 'Lab Supplies', 'Laboratory consumables'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5850', name: 'Insurance Expenses',
    description: 'Business insurance premiums',
    subs: [
      ['5851', 'General Liability Insurance', 'Public and general liability cover'],
      ['5852', 'Fire Insurance', 'Fire and allied perils cover'],
      ['5853', 'Cyber Insurance', 'Cyber risk cover'],
      ['5854', 'Key Person Insurance', 'Cover on key employees'],
      ['5855', 'Directors & Officers Insurance', 'D&O liability cover'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5900', name: 'Training & Education',
    description: 'Employee learning and development',
    subs: [
      ['5901', 'Employee Training', 'Training programmes for staff'],
      ['5902', 'Certification Courses', 'Professional certification fees'],
      ['5903', 'Conferences & Seminars', 'Conference and seminar fees'],
    ],
  },
  {
    account_type: 'EXPENSE', code: '5950', name: 'Income Tax Expense',
    description: 'Tax on the profits of the business',
    subs: [
      ['5951', 'Current Tax', 'Income tax for the current year'],
      ['5952', 'Deferred Tax', 'Deferred tax charge'],
      ['5953', 'Tax for Earlier Years', 'Tax adjustments for previous years'],
    ],
  },
]

/** The Code / Name / Description column trio for sub-categories 1..count. */
export const subCategoryColumns = (count: number): ImportExcelColumn[] =>
  Array.from({ length: count }, (_, i) => [
    { key: `sub_category_${i + 1}_code`, header: `Sub-Category ${i + 1} Code`, width: 18 },
    { key: `sub_category_${i + 1}`, header: `Sub-Category ${i + 1}`, width: 20 },
    { key: `sub_category_${i + 1}_description`, header: `Sub-Category ${i + 1} Description`, width: 30 },
  ]).flat()

/** Flattens a category and its sub-categories into one spreadsheet row. */
export const subCategoryCells = (subs: { code?: string | null; name: string; description?: string | null }[]) =>
  Object.fromEntries(subs.flatMap((s, i) => [
    [`sub_category_${i + 1}_code`, s.code || ''],
    [`sub_category_${i + 1}`, s.name],
    [`sub_category_${i + 1}_description`, s.description || ''],
  ]))

export const IMPORT_TEMPLATE_COLUMNS: ImportExcelColumn[] = [
  { key: 'account_type', header: 'Account Type', width: 16 },
  { key: 'code', header: 'Category Code', width: 14 },
  { key: 'name', header: 'Category', width: 22 },
  { key: 'description', header: 'Category Description', width: 30 },
  ...subCategoryColumns(Math.max(...IMPORT_TEMPLATE_SAMPLE_CATEGORIES.map((c) => c.subs.length))),
]

export const IMPORT_COLUMN_GUIDE: ImportColumnGuide[] = [
  {
    column: 'Account Type', required: true,
    description: 'One of Asset, Liability, Equity, Income or Expense (the upper-case value, e.g. ASSET, also works). Not case-sensitive.',
    example: 'ASSET',
  },
  {
    column: 'Category Code',
    description: 'Account code for the category. Must be unique across all categories; max 20 characters. Suggested ranges: Assets 1000-1999, Liabilities 2000-2999, Equity 3000-3999, Income 4000-4999, Expenses 5000-5999.',
    example: '1000',
  },
  {
    column: 'Category', required: true,
    description: 'Category name, max 150 characters. If a category with this name already exists for the same Account Type (not case-sensitive), it is reused.',
    example: 'Current Assets',
  },
  { column: 'Category Description', description: 'Free text describing the category.', example: 'Short-term assets' },
  {
    column: 'Sub-Category N Code',
    description: 'Account code for sub-category N. Must be unique across all sub-categories; max 20 characters.',
    example: '1001',
  },
  {
    column: 'Sub-Category N',
    description: 'Name of sub-category N under this category, max 150 characters. Leave empty if not needed. N is 1, 2, 3 ... as many as you need.',
    example: 'Cash',
  },
  { column: 'Sub-Category N Description', description: 'Free text describing sub-category N.', example: 'Physical cash held' },
]

export const IMPORT_ROW_GUIDE: string[] = [
  'Row 1 is the header row - keep the column names exactly as in the template. Your data starts from row 2.',
  'Put one category per row, with all of its sub-categories in the same row: Sub-Category 1 Code / Sub-Category 1 / Sub-Category 1 Description, then Sub-Category 2 ..., and so on.',
  'Need more sub-categories than the template has columns? Add another set of three columns with the next number (e.g. Sub-Category 23 Code, Sub-Category 23, Sub-Category 23 Description).',
  'Existing categories and sub-categories are matched by name (not case-sensitive) and reused - only new ones are created. Codes are only applied to newly created records.',
  'A row whose category and sub-categories all already exist adds nothing and is skipped as a duplicate.',
  'The sample rows in the template are examples - replace or delete them before importing.',
  'If any code is already used or repeated in the file, the whole import is cancelled and nothing is saved.',
]

export const IMPORT_TEMPLATE_SAMPLE_ROWS: Record<string, string>[] = IMPORT_TEMPLATE_SAMPLE_CATEGORIES.map((c) => ({
  account_type: c.account_type,
  code: c.code,
  name: c.name,
  description: c.description,
  ...subCategoryCells(c.subs.map(([code, name, description]) => ({ code, name, description }))),
}))

export interface TypeConfig {
  value: AccountType
  label: string
  pluralLabel: string
  codeRange: string
  desc: string
  tone: Tone
  icon: ReactNode
  border: string
  bg: string
  text: string
  iconBg: string
}

export const TYPE_CONFIGS: Record<AccountType, TypeConfig> = {
  ASSET: {
    value: 'ASSET', label: 'Asset', pluralLabel: 'Assets', codeRange: '1000–1999',
    desc: 'What the business owns or is owed', tone: 'info', icon: <Landmark className="h-4 w-4" />,
    border: 'border-info', bg: 'bg-info-soft', text: 'text-info-text', iconBg: 'bg-info-soft',
  },
  LIABILITY: {
    value: 'LIABILITY', label: 'Liability', pluralLabel: 'Liabilities', codeRange: '2000–2999',
    desc: 'What the business owes to third parties', tone: 'warning', icon: <Receipt className="h-4 w-4" />,
    border: 'border-caution', bg: 'bg-caution-soft', text: 'text-caution-text', iconBg: 'bg-caution-soft',
  },
  EQUITY: {
    value: 'EQUITY', label: 'Equity', pluralLabel: 'Equity', codeRange: '3000–3999',
    desc: "The owner's stake in the business", tone: 'secondary', icon: <PieChart className="h-4 w-4" />,
    border: 'border-equity', bg: 'bg-equity-soft', text: 'text-equity-text', iconBg: 'bg-equity-soft',
  },
  INCOME: {
    value: 'INCOME', label: 'Income', pluralLabel: 'Income', codeRange: '4000–4999',
    desc: 'Money earned from sales & operations', tone: 'success', icon: <TrendingUp className="h-4 w-4" />,
    border: 'border-success', bg: 'bg-success-soft', text: 'text-success-text', iconBg: 'bg-success-soft',
  },
  EXPENSE: {
    value: 'EXPENSE', label: 'Expense', pluralLabel: 'Expenses', codeRange: '5000–5999',
    desc: 'Money spent running the business', tone: 'error', icon: <TrendingDown className="h-4 w-4" />,
    border: 'border-danger', bg: 'bg-danger-soft', text: 'text-danger-text', iconBg: 'bg-danger-soft',
  },
}
