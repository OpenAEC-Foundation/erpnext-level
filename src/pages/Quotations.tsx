import { useEffect, useState, useMemo } from "react";
import { fetchList, getErpNextLinkUrl } from "../lib/erpnext";
import { FileBarChart, RefreshCw, Search, Filter, ChevronDown, Plus } from "lucide-react";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";

interface Quotation {
  name: string;
  party_name: string;
  net_total: number;
  transaction_date: string;
  valid_till: string;
  status: string;
  company: string;
}

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Open: "bg-3bm-teal/10 text-3bm-teal-dark",
  Replied: "bg-purple-100 text-purple-700",
  Ordered: "bg-green-100 text-green-700",
  Lost: "bg-red-100 text-red-700",
  Cancelled: "bg-slate-100 text-slate-600",
  Expired: "bg-orange-100 text-orange-700",
};

export default function Quotations() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
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
      const filters: unknown[][] = [["docstatus", "!=", 2]];
      if (statusFilter.length > 0) filters.push(["status", "in", statusFilter]);
      if (company) filters.push(["company", "=", company]);
      if (fromDate) filters.push(["transaction_date", ">=", fromDate]);
      if (toDate) filters.push(["transaction_date", "<=", toDate]);
      const list = await fetchList<Quotation>("Quotation", {
        fields: [
          "name", "party_name", "net_total", "transaction_date",
          "valid_till", "status", "company",
        ],
        filters,
        limit_page_length: 200,
        order_by: "transaction_date desc",
      });
      setQuotations(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [statusFilter, company, fromDate, toDate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return quotations;
    const q = search.toLowerCase();
    return quotations.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.party_name?.toLowerCase().includes(q)
    );
  }, [quotations, search]);



  const totalValue = filtered.reduce((s, q) => s + q.net_total, 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Offertes</h2>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextLinkUrl()}/quotation/new`}
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
          <div className="p-2 bg-indigo-100 rounded-lg">
            <FileBarChart className="text-indigo-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Offertes</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : filtered.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <FileBarChart className="text-green-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Totale waarde (excl. BTW)</p>
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
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[180px]">
                {["Draft", "Open", "Replied", "Ordered", "Lost", "Cancelled", "Expired"].map((s) => (
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
          <input type="text" placeholder="Zoek op offertenummer of klant..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Offertenr</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Klant</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Datum</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Geldig tot</th>
              <th className="text-right px-4 py-3 text-sm font-semibold text-slate-600">Bedrag (excl. BTW)</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Laden...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Geen offertes gevonden</td></tr>
            ) : filtered.map((q) => (
              <tr key={q.name} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium">
                  <a
                    href={`${getErpNextLinkUrl()}/quotation/${q.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-3bm-teal hover:text-3bm-teal-dark hover:underline"
                  >
                    {q.name}
                  </a>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{q.party_name}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{q.transaction_date}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{q.valid_till || "-"}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">
                  {`\u20AC ${q.net_total.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusColors[q.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {q.status}
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
