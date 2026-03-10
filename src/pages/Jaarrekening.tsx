import { useEffect, useState, useMemo } from "react";
import { fetchAll, getErpNextLinkUrl } from "../lib/erpnext";
import CompanySelect from "../components/CompanySelect";
import {
  BookOpen,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Users,
} from "lucide-react";

interface GLEntry {
  account: string;
  debit: number;
  credit: number;
  posting_date: string;
  voucher_type: string;
}

interface Account {
  name: string;
  account_name: string;
  root_type: string;
  parent_account: string;
  is_group: number;
  account_type: string;
}

interface SalarySlip {
  employee_name: string;
  gross_pay: number;
  net_pay: number;
  total_deduction: number;
  posting_date: string;
}

interface AccountRow {
  account: string;
  account_name: string;
  balance: number;
}

interface GroupRow {
  group: string;
  label: string;
  balance: number;
  accounts: AccountRow[];
}

const currentYear = new Date().getFullYear();
const years = [2022, 2023, 2024, 2025, 2026];

function euro(value: number): string {
  return value.toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function stripSuffix(parentAccount: string): string {
  return parentAccount.replace(/\s*-\s*\w+$/, "").trim();
}

/**
 * Check whether an account is VAT/BTW-related based on its name, account_name,
 * or account_type. These should be excluded from Income/Expense in the P&L.
 */
function isVatAccount(account: Account): boolean {
  const keywords = [
    "btw",
    "vat",
    "tax",
    "belasting",
    "voorbelasting",
    "te vorderen",
    "omzetbelasting",
    "input tax",
    "output tax",
  ];

  if (account.account_type === "Tax") {
    return true;
  }

  const haystack = `${account.name} ${account.account_name}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

const rootTypeLabels: Record<string, string> = {
  Asset: "Activa",
  Liability: "Passiva",
  Equity: "Eigen Vermogen",
  Income: "Omzet (excl. BTW)",
  Expense: "Kosten (excl. BTW)",
};

const balansTypes = ["Asset", "Liability", "Equity"] as const;
const plTypes = ["Income", "Expense"] as const;

export default function Jaarrekening() {
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [year, setYear] = useState(currentYear);
  const [plEntries, setPlEntries] = useState<GLEntry[]>([]);
  const [bsEntries, setBsEntries] = useState<GLEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [salarySlips, setSalarySlips] = useState<SalarySlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // P&L: two separate queries for Sales Invoice and Purchase Invoice GL entries
      // (ERPNext REST API doesn't reliably support "in" filters)
      const commonPlFilters: unknown[][] = [
        ["is_cancelled", "=", 0],
        ["posting_date", ">=", `${year}-01-01`],
        ["posting_date", "<=", `${year}-12-31`],
      ];
      if (company) commonPlFilters.push(["company", "=", company]);

      // Balance Sheet entries: cumulative from the beginning up to year-end
      const bsFilters: unknown[][] = [
        ["is_cancelled", "=", 0],
        ["posting_date", "<=", `${year}-12-31`],
      ];
      if (company) bsFilters.push(["company", "=", company]);

      const acctFilters: unknown[][] = [
        ["is_group", "=", 0],
      ];
      if (company) acctFilters.push(["company", "=", company]);

      const glFields: string[] = ["account", "debit", "credit", "posting_date", "voucher_type"];

      const [siGLData, piGLData, bsData, accts, salaryData] = await Promise.all([
        fetchAll<GLEntry>(
          "GL Entry",
          glFields,
          [...commonPlFilters, ["voucher_type", "=", "Sales Invoice"]],
          "posting_date asc"
        ),
        fetchAll<GLEntry>(
          "GL Entry",
          glFields,
          [...commonPlFilters, ["voucher_type", "=", "Purchase Invoice"]],
          "posting_date asc"
        ),
        fetchAll<GLEntry>(
          "GL Entry",
          glFields,
          bsFilters,
          "posting_date asc"
        ),
        fetchAll<Account>(
          "Account",
          ["name", "account_name", "root_type", "parent_account", "is_group", "account_type"],
          acctFilters
        ),
        fetchAll<SalarySlip>(
          "Salary Slip",
          ["employee_name", "gross_pay", "net_pay", "total_deduction", "posting_date"],
          [
            ["docstatus", "=", 1],
            ["posting_date", ">=", `${year}-01-01`],
            ["posting_date", "<=", `${year}-12-31`],
            ...(company ? [["company", "=", company]] : []),
          ]
        ),
      ]);
      setPlEntries([...siGLData, ...piGLData]);
      setBsEntries(bsData);
      setAccounts(accts);
      setSalarySlips(salaryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [company, year]);

  // Build account lookup
  const accountMap = useMemo(() => {
    const map = new Map<string, Account>();
    for (const a of accounts) {
      map.set(a.name, a);
    }
    return map;
  }, [accounts]);

  // Build a set of account names per root_type for quick lookup
  const rootTypeByAccount = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      map.set(a.name, a.root_type);
    }
    return map;
  }, [accounts]);

  // Build a set of VAT account names to exclude from P&L
  const vatAccountNames = useMemo(() => {
    const vatSet = new Set<string>();
    for (const a of accounts) {
      if (isVatAccount(a)) {
        vatSet.add(a.name);
      }
    }
    return vatSet;
  }, [accounts]);

  // Compute balances per account using the correct entry set:
  // - P&L accounts (Income, Expense): use plEntries (selected year only), excluding VAT accounts
  // - Balance Sheet accounts (Asset, Liability, Equity): use bsEntries (selected year only)
  const accountBalances = useMemo(() => {
    const balances = new Map<string, number>();

    // Process P&L entries (selected year only) for Income & Expense accounts, excluding VAT
    for (const entry of plEntries) {
      const rootType = rootTypeByAccount.get(entry.account);
      if (rootType === "Income" || rootType === "Expense") {
        // Skip VAT accounts in the P&L
        if (vatAccountNames.has(entry.account)) continue;

        const current = balances.get(entry.account) || 0;
        balances.set(entry.account, current + entry.debit - entry.credit);
      }
    }

    // Process BS entries (selected year only) for Asset, Liability & Equity accounts
    for (const entry of bsEntries) {
      const rootType = rootTypeByAccount.get(entry.account);
      if (rootType === "Asset" || rootType === "Liability" || rootType === "Equity") {
        const current = balances.get(entry.account) || 0;
        balances.set(entry.account, current + entry.debit - entry.credit);
      }
    }

    return balances;
  }, [plEntries, bsEntries, rootTypeByAccount, vatAccountNames]);

  // Build grouped data by root_type -> parent_account
  const groupedData = useMemo(() => {
    const result: Record<string, GroupRow[]> = {};

    // Group accounts by root_type and parent_account
    const typeGroups = new Map<string, Map<string, AccountRow[]>>();

    for (const [acctName, balance] of accountBalances) {
      const acct = accountMap.get(acctName);
      if (!acct || !acct.root_type) continue;

      const rootType = acct.root_type;
      const parentRaw = acct.parent_account || "Overig";
      const parent = stripSuffix(parentRaw);

      if (!typeGroups.has(rootType)) {
        typeGroups.set(rootType, new Map());
      }
      const parentGroups = typeGroups.get(rootType)!;
      if (!parentGroups.has(parent)) {
        parentGroups.set(parent, []);
      }
      parentGroups.get(parent)!.push({
        account: acctName,
        account_name: acct.account_name,
        balance,
      });
    }

    for (const [rootType, parentGroups] of typeGroups) {
      const groups: GroupRow[] = [];
      for (const [group, accts] of parentGroups) {
        const groupBalance = accts.reduce((s, a) => s + a.balance, 0);
        accts.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
        groups.push({
          group: `${rootType}::${group}`,
          label: group,
          balance: groupBalance,
          accounts: accts,
        });
      }
      groups.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
      result[rootType] = groups;
    }

    return result;
  }, [accountBalances, accountMap]);

  // Compute section totals
  const sectionTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const [rootType, groups] of Object.entries(groupedData)) {
      totals[rootType] = groups.reduce((s, g) => s + g.balance, 0);
    }
    return totals;
  }, [groupedData]);

  // Profit & Loss (excl. BTW)
  const totalIncome = Math.abs(sectionTotals["Income"] || 0);
  const totalExpenses = sectionTotals["Expense"] || 0;
  const netResult = totalIncome - totalExpenses;

  const salaryData = useMemo(() => {
    const totalBruto = salarySlips.reduce((s, sl) => s + sl.gross_pay, 0);
    const totalNetto = salarySlips.reduce((s, sl) => s + sl.net_pay, 0);
    const totalInhouding = salarySlips.reduce((s, sl) => s + sl.total_deduction, 0);

    // Group by employee
    const byEmployee = new Map<string, { gross: number; net: number; deductions: number; count: number }>();
    for (const sl of salarySlips) {
      const existing = byEmployee.get(sl.employee_name) || { gross: 0, net: 0, deductions: 0, count: 0 };
      existing.gross += sl.gross_pay;
      existing.net += sl.net_pay;
      existing.deductions += sl.total_deduction;
      existing.count += 1;
      byEmployee.set(sl.employee_name, existing);
    }

    return { totalBruto, totalNetto, totalInhouding, byEmployee };
  }, [salarySlips]);

  function toggleGroup(groupKey: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  function renderSection(
    rootType: string,
    signMultiplier: number = 1
  ) {
    const groups = groupedData[rootType] || [];
    const total = sectionTotals[rootType] || 0;

    return (
      <div className="mb-6">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-100 rounded-t-xl">
          <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
            {rootTypeLabels[rootType] || rootType}
          </h4>
          <span className="text-sm font-bold text-slate-800">
            {euro(Math.abs(total) * signMultiplier)}
          </span>
        </div>
        <div className="border border-slate-200 border-t-0 rounded-b-xl overflow-hidden">
          {groups.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              Geen boekingen
            </div>
          ) : (
            groups.map((group) => {
              const isExpanded = expandedGroups.has(group.group);
              return (
                <div key={group.group}>
                  <button
                    onClick={() => toggleGroup(group.group)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100"
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown size={14} className="text-slate-400" />
                      ) : (
                        <ChevronRight size={14} className="text-slate-400" />
                      )}
                      <span className="text-sm font-medium text-slate-700">
                        {group.label}
                      </span>
                      <span className="text-xs text-slate-400">
                        ({group.accounts.length})
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-700">
                      {euro(Math.abs(group.balance) * signMultiplier)}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="bg-slate-50/50">
                      {group.accounts.map((acct) => (
                        <div
                          key={acct.account}
                          className="flex items-center justify-between px-4 py-2 pl-10 border-b border-slate-50"
                        >
                          <span className="text-xs text-slate-500">
                            {acct.account_name}
                          </span>
                          <span className="text-xs font-medium text-slate-600">
                            {euro(Math.abs(acct.balance) * signMultiplier)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <BookOpen className="text-emerald-600" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Jaarrekening</h2>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextLinkUrl()}/general-ledger?company=${encodeURIComponent(company)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <ExternalLink size={14} /> ERPNext
          </a>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Vernieuwen
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-3">
        <CompanySelect value={company} onChange={setCompany} />
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-64 flex items-center justify-center text-slate-400">
          Laden...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* =================== BALANS =================== */}
            <div>
              <h3 className="text-xl font-bold text-slate-800 mb-4">Balans</h3>

              {balansTypes.map((rootType) => {
                // Liabilities and Equity are normally credit-balance (negative debit-credit),
                // so we show absolute values. Assets are debit-balance.
                const sign = rootType === "Asset" ? 1 : 1;
                return (
                  <div key={rootType}>
                    {renderSection(rootType, sign)}
                  </div>
                );
              })}

              {/* Balans totals summary */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mt-2">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-600">Totaal Activa</span>
                  <span className="font-semibold text-slate-800">
                    {euro(Math.abs(sectionTotals["Asset"] || 0))}
                  </span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-600">Totaal Passiva + Eigen Vermogen</span>
                  <span className="font-semibold text-slate-800">
                    {euro(
                      Math.abs(sectionTotals["Liability"] || 0) +
                        Math.abs(sectionTotals["Equity"] || 0)
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* =================== WINST & VERLIES =================== */}
            <div>
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                Winst & Verlies (excl. BTW)
                <span className="block text-xs font-normal text-slate-400 mt-1">
                  Op basis van factuurdatums (verkoop- en inkoopfacturen)
                </span>
              </h3>

              {plTypes.map((rootType) => (
                <div key={rootType}>
                  {renderSection(rootType, 1)}
                </div>
              ))}

              {/* Net Result */}
              <div
                className={`rounded-xl shadow-sm border p-5 mt-2 ${
                  netResult >= 0
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Omzet (excl. BTW)</p>
                    <p className="text-lg font-semibold text-slate-800">
                      {euro(totalIncome)}
                    </p>
                  </div>
                  <span className="text-2xl text-slate-300 font-light">-</span>
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Kosten (excl. BTW)</p>
                    <p className="text-lg font-semibold text-slate-800">
                      {euro(totalExpenses)}
                    </p>
                  </div>
                  <span className="text-2xl text-slate-300 font-light">=</span>
                  <div className="text-right">
                    <p className="text-sm text-slate-500 mb-1">Nettoresultaat</p>
                    <p
                      className={`text-2xl font-bold ${
                        netResult >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {euro(netResult)}
                    </p>
                  </div>
                </div>
                <div className="w-full h-2 bg-white/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      netResult >= 0 ? "bg-green-500" : "bg-red-500"
                    }`}
                    style={{
                      width: `${
                        totalIncome > 0
                          ? Math.min(
                              (Math.abs(netResult) / totalIncome) * 100,
                              100
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2 text-right">
                  Winstmarge:{" "}
                  {totalIncome > 0
                    ? ((netResult / totalIncome) * 100).toFixed(1)
                    : "0.0"}
                  %
                </p>
              </div>
            </div>
          </div>

          {/* Salarisoverzicht - always shown */}
          <div className="mt-8">
            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Users size={20} className="text-3bm-teal" />
              Salarisoverzicht {year}
            </h3>

            {salarySlips.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-sm text-slate-400">
                Geen salarisgegevens gevonden voor {year}
              </div>
            ) : (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <p className="text-sm text-slate-500 mb-1">Totaal bruto</p>
                    <p className="text-2xl font-bold text-slate-800">{euro(salaryData.totalBruto)}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <p className="text-sm text-slate-500 mb-1">Totaal inhoudingen</p>
                    <p className="text-2xl font-bold text-red-600">{euro(salaryData.totalInhouding)}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <p className="text-sm text-slate-500 mb-1">Totaal netto</p>
                    <p className="text-2xl font-bold text-green-600">{euro(salaryData.totalNetto)}</p>
                  </div>
                </div>

                {/* Per Employee Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Medewerker</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Bruto</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Inhoudingen</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Netto</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Slips</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(salaryData.byEmployee.entries())
                        .sort((a, b) => b[1].gross - a[1].gross)
                        .map(([name, data]) => (
                          <tr key={name} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-3 text-sm font-medium text-slate-700">{name}</td>
                            <td className="px-4 py-3 text-sm text-slate-700 text-right">{euro(data.gross)}</td>
                            <td className="px-4 py-3 text-sm text-red-600 text-right">{euro(data.deductions)}</td>
                            <td className="px-4 py-3 text-sm text-green-600 text-right font-medium">{euro(data.net)}</td>
                            <td className="px-4 py-3 text-sm text-slate-500 text-right">{data.count}</td>
                          </tr>
                        ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                        <td className="px-4 py-3 text-sm text-slate-700">Totaal</td>
                        <td className="px-4 py-3 text-sm text-slate-800 text-right">{euro(salaryData.totalBruto)}</td>
                        <td className="px-4 py-3 text-sm text-red-700 text-right">{euro(salaryData.totalInhouding)}</td>
                        <td className="px-4 py-3 text-sm text-green-700 text-right">{euro(salaryData.totalNetto)}</td>
                        <td className="px-4 py-3 text-sm text-slate-500 text-right">{salarySlips.length}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
