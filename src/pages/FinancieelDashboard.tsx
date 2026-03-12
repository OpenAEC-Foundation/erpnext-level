import { useEffect, useState, useMemo } from "react";
import { fetchAll, fetchCount } from "../lib/erpnext";
import { getActiveInstanceId } from "../lib/instances";
import {
  BarChart3, RefreshCw, Landmark, FileText, ShoppingCart,
  TrendingUp, AlertTriangle, Filter, Clock, Users, FolderKanban, X, Building2,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";

interface InvoiceTrend {
  month: string;
  label: string;
  total: number;
  outstanding: number;
  count: number;
}

interface EmpMonthly {
  employee: string;
  name: string;
  months: number[];
  billableMonths: number[];
  total: number;
  totalBillable: number;
}

interface ProjMonthly {
  project: string;
  name: string;
  months: number[];
  total: number;
}

interface UrenDetailLog {
  date: string;
  project: string;
  activity: string;
  hours: number;
  isBillable: boolean;
  description: string;
}

interface UrenDetail {
  employee: string;
  month: number;
  year: string;
  logs: UrenDetailLog[];
  totalHours: number;
  billableHours: number;
  billablePercent: number;
}

interface ActivityMonthly {
  activity: string;
  months: number[];
  total: number;
}

interface UrenStats {
  employeeMonthly: EmpMonthly[];
  projectMonthly: ProjMonthly[];
  totalHours: number;
  totalBillable: number;
  billablePercent: number;
  monthTotalHours: number[];
  monthBillableHours: number[];
  monthBillablePercent: number[];
  bureauActivities: ActivityMonthly[];
}

type Tab = "overzicht" | "uren" | "bureau";

const MONTH_LABELS = ["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"];
const euro = (v: number) => `€ ${v.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;
const fmt = (n: number) => n % 1 !== 0 ? n.toFixed(1) : n.toFixed(0);

export default function FinancieelDashboard() {
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overzicht");

  // KPIs
  const [bankTransactions, setBankTransactions] = useState(0);
  const [unpaidPurchase, setUnpaidPurchase] = useState<{count: number; total: number}>({count: 0, total: 0});
  const [unpaidSales, setUnpaidSales] = useState<{count: number; total: number}>({count: 0, total: 0});

  // Trend data
  const [salesInvoices, setSalesInvoices] = useState<{posting_date: string; grand_total: number; outstanding_amount: number}[]>([]);

  // Uren tab
  const [urenStats, setUrenStats] = useState<UrenStats | null>(null);
  const [loadingUren, setLoadingUren] = useState(false);
  const [urenYear, setUrenYear] = useState(new Date().getFullYear());
  const [urenDetail, setUrenDetail] = useState<UrenDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const companyFilter: unknown[][] = company ? [["company", "=", company]] : [];
      const dateFilters: unknown[][] = [];
      if (fromDate) dateFilters.push(["posting_date", ">=", fromDate]);
      if (toDate) dateFilters.push(["posting_date", "<=", toDate]);

      const [bankCount, purchaseList, salesList] = await Promise.all([
        fetchCount("Bank Transaction", [
          ...companyFilter,
          ["status", "!=", "Reconciled"],
          ["status", "!=", "Cancelled"],
          ["docstatus", "=", 1],
        ]).catch(() => 0),
        fetchAll<{outstanding_amount: number}>(
          "Purchase Invoice",
          ["outstanding_amount"],
          [...companyFilter, ...dateFilters, ["docstatus", "=", 1], ["outstanding_amount", ">", 0]]
        ),
        fetchAll<{posting_date: string; grand_total: number; outstanding_amount: number}>(
          "Sales Invoice",
          ["posting_date", "grand_total", "outstanding_amount"],
          [...companyFilter, ...dateFilters, ["docstatus", "=", 1]],
          "posting_date asc"
        ),
      ]);

      setBankTransactions(bankCount);
      setUnpaidPurchase({
        count: purchaseList.length,
        total: purchaseList.reduce((s, i) => s + i.outstanding_amount, 0),
      });
      const outstandingSales = salesList.filter(i => i.outstanding_amount > 0);
      setUnpaidSales({
        count: outstandingSales.length,
        total: outstandingSales.reduce((s, i) => s + i.outstanding_amount, 0),
      });
      setSalesInvoices(salesList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  async function loadUrenData() {
    setLoadingUren(true);
    try {
      const inst = getActiveInstanceId();
      const params = new URLSearchParams({ year: String(urenYear), instance: inst });
      if (company) params.set("company", company);
      const res = await fetch(`/api/stats/uren?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UrenStats = await res.json();
      setUrenStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout bij laden uren");
    } finally {
      setLoadingUren(false);
    }
  }

  async function loadUrenDetail(employee: string, monthIdx: number, empName: string) {
    setLoadingDetail(true);
    try {
      const inst = getActiveInstanceId();
      const res = await fetch(`/api/stats/uren/detail?year=${urenYear}&month=${monthIdx}&employee=${encodeURIComponent(employee)}&instance=${inst}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UrenDetail = await res.json();
      data.employee = empName; // Use display name
      setUrenDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout bij laden detail");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => { loadData(); }, [company, fromDate, toDate]);
  useEffect(() => { if (activeTab === "uren" || activeTab === "bureau") loadUrenData(); }, [activeTab, company, urenYear]);

  // Build monthly trend
  const trendData = useMemo<InvoiceTrend[]>(() => {
    const months = new Map<string, {total: number; outstanding: number; count: number}>();
    for (const inv of salesInvoices) {
      const key = inv.posting_date.slice(0, 7);
      const current = months.get(key) || {total: 0, outstanding: 0, count: 0};
      current.total += inv.grand_total;
      current.outstanding += inv.outstanding_amount;
      current.count++;
      months.set(key, current);
    }
    return Array.from(months.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => {
        const [y, m] = month.split("-");
        return { month, label: `${MONTH_LABELS[parseInt(m)-1]} ${y.slice(2)}`, ...data };
      });
  }, [salesInvoices]);

  const maxTrend = Math.max(...trendData.map(d => Math.max(d.total, d.outstanding)), 1);

  // ─── Derived from backend stats ───
  const employeeMonthly = urenStats?.employeeMonthly || [];
  const projectMonthly = urenStats?.projectMonthly || [];

  const activeMonths = useMemo(() => {
    const hasData = new Array(12).fill(false);
    for (const e of employeeMonthly) {
      for (let i = 0; i < 12; i++) if (e.months[i] > 0) hasData[i] = true;
    }
    return hasData.map((has, i) => ({ idx: i, label: MONTH_LABELS[i], has })).filter(m => m.has);
  }, [employeeMonthly]);

  const monthTotals = useMemo(() => {
    const totals = new Array(12).fill(0);
    for (const e of employeeMonthly) {
      for (let i = 0; i < 12; i++) totals[i] += e.months[i];
    }
    return totals;
  }, [employeeMonthly]);

  const projectMonthTotals = useMemo(() => {
    const totals = new Array(12).fill(0);
    for (const p of projectMonthly) {
      for (let i = 0; i < 12; i++) totals[i] += p.months[i];
    }
    return totals;
  }, [projectMonthly]);

  const maxEmpHours = Math.max(...employeeMonthly.flatMap(e => e.months), 1);
  const maxProjHours = Math.max(...projectMonthly.flatMap(p => p.months), 1);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-3bm-teal/10 rounded-lg">
            <BarChart3 className="text-3bm-teal" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Financieel Dashboard</h2>
        </div>
        <button onClick={() => activeTab === "uren" ? loadUrenData() : loadData()} disabled={loading || loadingUren}
          className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer">
          <RefreshCw size={16} className={loading || loadingUren ? "animate-spin" : ""} /> Vernieuwen
        </button>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {([
          ["overzicht", "Overzicht", BarChart3],
          ["uren", "Uren", Clock],
          ["bureau", "Bureau Algemeen", Building2],
        ] as [Tab, string, typeof BarChart3][]).map(([tab, label, Icon]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
              activeTab === tab
                ? "border-3bm-teal text-3bm-teal"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overzicht" && (
        <>
          <div className="mb-6 flex items-center gap-3">
            <Filter size={16} className="text-slate-400" />
            <CompanySelect value={company} onChange={setCompany} />
            <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-amber-100 rounded-lg"><Landmark className="text-amber-600" size={20} /></div>
                <p className="text-sm text-slate-500">Niet verwerkte banktransacties</p>
              </div>
              <p className="text-3xl font-bold text-slate-800">{loading ? "..." : bankTransactions}</p>
              {!loading && bankTransactions > 0 && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> Actie vereist</p>
              )}
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-orange-100 rounded-lg"><ShoppingCart className="text-orange-600" size={20} /></div>
                <p className="text-sm text-slate-500">Openstaande inkoopfacturen</p>
              </div>
              <p className="text-2xl font-bold text-slate-800">{loading ? "..." : euro(unpaidPurchase.total)}</p>
              <p className="text-xs text-slate-400 mt-1">{unpaidPurchase.count} facturen</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-red-100 rounded-lg"><FileText className="text-red-600" size={20} /></div>
                <p className="text-sm text-slate-500">Openstaande verkoopfacturen</p>
              </div>
              <p className="text-2xl font-bold text-slate-800">{loading ? "..." : euro(unpaidSales.total)}</p>
              <p className="text-xs text-slate-400 mt-1">{unpaidSales.count} facturen</p>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                <TrendingUp size={18} className="text-3bm-teal" />
                Verkoopfacturen per maand
              </h3>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-3bm-teal/30 rounded-sm" /> Gefactureerd
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-red-400 rounded-sm" /> Openstaand
                </span>
              </div>
            </div>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-slate-400">Laden...</div>
            ) : trendData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-slate-400">Geen data</div>
            ) : (
              <div className="flex items-end gap-1" style={{ height: "256px" }}>
                {trendData.map((d) => {
                  const hPct = (d.total / maxTrend) * 100;
                  const oPct = (d.outstanding / maxTrend) * 100;
                  return (
                    <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full group">
                      <div className="relative w-full flex justify-center mb-1" style={{ height: "calc(100% - 24px)" }}>
                        <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2.5 py-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                          <div>{d.count} facturen</div>
                          <div>Gefactureerd: {euro(d.total)}</div>
                          <div>Openstaand: {euro(d.outstanding)}</div>
                        </div>
                        <div className="w-full max-w-[40px] h-full flex flex-col justify-end relative">
                          <div
                            className="w-full bg-3bm-teal/30 rounded-t"
                            style={{ height: `${Math.max(hPct, d.total > 0 ? 2 : 0)}%` }}
                          />
                          {d.outstanding > 0 && (
                            <div
                              className="w-full bg-red-400 rounded-t absolute bottom-0 left-0"
                              style={{ height: `${Math.max(oPct, 2)}%` }}
                            />
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 whitespace-nowrap" style={{ transform: "rotate(-45deg)", transformOrigin: "top left", marginTop: "4px" }}>{d.label}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "uren" && (
        <>
          <div className="mb-6 flex items-center gap-3">
            <Filter size={16} className="text-slate-400" />
            <CompanySelect value={company} onChange={setCompany} />
            <select
              value={urenYear}
              onChange={(e) => setUrenYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {loadingUren ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <RefreshCw size={20} className="animate-spin mr-2" /> Uren laden...
            </div>
          ) : (
            <div className="space-y-6">
              {/* ─── Uren per medewerker ─── */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users size={18} className="text-3bm-teal" />
                    <h3 className="text-base font-semibold text-slate-700">Uren per medewerker</h3>
                    <span className="text-xs text-slate-400 ml-2">{urenYear}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-3bm-teal/30 rounded-sm" /> Totaal uren</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-emerald-500 rounded-sm" /> Facturabel</span>
                  </div>
                </div>
                {employeeMonthly.length === 0 ? (
                  <div className="px-6 py-12 text-center text-slate-400">Geen timesheets gevonden voor {urenYear}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600 sticky left-0 bg-slate-50 min-w-[180px]">Medewerker</th>
                          {activeMonths.map(m => (
                            <th key={m.idx} className="text-center px-2 py-2 text-xs font-semibold text-slate-600 min-w-[80px]">{m.label}</th>
                          ))}
                          <th className="text-center px-3 py-2 text-xs font-bold text-slate-700 min-w-[80px] bg-slate-100">Totaal</th>
                          <th className="text-center px-3 py-2 text-xs font-bold text-slate-700 min-w-[90px] bg-emerald-50">% Facturabel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employeeMonthly.map((emp) => {
                          const billPct = emp.total > 0 ? (emp.totalBillable / emp.total) * 100 : 0;
                          return (
                            <tr key={emp.name} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-2 font-medium text-slate-700 sticky left-0 bg-white">{emp.name}</td>
                              {activeMonths.map(m => {
                                const h = emp.months[m.idx];
                                const b = emp.billableMonths[m.idx];
                                const pctH = (h / maxEmpHours) * 100;
                                const pctB = (b / maxEmpHours) * 100;
                                return (
                                  <td key={m.idx} className="px-2 py-2 text-center">
                                    {h > 0 ? (
                                      <div
                                        className="flex flex-col items-center gap-0.5 cursor-pointer hover:bg-slate-100 rounded p-0.5 transition-colors"
                                        onClick={() => loadUrenDetail(emp.employee, m.idx, emp.name)}
                                      >
                                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="h-full bg-3bm-teal/30 rounded-full" style={{ width: `${Math.max(pctH, 3)}%` }} />
                                        </div>
                                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(pctB, b > 0 ? 3 : 0)}%` }} />
                                        </div>
                                        <span className="text-xs text-slate-600">{fmt(h)} <span className="text-emerald-600">({fmt(b)})</span></span>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-slate-300">-</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-center bg-slate-50">
                                <span className="font-bold text-slate-800">{fmt(emp.total)}</span>
                                <span className="text-xs text-emerald-600 ml-1">({fmt(emp.totalBillable)})</span>
                              </td>
                              <td className="px-3 py-2 text-center bg-emerald-50">
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className={`text-sm font-bold ${billPct >= 70 ? "text-emerald-600" : billPct >= 40 ? "text-amber-600" : "text-red-500"}`}>
                                    {billPct.toFixed(0)}%
                                  </span>
                                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${billPct >= 70 ? "bg-emerald-500" : billPct >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${billPct}%` }} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-50">Totaal</td>
                          {activeMonths.map(m => (
                            <td key={m.idx} className="px-2 py-2 text-center font-bold text-slate-700">
                              {fmt(monthTotals[m.idx])}
                              <span className="text-xs text-emerald-600 ml-0.5">({fmt(urenStats?.monthBillableHours?.[m.idx] || 0)})</span>
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center bg-slate-100">
                            <span className="font-bold text-3bm-teal">{fmt(employeeMonthly.reduce((s, e) => s + e.total, 0))}</span>
                            <span className="text-xs text-emerald-600 ml-1">({fmt(employeeMonthly.reduce((s, e) => s + e.totalBillable, 0))})</span>
                          </td>
                          <td className="px-3 py-2 text-center font-bold bg-emerald-50">
                            {(() => {
                              const totH = employeeMonthly.reduce((s, e) => s + e.total, 0);
                              const totB = employeeMonthly.reduce((s, e) => s + e.totalBillable, 0);
                              const p = totH > 0 ? (totB / totH) * 100 : 0;
                              return <span className={`${p >= 70 ? "text-emerald-600" : p >= 40 ? "text-amber-600" : "text-red-500"}`}>{p.toFixed(0)}%</span>;
                            })()}
                          </td>
                        </tr>
                        <tr className="bg-emerald-50">
                          <td className="px-4 py-2 font-semibold text-emerald-700 sticky left-0 bg-emerald-50 text-xs">% Facturabel</td>
                          {activeMonths.map(m => {
                            const pct = urenStats?.monthBillablePercent?.[m.idx] || 0;
                            return (
                              <td key={m.idx} className="px-2 py-2 text-center">
                                <span className={`text-xs font-bold ${pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-500"}`}>
                                  {pct}%
                                </span>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* ─── Uren per project ─── */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                  <FolderKanban size={18} className="text-violet-500" />
                  <h3 className="text-base font-semibold text-slate-700">Uren per project</h3>
                  <span className="text-xs text-slate-400 ml-2">{urenYear}</span>
                </div>
                {projectMonthly.length === 0 ? (
                  <div className="px-6 py-12 text-center text-slate-400">
                    Geen projecturen gevonden voor {urenYear}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600 sticky left-0 bg-slate-50 min-w-[220px]">Project</th>
                          {activeMonths.map(m => (
                            <th key={m.idx} className="text-center px-2 py-2 text-xs font-semibold text-slate-600 min-w-[80px]">{m.label}</th>
                          ))}
                          <th className="text-center px-3 py-2 text-xs font-bold text-slate-700 min-w-[80px] bg-slate-100">Totaal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectMonthly.map((proj) => (
                          <tr key={proj.name} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2 font-medium text-slate-700 sticky left-0 bg-white truncate max-w-[220px]" title={proj.name}>
                              {proj.name}
                            </td>
                            {activeMonths.map(m => {
                              const h = proj.months[m.idx];
                              const pct = (h / maxProjHours) * 100;
                              return (
                                <td key={m.idx} className="px-2 py-2 text-center">
                                  {h > 0 ? (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.max(pct, 3)}%` }} />
                                      </div>
                                      <span className="text-xs text-slate-600">{fmt(h)}</span>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-slate-300">-</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="px-3 py-2 text-center font-bold text-slate-800 bg-slate-50">{fmt(proj.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-50">Totaal</td>
                          {activeMonths.map(m => (
                            <td key={m.idx} className="px-2 py-2 text-center font-bold text-slate-700">{fmt(projectMonthTotals[m.idx])}</td>
                          ))}
                          <td className="px-3 py-2 text-center font-bold text-violet-600 bg-slate-100">
                            {fmt(projectMonthly.reduce((s, p) => s + p.total, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {activeTab === "bureau" && (
        <>
          <div className="mb-6 flex items-center gap-3">
            <Filter size={16} className="text-slate-400" />
            <CompanySelect value={company} onChange={setCompany} />
            <select
              value={urenYear}
              onChange={(e) => setUrenYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {loadingUren ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <RefreshCw size={20} className="animate-spin mr-2" /> Laden...
            </div>
          ) : (() => {
            // Filter: alleen niet-facturabele uren (Bureau Algemeen = project "0000" of geen project)
            const bureauEmployees = employeeMonthly
              .map((emp) => {
                const nonBillableMonths = emp.months.map((h, i) => h - emp.billableMonths[i]);
                const totalNonBillable = emp.total - emp.totalBillable;
                return { ...emp, nonBillableMonths, totalNonBillable };
              })
              .filter((e) => e.totalNonBillable > 0)
              .sort((a, b) => b.totalNonBillable - a.totalNonBillable);

            const maxNB = Math.max(...bureauEmployees.flatMap(e => e.nonBillableMonths), 1);

            return (
              <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 size={18} className="text-amber-500" />
                      <h3 className="text-base font-semibold text-slate-700">Bureau Algemeen — Niet-facturabele uren per medewerker</h3>
                      <span className="text-xs text-slate-400 ml-2">{urenYear}</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600 sticky left-0 bg-slate-50 min-w-[180px]">Medewerker</th>
                          {activeMonths.map(m => (
                            <th key={m.idx} className="text-center px-2 py-2 text-xs font-semibold text-slate-600 min-w-[70px]">{m.label}</th>
                          ))}
                          <th className="text-center px-3 py-2 text-xs font-bold text-slate-700 min-w-[80px] bg-slate-100">Totaal</th>
                          <th className="text-center px-3 py-2 text-xs font-bold text-slate-700 min-w-[80px] bg-amber-50">% van totaal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bureauEmployees.map((emp) => {
                          const pctOfTotal = emp.total > 0 ? ((emp.totalNonBillable / emp.total) * 100) : 0;
                          return (
                            <tr key={emp.name} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-2 font-medium text-slate-700 sticky left-0 bg-white">{emp.name}</td>
                              {activeMonths.map(m => {
                                const h = emp.nonBillableMonths[m.idx];
                                const pct = (h / maxNB) * 100;
                                return (
                                  <td key={m.idx} className="px-2 py-2 text-center">
                                    {h > 0 ? (
                                      <div className="flex flex-col items-center gap-0.5">
                                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.max(pct, 3)}%` }} />
                                        </div>
                                        <span className="text-xs text-slate-600">{fmt(h)}</span>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-slate-300">-</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-center font-bold text-slate-800 bg-slate-50">{fmt(emp.totalNonBillable)}</td>
                              <td className="px-3 py-2 text-center bg-amber-50">
                                <span className={`text-sm font-bold ${pctOfTotal <= 30 ? "text-emerald-600" : pctOfTotal <= 60 ? "text-amber-600" : "text-red-500"}`}>
                                  {pctOfTotal.toFixed(0)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-50">Totaal</td>
                          {activeMonths.map(m => {
                            const tot = bureauEmployees.reduce((s, e) => s + e.nonBillableMonths[m.idx], 0);
                            return <td key={m.idx} className="px-2 py-2 text-center font-bold text-slate-700">{fmt(tot)}</td>;
                          })}
                          <td className="px-3 py-2 text-center font-bold text-amber-600 bg-slate-100">
                            {fmt(bureauEmployees.reduce((s, e) => s + e.totalNonBillable, 0))}
                          </td>
                          <td className="px-3 py-2 text-center font-bold bg-amber-50">
                            {(() => {
                              const totAll = employeeMonthly.reduce((s, e) => s + e.total, 0);
                              const totNB = bureauEmployees.reduce((s, e) => s + e.totalNonBillable, 0);
                              const p = totAll > 0 ? (totNB / totAll) * 100 : 0;
                              return <span className={`${p <= 30 ? "text-emerald-600" : p <= 60 ? "text-amber-600" : "text-red-500"}`}>{p.toFixed(0)}%</span>;
                            })()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
                {/* ─── Uitsplitsing per activiteit ─── */}
                {(urenStats?.bureauActivities || []).length > 0 && (() => {
                  const activities = urenStats!.bureauActivities;
                  const maxAct = Math.max(...activities.flatMap(a => a.months), 1);
                  return (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                        <Clock size={18} className="text-amber-500" />
                        <h3 className="text-base font-semibold text-slate-700">Niet-facturabele uren per activiteit</h3>
                        <span className="text-xs text-slate-400 ml-2">{urenYear}</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600 sticky left-0 bg-slate-50 min-w-[200px]">Activiteit</th>
                              {activeMonths.map(m => (
                                <th key={m.idx} className="text-center px-2 py-2 text-xs font-semibold text-slate-600 min-w-[70px]">{m.label}</th>
                              ))}
                              <th className="text-center px-3 py-2 text-xs font-bold text-slate-700 min-w-[80px] bg-slate-100">Totaal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activities.map((act) => (
                              <tr key={act.activity} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-2 font-medium text-slate-700 sticky left-0 bg-white">{act.activity}</td>
                                {activeMonths.map(m => {
                                  const h = act.months[m.idx];
                                  const pct = (h / maxAct) * 100;
                                  return (
                                    <td key={m.idx} className="px-2 py-2 text-center">
                                      {h > 0 ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.max(pct, 3)}%` }} />
                                          </div>
                                          <span className="text-xs text-slate-600">{fmt(h)}</span>
                                        </div>
                                      ) : (
                                        <span className="text-xs text-slate-300">-</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 text-center font-bold text-slate-800 bg-slate-50">{fmt(act.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-300 bg-slate-50">
                              <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-50">Totaal</td>
                              {activeMonths.map(m => {
                                const tot = activities.reduce((s, a) => s + a.months[m.idx], 0);
                                return <td key={m.idx} className="px-2 py-2 text-center font-bold text-slate-700">{fmt(tot)}</td>;
                              })}
                              <td className="px-3 py-2 text-center font-bold text-orange-600 bg-slate-100">
                                {fmt(activities.reduce((s, a) => s + a.total, 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </>
      )}

      {/* Detail modal */}
      {(urenDetail || loadingDetail) && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !loadingDetail && setUrenDetail(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {loadingDetail ? (
              <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw size={18} className="animate-spin" /> Detail laden...
              </div>
            ) : urenDetail && (
              <>
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">{urenDetail.employee}</h3>
                    <p className="text-sm text-slate-500">{MONTH_LABELS[urenDetail.month]} {urenDetail.year} — {fmt(urenDetail.totalHours)} uur, {urenDetail.billablePercent}% facturabel</p>
                  </div>
                  <button onClick={() => setUrenDetail(null)} className="p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer">
                    <X size={18} className="text-slate-500" />
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  {/* ── Project samenvatting ── */}
                  {(() => {
                    const projSummary = new Map<string, { hours: number; billable: number }>();
                    for (const log of urenDetail.logs) {
                      const key = log.project || "(geen project)";
                      const cur = projSummary.get(key) || { hours: 0, billable: 0 };
                      cur.hours += log.hours;
                      if (log.isBillable) cur.billable += log.hours;
                      projSummary.set(key, cur);
                    }
                    const projects = Array.from(projSummary.entries()).sort((a, b) => b[1].hours - a[1].hours);
                    const maxH = Math.max(...projects.map(([, v]) => v.hours), 1);
                    return (
                      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
                        <p className="text-xs font-semibold text-slate-500 mb-2">Uren per project</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {projects.map(([proj, data]) => {
                            const pct = data.hours > 0 ? (data.billable / data.hours) * 100 : 0;
                            return (
                              <div key={proj} className="flex items-center gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between text-xs mb-0.5">
                                    <span className="text-slate-700 font-medium truncate max-w-[180px]" title={proj}>{proj}</span>
                                    <span className="text-slate-500 ml-2 whitespace-nowrap">{fmt(data.hours)} uur
                                      {data.billable > 0 && <span className="text-emerald-600 ml-1">({fmt(data.billable)} fact.)</span>}
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full flex">
                                      <div className="h-full bg-emerald-500" style={{ width: `${(data.billable / maxH) * 100}%` }} />
                                      <div className="h-full bg-3bm-teal/30" style={{ width: `${((data.hours - data.billable) / maxH) * 100}%` }} />
                                    </div>
                                  </div>
                                </div>
                                <span className={`text-xs font-bold min-w-[32px] text-right ${pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-500"}`}>
                                  {pct.toFixed(0)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {/* ── Detail regels ── */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600">Datum</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600">Project</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600">Activiteit</th>
                        <th className="text-right px-4 py-2 text-xs font-semibold text-slate-600">Uren</th>
                        <th className="text-center px-4 py-2 text-xs font-semibold text-slate-600">Facturabel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {urenDetail.logs.map((log, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-600 font-mono text-xs">{log.date}</td>
                          <td className="px-4 py-2 text-slate-700">{log.project || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2 text-slate-500 text-xs">{log.activity || "—"}</td>
                          <td className="px-4 py-2 text-right font-mono text-slate-700">{fmt(log.hours)}</td>
                          <td className="px-4 py-2 text-center">
                            {log.isBillable ? (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">Ja</span>
                            ) : (
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs">Nee</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td className="px-4 py-2 font-bold text-slate-700" colSpan={3}>Totaal</td>
                        <td className="px-4 py-2 text-right font-bold font-mono text-slate-800">{fmt(urenDetail.totalHours)}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`text-sm font-bold ${urenDetail.billablePercent >= 70 ? "text-emerald-600" : urenDetail.billablePercent >= 40 ? "text-amber-600" : "text-red-500"}`}>
                            {urenDetail.billablePercent}%
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
