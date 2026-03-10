import { useEffect, useState, useMemo, useRef } from "react";
import { fetchList, fetchDocument, createDocument, updateDocument, getErpNextLinkUrl } from "../lib/erpnext";
import { useEmployees, useProjects } from "../lib/DataContext";
import { getActiveInstance } from "../lib/instances";
import { TimesheetDetailsTable } from "../pages/Timesheets";
import type { TimesheetDetail as TSDetail, ProjectInfo } from "../lib/timesheetValidation";
import {
  Clock, Send, ChevronDown, ChevronRight, AlertTriangle,
} from "lucide-react";

/* ─── Types ─── */

interface TimesheetDetail {
  name: string;
  parent: string;
  activity_type: string;
  hours: number;
  project: string;
  task: string;
  task_name?: string;
  from_time: string;
  to_time: string;
  description: string;
  billable?: number;
}

interface UrenBoekenWidgetProps {
  showWeekTable?: boolean;
  layout?: "stacked" | "side-by-side";
}

/* ─── Helpers ─── */

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

/* ─── Component ─── */

export default function UrenBoekenWidget({
  showWeekTable = false,
  layout = "stacked",
}: UrenBoekenWidgetProps) {
  const allEmployees = useEmployees();
  const projects = useProjects();
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [employee, setEmployee] = useState(() => {
    const instanceId = getActiveInstance().id;
    return localStorage.getItem(`pref_${instanceId}_employee`) || localStorage.getItem("erpnext_default_employee") || "";
  });
  const [project, setProject] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [task, setTask] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [tasks, setTasks] = useState<{ name: string; subject: string }[]>([]);
  const [activityType, setActivityType] = useState(() => {
    const stored = localStorage.getItem("erpnext_employee_activity_types");
    if (stored) {
      try { const parsed = JSON.parse(stored); if (Array.isArray(parsed) && parsed.length > 0) return parsed[0]; } catch { /* ignore */ }
    }
    return "Execution";
  });
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [fromTime, setFromTime] = useState("08:00");
  const [toTime, setToTime] = useState("17:00");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const projectRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<HTMLDivElement>(null);

  // Week data
  const [weekEntries, setWeekEntries] = useState<TSDetail[]>([]);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [weekTimesheet, setWeekTimesheet] = useState<string | null>(null);

  // Collapsible for stacked layout
  const [expanded, setExpanded] = useState(false);

  // Calculate hours from time range
  const hours = useMemo(() => {
    if (!fromTime || !toTime) return 0;
    const [fh, fm] = fromTime.split(":").map(Number);
    const [th, tm] = toTime.split(":").map(Number);
    const diff = (th + tm / 60) - (fh + fm / 60);
    return Math.max(0, Math.round(diff * 10) / 10);
  }, [fromTime, toTime]);

  // Active employees
  const activeEmployees = useMemo(
    () => allEmployees.filter((e) => e.status === "Active"),
    [allEmployees]
  );

  // Selected employee's company
  const selectedEmployeeCompany = useMemo(() => {
    const emp = allEmployees.find((e) => e.name === employee);
    return emp?.company || "";
  }, [allEmployees, employee]);

  // Selected employee's default activity type
  const selectedEmployeeDefaultActivity = useMemo(() => {
    const emp = allEmployees.find((e) => e.name === employee);
    return emp?.default_activity_type || undefined;
  }, [allEmployees, employee]);

  // Sorted projects: 0000-projects first, then employee's company, then rest
  const sortedActiveProjects = useMemo(() => {
    const open = projects.filter((p) => p.status === "Open");
    return open.sort((a, b) => {
      const aIs0000 = a.name.startsWith("0000");
      const bIs0000 = b.name.startsWith("0000");
      if (aIs0000 && !bIs0000) return -1;
      if (!aIs0000 && bIs0000) return 1;

      const aIsEmpCompany = a.company === selectedEmployeeCompany;
      const bIsEmpCompany = b.company === selectedEmployeeCompany;
      if (aIsEmpCompany && !bIsEmpCompany) return -1;
      if (!aIsEmpCompany && bIsEmpCompany) return 1;

      return a.name.localeCompare(b.name);
    });
  }, [projects, selectedEmployeeCompany]);

  // Searchable projects
  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return sortedActiveProjects.slice(0, 50);
    const q = projectSearch.toLowerCase();
    return sortedActiveProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_name?.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [sortedActiveProjects, projectSearch]);

  // Check if selected project is from a different company
  const projectCompanyWarning = useMemo(() => {
    if (!project || !selectedEmployeeCompany) return null;
    const proj = projects.find((p) => p.name === project);
    if (proj && proj.company && proj.company !== selectedEmployeeCompany) {
      return `Project hoort bij ${proj.company}, medewerker bij ${selectedEmployeeCompany}`;
    }
    return null;
  }, [project, projects, selectedEmployeeCompany]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    if (!taskSearch.trim()) return tasks.slice(0, 30);
    const q = taskSearch.toLowerCase();
    return tasks.filter(
      (t) => t.name.toLowerCase().includes(q) || t.subject?.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [tasks, taskSearch]);

  // Project info for TimesheetDetailsTable
  const projectInfos: ProjectInfo[] = useMemo(
    () => projects.map((p) => ({ name: p.name, company: p.company, project_name: p.project_name })),
    [projects]
  );

  // Week total
  const weekTotal = useMemo(
    () => weekEntries.reduce((s, d) => s + d.hours, 0),
    [weekEntries]
  );

  // Load activity types
  useEffect(() => {
    fetchList<{ name: string }>("Activity Type", { fields: ["name"], limit_page_length: 0 })
      .then((list) => {
        const names = list.map((a) => a.name);
        setActivityTypes(names);
        // Update default if needed
        const stored = localStorage.getItem("erpnext_employee_activity_types");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0 && names.includes(parsed[0])) {
              setActivityType(parsed[0]);
              return;
            }
          } catch { /* ignore */ }
        }
        if (!names.includes(activityType)) {
          setActivityType(names[0] || "");
        }
      });
  }, []);

  // Update activity type when employee changes (use employee's default)
  useEffect(() => {
    if (selectedEmployeeDefaultActivity && activityTypes.includes(selectedEmployeeDefaultActivity)) {
      setActivityType(selectedEmployeeDefaultActivity);
    }
  }, [employee, selectedEmployeeDefaultActivity, activityTypes]);

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

  // Find existing week timesheet
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

  // Load week entries
  useEffect(() => {
    if (!employee || !date) { setWeekEntries([]); return; }
    const monday = getWeekMonday(date);
    const sunday = getWeekSunday(date);
    const delay = success ? 800 : 0;
    const timer = setTimeout(() => {
      setLoadingWeek(true);
      fetchList<{ name: string }>("Timesheet", {
        fields: ["name"],
        filters: [
          ["employee", "=", employee],
          ["start_date", ">=", monday],
          ["start_date", "<=", sunday],
          ["docstatus", "!=", 2],
        ],
        limit_page_length: 20,
        order_by: "start_date asc",
      }).then(async (timesheets) => {
        if (timesheets.length === 0) { setWeekEntries([]); setLoadingWeek(false); return; }
        const allDetails: TSDetail[] = [];
        for (const ts of timesheets) {
          try {
            const doc = await fetchDocument<{ name: string; time_logs: TimesheetDetail[] }>("Timesheet", ts.name);
            if (doc.time_logs) {
              for (const log of doc.time_logs) {
                allDetails.push({
                  name: log.name,
                  parent: ts.name,
                  activity_type: log.activity_type || "",
                  hours: log.hours || 0,
                  project: log.project || "",
                  from_time: log.from_time || "",
                  task: log.task || "",
                  task_name: log.task_name,
                  description: log.description,
                  billable: log.billable,
                });
              }
            }
          } catch { /* skip failed fetches */ }
        }
        allDetails.sort((a, b) => (a.from_time || "").localeCompare(b.from_time || ""));
        setWeekEntries(allDetails);
      }).catch(() => setWeekEntries([]))
        .finally(() => setLoadingWeek(false));
    }, delay);
    return () => clearTimeout(timer);
  }, [employee, date, success]);

  // Update a timesheet detail (task or description)
  async function handleUpdateDetail(detail: TSDetail, field: "task" | "description" | "billable", value: string) {
    // Fetch the full timesheet document
    const doc = await fetchDocument<{ name: string; time_logs: TimesheetDetail[] }>("Timesheet", detail.parent);
    if (!doc.time_logs) return;
    // Find and update the specific time_log row
    const updatedLogs = doc.time_logs.map((log) => {
      if (log.name === detail.name) {
        const val = field === "billable" ? parseInt(value) : value;
        return { ...log, [field]: val };
      }
      return log;
    });
    // Save back
    await updateDocument("Timesheet", detail.parent, { time_logs: updatedLogs });
    // Update local state
    const localVal = field === "billable" ? parseInt(value) : value;
    setWeekEntries(prev => prev.map(e =>
      e.name === detail.name ? { ...e, [field]: localVal, ...(field === "task" ? { task_name: undefined } : {}) } : e
    ));
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (projectRef.current && !projectRef.current.contains(e.target as Node)) setProjectOpen(false);
      if (taskRef.current && !taskRef.current.contains(e.target as Node)) setTaskOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
        const existing = await fetchDocument<{ name: string; time_logs: Record<string, unknown>[] }>("Timesheet", weekTimesheet);
        const existingLogs = (existing.time_logs || []).map((log) => ({
          name: log.name,
          doctype: "Timesheet Detail",
          parent: weekTimesheet,
          parenttype: "Timesheet",
          parentfield: "time_logs",
          activity_type: log.activity_type,
          from_time: log.from_time,
          to_time: log.to_time,
          hours: log.hours,
          project: log.project,
          task: log.task,
          description: log.description,
        }));
        await updateDocument("Timesheet", weekTimesheet, {
          time_logs: [...existingLogs, newTimeLog],
        });
        tsName = weekTimesheet;
      } else {
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

  /* ─── Form Card ─── */
  const formCard = (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock size={18} className="text-3bm-teal" />
        <h3 className="font-semibold text-slate-800">Uren boeken</h3>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
          {weekTimesheet && (
            <a
              href={`${getErpNextLinkUrl()}/timesheet/${weekTimesheet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-3bm-teal hover:underline"
              title="Week-timesheet openen"
            >
              {weekTimesheet}
            </a>
          )}
          {weekTotal > 0 && (
            <span>
              Week: <span className="font-semibold text-slate-700">{weekTotal.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur</span>
            </span>
          )}
        </div>
      </div>

      {success && <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success}</div>}
      {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Row 1: Employee | Project */}
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
              className={`w-full px-2.5 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal ${
                projectCompanyWarning ? "border-amber-400" : "border-slate-200"
              }`}
            />
            {projectCompanyWarning && (
              <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                <AlertTriangle size={12} />
                <span>{projectCompanyWarning}</span>
              </div>
            )}
            {projectOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                <button type="button" onClick={() => { setProject(""); setTask(""); setProjectSearch(""); setProjectOpen(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm text-slate-400 cursor-pointer">
                  Geen project
                </button>
                {filteredProjects.map((p) => {
                  const isDiffCompany = selectedEmployeeCompany && p.company && p.company !== selectedEmployeeCompany;
                  return (
                    <button key={p.name} type="button"
                      onClick={() => { setProject(p.name); setProjectSearch(""); setProjectOpen(false); setTask(""); }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm cursor-pointer ${project === p.name ? "bg-3bm-teal/5 text-3bm-teal-dark" : "text-slate-700"}`}>
                      <span className="font-mono text-xs text-slate-400">{p.name}</span>
                      <span className="ml-1.5">{p.project_name}</span>
                      {isDiffCompany && (
                        <span className="ml-1.5 text-xs text-amber-500">({p.company})</span>
                      )}
                    </button>
                  );
                })}
                {filteredProjects.length === 0 && (
                  <div className="px-3 py-2 text-sm text-slate-400">Geen projecten gevonden</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Task (conditional) */}
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

        {/* Row 3: Type | Date | From | To | Book */}
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
            <label className="block text-xs font-medium text-slate-600 mb-1">{hours > 0 ? `${hours} uur` : "\u2014"}</label>
            <button type="submit" disabled={submitting || !employee || hours <= 0 || !activityType}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 text-sm font-medium cursor-pointer">
              <Send size={14} />
              {submitting ? "..." : "Boeken"}
            </button>
          </div>
        </div>

        {/* Row 4: Description */}
        <div>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Omschrijving (optioneel)"
            className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
        </div>
      </form>
    </div>
  );

  /* ─── Layout: side-by-side (Timesheets page) ─── */
  if (layout === "side-by-side" && showWeekTable) {
    return (
      <div className="flex gap-6">
        <div className="w-[750px] flex-shrink-0">
          {formCard}
        </div>
        <div className="flex-1">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Uren deze week</h3>
              <span className="text-sm font-semibold text-slate-700">
                {weekTotal.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} uur
              </span>
            </div>
            <TimesheetDetailsTable
              details={weekEntries}
              projects={projectInfos}
              employeeCompany={selectedEmployeeCompany}
              defaultActivityType={selectedEmployeeDefaultActivity}
              loading={loadingWeek}
              defaultGroupBy="dag"
            />
          </div>
        </div>
      </div>
    );
  }

  /* ─── Layout: stacked (Dashboard) ─── */
  return (
    <div>
      {formCard}

      {/* Collapsible section below form */}
      {employee && (
        <div className="mt-4">
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-3bm-teal cursor-pointer mb-2"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {expanded ? "Alle boekingen deze week" : "Laatste 3 boekingen"}
          </button>
          {expanded ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <TimesheetDetailsTable
                key="week-all"
                details={weekEntries}
                projects={projectInfos}
                employeeCompany={selectedEmployeeCompany}
                defaultActivityType={selectedEmployeeDefaultActivity}
                loading={loadingWeek}
                defaultGroupBy="dag"
                onUpdateDetail={handleUpdateDetail}
              />
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <TimesheetDetailsTable
                key="week-last3"
                details={weekEntries.slice(-3)}
                projects={projectInfos}
                employeeCompany={selectedEmployeeCompany}
                defaultActivityType={selectedEmployeeDefaultActivity}
                loading={loadingWeek}
                defaultGroupBy={null}
                onUpdateDetail={handleUpdateDetail}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
