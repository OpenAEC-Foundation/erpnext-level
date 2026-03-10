import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { fetchList, fetchDocument, createDocument, updateDocument, deleteDocument, getErpNextAppUrl } from "../lib/erpnext";
import { useEmployees, useProjects, useLeaves } from "../lib/DataContext";
import type { Page, ViewMode } from "../components/Sidebar";
import { getActiveInstance } from "../lib/instances";
import {
  Send, Search, Clock, FolderKanban, CheckSquare,
  ExternalLink, ChevronDown, Cake,
  Palmtree, User, ListTodo, Plus, Trash2, Save, X,
} from "lucide-react";

/* ─── Types ─── */

interface Task {
  name: string;
  subject: string;
  status: string;
  priority: string;
  assigned_to: string;
  project: string;
  exp_end_date: string;
}

interface TimesheetDetail {
  name: string;
  parent: string;
  activity_type: string;
  hours: number;
  project: string;
  from_time: string;
}

/* ─── Constants ─── */

const statusBadge: Record<string, string> = {
  Open: "bg-3bm-teal/10 text-3bm-teal-dark",
  Working: "bg-yellow-100 text-yellow-700",
  "Pending Review": "bg-purple-100 text-purple-700",
  Overdue: "bg-red-100 text-red-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-slate-100 text-slate-600",
};

const priorityDot: Record<string, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Medium: "bg-yellow-500",
  Low: "bg-slate-400",
};

function isOverdue(date: string): boolean {
  if (!date) return false;
  return new Date(date) < new Date(new Date().toDateString());
}

/* ─── Main Dashboard ─── */

interface DashboardProps {
  onNavigate: (page: Page) => void;
  viewMode: ViewMode;
}

export default function Dashboard({ onNavigate, viewMode }: DashboardProps) {
  if (viewMode === "werknemer") {
    return <EmployeeDashboard onNavigate={onNavigate} />;
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-slate-800">{getActiveInstance().name} Dashboard</h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          <QuickTimeBooking />
          <ProjectSearch onNavigate={onNavigate} />
          <MyTodoList />
        </div>

        {/* Right column */}
        <TaskList onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/* ─── Employee Dashboard ─── */

function EmployeeDashboard({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const employees = useEmployees();
  const leaves = useLeaves();
  const myEmployeeId = localStorage.getItem("erpnext_default_employee") || "";

  const myEmployee = useMemo(
    () => employees.find((e) => e.name === myEmployeeId),
    [employees, myEmployeeId]
  );

  // Upcoming birthdays (next 30 days)
  const upcomingBirthdays = useMemo(() => {
    const today = new Date();
    const active = employees.filter((e) => e.status === "Active" && e.date_of_birth);
    return active
      .map((e) => {
        const dob = new Date(e.date_of_birth);
        const nextBday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
        if (nextBday < today) nextBday.setFullYear(nextBday.getFullYear() + 1);
        const daysUntil = Math.round((nextBday.getTime() - today.getTime()) / 86400000);
        const age = nextBday.getFullYear() - dob.getFullYear();
        return { ...e, nextBday, daysUntil, age };
      })
      .filter((e) => e.daysUntil >= 0 && e.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [employees]);

  // My leave balance (approved leaves this year)
  const myLeaveStats = useMemo(() => {
    const year = new Date().getFullYear();
    const myLeaves = leaves.filter(
      (l) => l.employee === myEmployeeId && l.status === "Approved"
        && l.from_date.startsWith(String(year))
    );
    const totalDays = myLeaves.reduce((s, l) => s + (l.total_leave_days || 0), 0);
    const byType = new Map<string, number>();
    for (const l of myLeaves) {
      byType.set(l.leave_type, (byType.get(l.leave_type) || 0) + (l.total_leave_days || 0));
    }
    return { totalDays, byType: Array.from(byType.entries()).sort((a, b) => b[1] - a[1]) };
  }, [leaves, myEmployeeId]);

  // Who is on leave today
  const onLeaveToday = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return leaves
      .filter((l) => l.status === "Approved" && l.from_date <= today && l.to_date >= today)
      .map((l) => l.employee_name);
  }, [leaves]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-3bm-teal/10 rounded-lg">
          <User size={22} className="text-3bm-teal" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Welkom{myEmployee ? `, ${myEmployee.employee_name.split(" ")[0]}` : ""}
          </h2>
          {myEmployee && (
            <p className="text-sm text-slate-500">{myEmployee.designation} — {myEmployee.department}</p>
          )}
        </div>
      </div>

      {!myEmployeeId && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          Stel je medewerker-ID in via Instellingen om persoonlijke gegevens te zien.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          <QuickTimeBooking />

          {/* Vacation balance */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Palmtree size={18} className="text-3bm-teal" />
              <button onClick={() => onNavigate("vakantieplanning")} className="font-semibold text-slate-800 hover:text-3bm-teal cursor-pointer">
                Mijn verlof {new Date().getFullYear()} &rarr;
              </button>
            </div>
            <div className="text-3xl font-bold text-slate-800 mb-3">
              {myLeaveStats.totalDays} <span className="text-base font-normal text-slate-400">dagen opgenomen</span>
            </div>
            {myLeaveStats.byType.length > 0 ? (
              <div className="space-y-2">
                {myLeaveStats.byType.map(([type, days]) => (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{type}</span>
                    <span className="font-semibold text-slate-700">{days} dagen</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Nog geen verlof opgenomen</p>
            )}

            {onLeaveToday.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mb-1">Vandaag afwezig:</p>
                <div className="flex flex-wrap gap-1.5">
                  {onLeaveToday.map((name) => (
                    <span key={name} className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* My tasks */}
          <MyTaskList onNavigate={onNavigate} userEmail={myEmployee?.user_id || myEmployee?.company_email || ""} />

          {/* Birthdays */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Cake size={18} className="text-3bm-teal" />
              <h3 className="font-semibold text-slate-800">Verjaardagen</h3>
            </div>
            {upcomingBirthdays.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">Geen verjaardagen de komende 30 dagen</p>
            ) : (
              <div className="space-y-2">
                {upcomingBirthdays.map((e) => (
                  <div key={e.name} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50">
                    <div className="w-8 h-8 rounded-full bg-3bm-teal/10 flex items-center justify-center text-3bm-teal font-semibold text-xs flex-shrink-0">
                      {e.employee_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700">{e.employee_name}</p>
                      <p className="text-xs text-slate-400">{e.designation}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {e.daysUntil === 0 ? (
                        <span className="text-sm font-semibold text-3bm-teal">Vandaag!</span>
                      ) : e.daysUntil === 1 ? (
                        <span className="text-sm font-semibold text-orange-500">Morgen</span>
                      ) : (
                        <span className="text-sm text-slate-500">over {e.daysUntil} dagen</span>
                      )}
                      <p className="text-xs text-slate-400">wordt {e.age}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── My Task List (filtered to employee) ─── */

function MyTaskList({ onNavigate, userEmail }: { onNavigate: (page: Page) => void; userEmail: string }) {
  const storeProjects = useProjects();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of storeProjects) if (p.name && p.project_name) map.set(p.name, p.project_name);
    return map;
  }, [storeProjects]);

  useEffect(() => {
    if (!userEmail) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    fetchList<Task>("Task", {
      fields: ["name", "subject", "status", "priority", "_assign as assigned_to", "project", "exp_end_date"],
      filters: [
        ["_assign", "like", `%${userEmail}%`],
        ["status", "not in", ["Cancelled", "Template", "Completed"]],
      ],
      limit_page_length: 50,
      order_by: "modified desc",
    })
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userEmail]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col" style={{ maxHeight: "420px" }}>
      <div className="flex items-center gap-2 mb-4">
        <CheckSquare size={18} className="text-3bm-teal" />
        <button onClick={() => onNavigate("tasks")} className="font-semibold text-slate-800 hover:text-3bm-teal cursor-pointer">
          Mijn taken &rarr;
        </button>
        <span className="ml-auto text-sm text-slate-400">{loading ? "..." : `${tasks.length} taken`}</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {loading ? (
          <p className="text-center text-slate-400 py-8">Laden...</p>
        ) : tasks.length === 0 ? (
          <p className="text-center text-slate-400 py-8">
            {userEmail ? "Geen openstaande taken" : "Stel je medewerker-ID in via Instellingen"}
          </p>
        ) : (
          tasks.map((t) => (
            <a
              key={t.name}
              href={`${getErpNextAppUrl()}/app/task/${t.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group"
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${priorityDot[t.priority] ?? "bg-slate-300"}`} title={t.priority} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 group-hover:text-3bm-teal line-clamp-1">{t.subject}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] font-mono text-slate-400">{t.name}</span>
                  {t.project && (
                    <span className="text-[10px] text-slate-400 truncate max-w-[180px]">
                      {projectNameMap.get(t.project) || t.project}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {t.exp_end_date && (
                  <span className={`text-[10px] ${isOverdue(t.exp_end_date) ? "text-red-500 font-semibold" : "text-slate-400"}`}>
                    {t.exp_end_date}
                  </span>
                )}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusBadge[t.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {t.status}
                </span>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Quick Time Booking ─── */

function QuickTimeBooking() {
  const allEmployees = useEmployees();
  const projects = useProjects();
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [employee, setEmployee] = useState(localStorage.getItem("erpnext_default_employee") || "HR-EMP-00003");
  const [project, setProject] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [task, setTask] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [tasks, setTasks] = useState<{ name: string; subject: string }[]>([]);
  const [activityType, setActivityType] = useState("Execution");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [fromTime, setFromTime] = useState("08:00");
  const [toTime, setToTime] = useState("17:00");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const projectRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<HTMLDivElement>(null);

  // Day entries
  const [dayEntries, setDayEntries] = useState<TimesheetDetail[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // Last 3 bookings by this employee
  const [recentEntries, setRecentEntries] = useState<TimesheetDetail[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    if (!employee) { setRecentEntries([]); return; }
    setLoadingRecent(true);
    fetchList<{ name: string }>("Timesheet", {
      fields: ["name"],
      filters: [["employee", "=", employee], ["docstatus", "!=", 2]],
      limit_page_length: 5,
      order_by: "modified desc",
    }).then((timesheets) => {
      if (timesheets.length === 0) { setRecentEntries([]); setLoadingRecent(false); return; }
      const tsNames = timesheets.map((t) => t.name);
      fetchList<TimesheetDetail>("Timesheet Detail", {
        fields: ["name", "parent", "activity_type", "hours", "project", "from_time"],
        filters: [["parent", "in", tsNames], ["parenttype", "=", "Timesheet"]],
        limit_page_length: 50,
        order_by: "from_time desc",
      }).then((details) => setRecentEntries(details.slice(0, 3)))
        .catch(() => setRecentEntries([]))
        .finally(() => setLoadingRecent(false));
    }).catch(() => { setRecentEntries([]); setLoadingRecent(false); });
  }, [employee, success]);

  // Calculate hours from time range
  const hours = useMemo(() => {
    if (!fromTime || !toTime) return 0;
    const [fh, fm] = fromTime.split(":").map(Number);
    const [th, tm] = toTime.split(":").map(Number);
    const diff = (th + tm / 60) - (fh + fm / 60);
    return Math.max(0, Math.round(diff * 10) / 10);
  }, [fromTime, toTime]);

  useEffect(() => {
    fetchList<{ name: string }>("Activity Type", { fields: ["name"], limit_page_length: 0 })
      .then((list) => {
        const names = list.map((a) => a.name);
        setActivityTypes(names);
        if (!names.includes("Execution")) setActivityType(names[0] || "");
      });
  }, []);

  // Load tasks when project changes
  useEffect(() => {
    if (!project) { setTasks([]); setTask(""); return; }
    fetchList<{ name: string; subject: string }>("Task", {
      fields: ["name", "subject"],
      filters: [["project", "=", project], ["status", "not in", ["Cancelled", "Completed", "Template"]]],
      limit_page_length: 100,
      order_by: "modified desc",
    }).then(setTasks).catch(() => setTasks([]));
  }, [project]);

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

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return activeProjects.slice(0, 30);
    const q = projectSearch.toLowerCase();
    return activeProjects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.project_name?.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [activeProjects, projectSearch]);

  const filteredTasks = useMemo(() => {
    if (!taskSearch.trim()) return tasks.slice(0, 30);
    const q = taskSearch.toLowerCase();
    return tasks.filter(
      (t) => t.name.toLowerCase().includes(q) || t.subject?.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [tasks, taskSearch]);

  // Load day entries (with small delay after booking to let ERPNext commit)
  useEffect(() => {
    if (!date) { setDayEntries([]); return; }
    const delay = success ? 800 : 0; // Wait a bit after a successful booking
    const timer = setTimeout(() => {
      setLoadingEntries(true);
      fetchList<TimesheetDetail>("Timesheet Detail", {
        fields: ["name", "parent", "activity_type", "hours", "project", "from_time"],
        filters: [
          ["from_time", ">=", `${date} 00:00:00`],
          ["from_time", "<=", `${date} 23:59:59`],
          ["parenttype", "=", "Timesheet"],
        ],
        limit_page_length: 50,
        order_by: "from_time asc",
      })
        .then(setDayEntries)
        .catch(() => setDayEntries([]))
        .finally(() => setLoadingEntries(false));
    }, delay);
    return () => clearTimeout(timer);
  }, [date, success]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) setProjectOpen(false);
      if (taskRef.current && !taskRef.current.contains(e.target as Node)) setTaskOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Get Monday of the week for a given date
  function getWeekMonday(d: string): string {
    const dt = new Date(d + "T00:00:00");
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday = 1
    dt.setDate(dt.getDate() + diff);
    return dt.toISOString().split("T")[0];
  }

  function getWeekSunday(d: string): string {
    const mon = new Date(getWeekMonday(d) + "T00:00:00");
    mon.setDate(mon.getDate() + 6);
    return mon.toISOString().split("T")[0];
  }

  // Current week timesheet
  const [weekTimesheet, setWeekTimesheet] = useState<string | null>(null);

  // Find existing week timesheet
  useEffect(() => {
    if (!employee || !date) return;
    const monday = getWeekMonday(date);
    const sunday = getWeekSunday(date);
    fetchList<{ name: string }>("Timesheet", {
      fields: ["name"],
      filters: [
        ["employee", "=", employee],
        ["start_date", ">=", monday],
        ["start_date", "<=", sunday],
        ["docstatus", "=", 0], // Draft only
      ],
      limit_page_length: 1,
      order_by: "modified desc",
    }).then((list) => {
      setWeekTimesheet(list.length > 0 ? list[0].name : null);
    }).catch(() => setWeekTimesheet(null));
  }, [employee, date, success]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employee || hours <= 0 || !activityType) return;
    setSubmitting(true);
    setFormError("");
    setSuccess("");
    try {
      const company = localStorage.getItem("erpnext_default_company") || undefined;
      const newTimeLog = {
        activity_type: activityType,
        from_time: `${date} ${fromTime}:00`,
        to_time: `${date} ${toTime}:00`,
        hours,
        project: project || undefined,
        task: task || undefined,
        description: description || undefined,
      };

      let tsName: string;

      if (weekTimesheet) {
        // Add time_log to existing week timesheet
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
      setFromTime("08:00");
      setToTime("17:00");
      setDescription("");
      setProject("");
      setProjectSearch("");
      setTask("");
      setTaskSearch("");
      setTimeout(() => setSuccess(""), 5000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProject = projects.find((p) => p.name === project);
  const selectedTask = tasks.find((t) => t.name === task);
  const dayTotal = dayEntries.reduce((s, e) => s + e.hours, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock size={18} className="text-3bm-teal" />
        <h3 className="font-semibold text-slate-800">Uren boeken</h3>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
          {weekTimesheet && (
            <a
              href={`${getErpNextAppUrl()}/app/timesheet/${weekTimesheet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-3bm-teal hover:underline"
              title="Week-timesheet openen"
            >
              {weekTimesheet}
            </a>
          )}
          {!loadingEntries && dayTotal > 0 && (
            <span>
              Vandaag: <span className="font-semibold text-slate-700">{dayTotal.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur</span>
            </span>
          )}
        </div>
      </div>

      {success && <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success}</div>}
      {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Medewerker *</label>
            <select value={employee} onChange={(e) => setEmployee(e.target.value)} required
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal">
              <option value="">Selecteer...</option>
              {activeEmployees.map((emp) => (
                <option key={emp.name} value={emp.name}>{emp.employee_name}</option>
              ))}
            </select>
          </div>
          <div ref={projectRef} className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1">Project</label>
            <input
              type="text"
              value={projectOpen ? projectSearch : (selectedProject ? `${selectedProject.name} — ${selectedProject.project_name}` : projectSearch)}
              onChange={(e) => { setProjectSearch(e.target.value); setProjectOpen(true); if (!e.target.value) { setProject(""); setTask(""); } }}
              onFocus={() => setProjectOpen(true)}
              placeholder="Zoek project..."
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            />
            {projectOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                <button type="button" onClick={() => { setProject(""); setTask(""); setProjectSearch(""); setProjectOpen(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm text-slate-400 cursor-pointer">
                  Geen project
                </button>
                {filteredProjects.map((p) => (
                  <button key={p.name} type="button"
                    onClick={() => { setProject(p.name); setProjectSearch(""); setProjectOpen(false); setTask(""); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm cursor-pointer ${project === p.name ? "bg-3bm-teal/5 text-3bm-teal-dark" : "text-slate-700"}`}>
                    <span className="font-mono text-xs text-slate-400">{p.name}</span>
                    <span className="ml-1.5">{p.project_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Task selector - only when project selected */}
        {project && tasks.length > 0 && (
          <div ref={taskRef} className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1">Taak</label>
            <input
              type="text"
              value={taskOpen ? taskSearch : (selectedTask ? `${selectedTask.name} — ${selectedTask.subject}` : taskSearch)}
              onChange={(e) => { setTaskSearch(e.target.value); setTaskOpen(true); if (!e.target.value) setTask(""); }}
              onFocus={() => setTaskOpen(true)}
              placeholder="Zoek taak..."
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            />
            {taskOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                <button type="button" onClick={() => { setTask(""); setTaskSearch(""); setTaskOpen(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm text-slate-400 cursor-pointer">
                  Geen taak
                </button>
                {filteredTasks.map((t) => (
                  <button key={t.name} type="button"
                    onClick={() => { setTask(t.name); setTaskSearch(""); setTaskOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm cursor-pointer ${task === t.name ? "bg-3bm-teal/5 text-3bm-teal-dark" : "text-slate-700"}`}>
                    <span className="font-mono text-xs text-slate-400">{t.name}</span>
                    <span className="ml-1.5 truncate">{t.subject}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type *</label>
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} required
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal">
              {activityTypes.map((at) => <option key={at} value={at}>{at}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Datum *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Van *</label>
            <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} required
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tot *</label>
            <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} required
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-slate-600 mb-1">{hours > 0 ? `${hours} uur` : "—"}</label>
            <button type="submit" disabled={submitting || !employee || hours <= 0 || !activityType}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 text-sm font-medium cursor-pointer">
              <Send size={14} />
              {submitting ? "..." : "Boeken"}
            </button>
          </div>
        </div>

        <div>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Omschrijving (optioneel)"
            className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
        </div>
      </form>

      {/* Last 3 bookings by employee */}
      {employee && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-2">Laatste 3 boekingen</p>
          {loadingRecent ? (
            <p className="text-xs text-slate-400">Laden...</p>
          ) : recentEntries.length === 0 ? (
            <p className="text-xs text-slate-400">Geen eerdere boekingen</p>
          ) : (
            <div className="space-y-1">
              {recentEntries.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-slate-600">
                    <span className="text-slate-400 w-20 shrink-0">
                      {new Date(entry.from_time).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                    </span>
                    <a href={`${getErpNextAppUrl()}/app/timesheet/${entry.parent}`} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-3bm-teal hover:underline">{entry.parent}</a>
                    <span className="bg-slate-100 px-1.5 py-0.5 rounded">{entry.activity_type}</span>
                    {entry.project && <span className="text-slate-400 truncate max-w-[120px]">{entry.project}</span>}
                  </div>
                  <span className="font-semibold text-slate-700">{entry.hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}u</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Day entries summary */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <p className="text-xs font-medium text-slate-500 mb-2">
          Geboekt op {new Date(date + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "short" })}
        </p>
        {loadingEntries ? (
          <p className="text-xs text-slate-400">Laden...</p>
        ) : dayEntries.length === 0 ? (
          <p className="text-xs text-slate-400">Nog geen uren geboekt</p>
        ) : (
          <div className="space-y-1">
            {dayEntries.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <a href={`${getErpNextAppUrl()}/app/timesheet/${entry.parent}`} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-3bm-teal hover:underline">{entry.parent}</a>
                  <span className="bg-slate-100 px-1.5 py-0.5 rounded">{entry.activity_type}</span>
                  {entry.project && <span className="text-slate-400">{entry.project}</span>}
                </div>
                <span className="font-semibold text-slate-700">{entry.hours.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}u</span>
              </div>
            ))}
            <div className="pt-1 flex justify-end text-xs font-semibold text-slate-700">
              Totaal: {dayTotal.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Project Search ─── */

function ProjectSearch({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const projects = useProjects();
  const [search, setSearch] = useState("");

  const results = useMemo(() => {
    const open = projects.filter((p) => p.status === "Open");
    if (!search.trim()) return open.slice(0, 10);
    const q = search.toLowerCase();
    return open.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_name?.toLowerCase().includes(q) ||
        p.company?.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [projects, search]);

  const statusColor: Record<string, string> = {
    Open: "bg-3bm-teal/10 text-3bm-teal-dark",
    Completed: "bg-green-100 text-green-700",
    Cancelled: "bg-red-100 text-red-700",
    "Pending Review": "bg-purple-100 text-purple-700",
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <FolderKanban size={18} className="text-3bm-teal" />
        <button onClick={() => onNavigate("projects")} className="font-semibold text-slate-800 hover:text-3bm-teal cursor-pointer">Projecten zoeken &rarr;</button>
      </div>

      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Zoek op projectnr, naam of bedrijf..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm"
        />
      </div>

      {results.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-4">Geen projecten gevonden</p>
      )}

      {results.length > 0 && (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {results.map((p) => (
            <a
              key={p.name}
              href={`${getErpNextAppUrl()}/app/project/${p.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 group"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-3bm-teal group-hover:underline">{p.name}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor[p.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {p.status}
                  </span>
                </div>
                <p className="text-sm text-slate-600 truncate">{p.project_name}</p>
                {p.company && <p className="text-xs text-slate-400">{p.company}</p>}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                {p.percent_complete > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-3bm-teal rounded-full" style={{ width: `${Math.min(p.percent_complete, 100)}%` }} />
                    </div>
                    <span className="text-xs text-slate-400">{Math.round(p.percent_complete)}%</span>
                  </div>
                )}
                <ExternalLink size={14} className="text-slate-300 group-hover:text-3bm-teal" />
              </div>
            </a>
          ))}
        </div>
      )}

    </div>
  );
}

/* ─── My ToDo List ─── */

interface TodoItem {
  name: string;
  description: string;
  status: "Open" | "Closed";
  priority: "Low" | "Medium" | "High" | "Urgent";
  date: string;
  reference_type: string;
  reference_name: string;
  allocated_to: string;
  assigned_by: string;
  color: string;
}

const todoPriorityColors: Record<string, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Medium: "bg-yellow-500",
  Low: "bg-slate-400",
};

function MyTodoList() {
  const employees = useEmployees();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TodoItem>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTodo, setNewTodo] = useState({ description: "", priority: "Medium" as string, date: "" });
  const [error, setError] = useState("");

  // For assigning new todos (optional)
  const myEmployeeId = localStorage.getItem("erpnext_default_employee") || "";
  const myEmail = useMemo(() => {
    const emp = employees.find((e) => e.name === myEmployeeId);
    return emp?.user_id || emp?.company_email || "";
  }, [employees, myEmployeeId]);

  const loadTodos = useCallback(() => {
    setLoading(true);

    // Fetch ALL open ToDo's - no user filter (was causing empty results)
    fetchList<TodoItem>("ToDo", {
      fields: ["name", "description", "status", "priority", "date", "reference_type", "reference_name", "allocated_to", "assigned_by", "color"],
      filters: [["status", "=", "Open"]],
      limit_page_length: 100,
      order_by: "modified desc",
    })
      .then((todos) => {
        // Sort: by priority
        const priorityOrder: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
        todos.sort((a, b) =>
          (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
        );
        setTodos(todos);
      })
      .catch((err) => { console.error("ToDo fetch error:", err); setTodos([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadTodos(); }, [loadTodos]);

  function startEdit(todo: TodoItem) {
    setEditingId(todo.name);
    setEditData({ description: todo.description, status: todo.status, priority: todo.priority, date: todo.date || "", color: todo.color || "" });
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditData({});
  }

  async function saveEdit(todoName: string) {
    setSaving(true);
    setError("");
    try {
      await updateDocument("ToDo", todoName, {
        description: editData.description,
        status: editData.status,
        priority: editData.priority,
        date: editData.date || null,
        color: editData.color || null,
      });
      setEditingId(null);
      loadTodos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout bij opslaan");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(todo: TodoItem) {
    const newStatus = todo.status === "Open" ? "Closed" : "Open";
    try {
      await updateDocument("ToDo", todo.name, { status: newStatus });
      loadTodos();
    } catch {
      // silent
    }
  }

  async function handleDelete(todoName: string) {
    try {
      await deleteDocument("ToDo", todoName);
      loadTodos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout bij verwijderen");
    }
  }

  async function handleAdd() {
    if (!newTodo.description.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createDocument("ToDo", {
        description: newTodo.description,
        priority: newTodo.priority,
        date: newTodo.date || null,
        status: "Open",
        allocated_to: myEmail,
      });
      setNewTodo({ description: "", priority: "Medium", date: "" });
      setAdding(false);
      loadTodos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout bij aanmaken");
    } finally {
      setSaving(false);
    }
  }

  // Strip HTML tags for display
  function stripHtml(html: string): string {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  const openTodos = todos.filter((t) => t.status === "Open");
  const closedTodos = todos.filter((t) => t.status === "Closed");

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <ListTodo size={18} className="text-3bm-teal" />
        <h3 className="font-semibold text-slate-800">Mijn ToDo's</h3>
        <span className="ml-auto text-sm text-slate-400">
          {loading ? "..." : `${openTodos.length} open`}
        </span>
        <button
          onClick={() => setAdding(!adding)}
          className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-3bm-teal cursor-pointer"
          title="Nieuwe todo"
        >
          <Plus size={16} />
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{error}</div>
      )}

      {/* Add new todo */}
      {adding && (
        <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <input
            type="text"
            value={newTodo.description}
            onChange={(e) => setNewTodo({ ...newTodo, description: e.target.value })}
            placeholder="Beschrijving..."
            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={newTodo.priority}
              onChange={(e) => setNewTodo({ ...newTodo, priority: e.target.value })}
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
            <input
              type="date"
              value={newTodo.date}
              onChange={(e) => setNewTodo({ ...newTodo, date: e.target.value })}
              className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            />
            <div className="ml-auto flex gap-1">
              <button onClick={handleAdd} disabled={saving || !newTodo.description.trim()}
                className="px-2.5 py-1 bg-3bm-teal text-white rounded-lg text-xs font-medium hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer">
                {saving ? "..." : "Toevoegen"}
              </button>
              <button onClick={() => setAdding(false)}
                className="px-2 py-1 text-slate-500 hover:text-slate-700 text-xs cursor-pointer">
                Annuleer
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-slate-400 py-8">Laden...</p>
      ) : (
        <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
          {/* Open todos */}
          {openTodos.map((todo) => (
            <div key={todo.name} className="group">
              {editingId === todo.name ? (
                /* Inline edit mode */
                <div className="p-3 bg-slate-50 rounded-lg border border-3bm-teal/30 space-y-2">
                  <input
                    type="text"
                    value={editData.description || ""}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={editData.status}
                      onChange={(e) => setEditData({ ...editData, status: e.target.value as "Open" | "Closed" })}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                    >
                      <option value="Open">Open</option>
                      <option value="Closed">Closed</option>
                    </select>
                    <select
                      value={editData.priority}
                      onChange={(e) => setEditData({ ...editData, priority: e.target.value as TodoItem["priority"] })}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Urgent">Urgent</option>
                    </select>
                    <input
                      type="date"
                      value={editData.date || ""}
                      onChange={(e) => setEditData({ ...editData, date: e.target.value })}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                    />
                    <input
                      type="color"
                      value={editData.color || "#000000"}
                      onChange={(e) => setEditData({ ...editData, color: e.target.value })}
                      className="w-7 h-7 rounded border border-slate-200 cursor-pointer"
                      title="Kleur"
                    />
                    <div className="ml-auto flex gap-1">
                      <button onClick={() => saveEdit(todo.name)} disabled={saving}
                        className="p-1 rounded-lg hover:bg-green-100 text-green-600 cursor-pointer" title="Opslaan">
                        <Save size={14} />
                      </button>
                      <button onClick={cancelEdit}
                        className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer" title="Annuleren">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {todo.reference_type && todo.reference_name && (
                    <p className="text-[10px] text-slate-400">
                      Ref: {todo.reference_type} → <a href={`${getErpNextAppUrl()}/app/${todo.reference_type.toLowerCase().replace(/ /g, "-")}/${todo.reference_name}`}
                        target="_blank" rel="noopener noreferrer" className="text-3bm-teal hover:underline">{todo.reference_name}</a>
                    </p>
                  )}
                </div>
              ) : (
                /* Display mode */
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-slate-50">
                  <button
                    onClick={() => toggleStatus(todo)}
                    className="mt-0.5 w-4 h-4 rounded border border-slate-300 hover:border-3bm-teal flex-shrink-0 cursor-pointer"
                    title="Markeer als klaar"
                  />
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${todoPriorityColors[todo.priority] ?? "bg-slate-300"}`} title={todo.priority} />
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => startEdit(todo)}>
                    <p className="text-sm text-slate-700 line-clamp-2">{stripHtml(todo.description)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {todo.date && (
                        <span className={`text-[10px] ${isOverdue(todo.date) ? "text-red-500 font-semibold" : "text-slate-400"}`}>
                          {todo.date}
                        </span>
                      )}
                      {todo.reference_type && (
                        <span className="text-[10px] text-slate-400">{todo.reference_type}: {todo.reference_name}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(todo.name)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 cursor-pointer flex-shrink-0"
                    title="Verwijderen"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Closed todos (collapsed) */}
          {closedTodos.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs font-medium text-slate-400 cursor-pointer hover:text-slate-600 px-3 py-1">
                {closedTodos.length} afgerond
              </summary>
              {closedTodos.map((todo) => (
                <div key={todo.name} className="flex items-start gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-50 group">
                  <button
                    onClick={() => toggleStatus(todo)}
                    className="mt-0.5 w-4 h-4 rounded border border-slate-300 bg-3bm-teal/20 flex-shrink-0 cursor-pointer flex items-center justify-center"
                    title="Heropenen"
                  >
                    <span className="text-3bm-teal text-[10px]">✓</span>
                  </button>
                  <p className="text-sm text-slate-400 line-through line-clamp-1 flex-1">{stripHtml(todo.description)}</p>
                  <button
                    onClick={() => handleDelete(todo.name)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 cursor-pointer flex-shrink-0"
                    title="Verwijderen"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </details>
          )}

          {openTodos.length === 0 && closedTodos.length === 0 && myEmail && (
            <p className="text-sm text-slate-400 text-center py-4">Geen todo's</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Task List (werkgever full list) ─── */

function TaskList({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const storeProjects = useProjects();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["Open", "Working", "Pending Review", "Overdue"]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of storeProjects) if (p.name && p.project_name) map.set(p.name, p.project_name);
    return map;
  }, [storeProjects]);

  const company = localStorage.getItem("erpnext_default_company") || "";

  useEffect(() => {
    setLoading(true);
    const filters: unknown[][] = [];
    if (company) filters.push(["company", "=", company]);
    // Only active tasks by default
    filters.push(["status", "not in", ["Cancelled", "Template"]]);

    fetchList<Task>("Task", {
      fields: ["name", "subject", "status", "priority", "_assign as assigned_to", "project", "exp_end_date"],
      filters,
      limit_page_length: 300,
      order_by: "modified desc",
    })
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [company]);

  function toggleStatus(s: string) {
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  const filtered = useMemo(() => {
    let result = tasks;
    if (statusFilter.length > 0) result = result.filter((t) => statusFilter.includes(t.status));
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.subject?.toLowerCase().includes(q) ||
          t.project?.toLowerCase().includes(q) ||
          projectNameMap.get(t.project)?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [tasks, search, statusFilter, projectNameMap]);

  const allStatuses = ["Open", "Working", "Pending Review", "Overdue", "Completed", "Cancelled"];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col" style={{ maxHeight: "calc(100vh - 120px)" }}>
      <div className="flex items-center gap-2 mb-4">
        <CheckSquare size={18} className="text-3bm-teal" />
        <button onClick={() => onNavigate("tasks")} className="font-semibold text-slate-800 hover:text-3bm-teal cursor-pointer">Taken bureaubreed &rarr;</button>
        <span className="ml-auto text-sm text-slate-400">{loading ? "..." : `${filtered.length} taken`}</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek taken..."
            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setStatusDropdownOpen((o) => !o)}
            className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal flex items-center gap-1.5 cursor-pointer"
          >
            {statusFilter.length === 0 ? "Alle" : `${statusFilter.length} status`}
            <ChevronDown size={12} className="text-slate-400" />
          </button>
          {statusDropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setStatusDropdownOpen(false)} />
              <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[160px]">
                {allStatuses.map((s) => (
                  <label key={s} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
                    <input type="checkbox" checked={statusFilter.includes(s)} onChange={() => toggleStatus(s)}
                      className="rounded border-slate-300 text-3bm-teal focus:ring-3bm-teal" />
                    <span className={`inline-block px-1.5 py-0.5 text-xs font-medium rounded-full ${statusBadge[s] ?? "bg-slate-100 text-slate-600"}`}>
                      {s}
                    </span>
                  </label>
                ))}
                {statusFilter.length > 0 && (
                  <button onClick={() => { setStatusFilter([]); setStatusDropdownOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600 border-t border-slate-100 cursor-pointer">
                    Wis filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loading ? (
          <p className="text-center text-slate-400 py-8">Laden...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-8">Geen taken gevonden</p>
        ) : (
          filtered.map((t) => (
            <a
              key={t.name}
              href={`${getErpNextAppUrl()}/app/task/${t.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group"
            >
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${priorityDot[t.priority] ?? "bg-slate-300"}`} title={t.priority} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 group-hover:text-3bm-teal line-clamp-1">{t.subject}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] font-mono text-slate-400">{t.name}</span>
                  {t.project && (
                    <span className="text-[10px] text-slate-400 truncate max-w-[180px]">
                      {projectNameMap.get(t.project) || t.project}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {t.exp_end_date && (
                  <span className={`text-[10px] ${isOverdue(t.exp_end_date) ? "text-red-500 font-semibold" : "text-slate-400"}`}>
                    {t.exp_end_date}
                  </span>
                )}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusBadge[t.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {t.status}
                </span>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
