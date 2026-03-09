import { useEffect, useState, useMemo } from "react";
import { fetchAll, getErpNextAppUrl } from "../lib/erpnext";
import {
  TrendingUp, RefreshCw, Filter, ExternalLink, BarChart3, FileText, Hash,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";

interface SalesInvoice {
  name: string;
  net_total: number;
  posting_date: string;
  customer_name: string;
  company: string;
}

interface MonthData {
  month: number;
  label: string;
  count: number;
  revenue: number;
  prevRevenue: number;
  prevCount: number;
}

const MONTH_LABELS = [
  "Januari", "Februari", "Maart", "April", "Mei", "Juni",
  "Juli", "Augustus", "September", "Oktober", "November", "December",
];

const euro = (value: number) =>
  value.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

const currentYear = new Date().getFullYear();
const yearOptions = [2022, 2023, 2024, 2025, 2026];

export default function Omzet() {
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [year, setYear] = useState(currentYear);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [prevInvoices, setPrevInvoices] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const baseFilters: unknown[][] = [
        ["docstatus", "=", 1],
      ];
      if (company) baseFilters.push(["company", "=", company]);

      const currentFilters: unknown[][] = [
        ...baseFilters,
        ["posting_date", ">=", `${year}-01-01`],
        ["posting_date", "<=", `${year}-12-31`],
      ];

      const prevFilters: unknown[][] = [
        ...baseFilters,
        ["posting_date", ">=", `${year - 1}-01-01`],
        ["posting_date", "<=", `${year - 1}-12-31`],
      ];

      const fields: string[] = ["name", "net_total", "posting_date", "customer_name", "company"];

      const [current, prev] = await Promise.all([
        fetchAll<SalesInvoice>(
          "Sales Invoice",
          fields,
          currentFilters,
          "posting_date asc"
        ),
        fetchAll<SalesInvoice>(
          "Sales Invoice",
          fields,
          prevFilters,
          "posting_date asc"
        ),
      ]);

      setInvoices(current);
      setPrevInvoices(prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [company, year]);

  // Monthly data
  const monthlyData = useMemo<MonthData[]>(() => {
    const months: MonthData[] = MONTH_LABELS.map((label, i) => ({
      month: i,
      label,
      count: 0,
      revenue: 0,
      prevRevenue: 0,
      prevCount: 0,
    }));

    for (const inv of invoices) {
      const m = new Date(inv.posting_date).getMonth();
      months[m].count++;
      months[m].revenue += inv.net_total;
    }

    for (const inv of prevInvoices) {
      const m = new Date(inv.posting_date).getMonth();
      months[m].prevCount++;
      months[m].prevRevenue += inv.net_total;
    }

    return months;
  }, [invoices, prevInvoices]);

  // KPIs
  const totalRevenue = invoices.reduce((s, i) => s + i.net_total, 0);
  const prevTotalRevenue = prevInvoices.reduce((s, i) => s + i.net_total, 0);
  const activeMonths = monthlyData.filter((m) => m.revenue > 0).length;
  const avgPerMonth = activeMonths > 0 ? totalRevenue / activeMonths : 0;
  const growthPct = prevTotalRevenue > 0
    ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100
    : 0;

  const maxBarValue = Math.max(
    ...monthlyData.map((m) => Math.max(m.revenue, m.prevRevenue)),
    1
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <TrendingUp className="text-emerald-600" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Omzet (excl. BTW)</h2>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextAppUrl()}/sales-invoice`}
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

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      {/* Filters */}
      <div className="mb-6 flex items-center gap-3">
        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <TrendingUp className="text-emerald-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Totale Omzet {year} (excl. BTW)</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(totalRevenue)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-3bm-teal/10 rounded-lg">
              <BarChart3 className="text-3bm-teal" size={20} />
            </div>
            <p className="text-sm text-slate-500">Gemiddeld per maand</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(avgPerMonth)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Hash className="text-purple-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Aantal facturen</p>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {loading ? "..." : invoices.length}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TrendingUp className="text-orange-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Groei t.o.v. {year - 1}</p>
          </div>
          <p className={`text-3xl font-bold ${growthPct >= 0 ? "text-green-600" : "text-red-600"}`}>
            {loading
              ? "..."
              : prevTotalRevenue === 0
                ? "n.v.t."
                : `${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(1)}%`}
          </p>
          {!loading && prevTotalRevenue > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              {year - 1}: {euro(prevTotalRevenue)}
            </p>
          )}
        </div>
      </div>

      {/* Bar Chart */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-700">Maandelijkse omzet (excl. BTW)</h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-3bm-teal rounded" /> {year}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-slate-200 rounded" /> {year - 1}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="h-56 flex items-center justify-center text-slate-400">Laden...</div>
        ) : (
          <div className="flex items-end gap-2 h-56">
            {monthlyData.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end group relative">
                {/* Tooltip */}
                <div className="absolute -top-14 bg-slate-800 text-white text-xs px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 leading-tight">
                  <div>{m.label} {year}: {euro(m.revenue)}</div>
                  <div>{m.label} {year - 1}: {euro(m.prevRevenue)}</div>
                </div>

                {/* Bars container */}
                <div className="w-full flex items-end justify-center gap-0.5 h-44">
                  {/* Previous year bar */}
                  <div
                    className="w-[45%] bg-slate-200 rounded-t transition-all hover:bg-slate-300"
                    style={{ height: `${Math.max((m.prevRevenue / maxBarValue) * 100, m.prevRevenue > 0 ? 2 : 0)}%` }}
                  />
                  {/* Current year bar */}
                  <div
                    className="w-[45%] bg-3bm-teal rounded-t transition-all hover:bg-3bm-teal"
                    style={{ height: `${Math.max((m.revenue / maxBarValue) * 100, m.revenue > 0 ? 2 : 0)}%` }}
                  />
                </div>

                {/* Month label */}
                <span className="text-[10px] text-slate-400 mt-1">{m.label.slice(0, 3)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Monthly table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-600">Overzicht per maand</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Maand</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Aantal facturen</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Omzet {year} (excl. BTW)</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Omzet {year - 1} (excl. BTW)</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Verschil %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">Laden...</td>
              </tr>
            ) : (
              <>
                {monthlyData.map((m) => {
                  const diff = m.prevRevenue > 0
                    ? ((m.revenue - m.prevRevenue) / m.prevRevenue) * 100
                    : null;
                  return (
                    <tr key={m.month} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-700">{m.label}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">{m.count}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-800 text-right">
                        {euro(m.revenue)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 text-right">
                        {euro(m.prevRevenue)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {diff === null ? (
                          <span className="text-slate-400">-</span>
                        ) : (
                          <span className={diff >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                            {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-3 text-sm text-slate-800">Totaal</td>
                  <td className="px-4 py-3 text-sm text-slate-800 text-right">{invoices.length}</td>
                  <td className="px-4 py-3 text-sm text-slate-800 text-right">{euro(totalRevenue)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right">{euro(prevTotalRevenue)}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    {prevTotalRevenue > 0 ? (
                      <span className={growthPct >= 0 ? "text-green-600" : "text-red-600"}>
                        {growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
