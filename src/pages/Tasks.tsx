import { useEffect, useState, useMemo, type DragEvent } from "react";
import { fetchList, fetchDocument, createDocument, callMethod, getErpNextAppUrl } from "../lib/erpnext";
import {
  CheckSquare, RefreshCw, Search, LayoutGrid, List, User, Filter,
  GripVertical, ChevronDown, Plus, X, ExternalLink, Calendar, Flag,
  FileText, Briefcase,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";
import { useProjects } from "../lib/DataContext";

interface Employee {
  name: string;
  employee_name: string;
  company_email: string;
  user_id: string;
}

interface Task {
  name: string;
  subject: string;
  status: string;
  priority: string;
  assigned_to: string;
  project: string;
  exp_end_date: string;
  description: string;
  company: string;
  workflow_state: string;
}

const workflowColors: Record<string, string> = {
  Open: "bg-3bm-teal/10 text-3bm-teal-dark",
  Working: "bg-yellow-100 text-yellow-700",
  "Pending Review Intern": "bg-purple-100 text-purple-700",
  "Pending Review Extern": "bg-indigo-100 text-indigo-700",
  "On Hold": "bg-orange-100 text-orange-700",
  "Information required": "bg-amber-100 text-amber-700",
  "to discussed": "bg-cyan-100 text-cyan-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
};

// Workflow action map: { fromState: [{ action, nextState }] }
const workflowActions: Record<string, { action: string; next: string }[]> = {
  Open: [
    { action: "Working", next: "Working" },
    { action: "Pending Review Intern", next: "Pending Review Intern" },
    { action: "Pending Review Extern", next: "Pending Review Extern" },
    { action: "On Hold", next: "On Hold" },
    { action: "Information Required", next: "Information required" },
    { action: "to be discussed", next: "to discussed" },
    { action: "Completed", next: "Completed" },
    { action: "Cancel", next: "Cancelled" },
  ],
  Working: [
    { action: "Send to Open", next: "Open" },
    { action: "Pending Review Intern", next: "Pending Review Intern" },
    { action: "Pending Review Extern", next: "Pending Review Extern" },
    { action: "Information Required", next: "Information required" },
    { action: "to be discussed", next: "to discussed" },
    { action: "Completed", next: "Completed" },
    { action: "Cancel", next: "Cancelled" },
  ],
  "Pending Review Intern": [
    { action: "Send to Open", next: "Open" },
    { action: "Working", next: "Working" },
    { action: "Pending Review Extern", next: "Pending Review Extern" },
    { action: "On Hold", next: "On Hold" },
    { action: "Information Required", next: "Information required" },
    { action: "to be discussed", next: "to discussed" },
    { action: "Completed", next: "Completed" },
    { action: "Cancel", next: "Cancelled" },
  ],
  "Pending Review Extern": [
    { action: "Send to Open", next: "Open" },
    { action: "Working", next: "Working" },
    { action: "Pending Review Intern", next: "Pending Review Intern" },
    { action: "On Hold", next: "On Hold" },
    { action: "Information Required", next: "Information required" },
    { action: "to be discussed", next: "to discussed" },
    { action: "Completed", next: "Completed" },
    { action: "Cancel", next: "Cancelled" },
  ],
  "On Hold": [
    { action: "Send to Open", next: "Open" },
    { action: "Working", next: "Working" },
    { action: "Pending Review Intern", next: "Pending Review Intern" },
    { action: "Pending Review Extern", next: "Pending Review Extern" },
    { action: "Information Required", next: "Information required" },
    { action: "to be discussed", next: "to discussed" },
    { action: "Completed", next: "Completed" },
    { action: "Cancel", next: "Cancelled" },
  ],
  "Information required": [
    { action: "Send to Open", next: "Open" },
    { action: "Working", next: "Working" },
    { action: "Pending Review Intern", next: "Pending Review Intern" },
    { action: "Pending Review Extern", next: "Pending Review Extern" },
    { action: "On Hold", next: "On Hold" },
    { action: "Completed", next: "Completed" },
    { action: "Cancel", next: "Cancelled" },
  ],
  "to discussed": [
    { action: "Send to Open", next: "Open" },
    { action: "Completed", next: "Completed" },
    { action: "Cancel", next: "Cancelled" },
  ],
  Completed: [
    { action: "Send to Open", next: "Open" },
    { action: "Working", next: "Working" },
    { action: "Pending Review Intern", next: "Pending Review Intern" },
    { action: "Pending Review Extern", next: "Pending Review Extern" },
    { action: "On Hold", next: "On Hold" },
    { action: "Information Required", next: "Information required" },
    { action: "Cancel", next: "Cancelled" },
  ],
};

const statusBadge: Record<string, string> = {
  Open: "bg-3bm-teal/10 text-3bm-teal-dark",
  Working: "bg-yellow-100 text-yellow-700",
  "Pending Review": "bg-purple-100 text-purple-700",
  "Pending Internal Review": "bg-indigo-100 text-indigo-700",
  "Information Required": "bg-amber-100 text-amber-700",
  Overdue: "bg-red-100 text-red-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-slate-100 text-slate-600",
  "Template": "bg-slate-100 text-slate-500",
};

const priorityColors: Record<string, string> = {
  Urgent: "bg-red-100 text-red-700",
  High: "bg-orange-100 text-orange-700",
  Medium: "bg-yellow-100 text-yellow-700",
  Low: "bg-slate-100 text-slate-600",
};

const priorityDot: Record<string, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Medium: "bg-yellow-500",
  Low: "bg-slate-400",
};

function parseAssignees(assignedTo: string): string[] {
  if (!assignedTo) return [];
  try {
    const parsed = JSON.parse(assignedTo);
    if (Array.isArray(parsed)) return parsed;
    return [String(parsed)];
  } catch {
    return assignedTo ? [assignedTo] : [];
  }
}

function getInitials(email: string): string {
  const name = email.split("@")[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(email: string): string {
  const colors = [
    "bg-3bm-teal/100", "bg-green-500", "bg-purple-500", "bg-pink-500",
    "bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-cyan-500",
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function isOverdue(date: string): boolean {
  if (!date) return false;
  return new Date(date) < new Date(new Date().toDateString());
}

export default function Tasks() {
  const storeProjects = useProjects();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Build email → employee name map
  const emailToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const emp of employees) {
      if (emp.user_id) map.set(emp.user_id.toLowerCase(), emp.employee_name);
      if (emp.company_email) map.set(emp.company_email.toLowerCase(), emp.employee_name);
    }
    return map;
  }, [employees]);

  // Build project ID → project name map
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of storeProjects) {
      if (p.name && p.project_name) map.set(p.name, p.project_name);
    }
    return map;
  }, [storeProjects]);

  function getDisplayName(email: string): string {
    if (email === "Niet toegewezen") return email;
    return emailToName.get(email.toLowerCase()) || email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [];
      if (company) filters.push(["company", "=", company]);
      const [list, empList] = await Promise.all([
        fetchList<Task>("Task", {
          fields: [
            "name", "subject", "status", "priority",
            "_assign as assigned_to", "project", "exp_end_date",
            "description", "company", "workflow_state",
          ],
          filters,
          limit_page_length: 300,
          order_by: "modified desc",
        }),
        fetchList<Employee>("Employee", {
          fields: ["name", "employee_name", "company_email", "user_id"],
          filters: [["status", "=", "Active"]],
          limit_page_length: 200,
        }),
      ]);
      setTasks(list);
      setEmployees(empList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [company]);

  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

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
          projectNameMap.get(t.project)?.toLowerCase().includes(q) ||
          t.assigned_to?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [tasks, search, statusFilter, projectNameMap]);

  const kanbanData = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of filtered) {
      const assignees = parseAssignees(task.assigned_to);
      if (assignees.length === 0) {
        const key = "Niet toegewezen";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(task);
      } else {
        for (const email of assignees) {
          if (!map.has(email)) map.set(email, []);
          map.get(email)!.push(task);
        }
      }
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "Niet toegewezen") return 1;
      if (b[0] === "Niet toegewezen") return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);



  async function reassignTask(taskName: string, fromEmail: string, toEmail: string) {
    if (fromEmail === toEmail) return;

    // Optimistic: update assigned_to in local state
    setTasks(prev => prev.map(t => {
      if (t.name !== taskName) return t;
      const assignees = parseAssignees(t.assigned_to);
      const newAssignees = assignees.filter(a => a !== fromEmail);
      if (toEmail !== "Niet toegewezen") newAssignees.push(toEmail);
      return { ...t, assigned_to: JSON.stringify(newAssignees) };
    }));

    try {
      if (fromEmail && fromEmail !== "Niet toegewezen") {
        await callMethod("frappe.desk.form.assign_to.remove", {
          doctype: "Task",
          name: taskName,
          assign_to: fromEmail,
        });
      }
      if (toEmail && toEmail !== "Niet toegewezen") {
        await callMethod("frappe.desk.form.assign_to.add", {
          doctype: "Task",
          name: taskName,
          assign_to: [toEmail],
        });
      }
    } catch (e) {
      loadData(); // Revert on failure
      setError(e instanceof Error ? e.message : "Fout bij toewijzen");
    }
  }

  async function changeTaskStatus(taskName: string, newStatus: string) {
    // Optimistic update
    setTasks(prev => prev.map(t => t.name === taskName ? { ...t, status: newStatus } : t));

    try {
      await callMethod("frappe.client.set_value", {
        doctype: "Task",
        name: taskName,
        fieldname: "status",
        value: newStatus,
      });
    } catch (e) {
      loadData();
      setError(e instanceof Error ? e.message : "Fout bij status wijzigen");
    }
  }

  async function changeWorkflowState(taskName: string, action: string, nextState: string) {
    // Optimistic update
    setTasks(prev => prev.map(t => t.name === taskName ? { ...t, workflow_state: nextState } : t));

    try {
      await callMethod("frappe.model.workflow.apply_workflow", {
        doc: { doctype: "Task", name: taskName },
        action,
      });

      // If completing a task, try to create a draft Delivery Note from the project's Sales Order
      if (nextState === "Completed") {
        const task = tasks.find((t) => t.name === taskName);
        if (task?.project) {
          try {
            await createDeliveryNoteFromProject(task.project, taskName);
          } catch (e) {
            console.warn("Delivery Note aanmaken overgeslagen:", e);
          }
        }
      }
    } catch (e) {
      loadData();
      setError(e instanceof Error ? e.message : "Fout bij workflow wijzigen");
    }
  }

  /** Try to create a draft Delivery Note from the project's linked Sales Order */
  async function createDeliveryNoteFromProject(projectName: string, _taskName: string) {
    // Find Sales Orders linked to this project
    const salesOrders = await fetchList<{ name: string; customer: string; company: string }>("Sales Order", {
      fields: ["name", "customer", "company"],
      filters: [["project", "=", projectName], ["docstatus", "=", 1]],
      limit_page_length: 1,
    });
    if (salesOrders.length === 0) return; // No sales order linked

    const so = salesOrders[0];
    // Fetch SO items
    const soDoc = await fetchDocument<{
      items: { item_code: string; item_name: string; qty: number; rate: number; uom: string; warehouse: string }[];
    }>("Sales Order", so.name);
    if (!soDoc.items?.length) return;

    // Create draft Delivery Note
    const dn = await createDocument<{ name: string }>("Delivery Note", {
      customer: so.customer,
      company: so.company,
      project: projectName,
      items: soDoc.items.map((item) => ({
        item_code: item.item_code,
        item_name: item.item_name,
        qty: item.qty,
        rate: item.rate,
        uom: item.uom,
        warehouse: item.warehouse,
        against_sales_order: so.name,
      })),
    });

    setError(null);
    const url = `${getErpNextAppUrl()}/app/delivery-note/${dn.name}`;
    // Show success with link
    alert(`Delivery Note ${dn.name} aangemaakt als draft.\n\nOpen in ERPNext: ${url}`);
    window.open(url, "_blank");
  }

  async function changeAssignee(taskName: string, oldEmails: string[], newEmail: string) {
    // Optimistic: replace all assignments with the new one
    setTasks(prev => prev.map(t => {
      if (t.name !== taskName) return t;
      return { ...t, assigned_to: JSON.stringify(newEmail ? [newEmail] : []) };
    }));

    try {
      // Remove old assignments
      for (const email of oldEmails) {
        await callMethod("frappe.desk.form.assign_to.remove", {
          doctype: "Task",
          name: taskName,
          assign_to: email,
        });
      }
      // Add new assignment
      if (newEmail) {
        await callMethod("frappe.desk.form.assign_to.add", {
          doctype: "Task",
          name: taskName,
          assign_to: [newEmail],
        });
      }
    } catch (e) {
      loadData();
      setError(e instanceof Error ? e.message : "Fout bij toewijzen");
    }
  }

  return (
    <div className="p-6 min-w-0">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Taken</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden">
            <button onClick={() => setView("kanban")}
              className={`px-3 py-2 flex items-center gap-1.5 text-sm cursor-pointer ${view === "kanban" ? "bg-3bm-teal text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              <LayoutGrid size={16} /> Kanban
            </button>
            <button onClick={() => setView("table")}
              className={`px-3 py-2 flex items-center gap-1.5 text-sm cursor-pointer ${view === "table" ? "bg-3bm-teal text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              <List size={16} /> Tabel
            </button>
          </div>
          <a
            href={`${getErpNextAppUrl()}/task/new`}
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
          <div className="p-2 bg-emerald-100 rounded-lg">
            <CheckSquare className="text-emerald-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Taken</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : filtered.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-3bm-teal/10 rounded-lg">
            <User className="text-3bm-teal" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Medewerkers</p>
            <p className="text-2xl font-bold text-slate-800">
              {loading ? "..." : kanbanData.filter(([k]) => k !== "Niet toegewezen").length}
            </p>
          </div>
        </div>

        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />

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
                {["Open", "Working", "Pending Review", "Pending Internal Review", "Information Required", "Overdue", "Completed", "Cancelled", "Template"].map((s) => (
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
                    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge[s]}`}>
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
          <input type="text" placeholder="Zoek op onderwerp, taaknummer, project of medewerker..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm" />
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanView data={kanbanData} loading={loading} onReassign={reassignTask} onStatusChange={changeTaskStatus} getDisplayName={getDisplayName} onSelectTask={setSelectedTask} projectNameMap={projectNameMap} />
      ) : (
        <TableView tasks={filtered} loading={loading} search={search} getDisplayName={getDisplayName} onSelectTask={setSelectedTask} />
      )}

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          getDisplayName={getDisplayName}
          projectName={projectNameMap.get(selectedTask.project) || ""}
          employees={employees}
          onStatusChange={(name, status) => {
            changeTaskStatus(name, status);
            setSelectedTask((prev) => prev && prev.name === name ? { ...prev, status } : prev);
          }}
          onWorkflowChange={(name, action, nextState) => {
            changeWorkflowState(name, action, nextState);
            setSelectedTask((prev) => prev && prev.name === name ? { ...prev, workflow_state: nextState } : prev);
          }}
          onAssigneeChange={(name, oldEmails, newEmail) => {
            changeAssignee(name, oldEmails, newEmail);
            setSelectedTask((prev) => prev && prev.name === name
              ? { ...prev, assigned_to: JSON.stringify(newEmail ? [newEmail] : []) }
              : prev);
          }}
        />
      )}
    </div>
  );
}

/* ─── Task Detail Panel ─── */

function TaskDetail({
  task,
  onClose,
  getDisplayName,
  projectName,
  employees,
  onStatusChange,
  onWorkflowChange,
  onAssigneeChange,
}: {
  task: Task;
  onClose: () => void;
  getDisplayName: (email: string) => string;
  projectName: string;
  employees: Employee[];
  onStatusChange: (taskName: string, newStatus: string) => void;
  onWorkflowChange: (taskName: string, action: string, nextState: string) => void;
  onAssigneeChange: (taskName: string, oldEmails: string[], newEmail: string) => void;
}) {
  const assignees = parseAssignees(task.assigned_to);
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);

  const fields: { label: string; icon: typeof Briefcase; value: React.ReactNode }[] = [
    {
      label: "Workflow",
      icon: Flag,
      value: (
        <WorkflowChanger
          currentState={task.workflow_state}
          onWorkflowChange={(action, nextState) => onWorkflowChange(task.name, action, nextState)}
        />
      ),
    },
    {
      label: "Status",
      icon: Flag,
      value: (
        <StatusChanger
          currentStatus={task.status}
          onStatusChange={(s) => onStatusChange(task.name, s)}
        />
      ),
    },
    {
      label: "Prioriteit",
      icon: Flag,
      value: (
        <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${priorityColors[task.priority] ?? "bg-slate-100 text-slate-600"}`}>
          {task.priority || "-"}
        </span>
      ),
    },
    {
      label: "Project",
      icon: Briefcase,
      value: task.project ? (
        <a
          href={`${getErpNextAppUrl()}/project/${task.project}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-3bm-teal hover:underline flex items-center gap-1"
        >
          {projectName || task.project}
          <ExternalLink size={12} className="opacity-50" />
        </a>
      ) : (
        <span className="text-sm text-slate-400">-</span>
      ),
    },
    {
      label: "Toegewezen aan",
      icon: User,
      value: (
        <div>
          <div className="flex flex-wrap gap-2 mb-1">
            {assignees.length > 0 ? assignees.map((email) => (
              <div key={email} className="flex items-center gap-2 bg-slate-50 rounded-full px-2 py-1">
                <div className={`w-6 h-6 rounded-full ${getAvatarColor(email)} flex items-center justify-center text-white text-[10px] font-bold`}>
                  {getInitials(email)}
                </div>
                <span className="text-sm text-slate-700">{getDisplayName(email)}</span>
              </div>
            )) : (
              <span className="text-sm text-slate-400">Niet toegewezen</span>
            )}
          </div>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setAssignDropdownOpen(!assignDropdownOpen); }}
              className="text-xs text-3bm-teal hover:underline cursor-pointer"
            >
              Wijzig toewijzing
            </button>
            {assignDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setAssignDropdownOpen(false); }} />
                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40 py-1 min-w-[220px] max-h-60 overflow-y-auto">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssigneeChange(task.name, assignees, "");
                      setAssignDropdownOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm text-slate-400 cursor-pointer"
                  >
                    Niemand
                  </button>
                  {employees.map((emp) => {
                    const email = emp.user_id || emp.company_email;
                    if (!email) return null;
                    return (
                      <button
                        key={emp.name}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAssigneeChange(task.name, assignees, email);
                          setAssignDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm cursor-pointer flex items-center gap-2 ${
                          assignees.includes(email) ? "bg-3bm-teal/5 text-3bm-teal-dark" : "text-slate-700"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full ${getAvatarColor(email)} flex items-center justify-center text-white text-[9px] font-bold`}>
                          {getInitials(email)}
                        </div>
                        {emp.employee_name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      ),
    },
    {
      label: "Deadline",
      icon: Calendar,
      value: (
        <span className={`text-sm ${task.exp_end_date && isOverdue(task.exp_end_date) ? "text-red-500 font-semibold" : "text-slate-700"}`}>
          {task.exp_end_date || "-"}
        </span>
      ),
    },
    {
      label: "Bedrijf",
      icon: Briefcase,
      value: <span className="text-sm text-slate-700">{task.company || "-"}</span>,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-slate-400 font-mono">{task.name}</p>
            <h3 className="text-lg font-bold text-slate-800 truncate">{task.subject}</h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={`${getErpNextAppUrl()}/task/${task.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-3bm-teal"
              title="Openen in ERPNext"
            >
              <ExternalLink size={18} />
            </a>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg cursor-pointer">
              <X size={20} className="text-slate-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Properties */}
          <div className="space-y-4">
            {fields.map(({ label, icon: Icon, value }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-32 flex-shrink-0 flex items-center gap-2 pt-1">
                  <Icon size={14} className="text-slate-400" />
                  <span className="text-sm text-slate-500">{label}</span>
                </div>
                <div className="flex-1">{value}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          {task.description && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-600">Beschrijving</span>
              </div>
              <div
                className="prose prose-sm max-w-none text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-200"
                dangerouslySetInnerHTML={{ __html: task.description }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- KANBAN with Drag & Drop ----

function StatusChanger({ currentStatus, onStatusChange }: {
  currentStatus: string;
  onStatusChange: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const statuses = ["Open", "Working", "Pending Review", "Pending Internal Review", "Information Required", "Overdue", "Completed", "Cancelled", "Template"];

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full cursor-pointer ${statusBadge[currentStatus] ?? "bg-slate-100 text-slate-600"}`}
      >
        {currentStatus}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40 py-1 min-w-[180px]">
            {statuses.filter(s => s !== currentStatus).map(s => (
              <button
                key={s}
                onClick={(e) => { e.stopPropagation(); onStatusChange(s); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm flex items-center gap-2 cursor-pointer"
              >
                <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge[s] ?? "bg-slate-100 text-slate-600"}`}>
                  {s}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function WorkflowChanger({ currentState, onWorkflowChange }: {
  currentState: string;
  onWorkflowChange: (action: string, nextState: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const transitions = workflowActions[currentState] || [];

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full cursor-pointer ${workflowColors[currentState] ?? "bg-slate-100 text-slate-600"}`}
      >
        {currentState || "-"}
      </button>
      {open && transitions.length > 0 && (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40 py-1 min-w-[200px]">
            {transitions.map(({ action, next }) => (
              <button
                key={action}
                onClick={(e) => { e.stopPropagation(); onWorkflowChange(action, next); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm flex items-center gap-2 cursor-pointer"
              >
                <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${workflowColors[next] ?? "bg-slate-100 text-slate-600"}`}>
                  {next}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function KanbanView({
  data, loading, onReassign, onStatusChange, getDisplayName, onSelectTask, projectNameMap,
}: {
  data: [string, Task[]][];
  loading: boolean;
  onReassign: (taskName: string, from: string, to: string) => void;
  onStatusChange: (taskName: string, newStatus: string) => void;
  getDisplayName: (email: string) => string;
  onSelectTask: (task: Task) => void;
  projectNameMap: Map<string, string>;
}) {
  const [dragData, setDragData] = useState<{ taskName: string; fromColumn: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400">Laden...</div>;
  if (data.length === 0) return <div className="flex items-center justify-center py-16 text-slate-400">Geen taken gevonden</div>;

  function handleDragStart(e: DragEvent, taskName: string, fromColumn: string) {
    e.dataTransfer.effectAllowed = "move";
    setDragData({ taskName, fromColumn });
  }

  function handleDragOver(e: DragEvent, column: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(column);
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  function handleDrop(e: DragEvent, toColumn: string) {
    e.preventDefault();
    setDropTarget(null);
    if (dragData && dragData.fromColumn !== toColumn) {
      onReassign(dragData.taskName, dragData.fromColumn, toColumn);
    }
    setDragData(null);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {data.map(([assignee, tasks]) => (
        <div
          key={assignee}
          className={`flex-shrink-0 w-80 rounded-xl border transition-colors ${
            dropTarget === assignee
              ? "bg-3bm-teal/10 border-3bm-teal"
              : "bg-slate-50 border-slate-200"
          }`}
          onDragOver={(e) => handleDragOver(e, assignee)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, assignee)}
        >
          <div className="p-3 border-b border-slate-200 flex items-center gap-3">
            {assignee === "Niet toegewezen" ? (
              <div className="w-8 h-8 rounded-full bg-slate-300 flex items-center justify-center text-white text-xs font-bold">?</div>
            ) : (
              <div className={`w-8 h-8 rounded-full ${getAvatarColor(assignee)} flex items-center justify-center text-white text-xs font-bold`}>
                {getInitials(assignee)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">
                {getDisplayName(assignee)}
              </p>
              <p className="text-xs text-slate-400">{tasks.length} {tasks.length === 1 ? "taak" : "taken"}</p>
            </div>
          </div>
          <div className="p-2 space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
            {tasks.map((task) => (
              <div
                key={`${assignee}-${task.name}`}
                draggable
                onDragStart={(e) => handleDragStart(e, task.name, assignee)}
                onClick={() => onSelectTask(task)}
                className="bg-white rounded-lg border border-slate-200 p-3 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1">
                    <GripVertical size={14} className="text-slate-300" />
                    <p className="text-xs font-mono text-slate-400">{task.name}</p>
                  </div>
                  {task.priority && (
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${priorityDot[task.priority] ?? "bg-slate-300"}`} title={task.priority} />
                  )}
                </div>
                <p className="text-sm font-medium text-slate-800 mb-2 line-clamp-2">{task.subject}</p>
                {task.project && (
                  <p className="text-xs text-3bm-teal mb-2 truncate" title={task.project}>
                    <span className="font-mono">{task.project}</span>
                    {projectNameMap.get(task.project) && (
                      <span className="text-slate-500 font-sans"> · {projectNameMap.get(task.project)}</span>
                    )}
                  </p>
                )}
                <div className="flex items-center justify-between gap-1 flex-wrap">
                  <div className="flex items-center gap-1">
                    {task.workflow_state && (
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-full ${workflowColors[task.workflow_state] ?? "bg-slate-100 text-slate-600"}`}>
                        {task.workflow_state}
                      </span>
                    )}
                    <StatusChanger
                      currentStatus={task.status}
                      onStatusChange={(newStatus) => onStatusChange(task.name, newStatus)}
                    />
                  </div>
                  {task.exp_end_date && (
                    <span className={`text-xs ${isOverdue(task.exp_end_date) ? "text-red-500 font-semibold" : "text-slate-400"}`}>
                      {task.exp_end_date}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- TABLE VIEW ----

function TableView({ tasks, loading, search, getDisplayName, onSelectTask }: { tasks: Task[]; loading: boolean; search: string; getDisplayName: (email: string) => string; onSelectTask: (task: Task) => void }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Taak</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Onderwerp</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Toegewezen aan</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Project</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Prioriteit</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Workflow</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Status</th>
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Laden...</td></tr>
          ) : tasks.length === 0 ? (
            <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">{search ? "Geen taken gevonden" : "Geen taken"}</td></tr>
          ) : tasks.map((t) => {
            const assignees = parseAssignees(t.assigned_to);
            return (
              <tr key={t.name} onClick={() => onSelectTask(t)} className="border-b border-slate-100 hover:bg-3bm-teal/5 cursor-pointer transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-3bm-teal">{t.name}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{t.subject}</td>
                <td className="px-4 py-3">
                  <div className="flex -space-x-1">
                    {assignees.length === 0 ? (
                      <span className="text-sm text-slate-400">-</span>
                    ) : assignees.map((email) => (
                      <div key={email}
                        className={`w-6 h-6 rounded-full ${getAvatarColor(email)} flex items-center justify-center text-white text-[10px] font-bold border-2 border-white`}
                        title={getDisplayName(email)}>
                        {getInitials(email)}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{t.project || "-"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${priorityColors[t.priority] ?? "bg-slate-100 text-slate-600"}`}>
                    {t.priority || "-"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${workflowColors[t.workflow_state] ?? "bg-slate-100 text-slate-600"}`}>
                    {t.workflow_state || "-"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusBadge[t.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {t.status}
                  </span>
                </td>
                <td className={`px-4 py-3 text-sm ${isOverdue(t.exp_end_date) ? "text-red-500 font-semibold" : "text-slate-500"}`}>
                  {t.exp_end_date || "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
