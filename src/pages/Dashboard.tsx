import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { fetchList, createDocument, updateDocument, deleteDocument, getErpNextLinkUrl } from "../lib/erpnext";
import { useEmployees, useProjects, useLeaves } from "../lib/DataContext";
import type { Page, ViewMode } from "../components/Sidebar";
import { getActiveInstance, getActiveInstanceId } from "../lib/instances";
import {
  Send, Search, FolderKanban, CheckSquare,
  ExternalLink, ChevronDown, Cake,
  Palmtree, User, ListTodo, Plus, Trash2, Save, X,
  GripVertical, Mail, Car,
} from "lucide-react";
import UrenBoekenWidget from "../components/UrenBoekenWidget";
import { DndContext, closestCenter } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

/* ─── Widget types & config ─── */

interface WidgetPlacement {
  id: string;
  col: number;
}

const ALL_WIDGETS: { id: string; label: string }[] = [
  { id: "time-booking", label: "Uren boeken" },
  { id: "km-booking", label: "Km boeken" },
  { id: "tasks", label: "Taken bureaubreed" },
  { id: "projects", label: "Projecten zoeken" },
  { id: "todos", label: "Mijn ToDo's" },
  { id: "email", label: "E-mail" },
];

const DEFAULT_LAYOUT: WidgetPlacement[] = [
  { id: "time-booking", col: 0 },
  { id: "km-booking", col: 0 },
  { id: "tasks", col: 0 },
  { id: "projects", col: 1 },
  { id: "todos", col: 1 },
  { id: "email", col: 1 },
];

function getLayoutKey(): string {
  return `pref_${getActiveInstanceId()}_dashboard_widgets`;
}

function loadLayout(): WidgetPlacement[] {
  try {
    const raw = localStorage.getItem(getLayoutKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* use default */ }
  return DEFAULT_LAYOUT;
}

function saveLayout(layout: WidgetPlacement[]) {
  localStorage.setItem(getLayoutKey(), JSON.stringify(layout));
}

/* ─── Email Widget ─── */

interface EmailMessage {
  uid: number;
  from: { name?: string; address?: string };
  subject: string;
  date: string;
  seen: boolean;
}

function EmailWidget() {
  const instanceId = getActiveInstanceId();
  const host = localStorage.getItem(`pref_${instanceId}_imap_host`) || "";
  const port = localStorage.getItem(`pref_${instanceId}_imap_port`) || "";
  const user = localStorage.getItem(`pref_${instanceId}_imap_user`) || "";
  const pass = localStorage.getItem(`pref_${instanceId}_imap_pass`) || "";

  const configured = !!(host && user && pass);

  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!configured) return;
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      host, port: port || "993", user, pass,
      secure: localStorage.getItem(`pref_${instanceId}_imap_secure`) ?? "true",
      folder: "INBOX",
      limit: "5",
    });

    fetch(`/api/mail/messages?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then((data) => setMessages(Array.isArray(data) ? data.slice(0, 5) : []))
      .catch((err) => setError(err instanceof Error ? err.message : "Fout bij ophalen e-mail"))
      .finally(() => setLoading(false));
  }, [configured, host, port, user, pass, instanceId]);

  function formatDate(dateStr: string): string {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  }

  if (!configured) {
    return (
      <div className="text-sm text-slate-400 text-center py-6">
        Stel e-mail in via Instellingen
      </div>
    );
  }

  if (loading) {
    return <p className="text-center text-slate-400 py-6">Laden...</p>;
  }

  if (error) {
    return <p className="text-center text-red-400 text-sm py-4">{error}</p>;
  }

  if (messages.length === 0) {
    return <p className="text-center text-slate-400 text-sm py-6">Geen berichten</p>;
  }

  return (
    <div className="space-y-1">
      {messages.map((msg) => (
        <div
          key={msg.uid}
          className={`px-3 py-2 rounded-lg hover:bg-slate-50 ${!msg.seen ? "bg-blue-50/40" : ""}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm truncate ${!msg.seen ? "font-semibold text-slate-800" : "text-slate-600"}`}>
              {msg.from?.name || msg.from?.address || "Onbekend"}
            </span>
            <span className="text-[10px] text-slate-400 flex-shrink-0">{formatDate(msg.date)}</span>
          </div>
          <p className={`text-sm truncate mt-0.5 ${!msg.seen ? "font-medium text-slate-700" : "text-slate-500"}`}>
            {msg.subject || "(geen onderwerp)"}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─── Sortable Widget Wrapper ─── */

function SortableWidget({
  id,
  onRemove,
  children,
}: {
  id: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group/widget">
      {/* Drag handle + close button overlay */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover/widget:opacity-100 transition-opacity">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-1 rounded bg-white/80 hover:bg-slate-100 text-slate-400 hover:text-slate-600 shadow-sm border border-slate-200"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded bg-white/80 hover:bg-red-50 text-slate-400 hover:text-red-500 cursor-pointer shadow-sm border border-slate-200"
          title="Widget verbergen"
        >
          <X size={12} />
        </button>
      </div>
      {children}
    </div>
  );
}

/* ─── Droppable Column ─── */

function WidgetColumn({
  items,
  onNavigate,
  onRemove,
}: {
  items: WidgetPlacement[];
  onNavigate: (page: Page) => void;
  onRemove: (id: string) => void;
}) {
  const ids = items.map((w) => w.id);

  function renderWidget(widgetId: string) {
    let content: React.ReactNode;

    switch (widgetId) {
      case "time-booking":
        content = <QuickTimeBookingInner />;
        break;
      case "km-booking":
        content = <QuickKmBooking />;
        break;
      case "tasks":
        content = <TaskListInner onNavigate={onNavigate} />;
        break;
      case "projects":
        content = <ProjectSearchInner onNavigate={onNavigate} />;
        break;
      case "todos":
        content = <MyTodoListInner />;
        break;
      case "email":
        content = (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Mail size={18} className="text-3bm-teal" />
              <h3 className="font-semibold text-slate-800">E-mail</h3>
            </div>
            <EmailWidget />
          </div>
        );
        break;
      default:
        return null;
    }

    return (
      <SortableWidget key={widgetId} id={widgetId} onRemove={() => onRemove(widgetId)}>
        {content}
      </SortableWidget>
    );
  }

  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div className="space-y-6">
        {items.map((w) => renderWidget(w.id))}
      </div>
    </SortableContext>
  );
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

  const [layout, setLayout] = useState<WidgetPlacement[]>(loadLayout);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const leftWidgets = layout.filter((w) => w.col === 0);
  const rightWidgets = layout.filter((w) => w.col === 1);
  const hiddenWidgets = ALL_WIDGETS.filter((w) => !layout.find((l) => l.id === w.id));

  function handleRemove(id: string) {
    const next = layout.filter((w) => w.id !== id);
    setLayout(next);
    saveLayout(next);
  }

  function handleAdd(id: string) {
    const next = [...layout, { id, col: 1 }];
    setLayout(next);
    saveLayout(next);
    setAddOpen(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeIdx = layout.findIndex((w) => w.id === activeId);
    const overIdx = layout.findIndex((w) => w.id === overId);

    if (activeIdx === -1 || overIdx === -1) return;

    // Move the active widget to the same column as the over widget
    const targetCol = layout[overIdx].col;

    // Get all widgets in the target column (including the moved one placed at target col)
    const newLayout = [...layout];
    newLayout[activeIdx] = { ...newLayout[activeIdx], col: targetCol };

    // Now reorder within the full layout: extract column items, reorder, put back
    const colItems = newLayout
      .map((w, i) => ({ ...w, _origIdx: i }))
      .filter((w) => w.col === targetCol);

    const colActiveIdx = colItems.findIndex((w) => w.id === activeId);
    const colOverIdx = colItems.findIndex((w) => w.id === overId);

    if (colActiveIdx !== -1 && colOverIdx !== -1) {
      const reordered = arrayMove(colItems, colActiveIdx, colOverIdx);
      // Rebuild layout: non-target-col items stay, target-col items get reordered
      const otherItems = newLayout.filter((w) => w.col !== targetCol);
      const finalLayout = [
        ...otherItems,
        ...reordered.map((w) => ({ id: w.id, col: w.col })),
      ];
      // Preserve original ordering: left col first, then right col
      const sorted = [
        ...finalLayout.filter((w) => w.col === 0),
        ...finalLayout.filter((w) => w.col === 1),
      ];
      setLayout(sorted);
      saveLayout(sorted);
    } else {
      setLayout(newLayout);
      saveLayout(newLayout);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-slate-800">{getActiveInstance().name} Dashboard</h2>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Left column */}
          <WidgetColumn items={leftWidgets} onNavigate={onNavigate} onRemove={handleRemove} />

          {/* Right column */}
          <WidgetColumn items={rightWidgets} onNavigate={onNavigate} onRemove={handleRemove} />
        </div>
      </DndContext>

      {/* Add widget button */}
      {hiddenWidgets.length > 0 && (
        <div ref={addRef} className="relative inline-block">
          <button
            onClick={() => setAddOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 bg-white border border-dashed border-slate-300 rounded-lg hover:border-3bm-teal hover:text-3bm-teal cursor-pointer"
          >
            <Plus size={16} />
            Widget toevoegen
          </button>
          {addOpen && (
            <div className="absolute bottom-full left-0 mb-2 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[200px]">
              {hiddenWidgets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleAdd(w.id)}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Inner widget wrappers (no outer card, used inside SortableWidget) ─── */

function QuickTimeBookingInner() {
  return <UrenBoekenWidget showWeekTable={false} />;
}

function ProjectSearchInner({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return <ProjectSearch onNavigate={onNavigate} />;
}

function MyTodoListInner() {
  return <MyTodoList />;
}

function TaskListInner({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return <TaskList onNavigate={onNavigate} />;
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
          <UrenBoekenWidget showWeekTable={false} />
          <QuickKmBooking />

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
              href={`${getErpNextLinkUrl()}/task/${t.name}`}
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

/* ─── Quick Km Booking ─── */

function QuickKmBooking() {
  const allEmployees = useEmployees();
  const [employee, setEmployee] = useState(() => {
    const instanceId = getActiveInstance().id;
    return localStorage.getItem(`pref_${instanceId}_employee`) || localStorage.getItem("erpnext_default_employee") || "";
  });
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [km, setKm] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const [recentRequests, setRecentRequests] = useState<{ name: string; travel_from: string; travel_to: string; total_distance: number; travel_date: string; description?: string }[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const activeEmployees = useMemo(
    () => allEmployees.filter((e) => e.status === "Active"),
    [allEmployees]
  );

  // Load recent travel requests
  useEffect(() => {
    if (!employee) { setRecentRequests([]); return; }
    setLoadingRecent(true);
    fetchList<{ name: string; travel_from: string; travel_to: string; total_distance: number; travel_date: string; description: string }>(
      "Travel Request",
      {
        fields: ["name", "travel_from", "travel_to", "total_distance", "travel_date", "description"],
        filters: [["employee", "=", employee]],
        limit_page_length: 3,
        order_by: "creation desc",
      }
    )
      .then(setRecentRequests)
      .catch(() => setRecentRequests([]))
      .finally(() => setLoadingRecent(false));
  }, [employee, success]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employee || !km || !departure || !destination) return;
    setSubmitting(true);
    setFormError("");
    setSuccess("");
    try {
      const company = localStorage.getItem("erpnext_default_company") || undefined;
      const doc = await createDocument<{ name: string }>("Travel Request", {
        employee,
        company,
        travel_type: "Routes",
        travel_date: date,
        travel_from: departure,
        travel_to: destination,
        total_distance: parseFloat(km),
        description: description || undefined,
      });
      setSuccess(`Km geboekt: ${doc.name}`);
      setDeparture("");
      setDestination("");
      setKm("");
      setDescription("");
      setTimeout(() => setSuccess(""), 5000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Onbekende fout");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Car size={18} className="text-3bm-teal" />
        <h3 className="font-semibold text-slate-800">Km boeken</h3>
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
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Datum *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Van *</label>
            <input type="text" value={departure} onChange={(e) => setDeparture(e.target.value)} required
              placeholder="Vertrekpunt"
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Naar *</label>
            <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} required
              placeholder="Bestemming"
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Km *</label>
            <input type="number" step="0.1" min="0" value={km} onChange={(e) => setKm(e.target.value)} required
              placeholder="Afstand"
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Omschrijving (optioneel)"
              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal" />
          </div>
          <button type="submit" disabled={submitting || !employee || !km || !departure || !destination}
            className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 text-sm font-medium cursor-pointer">
            <Send size={14} />
            {submitting ? "..." : "Boeken"}
          </button>
        </div>
      </form>

      {/* Recent travel requests */}
      {employee && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-2">Laatste 3 ritten</p>
          {loadingRecent ? (
            <p className="text-xs text-slate-400">Laden...</p>
          ) : recentRequests.length === 0 ? (
            <p className="text-xs text-slate-400">Geen eerdere ritten</p>
          ) : (
            <div className="space-y-2">
              {recentRequests.map((req) => (
                <div key={req.name} className="bg-slate-50 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-slate-400 shrink-0">
                        {req.travel_date ? new Date(req.travel_date + "T00:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : ""}
                      </span>
                      <span className="text-xs text-slate-700 truncate">
                        {req.travel_from || "?"} &rarr; {req.travel_to || "?"}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-slate-700 shrink-0 ml-2">
                      {(req.total_distance || 0).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} km
                    </span>
                  </div>
                  {req.description && (
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{req.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
              href={`${getErpNextLinkUrl()}/project/${p.name}`}
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
                      Ref: {todo.reference_type} → <a href={`${getErpNextLinkUrl()}/${todo.reference_type.toLowerCase().replace(/ /g, "-")}/${todo.reference_name}`}
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
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col" style={{ maxHeight: "350px" }}>
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
              href={`${getErpNextLinkUrl()}/task/${t.name}`}
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
