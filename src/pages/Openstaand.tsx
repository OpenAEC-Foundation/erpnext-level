import { useEffect, useState, useMemo } from "react";
import { fetchAll, getErpNextLinkUrl } from "../lib/erpnext";
import {
  Clock, RefreshCw, Filter, ExternalLink, FileText, Users, Calculator,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";

interface OutstandingInvoice {
  name: string;
  customer_name: string;
  grand_total: number;
  net_total: number;
  outstanding_amount: number;
  posting_date: string;
  due_date: string;
  status: string;
  company: string;
  contact_email: string;
}

interface CustomerTotal {
  customer: string;
  count: number;
  total: number;
}

const euro = (value: number) =>
  value.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

function daysOpen(postingDate: string): number {
  const today = new Date();
  const posted = new Date(postingDate);
  return Math.max(0, Math.round((today.getTime() - posted.getTime()) / 86400000));
}

const agingBuckets = [
  { label: "0-30 dagen", min: 0, max: 30, color: "bg-green-500", lightColor: "bg-green-100", textColor: "text-green-700" },
  { label: "31-60 dagen", min: 31, max: 60, color: "bg-yellow-500", lightColor: "bg-yellow-100", textColor: "text-yellow-700" },
  { label: "61-90 dagen", min: 61, max: 90, color: "bg-orange-500", lightColor: "bg-orange-100", textColor: "text-orange-700" },
  { label: "90+ dagen", min: 91, max: Infinity, color: "bg-red-500", lightColor: "bg-red-100", textColor: "text-red-700" },
];

const statusColors: Record<string, string> = {
  Overdue: "bg-red-100 text-red-700",
  "Partly Paid": "bg-yellow-100 text-yellow-700",
  Unpaid: "bg-3bm-teal/10 text-3bm-teal-dark",
};

function MonthlyChart({ invoices }: { invoices: OutstandingInvoice[] }) {
  const monthData = useMemo(() => {
    const months = new Map<string, { count: number; amount: number }>();
    for (const inv of invoices) {
      const key = inv.posting_date.slice(0, 7);
      const current = months.get(key) || { count: 0, amount: 0 };
      current.count++;
      current.amount += inv.outstanding_amount;
      months.set(key, current);
    }
    return Array.from(months.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => {
        const [y, m] = month.split("-");
        const labels = ["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"];
        return { month, label: `${labels[parseInt(m)-1]} '${y.slice(2)}`, ...data };
      });
  }, [invoices]);

  if (monthData.length === 0) return <div className="h-48 flex items-center justify-center text-slate-400">Geen data</div>;

  const maxAmount = Math.max(...monthData.map(d => d.amount), 1);

  return (
    <div className="flex items-end gap-2 h-48">
      {monthData.map((d) => (
        <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full group">
          <div className="relative w-full flex justify-center">
            <div className="absolute -top-10 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
              {d.count} facturen - {euro(d.amount)}
            </div>
            <div
              className="w-full max-w-[36px] bg-red-400 rounded-t hover:bg-red-500 transition-colors"
              style={{
                height: `${Math.max((d.amount / maxAmount) * 100, d.amount > 0 ? 3 : 0)}%`,
                minHeight: d.amount > 0 ? '4px' : '0'
              }}
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">{d.label}</p>
        </div>
      ))}
    </div>
  );
}

export default function Openstaand() {
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [invoices, setInvoices] = useState<OutstandingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [
        ["docstatus", "=", 1],
        ["outstanding_amount", ">", 0],
      ];
      if (company) filters.push(["company", "=", company]);
      if (fromDate) filters.push(["posting_date", ">=", fromDate]);
      if (toDate) filters.push(["posting_date", "<=", toDate]);

      const list = await fetchAll<OutstandingInvoice>(
        "Sales Invoice",
        ["name", "customer_name", "grand_total", "net_total", "outstanding_amount",
         "posting_date", "due_date", "status", "company", "contact_email"],
        filters,
        "posting_date desc"
      );

      setInvoices(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [company, fromDate, toDate]);

  // KPIs
  const totalOutstanding = invoices.reduce((s, i) => s + i.outstanding_amount, 0);
  const avgPerInvoice = invoices.length > 0 ? totalOutstanding / invoices.length : 0;
  const dso = useMemo(() => {
    if (invoices.length === 0) return 0;
    const totalDays = invoices.reduce((s, i) => s + daysOpen(i.posting_date), 0);
    return Math.round(totalDays / invoices.length);
  }, [invoices]);

  // Aging analysis
  const agingData = useMemo(() => {
    return agingBuckets.map((bucket) => {
      const matches = invoices.filter((inv) => {
        const days = daysOpen(inv.posting_date);
        return days >= bucket.min && days <= bucket.max;
      });
      return {
        ...bucket,
        count: matches.length,
        amount: matches.reduce((s, i) => s + i.outstanding_amount, 0),
      };
    });
  }, [invoices]);

  const maxAgingAmount = Math.max(...agingData.map((b) => b.amount), 1);

  // Top 10 customers
  const topCustomers = useMemo<CustomerTotal[]>(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const inv of invoices) {
      const existing = map.get(inv.customer_name) || { count: 0, total: 0 };
      existing.count++;
      existing.total += inv.outstanding_amount;
      map.set(inv.customer_name, existing);
    }
    return Array.from(map.entries())
      .map(([customer, data]) => ({ customer, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [invoices]);

  const maxCustomerTotal = topCustomers.length > 0 ? topCustomers[0].total : 1;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Clock className="text-amber-600" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Openstaand</h2>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextLinkUrl()}/sales-invoice?status=Unpaid&status=Overdue&company=${encodeURIComponent(company)}`}
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

      {/* Company filter */}
      <div className="mb-6 flex items-center gap-3">
        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-red-100 rounded-lg">
              <FileText className="text-red-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Totaal openstaand</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(totalOutstanding)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-3bm-teal/10 rounded-lg">
              <FileText className="text-3bm-teal" size={20} />
            </div>
            <p className="text-sm text-slate-500">Aantal facturen</p>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {loading ? "..." : invoices.length}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Calculator className="text-purple-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Gemiddeld per factuur</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(avgPerInvoice)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Clock className="text-orange-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">DSO (gem. dagen open)</p>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {loading ? "..." : dso}
            {!loading && <span className="text-base font-normal text-slate-400 ml-1">dagen</span>}
          </p>
        </div>
      </div>

      {/* Outstanding Trend */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h3 className="text-lg font-semibold text-slate-700 mb-4">Openstaand per maand</h3>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-slate-400">Laden...</div>
        ) : (
          <MonthlyChart invoices={invoices} />
        )}
      </div>

      {/* Aging Analysis */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <h3 className="text-lg font-semibold text-slate-700 mb-4">Ouderdomsanalyse</h3>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-slate-400">Laden...</div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {agingData.map((bucket) => (
              <div key={bucket.label} className="text-center">
                <div className="h-32 flex items-end justify-center mb-3">
                  <div className="w-full max-w-[80px] relative group">
                    {/* Tooltip */}
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {bucket.count} facturen - {euro(bucket.amount)}
                    </div>
                    <div
                      className={`w-full ${bucket.color} rounded-t transition-all hover:opacity-80`}
                      style={{ height: `${Math.max((bucket.amount / maxAgingAmount) * 100, bucket.amount > 0 ? 4 : 0)}%`, minHeight: bucket.amount > 0 ? "8px" : "0px" }}
                    />
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-700">{bucket.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{bucket.count} facturen</p>
                <p className="text-sm font-medium text-slate-800 mt-0.5">{euro(bucket.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top 10 Customers */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Users size={16} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-600">Top 10 klanten met hoogste openstaand bedrag</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Klant</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Facturen</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Openstaand</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 w-48">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">Laden...</td>
              </tr>
            ) : topCustomers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">Geen data</td>
              </tr>
            ) : (
              topCustomers.map((c) => (
                <tr key={c.customer} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-700">{c.customer}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 text-right">{c.count}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-slate-800 text-right">{euro(c.total)}</td>
                  <td className="px-4 py-3">
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-full"
                        style={{ width: `${(c.total / maxCustomerTotal) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-600">Alle openstaande facturen</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-600">Factuurnr</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-600">Klant</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-600">Factuurdatum</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-600">Vervaldatum</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-slate-600">Bedrag (excl. BTW)</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-slate-600">Openstaand</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-slate-600">Dagen open</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">Laden...</td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">Geen openstaande facturen</td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const days = daysOpen(inv.posting_date);
                const agingColor = days <= 30
                  ? "text-green-600"
                  : days <= 60
                    ? "text-yellow-600"
                    : days <= 90
                      ? "text-orange-600"
                      : "text-red-600";

                return (
                  <tr key={inv.name} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 text-sm font-medium">
                      <a
                        href={`${getErpNextLinkUrl()}/sales-invoice/${inv.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-3bm-teal hover:text-3bm-teal-dark hover:underline"
                      >
                        {inv.name}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-slate-700">{inv.customer_name}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-500">{inv.posting_date}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-500">{inv.due_date || "-"}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-700 text-right">{euro(inv.net_total)}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-orange-600 text-right">
                      {euro(inv.outstanding_amount)}
                    </td>
                    <td className={`px-3 py-2.5 text-sm font-semibold text-right ${agingColor}`}>
                      {days}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[inv.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Summary row */}
        {!loading && invoices.length > 0 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-sm">
            <span className="text-slate-500">{invoices.length} facturen</span>
            <span className="font-semibold text-slate-700">
              Totaal openstaand: {euro(totalOutstanding)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
