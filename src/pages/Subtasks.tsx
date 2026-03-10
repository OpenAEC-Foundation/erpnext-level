import { useEffect, useState, useMemo } from "react";
import { fetchList, createDocument, updateDocument, callMethod, getErpNextLinkUrl } from "../lib/erpnext";
import { useProjects } from "../lib/DataContext";
import {
  ListTree, Search, Plus, Check, ChevronRight,
  ExternalLink, RefreshCw, Trash2,
} from "lucide-react";
import CompanySelect from "../components/CompanySelect";

interface Task {
  name: string;
  subject: string;
  status: string;
  priority: string;
  project: string;
  parent_task: string;
  _assign: string;
  exp_end_date: string;
  company: string;
}

const statusColors: Record<string, string> = {
  Open: "bg-3bm-teal/10 text-3bm-teal-dark",
  Working: "bg-yellow-100 text-yellow-700",
  "Pending Review": "bg-purple-100 text-purple-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-slate-100 text-slate-500",
  Overdue: "bg-red-100 text-red-700",
};

const priorityDot: Record<string, string> = {
  Urgent: "bg-red-500",
  High: "bg-orange-500",
  Medium: "bg-yellow-500",
  Low: "bg-slate-400",
};

export default function Subtasks() {
  const projects = useProjects();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [search, setSearch] = useState("");
  const [selectedParent, setSelectedParent] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);

  // New subtask form
  const [showAdd, setShowAdd] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newPriority, setNewPriority] = useState("Medium");
  const [newStatus] = useState("Open");
  const [submitting, setSubmitting] = useState(false);

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.name, p.project_name);
    return map;
  }, [projects]);

  // Load all tasks that could be parent tasks (no parent_task themselves, or explicitly all)
  async function loadTasks() {
    setLoading(true);
    try {
      const filters: unknown[][] = [];
      if (company) filters.push(["company", "=", company]);
      // Exclude cancelled tasks and templates
      filters.push(["status", "not in", ["Cancelled", "Template"]]);

      const list = await fetchList<Task>("Task", {
        fields: ["name", "subject", "status", "priority", "project", "parent_task", "_assign", "exp_end_date", "company"],
        filters,
        limit_page_length: 500,
        order_by: "modified desc",
      });
      setTasks(list);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadTasks(); }, [company]);

  // Parent tasks = tasks without a parent_task
  const parentTasks = useMemo(() => {
    const s = search.toLowerCase();
    return tasks
      .filter((t) => !t.parent_task)
      .filter((t) =>
        !s || t.subject.toLowerCase().includes(s) ||
        t.name.toLowerCase().includes(s) ||
        (projectNameMap.get(t.project) || t.project || "").toLowerCase().includes(s)
      );
  }, [tasks, search, projectNameMap]);

  // Count subtasks per parent
  const subtaskCounts = useMemo(() => {
    const counts = new Map<string, { total: number; done: number }>();
    for (const t of tasks) {
      if (t.parent_task) {
        const prev = counts.get(t.parent_task) || { total: 0, done: 0 };
        prev.total++;
        if (t.status === "Completed") prev.done++;
        counts.set(t.parent_task, prev);
      }
    }
    return counts;
  }, [tasks]);

  // Load subtasks for selected parent
  async function loadSubtasks(parentName: string) {
    setLoadingSubs(true);
    try {
      const list = await fetchList<Task>("Task", {
        fields: ["name", "subject", "status", "priority", "project", "parent_task", "_assign", "exp_end_date", "company"],
        filters: [["parent_task", "=", parentName]],
        limit_page_length: 200,
        order_by: "creation asc",
      });
      setSubtasks(list);
    } catch { /* ignore */ }
    finally { setLoadingSubs(false); }
  }

  function selectParent(task: Task) {
    setSelectedParent(task);
    setShowAdd(false);
    loadSubtasks(task.name);
  }

  async function addSubtask() {
    if (!newSubject.trim() || !selectedParent) return;
    setSubmitting(true);
    try {
      await createDocument("Task", {
        subject: newSubject.trim(),
        parent_task: selectedParent.name,
        project: selectedParent.project || undefined,
        company: selectedParent.company || undefined,
        priority: newPriority,
        status: newStatus,
      });
      setNewSubject("");
      setNewPriority("Medium");
      setShowAdd(false);
      // Reload subtasks and main list
      await loadSubtasks(selectedParent.name);
      await loadTasks();
    } catch { /* ignore */ }
    finally { setSubmitting(false); }
  }

  async function toggleSubtaskComplete(sub: Task) {
    const newStatus = sub.status === "Completed" ? "Open" : "Completed";
    try {
      // Use workflow action if available, otherwise direct update
      try {
        await callMethod("frappe.client.set_value", {
          doctype: "Task",
          name: sub.name,
          fieldname: "status",
          value: newStatus,
        });
      } catch {
        await updateDocument("Task", sub.name, { status: newStatus });
      }
      setSubtasks((prev) =>
        prev.map((s) => s.name === sub.name ? { ...s, status: newStatus } : s)
      );
      // Update counts
      await loadTasks();
    } catch { /* ignore */ }
  }

  async function deleteSubtask(sub: Task) {
    try {
      await callMethod("frappe.client.set_value", {
        doctype: "Task",
        name: sub.name,
        fieldname: "status",
        value: "Cancelled",
      });
      setSubtasks((prev) => prev.filter((s) => s.name !== sub.name));
      await loadTasks();
    } catch { /* ignore */ }
  }

  return (
    <div className="flex h-full">
      {/* Left: Parent task list */}
      <div className="w-96 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListTree size={18} className="text-3bm-teal" />
              <h2 className="text-lg font-bold text-slate-800">Subtaken</h2>
            </div>
            <button onClick={loadTasks} disabled={loading}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded cursor-pointer">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          <CompanySelect value={company} onChange={setCompany} />

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek hoofdtaak..."
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
            />
          </div>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-4 text-sm text-slate-400">Laden...</p>}
          {!loading && parentTasks.length === 0 && (
            <p className="p-4 text-sm text-slate-400">Geen taken gevonden</p>
          )}
          {parentTasks.map((task) => {
            const counts = subtaskCounts.get(task.name);
            const isSelected = selectedParent?.name === task.name;
            const pDot = priorityDot[task.priority] || "bg-slate-300";
            return (
              <button
                key={task.name}
                onClick={() => selectParent(task)}
                className={`w-full px-4 py-3 border-b border-slate-100 text-left transition-colors cursor-pointer ${
                  isSelected ? "bg-3bm-teal/5 border-l-2 border-l-3bm-teal" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${pDot}`} />
                  <span className="text-sm font-medium text-slate-800 truncate flex-1">{task.subject}</span>
                  {isSelected ? <ChevronRight size={14} className="text-3bm-teal shrink-0" />
                    : counts && <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0">
                      {counts.done}/{counts.total}
                    </span>
                  }
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {task.project && (
                    <span className="text-[11px] text-slate-400 truncate">
                      {projectNameMap.get(task.project) || task.project}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[task.status] || "bg-slate-100 text-slate-500"}`}>
                    {task.status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Subtask detail */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
        {!selectedParent ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <ListTree size={48} className="text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Selecteer een hoofdtaak om subtaken te beheren</p>
            </div>
          </div>
        ) : (
          <>
            {/* Parent task header */}
            <div className="px-6 py-4 bg-white border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${priorityDot[selectedParent.priority] || "bg-slate-300"}`} />
                    <h3 className="text-lg font-bold text-slate-800 truncate">{selectedParent.subject}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColors[selectedParent.status] || "bg-slate-100 text-slate-500"}`}>
                      {selectedParent.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-slate-400 font-mono">{selectedParent.name}</span>
                    {selectedParent.project && (
                      <span className="text-xs text-slate-500">
                        {projectNameMap.get(selectedParent.project) || selectedParent.project}
                      </span>
                    )}
                    <a href={`${getErpNextLinkUrl()}/task/${selectedParent.name}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-3bm-teal hover:text-3bm-teal-dark flex items-center gap-1">
                      <ExternalLink size={10} /> ERPNext
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {subtaskCounts.get(selectedParent.name) && (
                    <div className="text-right">
                      <p className="text-2xl font-bold text-slate-800">
                        {subtaskCounts.get(selectedParent.name)!.done}/{subtaskCounts.get(selectedParent.name)!.total}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase">Afgerond</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {subtaskCounts.get(selectedParent.name) && (
                <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-3bm-teal rounded-full transition-all"
                    style={{
                      width: `${Math.round((subtaskCounts.get(selectedParent.name)!.done / Math.max(1, subtaskCounts.get(selectedParent.name)!.total)) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Subtask list */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loadingSubs && <p className="text-sm text-slate-400">Subtaken laden...</p>}

              <div className="space-y-1.5">
                {subtasks.map((sub) => {
                  const isDone = sub.status === "Completed";
                  return (
                    <div key={sub.name}
                      className={`flex items-center gap-3 px-4 py-2.5 bg-white rounded-lg border border-slate-200 group transition-colors ${isDone ? "opacity-60" : ""}`}>
                      <button onClick={() => toggleSubtaskComplete(sub)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                          isDone ? "bg-green-500 border-green-500 text-white" : "border-slate-300 hover:border-3bm-teal"
                        }`}>
                        {isDone && <Check size={12} />}
                      </button>

                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot[sub.priority] || "bg-slate-300"}`} />

                      <span className={`text-sm flex-1 min-w-0 truncate ${isDone ? "line-through text-slate-400" : "text-slate-700"}`}>
                        {sub.subject}
                      </span>

                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${statusColors[sub.status] || "bg-slate-100 text-slate-500"}`}>
                        {sub.status}
                      </span>

                      {sub.exp_end_date && (
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {new Date(sub.exp_end_date + "T00:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                        </span>
                      )}

                      <button onClick={() => deleteSubtask(sub)}
                        className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add subtask */}
              {showAdd ? (
                <div className="mt-3 bg-white rounded-lg border border-3bm-teal/30 p-3 space-y-3">
                  <input
                    type="text" value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    placeholder="Subtaak beschrijving..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter" && newSubject.trim()) addSubtask(); }}
                  />
                  <div className="flex items-center gap-2">
                    <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)}
                      className="px-2 py-1.5 border border-slate-200 rounded text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-3bm-teal">
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                      <option value="Urgent">Urgent</option>
                    </select>
                    <div className="flex-1" />
                    <button onClick={() => { setShowAdd(false); setNewSubject(""); }}
                      className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 cursor-pointer">
                      Annuleren
                    </button>
                    <button onClick={addSubtask} disabled={!newSubject.trim() || submitting}
                      className="px-3 py-1.5 text-xs bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer font-medium">
                      {submitting ? "Opslaan..." : "Toevoegen"}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAdd(true)}
                  className="mt-3 w-full flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-200 rounded-lg text-sm text-slate-400 hover:border-3bm-teal hover:text-3bm-teal transition-colors cursor-pointer">
                  <Plus size={16} /> Subtaak toevoegen
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
