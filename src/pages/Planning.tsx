import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { fetchList } from "../lib/erpnext";
import { useEmployees, useLeaves } from "../lib/DataContext";
import CompanySelect from "../components/CompanySelect";
import { isHoliday } from "../lib/holidays";
import { CalendarDays, RefreshCw, ChevronLeft, ChevronRight, Filter, ZoomIn, ZoomOut } from "lucide-react";

interface Task {
  name: string;
  subject: string;
  status: string;
  priority: string;
  assigned_to: string;
  project: string;
  exp_start_date: string;
  exp_end_date: string;
}

const priorityColors: Record<string, string> = {
  Urgent: "bg-red-400",
  High: "bg-orange-400",
  Medium: "bg-3bm-teal",
  Low: "bg-slate-400",
};

const blockedCellStyle: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(148, 163, 184, 0.3) 4px, rgba(148, 163, 184, 0.3) 8px)",
};

function parseAssignees(assignedTo: string): string[] {
  if (!assignedTo) return [];
  try {
    const parsed = JSON.parse(assignedTo);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return assignedTo ? [assignedTo] : [];
  }
}

function getWeekDates(offset: number, numWeeks: number = 1): { start: Date; days: Date[] } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const totalDays = numWeeks * 5;
  const days: Date[] = [];
  let current = new Date(monday);
  let added = 0;
  while (added < totalDays) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push(new Date(current));
      added++;
    }
    current.setDate(current.getDate() + 1);
  }
  return { start: monday, days };
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatDay(d: Date): string {
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

/** Compute the visible column span for a task within the week days.
 *  Returns [startCol, endCol] (0-based, inclusive) or null if task is not visible. */
function getTaskSpan(task: Task, dayStrs: string[]): [number, number] | null {
  const start = task.exp_start_date || task.exp_end_date;
  const end = task.exp_end_date || task.exp_start_date;
  if (!start && !end) return null;

  const taskStart = start || dayStrs[0];
  const taskEnd = end || dayStrs[dayStrs.length - 1];

  // Find first visible day where task is active
  let firstCol = -1;
  let lastCol = -1;
  for (let i = 0; i < dayStrs.length; i++) {
    if (dayStrs[i] >= taskStart && dayStrs[i] <= taskEnd) {
      if (firstCol === -1) firstCol = i;
      lastCol = i;
    }
  }

  if (firstCol === -1) return null;
  return [firstCol, lastCol];
}

export default function Planning() {
  const storeEmployees = useEmployees();
  const allLeaves = useLeaves();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [weeksToShow, setWeeksToShow] = useState(1);
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [deptFilter, setDeptFilter] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);

  const { days } = useMemo(() => getWeekDates(weekOffset, weeksToShow), [weekOffset, weeksToShow]);
  const dayStrs = useMemo(() => days.map(formatDate), [days]);
  const todayStr = formatDate(new Date());

  // Ctrl+scroll zoom
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setWeeksToShow((prev) => {
        if (e.deltaY > 0) return Math.min(prev + 1, 12); // zoom out
        return Math.max(prev - 1, 1); // zoom in
      });
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Filter employees locally from the datastore
  const employees = useMemo(() => {
    let list = storeEmployees.filter((e) => e.status === "Active");
    if (company) list = list.filter((e) => e.company === company);
    return list;
  }, [storeEmployees, company]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const taskList = await fetchList<Task>("Task", {
        fields: [
          "name", "subject", "status", "priority",
          "_assign as assigned_to", "project",
          "exp_start_date", "exp_end_date",
        ],
        filters: [["status", "not in", ["Completed", "Cancelled"]]],
        limit_page_length: 500,
        order_by: "modified desc",
      });
      setTasks(taskList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) if (e.department) set.add(e.department);
    return Array.from(set).sort();
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!deptFilter) return employees;
    return employees.filter((e) => e.department === deptFilter);
  }, [employees, deptFilter]);

  // Map assignee identifiers -> tasks
  // Tasks use _assign which contains email addresses, so we index by each assignee string
  const employeeTaskMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const assignees = parseAssignees(task.assigned_to);
      for (const assignee of assignees) {
        const key = assignee.toLowerCase().trim();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(task);
      }
    }
    return map;
  }, [tasks]);

  // Helper to find tasks for an employee by checking all identifiers
  function getTasksForEmployee(emp: { name: string; user_id: string; company_email: string }): Task[] {
    const ids = new Set<string>();
    if (emp.name) ids.add(emp.name.toLowerCase().trim());
    if (emp.user_id) ids.add(emp.user_id.toLowerCase().trim());
    if (emp.company_email) ids.add(emp.company_email.toLowerCase().trim());

    const result: Task[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const found = employeeTaskMap.get(id);
      if (found) {
        for (const t of found) {
          if (!seen.has(t.name)) {
            seen.add(t.name);
            result.push(t);
          }
        }
      }
    }
    return result;
  }

  // Check if a cell should be blocked (holiday or approved leave)
  function getCellBlock(empName: string, empId: string, dayStr: string): string | null {
    // Check holiday
    const year = parseInt(dayStr.substring(0, 4));
    const holidayName = isHoliday(dayStr, year);
    if (holidayName) return holidayName;

    // Check approved leave
    const hasLeave = allLeaves.some(
      (l) =>
        l.status === "Approved" &&
        (l.employee === empId || l.employee_name === empName) &&
        dayStr >= l.from_date &&
        dayStr <= l.to_date
    );
    if (hasLeave) return "Verlof";

    return null;
  }

  /** Build the row cells for one employee.
   *  Returns an array of <td> elements that together form the 5 day-columns.
   *  Tasks that span multiple days are rendered as a single <td> with colSpan. */
  function buildRowCells(emp: { name: string; employee_name: string; user_id: string; company_email: string }) {
    const empTasks = getTasksForEmployee(emp);
    const cells: React.ReactNode[] = [];

    // Compute task spans visible in this week
    const taskSpans: { task: Task; startCol: number; endCol: number }[] = [];
    for (const task of empTasks) {
      const span = getTaskSpan(task, dayStrs);
      if (span) {
        taskSpans.push({ task, startCol: span[0], endCol: span[1] });
      }
    }

    // Sort tasks by start column, then by span width (wider first) for stacking
    taskSpans.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

    // For each column, track which tasks are present and where they START
    // We use a greedy approach: walk through columns, merging blocked cells
    // and rendering task strips at their start column with proper colSpan.
    const numDays = dayStrs.length;
    let col = 0;
    while (col < numDays) {
      const dayStr = dayStrs[col];
      const isToday = dayStr === todayStr;
      const blockReason = getCellBlock(emp.employee_name, emp.name, dayStr);

      if (blockReason) {
        // Merge consecutive blocked cells of the same reason
        let spanEnd = col;
        while (
          spanEnd + 1 < numDays &&
          getCellBlock(emp.employee_name, emp.name, dayStrs[spanEnd + 1]) !== null
        ) {
          spanEnd++;
        }
        const spanCount = spanEnd - col + 1;

        // Collect all distinct block reasons for the tooltip
        const reasons = new Set<string>();
        for (let c = col; c <= spanEnd; c++) {
          const r = getCellBlock(emp.employee_name, emp.name, dayStrs[c]);
          if (r) reasons.add(r);
        }
        const label = Array.from(reasons).join(" / ");

        // Check if any cell in this blocked span is today
        let spanHasToday = false;
        for (let c = col; c <= spanEnd; c++) {
          if (dayStrs[c] === todayStr) { spanHasToday = true; break; }
        }

        cells.push(
          <td
            key={dayStr}
            colSpan={spanCount}
            className={`px-2 py-2 border-r border-slate-200 align-top ${spanHasToday ? "ring-1 ring-inset ring-3bm-teal/30" : ""}`}
            style={blockedCellStyle}
          >
            <div className="min-h-[40px] flex items-center justify-center">
              <span className="text-xs text-slate-400 italic">{label}</span>
            </div>
          </td>
        );
        col = spanEnd + 1;
        continue;
      }

      // Not blocked: find all tasks starting at this column
      const tasksStartingHere = taskSpans.filter((ts) => ts.startCol === col);

      if (tasksStartingHere.length === 0) {
        // Empty normal cell
        cells.push(
          <td
            key={dayStr}
            className={`px-2 py-2 border-r border-slate-200 align-top ${isToday ? "bg-3bm-teal/5" : ""}`}
          >
            <div className="min-h-[40px]" />
          </td>
        );
        col++;
        continue;
      }

      // There are tasks starting at this column.
      // We need to determine if we can use colSpan (all tasks here have the same span, and
      // no tasks start at intermediate columns). The simplest correct approach:
      // find the maximum span among tasks starting here, use that colSpan, and render all
      // tasks starting here inside that cell. Tasks with shorter spans will just be narrower
      // via percentage width.

      // Find the max endCol among tasks starting at this col
      let maxEndCol = col;
      for (const ts of tasksStartingHere) {
        if (ts.endCol > maxEndCol) maxEndCol = ts.endCol;
      }

      // But we cannot span past a blocked cell or past a cell where a different-start task exists
      // Check for blocked cells in the range
      let effectiveEnd = col;
      for (let c = col + 1; c <= maxEndCol; c++) {
        if (getCellBlock(emp.employee_name, emp.name, dayStrs[c])) break;
        effectiveEnd = c;
      }

      // Also check: are there tasks that START at intermediate columns (between col+1 and effectiveEnd)?
      // If so, we need to stop before them so they get their own cell.
      for (let c = col + 1; c <= effectiveEnd; c++) {
        const hasNewStart = taskSpans.some((ts) => ts.startCol === c);
        if (hasNewStart) {
          effectiveEnd = c - 1;
          break;
        }
      }

      const spanCount = effectiveEnd - col + 1;

      // Check if span includes today
      let spanHasToday = false;
      for (let c = col; c <= effectiveEnd; c++) {
        if (dayStrs[c] === todayStr) { spanHasToday = true; break; }
      }

      cells.push(
        <td
          key={dayStr}
          colSpan={spanCount}
          className={`px-2 py-2 border-r border-slate-200 align-top ${spanHasToday ? "bg-3bm-teal/5" : ""}`}
        >
          <div className="space-y-1 min-h-[40px]">
            {tasksStartingHere.map((ts) => {
              // Calculate the visual width of this task relative to the cell's colSpan
              const taskCols = Math.min(ts.endCol, effectiveEnd) - ts.startCol + 1;
              const widthPercent = (taskCols / spanCount) * 100;

              return (
                <div
                  key={ts.task.name}
                  className={`${priorityColors[ts.task.priority] || "bg-3bm-teal"} text-white text-xs px-2 py-1 rounded truncate`}
                  style={spanCount > 1 ? { width: `${widthPercent}%`, minWidth: "fit-content" } : undefined}
                  title={`${ts.task.name}: ${ts.task.subject} (${ts.task.project || ""})`}
                >
                  {ts.task.subject || ts.task.name}
                </div>
              );
            })}
          </div>
        </td>
      );
      col = effectiveEnd + 1;
    }

    return cells;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Planningsbord</h2>
        <button onClick={loadTasks} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Vernieuwen
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      <div className="mb-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset((w) => w - 1)}
            className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setWeekOffset(0)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 cursor-pointer">
            Deze week
          </button>
          <button onClick={() => setWeekOffset((w) => w + 1)}
            className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
            <ChevronRight size={18} />
          </button>
        </div>

        <span className="text-sm font-medium text-slate-600">
          {days[0].toLocaleDateString("nl-NL", { day: "numeric", month: "long" })} - {days[days.length - 1].toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}
        </span>

        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setWeeksToShow((w) => Math.max(1, w - 1))} disabled={weeksToShow <= 1}
            className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 cursor-pointer" title="Zoom in">
            <ZoomIn size={16} />
          </button>
          <span className="text-xs text-slate-500 w-16 text-center">{weeksToShow} {weeksToShow === 1 ? "week" : "weken"}</span>
          <button onClick={() => setWeeksToShow((w) => Math.min(12, w + 1))} disabled={weeksToShow >= 12}
            className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 cursor-pointer" title="Zoom out">
            <ZoomOut size={16} />
          </button>
        </div>

        <Filter size={16} className="text-slate-400 ml-4" />
        <CompanySelect value={company} onChange={setCompany} />
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal">
          <option value="">Alle afdelingen</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Laden...</div>
      ) : (
        <div ref={tableRef} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-auto">
          <table className="w-full border-collapse table-fixed" style={{ minWidth: `${208 + days.length * 120}px` }}>
            <colgroup>
              <col className="w-52" />
              {days.map((d) => (
                <col key={formatDate(d)} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600 border-b border-r border-slate-200 sticky left-0 bg-slate-50 z-10">
                  Medewerker
                </th>
                {days.map((d, i) => {
                  const isToday = formatDate(d) === todayStr;
                  const isMonday = d.getDay() === 1 && i > 0;
                  return (
                    <th key={formatDate(d)}
                      className={`text-center px-1.5 py-3 font-semibold border-b border-r border-slate-200 ${
                        isToday ? "bg-3bm-teal/10 text-3bm-teal-dark" : "text-slate-600"
                      } ${isMonday ? "border-l-2 border-l-slate-300" : ""} ${weeksToShow > 2 ? "text-[11px]" : "text-sm"}`}>
                      {weeksToShow > 4
                        ? d.toLocaleDateString("nl-NL", { day: "numeric", month: "numeric" })
                        : formatDay(d)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 1} className="px-4 py-8 text-center text-slate-400">
                    Geen medewerkers gevonden
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.name} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3 border-r border-slate-200 sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-3">
                        <CalendarDays size={16} className="text-slate-400" />
                        <div>
                          <p className="text-sm font-medium text-slate-800">{emp.employee_name}</p>
                          <p className="text-xs text-slate-400">{emp.designation || emp.department || ""}</p>
                        </div>
                      </div>
                    </td>
                    {buildRowCells(emp)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
