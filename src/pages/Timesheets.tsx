import { Fragment, useEffect, useState, useMemo } from "react";
import { fetchList, fetchAll, fetchDocument, callMethod, getErpNextLinkUrl } from "../lib/erpnext";
import UrenBoekenWidget from "../components/UrenBoekenWidget";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";
import { useEmployees, useProjects } from "../lib/DataContext";
import {
  Timer, RefreshCw, Filter, Search, ExternalLink,
  Clock, CheckCircle, DollarSign, FileText, ChevronDown, ChevronRight,
  Plus, ClipboardCheck, X, AlertTriangle, ShieldCheck,
} from "lucide-react";
import {
  type TimesheetDetail as TSDetail,
  type ValidationWarning,
  type ProjectInfo,
  runTimesheetValidation,
  getDetailHighlights,
  warningTypeLabels,
} from "../lib/timesheetValidation";

interface Timesheet {
  name: string;
  employee: string;
  employee_name: string;
  total_hours: number;
  total_billed_hours: number;
  total_billed_amount: number;
  start_date: string;
  end_date: string;
  status: string;
  company: string | null;
}

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Submitted: "bg-3bm-teal/10 text-3bm-teal-dark",
  Billed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
};

const euro = (v: number) =>
  `\u20AC ${v.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;



export default function Timesheets() {
  const allEmployees = useEmployees();
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [activeTab, setActiveTab] = useState<"overzicht" | "boeken" | "goedkeuren">("overzicht");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [];
      if (fromDate) filters.push(["start_date", ">=", fromDate]);
      if (toDate) filters.push(["start_date", "<=", toDate]);
      const list = await fetchList<Timesheet>("Timesheet", {
        fields: [
          "name", "employee", "employee_name", "total_hours", "total_billed_hours",
          "total_billed_amount", "start_date", "end_date", "status", "company",
        ],
        filters,
        limit_page_length: 200,
        order_by: "start_date desc",
      });
      setTimesheets(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [fromDate, toDate]);

  // Filter by company via employee's company (timesheets often have empty company)
  const employeeIdSet = useMemo(() => {
    if (!company) return null;
    const set = new Set<string>();
    for (const emp of allEmployees) {
      if (emp.company === company) set.add(emp.name);
    }
    return set;
  }, [allEmployees, company]);

  const companyFiltered = useMemo(() => {
    if (!employeeIdSet) return timesheets;
    return timesheets.filter((t) => employeeIdSet.has(t.employee));
  }, [timesheets, employeeIdSet]);

  // Get unique employees from company-filtered data
  const employees = useMemo(() => {
    const set = new Set<string>();
    for (const t of companyFiltered) if (t.employee_name) set.add(t.employee_name);
    return Array.from(set).sort();
  }, [companyFiltered]);

  function toggleStatus(s: string) {
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  // Apply employee filter
  const employeeFiltered = useMemo(() => {
    if (!employeeFilter) return companyFiltered;
    return companyFiltered.filter((t) => t.employee_name === employeeFilter);
  }, [companyFiltered, employeeFilter]);

  // Apply status filter
  const statusFiltered = useMemo(() => {
    if (statusFilter.length === 0) return employeeFiltered;
    return employeeFiltered.filter((t) => statusFilter.includes(t.status));
  }, [employeeFiltered, statusFilter]);

  // Apply search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return statusFiltered;
    const q = search.toLowerCase();
    return statusFiltered.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.employee_name?.toLowerCase().includes(q)
    );
  }, [statusFiltered, search]);

  const totalHours = statusFiltered.reduce((s, t) => s + t.total_hours, 0);
  const billedHours = statusFiltered.reduce((s, t) => s + t.total_billed_hours, 0);
  const billedAmount = statusFiltered.reduce((s, t) => s + t.total_billed_amount, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Timesheets</h2>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextLinkUrl()}/timesheet`}
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

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setActiveTab("overzicht")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            activeTab === "overzicht"
              ? "bg-3bm-teal text-white"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <Timer size={16} /> Overzicht
        </button>
        <button
          onClick={() => setActiveTab("boeken")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            activeTab === "boeken"
              ? "bg-3bm-teal text-white"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <Plus size={16} /> Uren boeken
        </button>
        <button
          onClick={() => setActiveTab("goedkeuren")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            activeTab === "goedkeuren"
              ? "bg-3bm-teal text-white"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <ClipboardCheck size={16} /> Timesheets goedkeuren
        </button>
      </div>

      {activeTab === "overzicht" && (<>
      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          <option value="">Alle medewerkers</option>
          {employees.map((emp) => (
            <option key={emp} value={emp}>{emp}</option>
          ))}
        </select>
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
                {["Draft", "Submitted", "Billed", "Cancelled"].map((s) => (
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
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-3bm-teal/10 rounded-lg"><Clock className="text-3bm-teal" size={20} /></div>
            <p className="text-sm text-slate-500">Totaal uren</p>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {loading ? "..." : totalHours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-green-100 rounded-lg"><CheckCircle className="text-green-600" size={20} /></div>
            <p className="text-sm text-slate-500">Gefactureerde uren</p>
          </div>
          <p className="text-3xl font-bold text-green-600">
            {loading ? "..." : billedHours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-purple-100 rounded-lg"><DollarSign className="text-purple-600" size={20} /></div>
            <p className="text-sm text-slate-500">Gefactureerd bedrag</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">{loading ? "..." : euro(billedAmount)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-orange-100 rounded-lg"><FileText className="text-orange-600" size={20} /></div>
            <p className="text-sm text-slate-500">Aantal timesheets</p>
          </div>
          <p className="text-3xl font-bold text-slate-800">{loading ? "..." : statusFiltered.length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Zoek op medewerker of timesheetnr..."
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
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Timesheet</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Medewerker</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Startdatum</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Einddatum</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Totaal uren</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Gefact. uren</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600">Bedrag</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Laden...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Geen timesheets gevonden</td></tr>
            ) : (
              filtered.map((ts) => (
                <tr key={ts.name} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium">
                    <a
                      href={`${getErpNextLinkUrl()}/timesheet/${ts.name}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-3bm-teal hover:text-3bm-teal-dark hover:underline"
                    >
                      {ts.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{ts.employee_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{ts.start_date}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{ts.end_date}</td>
                  <td className="px-4 py-3 text-sm text-slate-700 text-right">
                    {ts.total_hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 text-right">
                    {ts.total_billed_hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700 text-right">
                    {euro(ts.total_billed_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[ts.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {ts.status}
                    </span>
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
          <span className="text-slate-500">{filtered.length} timesheets</span>
          <span className="font-semibold text-slate-700">
            Totaal: {filtered.reduce((s, t) => s + t.total_hours, 0).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uren
            {" | "}
            {euro(filtered.reduce((s, t) => s + t.total_billed_amount, 0))}
          </span>
        </div>
      )}
      </>)}

      {activeTab === "boeken" && <UrenBoekenWidget showWeekTable={true} layout="side-by-side" />}
      {activeTab === "goedkeuren" && <TimesheetGoedkeuren />}
    </div>
  );
}

/* ─── TimesheetDetailsTable ─── */

const DAY_LABELS = ["zo", "ma", "di", "wo", "do", "vr", "za"];

type GroupByOption = "project" | "dag" | "activiteit" | "taak" | null;

interface TimesheetDetailsTableProps {
  details: TSDetail[];
  projects: ProjectInfo[];
  employeeCompany?: string;
  defaultActivityType?: string;
  loading?: boolean;
  defaultGroupBy?: GroupByOption;
  onUpdateDetail?: (detail: TSDetail, field: "task" | "description" | "billable", value: string) => Promise<void>;
}

function formatTimeRange(fromTime: string, hours: number): string {
  if (!fromTime) return "";
  const start = new Date(fromTime);
  const end = new Date(start.getTime() + hours * 3600000);
  const fmt = (d: Date) => `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  return `${fmt(start)}-${fmt(end)}`;
}

function getDayLabel(fromTime: string): string {
  if (!fromTime) return "";
  const d = new Date(fromTime);
  return DAY_LABELS[d.getDay()];
}

function getDateKey(fromTime: string): string {
  if (!fromTime) return "";
  return fromTime.split(" ")[0] || fromTime.split("T")[0] || "";
}

export function TimesheetDetailsTable({
  details,
  projects,
  employeeCompany,
  defaultActivityType,
  loading,
  defaultGroupBy = null,
  onUpdateDetail,
}: TimesheetDetailsTableProps) {
  const [groupBy, setGroupBy] = useState<GroupByOption>(defaultGroupBy);
  const [editingCell, setEditingCell] = useState<{ name: string; field: "task" | "description" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const highlights = useMemo(
    () => getDetailHighlights(details, employeeCompany, defaultActivityType, projects),
    [details, employeeCompany, defaultActivityType, projects]
  );

  function toggleGroupBy(col: GroupByOption) {
    setGroupBy((prev) => (prev === col ? null : col));
  }

  const headerClass = (col: GroupByOption) =>
    `text-left px-3 py-2 text-xs font-semibold cursor-pointer select-none ${
      groupBy === col ? "text-3bm-teal underline" : "text-slate-600"
    }`;

  // Grouping logic
  const grouped = useMemo(() => {
    if (!groupBy) return null;

    const map = new Map<string, TSDetail[]>();

    for (const d of details) {
      let key: string;
      switch (groupBy) {
        case "project":
          key = d.project || "(geen project)";
          break;
        case "dag":
          key = getDateKey(d.from_time);
          break;
        case "activiteit":
          key = d.activity_type || "(geen activiteit)";
          break;
        case "taak":
          key = d.task_name || d.task || "(geen taak)";
          break;
        default:
          key = "";
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }

    // For day grouping, add empty workdays
    if (groupBy === "dag" && details.length > 0) {
      const allDates = details.map((d) => getDateKey(d.from_time)).filter(Boolean);
      if (allDates.length > 0) {
        const sorted = allDates.sort();
        const start = new Date(sorted[0] + "T00:00:00");
        const end = new Date(sorted[sorted.length - 1] + "T00:00:00");
        const cur = new Date(start);
        while (cur <= end) {
          const day = cur.getDay();
          if (day >= 1 && day <= 5) {
            const key = cur.toISOString().split("T")[0];
            if (!map.has(key)) map.set(key, []);
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
    }

    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [details, groupBy]);

  async function handleCellSave(d: TSDetail, field: "task" | "description") {
    if (!onUpdateDetail || saving) return;
    const currentVal = field === "task" ? (d.task || "") : (d.description || "");
    if (editValue === currentVal) { setEditingCell(null); return; }
    setSaving(true);
    try {
      await onUpdateDetail(d, field, editValue);
    } catch { /* ignore */ }
    setSaving(false);
    setEditingCell(null);
  }

  function renderEditableCell(d: TSDetail, field: "task" | "description", display: string, className: string) {
    const isEditing = editingCell?.name === d.name && editingCell?.field === field;
    if (!onUpdateDetail) {
      return <td className={className}>{display}</td>;
    }
    if (isEditing) {
      return (
        <td className={className}>
          <input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => handleCellSave(d, field)}
            onKeyDown={e => { if (e.key === "Enter") handleCellSave(d, field); if (e.key === "Escape") setEditingCell(null); }}
            className="w-full px-1 py-0.5 text-xs border border-3bm-teal rounded bg-white outline-none"
            disabled={saving}
          />
        </td>
      );
    }
    return (
      <td
        className={`${className} cursor-pointer hover:bg-blue-50 hover:text-blue-700`}
        onClick={() => {
          const val = field === "task" ? (d.task || "") : (d.description || "");
          setEditValue(val);
          setEditingCell({ name: d.name, field });
        }}
        title="Klik om te bewerken"
      >
        {display}
      </td>
    );
  }

  // Build a map from project ID to project_name for display
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      if (p.project_name) map.set(p.name, p.project_name);
    }
    return map;
  }, [projects]);

  function renderRow(d: TSDetail) {
    const hl = highlights.get(d.name) || {};
    return (
      <tr key={d.name} className="border-b border-slate-50 hover:bg-slate-50 text-xs">
        <td className={`px-3 py-1.5 ${hl.from_time || ""}`}>{getDayLabel(d.from_time)}</td>
        <td className={`px-3 py-1.5 ${hl.from_time || ""}`}>{formatTimeRange(d.from_time, d.hours)}</td>
        <td className={`px-3 py-1.5 text-right ${hl.hours || ""}`}>{d.hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}</td>
        <td className={`px-3 py-1.5 ${hl.project || ""}`}>{projectNameMap.get(d.project) || d.project || "-"}</td>
        {renderEditableCell(d, "task", d.task_name || d.task || "-", `px-3 py-1.5 ${hl.task || ""}`)}
        {renderEditableCell(d, "description", d.description || "-", "px-3 py-1.5 text-slate-500 max-w-[200px] truncate")}
        <td className="px-3 py-1.5 text-center">
          <input
            type="checkbox"
            checked={!!d.billable}
            onChange={() => {
              if (onUpdateDetail) {
                onUpdateDetail(d, "billable", d.billable ? "0" : "1");
              }
            }}
            disabled={!onUpdateDetail || saving}
            className="cursor-pointer accent-3bm-teal"
          />
        </td>
      </tr>
    );
  }

  if (loading) {
    return <div className="text-center text-slate-400 py-4 text-sm">Details laden...</div>;
  }

  if (details.length === 0) {
    return <div className="text-center text-slate-400 py-4 text-sm">Geen details gevonden</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className={headerClass("dag")} onClick={() => toggleGroupBy("dag")}>Dag</th>
            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Tijd</th>
            <th className="text-right px-3 py-2 text-xs font-semibold text-slate-600">Uren</th>
            <th className={headerClass("project")} onClick={() => toggleGroupBy("project")}>Project</th>
            <th className={headerClass("taak")} onClick={() => toggleGroupBy("taak")}>Taak</th>
            <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600">Omschrijving</th>
            <th className="text-center px-3 py-2 text-xs font-semibold text-slate-600">Facturabel</th>
          </tr>
        </thead>
        <tbody>
          {grouped ? (
            grouped.map(([groupKey, items]) => {
              const groupTotal = items.reduce((s, d) => s + d.hours, 0);
              let groupLabel = groupKey;
              if (groupBy === "dag" && groupKey) {
                const dt = new Date(groupKey + "T00:00:00");
                groupLabel = `${DAY_LABELS[dt.getDay()]} ${dt.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`;
              } else if (groupBy === "project" && groupKey && groupKey !== "(geen project)") {
                const pName = projectNameMap.get(groupKey);
                if (pName) groupLabel = `${groupKey} — ${pName}`;
              }
              return (
                <Fragment key={groupKey}>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <td colSpan={2} className="px-3 py-1.5 text-xs font-semibold text-slate-700">{groupLabel}</td>
                    <td className="px-3 py-1.5 text-xs font-semibold text-slate-700 text-right">
                      {groupTotal.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
                    </td>
                    <td colSpan={4} />
                  </tr>
                  {items.map(renderRow)}
                </Fragment>
              );
            })
          ) : (
            details.map(renderRow)
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 bg-slate-50">
            <td colSpan={2} className="px-3 py-1.5 text-xs font-semibold text-slate-700">Totaal</td>
            <td className="px-3 py-1.5 text-xs font-semibold text-slate-700 text-right">
              {details.reduce((s, d) => s + d.hours, 0).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
            </td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ─── ValidationModal ─── */

interface ValidationModalProps {
  warnings: ValidationWarning[];
  onClose: () => void;
  onApprove: () => void;
  tsName: string;
}

function ValidationModal({ warnings, onClose, onApprove, tsName }: ValidationModalProps) {
  const hasWarnings = warnings.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between ${hasWarnings ? "bg-amber-50 border-b border-amber-200" : "bg-green-50 border-b border-green-200"}`}>
          <div className="flex items-center gap-2">
            {hasWarnings ? (
              <AlertTriangle size={20} className="text-amber-600" />
            ) : (
              <ShieldCheck size={20} className="text-green-600" />
            )}
            <h3 className={`font-semibold ${hasWarnings ? "text-amber-800" : "text-green-800"}`}>
              {hasWarnings ? `${warnings.length} waarschuwing${warnings.length > 1 ? "en" : ""}` : "Geen waarschuwingen"}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-sm text-slate-600 mb-3">
            Timesheet: <span className="font-mono font-medium">{tsName}</span>
          </p>
          {hasWarnings ? (
            <ul className="space-y-2 max-h-60 overflow-y-auto">
              {warnings.map((w, i) => {
                const badge = warningTypeLabels[w.type];
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${badge.color}`}>
                      {badge.label}
                    </span>
                    <span className="text-slate-700">{w.message}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-green-700">Alle controles zijn doorstaan. Dit timesheet kan worden goedgekeurd.</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Annuleren
          </button>
          <button
            onClick={onApprove}
            className={`px-4 py-2 text-sm text-white rounded-lg cursor-pointer flex items-center gap-1 ${
              hasWarnings
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-3bm-teal hover:bg-3bm-teal-dark"
            }`}
          >
            <CheckCircle size={14} />
            Goedkeuren
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Timesheets Goedkeuren ─── */

type DateRangePreset = "vorige_4_weken" | "vorige_week" | "dit_jaar" | "alle_drafts";

function getDateRangeForPreset(preset: DateRangePreset): { from: string | null; to: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diffToMonday);
  // Always exclude current week
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const to = fmt(lastSunday);

  switch (preset) {
    case "vorige_week": {
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      return { from: fmt(lastMonday), to };
    }
    case "vorige_4_weken": {
      const fourWeeksAgo = new Date(thisMonday);
      fourWeeksAgo.setDate(thisMonday.getDate() - 28);
      return { from: fmt(fourWeeksAgo), to };
    }
    case "dit_jaar": {
      return { from: `${now.getFullYear()}-01-01`, to };
    }
    case "alle_drafts": {
      return { from: null, to };
    }
  }
}

const presetLabels: Record<DateRangePreset, string> = {
  vorige_4_weken: "Vorige 4 weken",
  vorige_week: "Vorige week",
  dit_jaar: "Dit jaar",
  alle_drafts: "Alle drafts",
};

function TimesheetGoedkeuren() {
  const allEmployees = useEmployees();
  const allProjects = useProjects();
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [expandedTs, setExpandedTs] = useState<string | null>(null);
  const [tsDetails, setTsDetails] = useState<Map<string, TSDetail[]>>(new Map());
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DateRangePreset>("vorige_4_weken");

  // Validation modal state
  const [validationModal, setValidationModal] = useState<{
    tsName: string;
    warnings: ValidationWarning[];
  } | null>(null);

  const company = localStorage.getItem("erpnext_default_company") || "";
  const defaultActivityType = localStorage.getItem("erpnext_default_activity_type") || undefined;
  const contractHoursStr = localStorage.getItem("erpnext_employee_contract_hours");
  const contractHours = contractHoursStr ? parseFloat(contractHoursStr) : null;

  // Build employee ID set for company filtering
  const employeeIdSet = useMemo(() => {
    if (!company) return null;
    const set = new Set<string>();
    for (const emp of allEmployees) {
      if (emp.company === company) set.add(emp.name);
    }
    return set;
  }, [allEmployees, company]);

  // Project info for validation
  const projectInfos: ProjectInfo[] = useMemo(
    () => allProjects.map((p) => ({ name: p.name, company: p.company, project_name: p.project_name })),
    [allProjects]
  );

  const dateRange = useMemo(() => getDateRangeForPreset(datePreset), [datePreset]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [
        ["docstatus", "=", 0], // Draft only
      ];
      if (dateRange.from) filters.push(["start_date", ">=", dateRange.from]);
      // Always exclude current week
      filters.push(["start_date", "<=", dateRange.to]);

      const list = await fetchAll<Timesheet>(
        "Timesheet",
        [
          "name", "employee", "employee_name", "total_hours", "total_billed_hours",
          "total_billed_amount", "start_date", "end_date", "status", "company",
        ],
        filters,
        "employee_name asc, start_date asc"
      );

      // Filter by employee company if needed
      const filtered = employeeIdSet
        ? list.filter((t) => employeeIdSet.has(t.employee))
        : list;

      setTimesheets(filtered);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [datePreset, company]);

  async function loadDetails(tsName: string) {
    if (tsDetails.has(tsName)) return;
    setDetailsLoading(tsName);
    try {
      const doc = await fetchDocument<{ time_logs: TSDetail[] }>("Timesheet", tsName);
      const details = (doc.time_logs || []).sort((a, b) =>
        (a.from_time || "").localeCompare(b.from_time || "")
      );
      setTsDetails((prev) => new Map(prev).set(tsName, details));
    } catch {
      // ignore
    } finally {
      setDetailsLoading(null);
    }
  }

  function toggleExpand(tsName: string) {
    if (expandedTs === tsName) {
      setExpandedTs(null);
    } else {
      setExpandedTs(tsName);
      loadDetails(tsName);
    }
  }

  async function handleApproveClick(ts: Timesheet) {
    // Load details if not already loaded
    let details = tsDetails.get(ts.name);
    if (!details) {
      setDetailsLoading(ts.name);
      try {
        const doc = await fetchDocument<{ time_logs: TSDetail[] }>("Timesheet", ts.name);
        details = (doc.time_logs || []).sort((a, b) =>
          (a.from_time || "").localeCompare(b.from_time || "")
        );
        setTsDetails((prev) => new Map(prev).set(ts.name, details!));
      } catch {
        details = [];
      } finally {
        setDetailsLoading(null);
      }
    }

    // Find employee company
    const emp = allEmployees.find((e) => e.name === ts.employee);
    const empCompany = emp?.company || company || undefined;

    // Run validation
    const warnings = runTimesheetValidation(ts, details, empCompany, defaultActivityType, projectInfos);
    setValidationModal({ tsName: ts.name, warnings });
  }

  async function handleConfirmApprove(tsName: string) {
    setValidationModal(null);
    setSubmittingId(tsName);
    try {
      await callMethod("frappe.client.submit", {
        doctype: "Timesheet",
        name: tsName,
      });
      setTimesheets((prev) => prev.filter((t) => t.name !== tsName));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout bij goedkeuren");
    } finally {
      setSubmittingId(null);
    }
  }

  // Calculate expected daily hours from contract
  function getHoursHighlight(ts: Timesheet): string {
    if (!contractHours || isNaN(contractHours)) return "";
    const start = new Date(ts.start_date + "T00:00:00");
    const end = new Date(ts.end_date + "T00:00:00");
    let workdays = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getDay();
      if (day >= 1 && day <= 5) workdays++;
      cur.setDate(cur.getDate() + 1);
    }
    const dailyHours = contractHours / 5;
    const expected = workdays * dailyHours;
    return Math.abs(ts.total_hours - expected) > 0.5 ? "bg-amber-100" : "";
  }

  // Group by employee
  const grouped = useMemo(() => {
    const map = new Map<string, Timesheet[]>();
    for (const ts of timesheets) {
      const key = ts.employee_name || ts.employee;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ts);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [timesheets]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Timesheets goedkeuren</h3>
          <p className="text-sm text-slate-500">
            {dateRange.from ? `${dateRange.from} t/m ${dateRange.to}` : `Alle drafts t/m ${dateRange.to}`}
            {company && <span className="ml-2 text-slate-400">· {company}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden">
            {(Object.keys(presetLabels) as DateRangePreset[]).map((p) => (
              <button
                key={p}
                onClick={() => setDatePreset(p)}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  datePreset === p
                    ? "bg-3bm-teal text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {presetLabels[p]}
              </button>
            ))}
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer text-sm"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Vernieuwen
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-12">Laden...</div>
      ) : timesheets.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <CheckCircle size={40} className="text-green-500 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Alle timesheets zijn goedgekeurd!</p>
          <p className="text-sm text-slate-400 mt-1">Er zijn geen draft timesheets meer om te beoordelen.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([empName, sheets]) => (
            <div key={empName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-3bm-teal flex items-center justify-center text-white text-xs font-bold">
                    {empName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-semibold text-slate-700">{empName}</span>
                </div>
                <span className="text-sm text-slate-500">
                  {sheets.reduce((s, t) => s + t.total_hours, 0).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur totaal
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {sheets.map((ts) => (
                  <div key={ts.name}>
                    <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleExpand(ts.name)}
                          className="text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                        >
                          <ChevronRight
                            size={16}
                            className={`transition-transform ${expandedTs === ts.name ? "rotate-90" : ""}`}
                          />
                        </button>
                        <a
                          href={`${getErpNextLinkUrl()}/timesheet/${ts.name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-mono text-3bm-teal hover:underline"
                        >
                          {ts.name}
                        </a>
                        <span className="text-sm text-slate-500">{ts.start_date}</span>
                        <span className={`text-sm font-medium text-slate-700 px-1 rounded ${getHoursHighlight(ts)}`}>
                          {ts.total_hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={`${getErpNextLinkUrl()}/timesheet/${ts.name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                        >
                          Bekijken
                        </a>
                        <button
                          onClick={() => handleApproveClick(ts)}
                          disabled={submittingId === ts.name || detailsLoading === ts.name}
                          className="px-3 py-1.5 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer flex items-center gap-1"
                        >
                          <CheckCircle size={14} />
                          {submittingId === ts.name ? "Bezig..." : detailsLoading === ts.name ? "Laden..." : "Goedkeuren"}
                        </button>
                      </div>
                    </div>
                    {/* Expanded details */}
                    {expandedTs === ts.name && (
                      <div className="px-4 pb-3 border-t border-slate-100 bg-slate-50/50">
                        <TimesheetDetailsTable
                          details={tsDetails.get(ts.name) || []}
                          projects={projectInfos}
                          employeeCompany={allEmployees.find((e) => e.name === ts.employee)?.company}
                          defaultActivityType={defaultActivityType}
                          loading={detailsLoading === ts.name}
                          defaultGroupBy="dag"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Validation Modal */}
      {validationModal && (
        <ValidationModal
          warnings={validationModal.warnings}
          onClose={() => setValidationModal(null)}
          onApprove={() => handleConfirmApprove(validationModal.tsName)}
          tsName={validationModal.tsName}
        />
      )}
    </div>
  );
}
