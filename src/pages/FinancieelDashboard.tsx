import { useEffect, useState, useMemo } from "react";
import { fetchAll, fetchCount } from "../lib/erpnext";
import {
  BarChart3, RefreshCw, Landmark, FileText, ShoppingCart,
  TrendingUp, AlertTriangle, Filter,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";

interface InvoiceTrend {
  month: string;
  label: string;
  outstanding: number;
  count: number;
}

const euro = (v: number) => `€ ${v.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;

export default function FinancieelDashboard() {
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // KPIs
  const [bankTransactions, setBankTransactions] = useState(0);
  const [unpaidPurchase, setUnpaidPurchase] = useState<{count: number; total: number}>({count: 0, total: 0});
  const [unpaidSales, setUnpaidSales] = useState<{count: number; total: number}>({count: 0, total: 0});

  // Trend data
  const [salesInvoices, setSalesInvoices] = useState<{posting_date: string; outstanding_amount: number}[]>([]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const companyFilter: unknown[][] = company ? [["company", "=", company]] : [];
      const dateFilters: unknown[][] = [];
      if (fromDate) dateFilters.push(["posting_date", ">=", fromDate]);
      if (toDate) dateFilters.push(["posting_date", "<=", toDate]);

      const [bankCount, purchaseList, salesList] = await Promise.all([
        // Bank Transactions not reconciled
        fetchCount("Bank Transaction", [
          ...companyFilter,
          ["status", "!=", "Reconciled"],
          ["status", "!=", "Cancelled"],
          ["docstatus", "=", 1],
        ]).catch(() => 0),

        // Outstanding Purchase Invoices
        fetchAll<{outstanding_amount: number}>(
          "Purchase Invoice",
          ["outstanding_amount"],
          [
            ...companyFilter,
            ...dateFilters,
            ["docstatus", "=", 1],
            ["outstanding_amount", ">", 0],
          ]
        ),

        // Outstanding Sales Invoices with dates for trend
        fetchAll<{posting_date: string; outstanding_amount: number}>(
          "Sales Invoice",
          ["posting_date", "outstanding_amount"],
          [
            ...companyFilter,
            ...dateFilters,
            ["docstatus", "=", 1],
            ["outstanding_amount", ">", 0],
          ],
          "posting_date asc"
        ),
      ]);

      setBankTransactions(bankCount);
      setUnpaidPurchase({
        count: purchaseList.length,
        total: purchaseList.reduce((s, i) => s + i.outstanding_amount, 0),
      });
      setUnpaidSales({
        count: salesList.length,
        total: salesList.reduce((s, i) => s + i.outstanding_amount, 0),
      });
      setSalesInvoices(salesList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [company, fromDate, toDate]);

  // Build monthly trend
  const trendData = useMemo<InvoiceTrend[]>(() => {
    const months = new Map<string, {outstanding: number; count: number}>();
    for (const inv of salesInvoices) {
      const key = inv.posting_date.slice(0, 7); // YYYY-MM
      const current = months.get(key) || {outstanding: 0, count: 0};
      current.outstanding += inv.outstanding_amount;
      current.count++;
      months.set(key, current);
    }
    return Array.from(months.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => {
        const [y, m] = month.split("-");
        const labels = ["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"];
        return {
          month,
          label: `${labels[parseInt(m)-1]} ${y.slice(2)}`,
          ...data,
        };
      });
  }, [salesInvoices]);

  const maxTrend = Math.max(...trendData.map(d => d.outstanding), 1);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-3bm-teal/10 rounded-lg">
            <BarChart3 className="text-3bm-teal" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Financieel Dashboard</h2>
        </div>
        <button onClick={loadData} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Vernieuwen
        </button>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}

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

      {/* Chart: Outstanding over time */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-3bm-teal" />
          Openstaande verkoopfacturen per maand
        </h3>
        {loading ? (
          <div className="h-64 flex items-center justify-center text-slate-400">Laden...</div>
        ) : trendData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400">Geen data</div>
        ) : (
          <div className="flex items-end gap-1 h-64">
            {trendData.map((d) => (
              <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full group">
                <div className="relative w-full flex justify-center mb-1">
                  <div className="absolute -top-10 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {d.count} facturen - {euro(d.outstanding)}
                  </div>
                  <div
                    className="w-full max-w-[40px] bg-3bm-teal rounded-t hover:bg-3bm-teal-dark transition-colors"
                    style={{ height: `${Math.max((d.outstanding / maxTrend) * 100, d.outstanding > 0 ? 3 : 0)}%`, minHeight: d.outstanding > 0 ? '4px' : '0' }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 -rotate-45 origin-top-left whitespace-nowrap">{d.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
