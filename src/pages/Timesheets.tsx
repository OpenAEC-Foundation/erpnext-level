import { useEffect, useState, useMemo, useRef } from "react";
import { fetchList, fetchDocument, createDocument, updateDocument, callMethod, getErpNextAppUrl } from "../lib/erpnext";
import CompanySelect from "../components/CompanySelect";
import DateRangeFilter from "../components/DateRangeFilter";
import { useEmployees, useProjects } from "../lib/DataContext";
import {
  Timer, RefreshCw, Filter, Search, ExternalLink,
  Clock, CheckCircle, DollarSign, FileText, ChevronDown,
  Plus, Send, ClipboardCheck, Calendar,
} from "lucide-react";

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

interface TimesheetDetail {
  name: string;
  parent: string;
  activity_type: string;
  from_time: string;
  to_time: string;
  hours: number;
  project: string;
  description: string;
}

const statusColors: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Submitted: "bg-3bm-teal/10 text-3bm-teal-dark",
  Billed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
};

const euro = (v: number) =>
  `\u20AC ${v.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;

function getLastWeekRange(): { from: string; to: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diffToMonday);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { from: fmt(lastMonday), to: fmt(lastSunday) };
}

export default function Timesheets() {
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

  // Filter by company (include null company when filter is set)
  const companyFiltered = useMemo(() => {
    if (!company) return timesheets;
    return timesheets.filter(
      (t) => t.company === company || t.company === null || t.company === ""
    );
  }, [timesheets, company]);

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
            href={`${getErpNextAppUrl()}/app/timesheet`}
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
                      href={`${getErpNextAppUrl()}/app/timesheet/${ts.name}`}
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

      {activeTab === "boeken" && <UrenBoekenForm />}
      {activeTab === "goedkeuren" && <TimesheetGoedkeuren />}
    </div>
  );
}

/* ─── Uren Boeken Form with daily entries panel ─── */

function UrenBoekenForm() {
  const allEmployees = useEmployees();
  const projects = useProjects();
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [employee, setEmployee] = useState(localStorage.getItem("erpnext_default_employee") || "HR-EMP-00003");
  const [project, setProject] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [activityType, setActivityType] = useState("Execution");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const projectRef = useRef<HTMLDivElement>(null);

  // Week timesheet tracking
  const [weekTimesheet, setWeekTimesheet] = useState<string | null>(null);

  // Daily entries
  const [dayEntries, setDayEntries] = useState<TimesheetDetail[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // Get Monday/Sunday of the week for a given date
  function getWeekMonday(d: string): string {
    const dt = new Date(d + "T00:00:00");
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    return dt.toISOString().split("T")[0];
  }
  function getWeekSunday(d: string): string {
    const mon = new Date(getWeekMonday(d) + "T00:00:00");
    mon.setDate(mon.getDate() + 6);
    return mon.toISOString().split("T")[0];
  }

  // Find existing week timesheet for this employee + date
  useEffect(() => {
    if (!employee || !date) { setWeekTimesheet(null); return; }
    const monday = getWeekMonday(date);
    const sunday = getWeekSunday(date);
    fetchList<{ name: string }>("Timesheet", {
      fields: ["name"],
      filters: [
        ["employee", "=", employee],
        ["start_date", ">=", monday],
        ["start_date", "<=", sunday],
        ["docstatus", "=", 0],
      ],
      limit_page_length: 1,
      order_by: "modified desc",
    }).then((list) => {
      setWeekTimesheet(list.length > 0 ? list[0].name : null);
    }).catch(() => setWeekTimesheet(null));
  }, [employee, date, success]);

  useEffect(() => {
    fetchList<{ name: string }>("Activity Type", {
      fields: ["name"],
      limit_page_length: 0,
    }).then((list) => {
      const names = list.map((a) => a.name);
      setActivityTypes(names);
      if (!names.includes("Execution")) {
        setActivityType(names[0] || "");
      }
    });
  }, []);

  const activeEmployees = useMemo(
    () => allEmployees.filter((e) => e.status === "Active"),
    [allEmployees]
  );

  // Only active projects, sorted by name ascending (low → high)
  const activeProjects = useMemo(() =>
    projects
      .filter((p) => p.status === "Open")
      .sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  );

  // Searchable projects
  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return activeProjects.slice(0, 50);
    const q = projectSearch.toLowerCase();
    return activeProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_name?.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [activeProjects, projectSearch]);

  // Load daily entries when date or employee changes (with delay after booking)
  useEffect(() => {
    if (!date || !employee) {
      setDayEntries([]);
      return;
    }
    const delay = success ? 800 : 0;
    const timer = setTimeout(() => {
      setLoadingEntries(true);
      fetchList<TimesheetDetail>("Timesheet Detail", {
        fields: ["name", "parent", "activity_type", "from_time", "to_time", "hours", "project", "description"],
        filters: [
          ["from_time", ">=", `${date} 00:00:00`],
          ["from_time", "<=", `${date} 23:59:59`],
          ["parenttype", "=", "Timesheet"],
        ],
        limit_page_length: 100,
        order_by: "from_time asc",
      })
        .then(setDayEntries)
        .catch(() => setDayEntries([]))
        .finally(() => setLoadingEntries(false));
    }, delay);
    return () => clearTimeout(timer);
  }, [date, employee, success]); // re-fetch after successful submit

  // Close project dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employee || !hours || !activityType) return;
    setSubmitting(true);
    setFormError("");
    setSuccess("");
    try {
      const company = localStorage.getItem("erpnext_default_company") || undefined;
      const parsedHours = parseFloat(hours);
      const newTimeLog = {
        activity_type: activityType,
        from_time: `${date} 08:00:00`,
        to_time: `${date} ${(8 + parsedHours).toString().padStart(2, "0")}:00:00`,
        hours: parsedHours,
        project: project || undefined,
        description: description || undefined,
      };

      let tsName: string;

      if (weekTimesheet) {
        // Append to existing week timesheet
        const existing = await fetchDocument<{ name: string; time_logs: Record<string, unknown>[] }>("Timesheet", weekTimesheet);
        const updatedLogs = [...(existing.time_logs || []), newTimeLog];
        await updateDocument("Timesheet", weekTimesheet, { time_logs: updatedLogs });
        tsName = weekTimesheet;
      } else {
        // Create new timesheet for this week
        const doc = await createDocument<{ name: string }>("Timesheet", {
          employee,
          company,
          time_logs: [newTimeLog],
        });
        tsName = doc.name;
      }

      setSuccess(`Uren geboekt in ${tsName}!`);
      setProject("");
      setProjectSearch("");
      setHours("");
      setDescription("");
      setTimeout(() => setSuccess(""), 5000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProjectName = projects.find((p) => p.name === project);

  return (
    <div className="flex gap-6">
      {/* Left: Form */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex-1 max-w-xl">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">Uren boeken</h3>
        <p className="text-xs text-slate-500 mb-4">
          {weekTimesheet ? (
            <>
              Week-timesheet:{" "}
              <a
                href={`${getErpNextAppUrl()}/app/timesheet/${weekTimesheet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-3bm-teal hover:underline font-mono"
              >
                {weekTimesheet}
              </a>
              {" "}(uren worden hieraan toegevoegd)
            </>
          ) : (
            <>Geen bestaande timesheet voor deze week — er wordt een nieuwe aangemaakt</>
          )}
        </p>

        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success}</div>
        )}
        {formError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Medewerker *</label>
            <select
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            >
              <option value="">Selecteer medewerker...</option>
              {activeEmployees.map((emp) => (
                <option key={emp.name} value={emp.name}>{emp.employee_name}</option>
              ))}
            </select>
          </div>
          <div ref={projectRef} className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Project</label>
            <input
              type="text"
              value={projectDropdownOpen ? projectSearch : (selectedProjectName ? `${selectedProjectName.name} — ${selectedProjectName.project_name}` : projectSearch)}
              onChange={(e) => {
                setProjectSearch(e.target.value);
                setProjectDropdownOpen(true);
                if (!e.target.value) setProject("");
              }}
              onFocus={() => setProjectDropdownOpen(true)}
              placeholder="Zoek project..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            />
            {project && !projectDropdownOpen && (
              <button
                type="button"
                onClick={() => { setProject(""); setProjectSearch(""); }}
                className="absolute right-2 top-8 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <span className="text-xs">&#x2715;</span>
              </button>
            )}
            {projectDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => { setProject(""); setProjectSearch(""); setProjectDropdownOpen(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm text-slate-400 cursor-pointer"
                >
                  Geen project
                </button>
                {filteredProjects.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => {
                      setProject(p.name);
                      setProjectSearch("");
                      setProjectDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-50 text-sm cursor-pointer ${
                      project === p.name ? "bg-3bm-teal/5 text-3bm-teal-dark" : "text-slate-700"
                    }`}
                  >
                    <span className="font-mono text-xs text-slate-500">{p.name}</span>
                    <span className="ml-2">{p.project_name}</span>
                  </button>
                ))}
                {filteredProjects.length === 0 && (
                  <div className="px-3 py-2 text-sm text-slate-400">Geen projecten gevonden</div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Activiteitstype *</label>
            <select
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            >
              <option value="">Selecteer type...</option>
              {activityTypes.map((at) => (
                <option key={at} value={at}>{at}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Datum *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Uren *</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                required
                placeholder="bijv. 8"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Omschrijving</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Werkzaamheden omschrijving..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !employee || !hours || !activityType}
            className="flex items-center gap-2 px-6 py-2.5 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 text-sm font-medium cursor-pointer"
          >
            <Send size={16} />
            {submitting ? "Opslaan..." : "Uren boeken"}
          </button>
        </form>
      </div>

      {/* Right: Daily entries */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex-1 max-w-lg">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-3bm-teal" />
          <h3 className="text-lg font-semibold text-slate-800">
            Uren op {date ? new Date(date + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }) : "..."}
          </h3>
        </div>

        {loadingEntries ? (
          <div className="text-center text-slate-400 py-8">Laden...</div>
        ) : dayEntries.length === 0 ? (
          <div className="text-center text-slate-400 py-8">Geen uren geboekt op deze dag</div>
        ) : (
          <div className="space-y-3">
            {dayEntries.map((entry) => (
              <div key={entry.name} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50">
                <div className="flex items-center justify-between mb-1">
                  <a
                    href={`${getErpNextAppUrl()}/app/timesheet/${entry.parent}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-3bm-teal hover:underline"
                  >
                    {entry.parent}
                  </a>
                  <span className="text-sm font-semibold text-slate-700">
                    {entry.hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="bg-slate-100 px-1.5 py-0.5 rounded">{entry.activity_type}</span>
                  {entry.project && (
                    <span className="bg-3bm-teal/10 text-3bm-teal-dark px-1.5 py-0.5 rounded">{entry.project}</span>
                  )}
                </div>
                {entry.description && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{entry.description}</p>
                )}
              </div>
            ))}
            <div className="pt-2 border-t border-slate-200 flex justify-between text-sm">
              <span className="text-slate-500">Totaal</span>
              <span className="font-semibold text-slate-700">
                {dayEntries.reduce((s, e) => s + e.hours, 0).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Timesheets Goedkeuren ─── */

function TimesheetGoedkeuren() {
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const company = localStorage.getItem("erpnext_default_company") || "";
  const lastWeek = useMemo(() => getLastWeekRange(), []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [
        ["start_date", ">=", lastWeek.from],
        ["start_date", "<=", lastWeek.to],
        ["docstatus", "=", 0], // Draft only
      ];
      if (company) filters.push(["company", "=", company]);

      const list = await fetchList<Timesheet>("Timesheet", {
        fields: [
          "name", "employee", "employee_name", "total_hours", "total_billed_hours",
          "total_billed_amount", "start_date", "end_date", "status", "company",
        ],
        filters,
        limit_page_length: 200,
        order_by: "employee_name asc, start_date asc",
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
  }, []);

  async function handleSubmit(tsName: string) {
    setSubmittingId(tsName);
    try {
      await callMethod("frappe.client.submit", {
          doctype: "Timesheet",
          name: tsName,
        });
      // Remove from list
      setTimesheets((prev) => prev.filter((t) => t.name !== tsName));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout bij goedkeuren");
    } finally {
      setSubmittingId(null);
    }
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
            Vorige week: {lastWeek.from} t/m {lastWeek.to}
            {company && <span className="ml-2 text-slate-400">· {company}</span>}
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer text-sm"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Vernieuwen
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-slate-400 py-12">Laden...</div>
      ) : timesheets.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <CheckCircle size={40} className="text-green-500 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Alle timesheets van vorige week zijn goedgekeurd!</p>
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
                  <div key={ts.name} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                    <div className="flex items-center gap-4">
                      <a
                        href={`${getErpNextAppUrl()}/app/timesheet/${ts.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-3bm-teal hover:underline"
                      >
                        {ts.name}
                      </a>
                      <span className="text-sm text-slate-500">{ts.start_date}</span>
                      <span className="text-sm font-medium text-slate-700">
                        {ts.total_hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`${getErpNextAppUrl()}/app/timesheet/${ts.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                      >
                        Bekijken
                      </a>
                      <button
                        onClick={() => handleSubmit(ts.name)}
                        disabled={submittingId === ts.name}
                        className="px-3 py-1.5 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer flex items-center gap-1"
                      >
                        <CheckCircle size={14} />
                        {submittingId === ts.name ? "Bezig..." : "Goedkeuren"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
