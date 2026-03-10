import { useEffect, useState, useMemo } from "react";
import { fetchList, getErpNextLinkUrl } from "../lib/erpnext";
import { ClipboardCheck, RefreshCw, Search, Filter, Plus, ChevronDown } from "lucide-react";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";

interface SalesOrder {
  name: string;
  customer_name: string;
  net_total: number;
  transaction_date: string;
  delivery_date: string;
  status: string;
  per_delivered: number;
  per_billed: number;
  company: string;
}

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  "To Deliver and Bill": "bg-3bm-teal/10 text-3bm-teal-dark",
  "To Bill": "bg-yellow-100 text-yellow-700",
  "To Deliver": "bg-purple-100 text-purple-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
  Closed: "bg-slate-100 text-slate-600",
  "On Hold": "bg-orange-100 text-orange-700",
};

export default function SalesOrders() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  function toggleStatus(s: string) {
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [["docstatus", "in", [0, 1]]];
      if (statusFilter.length > 0) filters.push(["status", "in", statusFilter]);
      if (company) filters.push(["company", "=", company]);
      if (fromDate) filters.push(["transaction_date", ">=", fromDate]);
      if (toDate) filters.push(["transaction_date", "<=", toDate]);
      const list = await fetchList<SalesOrder>("Sales Order", {
        fields: [
          "name", "customer_name", "net_total", "transaction_date",
          "delivery_date", "status", "per_delivered", "per_billed", "company",
        ],
        filters,
        limit_page_length: 200,
        order_by: "transaction_date desc",
      });
      setOrders(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [statusFilter, company, fromDate, toDate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q)
    );
  }, [orders, search]);



  const totalValue = filtered.reduce((s, o) => s + o.net_total, 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Opdrachtbevestigingen</h2>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextLinkUrl()}/sales-order/new`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Plus size={16} />
            Nieuw
          </a>
          <button onClick={loadData} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Vernieuwen
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      <div className="mb-4 flex items-center gap-4">
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-teal-100 rounded-lg">
            <ClipboardCheck className="text-teal-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Opdrachten</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : filtered.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <ClipboardCheck className="text-green-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Totale waarde</p>
            <p className="text-2xl font-bold text-slate-800">
              {loading ? "..." : `\u20AC ${totalValue.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`}
            </p>
          </div>
        </div>

        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />

        <div className="relative">
          <button
            onClick={() => setStatusDropdownOpen((o) => !o)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal flex items-center gap-2 cursor-pointer"
          >
            {statusFilter.length === 0
              ? "Alle statussen"
              : `${statusFilter.length} status${statusFilter.length > 1 ? "sen" : ""}`}
            <ChevronDown size={14} className="text-slate-400" />
          </button>
          {statusDropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setStatusDropdownOpen(false)} />
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[200px]">
                {["Draft", "To Deliver and Bill", "To Bill", "To Deliver", "Completed", "Cancelled", "Closed", "On Hold"].map((s) => (
                  <label
                    key={s}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={statusFilter.includes(s)}
                      onChange={() => toggleStatus(s)}
                      className="rounded border-slate-300 text-3bm-teal focus:ring-3bm-teal"
                    />
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[s] ?? "bg-slate-100 text-slate-600"}`}>
                      {s}
                    </span>
                  </label>
                ))}
                {statusFilter.length > 0 && (
                  <button
                    onClick={() => { setStatusFilter([]); setStatusDropdownOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:text-slate-600 border-t border-slate-100 cursor-pointer"
                  >
                    Wis filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Zoek op opdrachtnummer of klant..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Opdrachtnr</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Klant</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Datum</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Leverdatum</th>
              <th className="text-right px-4 py-3 text-sm font-semibold text-slate-600">Bedrag (excl. BTW)</th>
              <th className="text-right px-4 py-3 text-sm font-semibold text-slate-600">Geleverd</th>
              <th className="text-right px-4 py-3 text-sm font-semibold text-slate-600">Gefactureerd</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Laden...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Geen opdrachten gevonden</td></tr>
            ) : filtered.map((o) => (
              <tr key={o.name} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium">
                  <a
                    href={`${getErpNextLinkUrl()}/sales-order/${o.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-3bm-teal hover:text-3bm-teal-dark hover:underline"
                  >
                    {o.name}
                  </a>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{o.customer_name}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{o.transaction_date}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{o.delivery_date || "-"}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">
                  {`\u20AC ${o.net_total.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-3bm-teal rounded-full" style={{ width: `${o.per_delivered}%` }} />
                    </div>
                    <span className="text-xs text-slate-500">{o.per_delivered}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${o.per_billed}%` }} />
                    </div>
                    <span className="text-xs text-slate-500">{o.per_billed}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusColors[o.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {o.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
