import { useEffect, useState, useMemo } from "react";
import { fetchList, callMethod, getAuthHeaders, getErpNextAppUrl } from "../lib/erpnext";
import { useEmployees } from "../lib/DataContext";
import {
  ListTodo, RefreshCw, Plus, CheckCircle2, Circle, AlertCircle,
  ExternalLink, ChevronDown, X, User,
} from "lucide-react";

interface ToDo {
  name: string;
  description: string;
  status: string;
  priority: string;
  date: string;
  reference_type: string;
  reference_name: string;
  allocated_to: string;
}

const priorityColors: Record<string, string> = {
  High: "text-red-600 bg-red-50",
  Medium: "text-orange-600 bg-orange-50",
  Low: "text-slate-600 bg-slate-50",
};

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

export default function Todo() {
  const allEmployees = useEmployees();
  const [todos, setTodos] = useState<ToDo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"Open" | "Closed" | "">("Open");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("Medium");
  const [newDate, setNewDate] = useState("");
  const [newAllocatedTo, setNewAllocatedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeEmployees = useMemo(
    () => allEmployees.filter((e) => e.status === "Active").sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
    [allEmployees]
  );

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [];
      if (filter) filters.push(["status", "=", filter]);

      const list = await fetchList<ToDo>("ToDo", {
        fields: [
          "name", "description", "status", "priority", "date",
          "reference_type", "reference_name", "allocated_to",
        ],
        filters,
        limit_page_length: 200,
        order_by: "modified desc",
      });
      setTodos(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [filter]);

  async function toggleStatus(todo: ToDo) {
    const newStatus = todo.status === "Open" ? "Closed" : "Open";
    try {
      const baseUrl = localStorage.getItem("erpnext_url") || "";
      await fetch(`${baseUrl}/api/resource/ToDo/${todo.name}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      setTodos((prev) =>
        prev.map((t) => (t.name === todo.name ? { ...t, status: newStatus } : t))
      );
    } catch {
      await loadData();
    }
  }

  async function createTodo() {
    if (!newDesc.trim()) return;
    setSubmitting(true);
    try {
      const baseUrl = localStorage.getItem("erpnext_url") || "";
      await fetch(`${baseUrl}/api/resource/ToDo`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          description: newDesc,
          priority: newPriority,
          status: "Open",
          date: newDate || undefined,
          allocated_to: newAllocatedTo || undefined,
        }),
      });
      setNewDesc("");
      setNewPriority("Medium");
      setNewDate("");
      setNewAllocatedTo("");
      setShowForm(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout bij aanmaken");
    } finally {
      setSubmitting(false);
    }
  }

  const filteredTodos = useMemo(
    () => filterEmployee ? todos.filter((t) => t.allocated_to === filterEmployee) : todos,
    [todos, filterEmployee]
  );

  const openCount = filteredTodos.filter((t) => t.status === "Open").length;
  const closedCount = filteredTodos.filter((t) => t.status === "Closed").length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-3bm-teal/10 rounded-lg">
            <ListTodo className="text-3bm-teal" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Todo</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Plus size={16} /> Nieuw
          </button>
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

      {/* KPI + Filter */}
      <div className="mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <Circle className="text-orange-500" size={20} />
          <div>
            <p className="text-sm text-slate-500">Open</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : openCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <CheckCircle2 className="text-green-500" size={20} />
          <div>
            <p className="text-sm text-slate-500">Afgerond</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : closedCount}</p>
          </div>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "Open" | "Closed" | "")}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          <option value="">Alle</option>
          <option value="Open">Open</option>
          <option value="Closed">Afgerond</option>
        </select>
        <select
          value={filterEmployee}
          onChange={(e) => setFilterEmployee(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          <option value="">Alle medewerkers</option>
          {activeEmployees.map((e) => (
            <option key={e.name} value={e.user_id || e.company_email || e.employee_name}>
              {e.employee_name}
            </option>
          ))}
        </select>
      </div>

      {/* New Todo Form */}
      {showForm && (
        <div className="mb-4 bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Nieuwe todo</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3">
            <textarea
              placeholder="Omschrijving..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal resize-none"
              rows={3}
            />
            <div className="flex items-center gap-3">
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
              >
                <option value="High">Hoog</option>
                <option value="Medium">Medium</option>
                <option value="Low">Laag</option>
              </select>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
              />
              <select
                value={newAllocatedTo}
                onChange={(e) => setNewAllocatedTo(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
              >
                <option value="">Geen medewerker</option>
                {activeEmployees.map((e) => (
                  <option key={e.name} value={e.user_id || e.company_email || e.employee_name}>
                    {e.employee_name}
                  </option>
                ))}
              </select>
              <button
                onClick={createTodo}
                disabled={submitting || !newDesc.trim()}
                className="px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 text-sm cursor-pointer"
              >
                {submitting ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Todo List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Laden...</div>
      ) : filteredTodos.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Geen todos gevonden</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-100">
          {filteredTodos.map((todo) => (
            <div
              key={todo.name}
              className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50"
            >
              <button
                onClick={() => toggleStatus(todo)}
                className="mt-0.5 flex-shrink-0 cursor-pointer"
                title={todo.status === "Open" ? "Markeer als afgerond" : "Markeer als open"}
              >
                {todo.status === "Open" ? (
                  <Circle size={20} className="text-slate-300 hover:text-3bm-teal" />
                ) : (
                  <CheckCircle2 size={20} className="text-green-500" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${todo.status === "Closed" ? "line-through text-slate-400" : "text-slate-700"}`}>
                  {stripHtml(todo.description)}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${priorityColors[todo.priority] || "text-slate-600 bg-slate-50"}`}>
                    {todo.priority}
                  </span>
                  {todo.date && (
                    <span className="text-xs text-slate-400">{todo.date}</span>
                  )}
                  {todo.allocated_to && (
                    <span className="text-xs text-slate-500 flex items-center gap-0.5">
                      <User size={10} />
                      {todo.allocated_to}
                    </span>
                  )}
                  {todo.reference_type && todo.reference_name && (
                    <a
                      href={`${getErpNextAppUrl()}/app/${todo.reference_type.toLowerCase().replace(/ /g, "-")}/${todo.reference_name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-3bm-teal hover:text-3bm-teal-dark flex items-center gap-0.5"
                    >
                      {todo.reference_type}: {todo.reference_name}
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
