import { useEffect, useState, useMemo } from "react";
import { fetchList, getErpNextLinkUrl } from "../lib/erpnext";
import {
  RefreshCw, Filter, Search, ExternalLink,
  DollarSign, Clock, CheckCircle, FileText, Plus,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";

interface ExpenseClaim {
  name: string;
  employee_name: string;
  posting_date: string;
  total_claimed_amount: number;
  status: string;
  approval_status: string;
  company: string;
  expense_type?: string;
  expense_approver?: string;
}

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Unpaid: "bg-orange-100 text-orange-700",
  Paid: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  Cancelled: "bg-gray-100 text-gray-500",
};

const approvalColors: Record<string, string> = {
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  Draft: "bg-slate-100 text-slate-600",
};

const euro = (v: number) =>
  `\u20AC ${v.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;

export default function Onkosten() {
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [
        ["docstatus", "!=", 2],
      ];
      if (company) filters.push(["company", "=", company]);
      if (statusFilter) filters.push(["status", "=", statusFilter]);
      if (fromDate) filters.push(["posting_date", ">=", fromDate]);
      if (toDate) filters.push(["posting_date", "<=", toDate]);

      const list = await fetchList<ExpenseClaim>("Expense Claim", {
        fields: [
          "name", "employee_name", "posting_date", "total_claimed_amount",
          "status", "approval_status", "company", "expense_type", "expense_approver",
        ],
        filters,
        limit_page_length: 200,
        order_by: "posting_date desc",
      });
      setClaims(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [company, statusFilter, fromDate, toDate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return claims;
    const q = search.toLowerCase();
    return claims.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.employee_name?.toLowerCase().includes(q)
    );
  }, [claims, search]);

  const totalClaimed = claims.reduce((s, c) => s + c.total_claimed_amount, 0);
  const unpaidClaims = claims.filter((c) => c.status === "Unpaid");
  const unpaidAmount = unpaidClaims.reduce((s, c) => s + c.total_claimed_amount, 0);
  const paidClaims = claims.filter((c) => c.status === "Paid");
  const paidAmount = paidClaims.reduce((s, c) => s + c.total_claimed_amount, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Onkostendeclaraties</h2>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextLinkUrl()}/expense-claim/new`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-white bg-3bm-teal rounded-lg hover:bg-3bm-teal-dark"
          >
            <Plus size={14} /> Nieuw
          </a>
          <a
            href={`${getErpNextLinkUrl()}/expense-claim?company=${encodeURIComponent(company)}`}
            target="_blank" rel="noopener noreferrer"
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
      <div className="mb-4 flex items-center gap-3">
        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          <option value="">Alle statussen</option>
          <option value="Draft">Draft</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Paid">Paid</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-3bm-teal/10 rounded-lg"><DollarSign className="text-3bm-teal" size={20} /></div>
            <p className="text-sm text-slate-500">Totaal gedeclareerd</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">{loading ? "..." : euro(totalClaimed)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-orange-100 rounded-lg"><Clock className="text-orange-600" size={20} /></div>
            <p className="text-sm text-slate-500">Openstaand</p>
          </div>
          <p className="text-2xl font-bold text-orange-600">{loading ? "..." : euro(unpaidAmount)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-green-100 rounded-lg"><CheckCircle className="text-green-600" size={20} /></div>
            <p className="text-sm text-slate-500">Betaald</p>
          </div>
          <p className="text-2xl font-bold text-green-600">{loading ? "..." : euro(paidAmount)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-purple-100 rounded-lg"><FileText className="text-purple-600" size={20} /></div>
            <p className="text-sm text-slate-500">Aantal declaraties</p>
          </div>
          <p className="text-3xl font-bold text-slate-800">{loading ? "..." : claims.length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Zoek op medewerker of declaratienr..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Declaratie</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Medewerker</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Datum</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Bedrag</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Goedkeuring</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Type / Goedkeurder</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Laden...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Geen declaraties gevonden</td></tr>
            ) : (
              filtered.map((claim) => (
                <tr key={claim.name} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium">
                    <a
                      href={`${getErpNextLinkUrl()}/expense-claim/${claim.name}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-3bm-teal hover:text-3bm-teal-dark hover:underline"
                    >
                      {claim.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{claim.employee_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{claim.posting_date}</td>
                  <td className="px-4 py-3 text-sm text-slate-700 text-right">
                    {euro(claim.total_claimed_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[claim.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {claim.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${approvalColors[claim.approval_status] ?? "bg-slate-100 text-slate-600"}`}>
                      {claim.approval_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {claim.expense_type || claim.expense_approver || "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      {!loading && filtered.length > 0 && (
        <div className="mt-2 px-3 py-2 bg-slate-50 rounded-lg flex items-center justify-between text-sm">
          <span className="text-slate-500">{filtered.length} declaraties</span>
          <span className="font-semibold text-slate-700">
            Totaal: {euro(filtered.reduce((s, c) => s + c.total_claimed_amount, 0))}
          </span>
        </div>
      )}
    </div>
  );
}
