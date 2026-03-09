import { useEffect, useState, useMemo } from "react";
import { fetchAll, getErpNextAppUrl } from "../lib/erpnext";
import {
  PieChart,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Calendar,
  BarChart3,
  X,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";

interface GLEntry {
  account: string;
  debit: number;
  credit: number;
  posting_date: string;
  voucher_no?: string;
  voucher_type?: string;
  party?: string;
  party_type?: string;
  against?: string;
}

interface Account {
  name: string;
  account_name: string;
  root_type: string;
  parent_account: string;
  is_group: number;
}

interface CategoryData {
  category: string;
  total: number;
  accounts: { account: string; account_name: string; total: number }[];
}

const currentYear = new Date().getFullYear();
const years = [2022, 2023, 2024, 2025, 2026];
const monthNames = [
  "Januari", "Februari", "Maart", "April", "Mei", "Juni",
  "Juli", "Augustus", "September", "Oktober", "November", "December",
];

const CATEGORY_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-fuchsia-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-red-500",
];

const CATEGORY_COLORS_LIGHT = [
  "bg-blue-100",
  "bg-green-100",
  "bg-purple-100",
  "bg-pink-100",
  "bg-indigo-100",
  "bg-teal-100",
  "bg-orange-100",
  "bg-cyan-100",
  "bg-rose-100",
  "bg-amber-100",
  "bg-lime-100",
  "bg-emerald-100",
  "bg-fuchsia-100",
  "bg-sky-100",
  "bg-violet-100",
  "bg-red-100",
];

function euro(value: number): string {
  return value.toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function stripSuffix(parentAccount: string): string {
  // "Indirect Expenses - 3" → "Indirect Expenses"
  return parentAccount.replace(/\s*-\s*\w+$/, "").trim();
}

export default function Kosteninzicht() {
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [year, setYear] = useState(currentYear);
  const [glEntries, setGlEntries] = useState<GLEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<{ account: string; account_name: string } | null>(null);
  const [expandedParties, setExpandedParties] = useState<Set<string>>(new Set());

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const glFilters: unknown[][] = [
        ["is_cancelled", "=", 0],
        ["posting_date", ">=", `${year}-01-01`],
        ["posting_date", "<=", `${year}-12-31`],
      ];
      if (company) glFilters.push(["company", "=", company]);

      const acctFilters: unknown[][] = [
        ["is_group", "=", 0],
      ];
      if (company) acctFilters.push(["company", "=", company]);

      const [entries, accts] = await Promise.all([
        fetchAll<GLEntry>(
          "GL Entry",
          ["account", "debit", "credit", "posting_date", "voucher_no", "voucher_type", "party", "party_type", "against"],
          glFilters,
          "posting_date asc"
        ),
        fetchAll<Account>(
          "Account",
          ["name", "account_name", "root_type", "parent_account", "is_group"],
          acctFilters
        ),
      ]);
      setGlEntries(entries);
      setAccounts(accts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [company, year]);

  // Build account lookup: name → Account
  const accountMap = useMemo(() => {
    const map = new Map<string, Account>();
    for (const a of accounts) {
      map.set(a.name, a);
    }
    return map;
  }, [accounts]);

  // Filter GL entries to expense accounts only and compute categories
  const { categories, totalCosts } = useMemo(() => {
    const expenseAccounts = new Set<string>();
    for (const a of accounts) {
      if (a.root_type === "Expense") {
        const lowerName = a.account_name.toLowerCase();
        // Exclude VAT/BTW accounts
        if (lowerName.includes("vat") || lowerName.includes("btw")) continue;
        // Exclude year catch-up accounts (e.g. "2024 Expenses") - often incl. BTW
        if (/^20\d{2}\s/.test(a.account_name)) continue;
        expenseAccounts.add(a.name);
      }
    }

    // Group by parent_account (category)
    const catMap = new Map<string, Map<string, number>>();

    for (const entry of glEntries) {
      if (!expenseAccounts.has(entry.account)) continue;
      const acct = accountMap.get(entry.account);
      if (!acct) continue;

      const categoryRaw = acct.parent_account || "Overig";
      const category = stripSuffix(categoryRaw);
      const net = entry.debit - entry.credit;

      if (!catMap.has(category)) {
        catMap.set(category, new Map());
      }
      const acctMap = catMap.get(category)!;
      acctMap.set(entry.account, (acctMap.get(entry.account) || 0) + net);
    }

    let totalCosts = 0;
    const categories: CategoryData[] = [];

    for (const [category, acctMap] of catMap) {
      const acctEntries: CategoryData["accounts"] = [];
      let catTotal = 0;
      for (const [acctName, total] of acctMap) {
        const acct = accountMap.get(acctName);
        acctEntries.push({
          account: acctName,
          account_name: acct?.account_name || acctName,
          total,
        });
        catTotal += total;
      }
      acctEntries.sort((a, b) => b.total - a.total);
      categories.push({ category, total: catTotal, accounts: acctEntries });
      totalCosts += catTotal;
    }

    categories.sort((a, b) => b.total - a.total);
    return { categories, totalCosts };
  }, [glEntries, accounts, accountMap]);

  // Monthly breakdown
  const { monthlyData, topCategories } = useMemo(() => {
    const top = categories.slice(0, 6);
    const topCatNames = new Set(top.map((c) => c.category));

    // Build expense account → category lookup
    const acctToCategory = new Map<string, string>();
    for (const a of accounts) {
      if (a.root_type === "Expense") {
        const category = stripSuffix(a.parent_account || "Overig");
        acctToCategory.set(a.name, category);
      }
    }

    // Monthly totals per category
    const monthly: Record<number, Record<string, number>> = {};
    for (let m = 0; m < 12; m++) {
      monthly[m] = {};
      for (const cat of topCatNames) {
        monthly[m][cat] = 0;
      }
      monthly[m]["_totaal"] = 0;
    }

    for (const entry of glEntries) {
      const category = acctToCategory.get(entry.account);
      if (!category) continue;
      const month = new Date(entry.posting_date).getMonth();
      const net = entry.debit - entry.credit;
      if (topCatNames.has(category)) {
        monthly[month][category] = (monthly[month][category] || 0) + net;
      }
      monthly[month]["_totaal"] = (monthly[month]["_totaal"] || 0) + net;
    }

    return { monthlyData: monthly, topCategories: top };
  }, [glEntries, accounts, categories]);


  // Drill-down data: when a sub-account is selected, group GL entries by party (debiteur/crediteur)
  const accountDrillDown = useMemo(() => {
    if (!selectedAccount) return { parties: [], totalNet: 0 };

    const entries = glEntries.filter((e) => e.account === selectedAccount.account);

    // Group by party name
    const partyMap = new Map<string, { entries: GLEntry[]; totalDebit: number; totalCredit: number }>();
    for (const entry of entries) {
      const partyName = entry.party || entry.against || entry.voucher_no || "Onbekend";
      const existing = partyMap.get(partyName) || { entries: [], totalDebit: 0, totalCredit: 0 };
      existing.entries.push(entry);
      existing.totalDebit += entry.debit;
      existing.totalCredit += entry.credit;
      partyMap.set(partyName, existing);
    }

    const parties = Array.from(partyMap.entries())
      .map(([name, data]) => ({
        name,
        net: data.totalDebit - data.totalCredit,
        debit: data.totalDebit,
        credit: data.totalCredit,
        count: data.entries.length,
        entries: data.entries.sort((a, b) => (b.posting_date || "").localeCompare(a.posting_date || "")),
      }))
      .sort((a, b) => b.net - a.net);

    const totalNet = parties.reduce((s, p) => s + p.net, 0);
    return { parties, totalNet };
  }, [selectedAccount, glEntries]);

  const avgPerMonth = totalCosts / 12;
  const largestCategory = categories.length > 0 ? categories[0] : null;
  const maxCategoryTotal = categories.length > 0 ? categories[0].total : 1;

  function toggleCategory(cat: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <PieChart className="text-purple-600" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Kosteninzicht</h2>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextAppUrl()}/app/general-ledger?company=${encodeURIComponent(company)}`}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-100 rounded-lg">
              <TrendingUp className="text-red-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Totale kosten</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(totalCosts)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-3bm-teal/10 rounded-lg">
              <Calendar className="text-3bm-teal" size={20} />
            </div>
            <p className="text-sm text-slate-500">Gemiddeld per maand</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(avgPerMonth)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-100 rounded-lg">
              <BarChart3 className="text-purple-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Grootste categorie</p>
          </div>
          <p className="text-lg font-bold text-slate-800">
            {loading ? "..." : largestCategory ? largestCategory.category : "-"}
          </p>
          <p className="text-sm text-slate-500">
            {loading ? "" : largestCategory ? euro(largestCategory.total) : ""}
          </p>
        </div>
      </div>

      {/* Horizontal Bar Chart */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h3 className="text-lg font-semibold text-slate-700 mb-4">
          Kosten per categorie
        </h3>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-slate-400">
            Laden...
          </div>
        ) : categories.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-400">
            Geen kostendata gevonden
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((cat, idx) => {
              const isExpanded = expandedCategories.has(cat.category);
              const barWidth = maxCategoryTotal > 0 ? (cat.total / maxCategoryTotal) * 100 : 0;
              const pct = totalCosts > 0 ? ((cat.total / totalCosts) * 100).toFixed(1) : "0.0";
              const barColor = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
              const barColorLight = CATEGORY_COLORS_LIGHT[idx % CATEGORY_COLORS_LIGHT.length];

              return (
                <div key={cat.category}>
                  <button
                    onClick={() => {
                      toggleCategory(cat.category);
                    }}
                    className="w-full text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-4 flex-shrink-0">
                        {isExpanded ? (
                          <ChevronDown size={14} className="text-slate-400" />
                        ) : (
                          <ChevronRight size={14} className="text-slate-400" />
                        )}
                      </div>
                      <span className="text-sm font-medium text-slate-700 w-48 truncate">
                        {cat.category}
                      </span>
                      <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all`}
                          style={{ width: `${Math.max(barWidth, 0.5)}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-slate-700 w-32 text-right">
                        {euro(cat.total)}
                      </span>
                      <span className="text-xs text-slate-400 w-12 text-right">
                        {pct}%
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="ml-7 pl-4 border-l-2 border-slate-200 mt-1 mb-2 space-y-1">
                      {cat.accounts.map((acct) => {
                        const acctBarWidth =
                          cat.total > 0 ? (acct.total / cat.total) * 100 : 0;
                        return (
                          <button
                            key={acct.account}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAccount({ account: acct.account, account_name: acct.account_name });
                              setExpandedParties(new Set());
                            }}
                            className="w-full flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded py-0.5 px-1 -mx-1 transition-colors"
                          >
                            <span className="text-xs text-3bm-teal hover:text-3bm-teal-dark truncate w-48 text-left flex items-center gap-1 group/link">
                              <span className="truncate">{acct.account_name}</span>
                              <ChevronRight size={10} className="opacity-0 group-hover/link:opacity-100 flex-shrink-0 transition-opacity text-slate-400" />
                            </span>
                            <div className="flex-1 h-3 bg-slate-50 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${barColorLight} rounded-full`}
                                style={{ width: `${Math.max(acctBarWidth, 0.5)}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-slate-600 w-32 text-right">
                              {euro(acct.total)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Monthly Breakdown Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-semibold text-slate-700">
            Maandelijks overzicht
          </h3>
        </div>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-slate-400">
            Laden...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 sticky left-0 bg-white">
                    Maand
                  </th>
                  {topCategories.map((cat, idx) => {
                    const catIdx = categories.findIndex((c) => c.category === cat.category);
                    const dotColor = CATEGORY_COLORS[(catIdx >= 0 ? catIdx : idx) % CATEGORY_COLORS.length];
                    return (
                      <th
                        key={cat.category}
                        className="text-right px-4 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={`w-2.5 h-2.5 rounded-full ${dotColor} inline-block flex-shrink-0`} />
                          <span>{cat.category}</span>
                        </div>
                      </th>
                    );
                  })}
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-800 whitespace-nowrap">
                    Totaal
                  </th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 12 }, (_, m) => {
                  const row = monthlyData[m];
                  return (
                    <tr
                      key={m}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5 text-sm font-medium text-slate-700 sticky left-0 bg-white">
                        {monthNames[m]}
                      </td>
                      {topCategories.map((cat) => (
                        <td
                          key={cat.category}
                          className="px-4 py-2.5 text-sm text-slate-600 text-right whitespace-nowrap"
                        >
                          {euro(row[cat.category] || 0)}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 text-right whitespace-nowrap">
                        {euro(row["_totaal"] || 0)}
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-300">
                  <td className="px-4 py-3 text-sm text-slate-800 sticky left-0 bg-slate-50">
                    Totaal
                  </td>
                  {topCategories.map((cat) => {
                    const colTotal = Object.values(monthlyData).reduce(
                      (s, row) => s + (row[cat.category] || 0),
                      0
                    );
                    return (
                      <td
                        key={cat.category}
                        className="px-4 py-3 text-sm text-slate-800 text-right whitespace-nowrap"
                      >
                        {euro(colTotal)}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-sm text-slate-800 text-right whitespace-nowrap">
                    {euro(totalCosts)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sub-account Drill-down Panel: grouped by debiteur → facturen */}
      {selectedAccount && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedAccount(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  {selectedAccount.account_name}
                </h3>
                <p className="text-sm text-slate-500">
                  {accountDrillDown.parties.length} debiteuren/crediteuren &middot; Totaal: {euro(accountDrillDown.totalNet)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`${getErpNextAppUrl()}/app/general-ledger?account=${encodeURIComponent(selectedAccount.account)}&company=${encodeURIComponent(company)}&from_date=${year}-01-01&to_date=${year}-12-31`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg hover:bg-slate-200 transition-colors"
                  title="Open in ERPNext"
                >
                  <ExternalLink size={16} className="text-slate-500" />
                </a>
                <button
                  onClick={() => setSelectedAccount(null)}
                  className="p-2 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <X size={20} className="text-slate-500" />
                </button>
              </div>
            </div>

            {/* Body: parties with expandable invoices */}
            <div className="flex-1 overflow-y-auto">
              {accountDrillDown.parties.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-400">
                  Geen transacties gevonden
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {accountDrillDown.parties.map((party) => {
                    const isExpanded = expandedParties.has(party.name);
                    const maxPartyNet = accountDrillDown.parties[0]?.net || 1;
                    const barWidth = maxPartyNet > 0 ? (party.net / maxPartyNet) * 100 : 0;

                    return (
                      <div key={party.name}>
                        {/* Party row */}
                        <button
                          onClick={() => {
                            setExpandedParties((prev) => {
                              const next = new Set(prev);
                              if (next.has(party.name)) next.delete(party.name);
                              else next.add(party.name);
                              return next;
                            });
                          }}
                          className="w-full flex items-center gap-3 px-6 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <div className="w-4 flex-shrink-0">
                            {isExpanded ? (
                              <ChevronDown size={14} className="text-slate-400" />
                            ) : (
                              <ChevronRight size={14} className="text-slate-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-slate-700 truncate">
                                {party.name}
                              </span>
                              <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                                <span className="text-xs text-slate-400">{party.count} regels</span>
                                <span className="text-sm font-semibold text-slate-800 w-28 text-right">
                                  {euro(party.net)}
                                </span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-purple-400 rounded-full transition-all"
                                style={{ width: `${Math.max(barWidth, 0.5)}%` }}
                              />
                            </div>
                          </div>
                        </button>

                        {/* Expanded: individual invoices */}
                        {isExpanded && (
                          <div className="bg-slate-50/50 border-t border-slate-100">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-slate-200">
                                  <th className="text-left px-6 pl-14 py-2 text-xs font-semibold text-slate-500">Datum</th>
                                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Document</th>
                                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Type</th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Debet</th>
                                  <th className="text-right px-6 py-2 text-xs font-semibold text-slate-500">Credit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {party.entries.map((entry, i) => (
                                  <tr key={`${entry.voucher_no}-${i}`} className="border-b border-slate-100 hover:bg-white">
                                    <td className="px-6 pl-14 py-2 text-xs text-slate-500">{entry.posting_date}</td>
                                    <td className="px-3 py-2 text-xs">
                                      <a
                                        href={`${getErpNextAppUrl()}/app/${(entry.voucher_type || "gl-entry").toLowerCase().replace(/\s+/g, "-")}/${entry.voucher_no}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-3bm-teal hover:text-3bm-teal-dark hover:underline"
                                      >
                                        {entry.voucher_no}
                                      </a>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-400">{entry.voucher_type || "-"}</td>
                                    <td className="px-3 py-2 text-xs text-slate-700 text-right">
                                      {entry.debit > 0 ? euro(entry.debit) : "-"}
                                    </td>
                                    <td className="px-6 py-2 text-xs text-slate-700 text-right">
                                      {entry.credit > 0 ? euro(entry.credit) : "-"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="bg-slate-100/50 font-medium">
                                  <td colSpan={3} className="px-6 pl-14 py-2 text-xs text-slate-600">Subtotaal</td>
                                  <td className="px-3 py-2 text-xs text-slate-700 text-right">{euro(party.debit)}</td>
                                  <td className="px-6 py-2 text-xs text-slate-700 text-right">{euro(party.credit)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
