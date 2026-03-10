import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { fetchList, fetchDocument, fetchAll, getErpNextLinkUrl } from "../lib/erpnext";
import { useProjects, useCompanies } from "../lib/DataContext";
import type { ProjectRecord } from "../lib/DataContext";
import { geocodeAddress } from "../lib/geocode";
import {
  FolderKanban, RefreshCw, Search, Plus, FolderOpen, MapPin, Map as MapIcon,
  X, ExternalLink, Clock, CheckCircle2, ListTodo, CalendarDays,
  ChevronRight, AlertCircle, List,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

// Fix default marker icons (Leaflet + bundler issue)
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/* ─── Interfaces ─── */

interface TimesheetDetail {
  project: string;
  hours: number;
  parent: string;
}

interface TimesheetParent {
  name: string;
  employee_name: string;
}

interface AddressDoc {
  address_line1?: string;
  city?: string;
  pincode?: string;
  country?: string;
}

interface MarkerData {
  projectName: string;
  projectTitle: string;
  address: string;
  lat: number;
  lng: number;
}

interface TaskRecord {
  name: string;
  subject: string;
  status: string;
  priority: string;
  exp_start_date: string;
  exp_end_date: string;
  _assign: string;
  completed_on: string;
}

/* ─── Constants ─── */

// getErpNextLinkUrl() is imported from erpnext.ts and reads the current instance URL
/** NAS folder path per company */
const COMPANY_FOLDER_MAP: Record<string, string> = {
  "3BM": "C:/3BM/50_projecten/3_3BM_bouwtechniek",
  "Symitech": "C:/Symitech/projecten",
};
const DEFAULT_PROJECT_BASE = "C:/3BM/50_projecten/3_3BM_bouwtechniek";

function getProjectFolderPath(projectName: string, company?: string): string {
  const base = (company && COMPANY_FOLDER_MAP[company]) || DEFAULT_PROJECT_BASE;
  return `${base}/${projectName}`;
}

async function openFolder(folderPath: string) {
  try {
    await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath }),
    });
  } catch (e) {
    console.warn("Kon map niet openen:", e);
    // Fallback: try file:/// link
    window.open(`file:///${folderPath}`, "_blank");
  }
}

const NL_CENTER: [number, number] = [52.1, 5.3];

const PROJECT_STATUSES = ["Open", "Completed", "Cancelled", "Overdue"];

const statusColors: Record<string, string> = {
  Open: "bg-3bm-teal/10 text-3bm-teal-dark",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
  Overdue: "bg-orange-100 text-orange-700",
};

const taskStatusColors: Record<string, string> = {
  Open: "bg-blue-100 text-blue-700",
  Working: "bg-yellow-100 text-yellow-700",
  "Pending Review": "bg-purple-100 text-purple-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
  Overdue: "bg-orange-100 text-orange-700",
};

const priorityColors: Record<string, string> = {
  Urgent: "text-red-600",
  High: "text-orange-500",
  Medium: "text-yellow-500",
  Low: "text-slate-400",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-3bm-teal", "bg-green-500", "bg-purple-500", "bg-pink-500",
    "bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-cyan-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function parseAssign(raw: string): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/* ─── ProjectDetail Panel ─── */

const TOC_ITEMS = [
  { id: "overzicht", label: "Overzicht", icon: FolderKanban },
  { id: "taken", label: "Taken", icon: ListTodo },
  { id: "uren", label: "Uren", icon: Clock },
  { id: "planning", label: "Planning", icon: CalendarDays },
];

function ProjectDetail({
  project,
  projectHours,
  onClose,
}: {
  project: ProjectRecord;
  projectHours: Map<string, number>;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("overzicht");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTasksLoading(true);
    fetchAll<TaskRecord>(
      "Task",
      ["name", "subject", "status", "priority", "exp_start_date", "exp_end_date", "_assign", "completed_on"],
      [["project", "=", project.name]],
      "exp_start_date asc"
    )
      .then(setTasks)
      .catch(() => setTasks([]))
      .finally(() => setTasksLoading(false));
  }, [project.name]);

  // Sort hours descending
  const sortedHours = useMemo(() => {
    return Array.from(projectHours.entries())
      .sort((a, b) => b[1] - a[1]);
  }, [projectHours]);

  const totalHours = useMemo(() => sortedHours.reduce((s, [, h]) => s + h, 0), [sortedHours]);

  // Scroll to section
  function scrollTo(id: string) {
    setActiveSection(id);
    const el = document.getElementById(`pd-${id}`);
    if (el && contentRef.current) {
      contentRef.current.scrollTo({ top: el.offsetTop - contentRef.current.offsetTop - 16, behavior: "smooth" });
    }
  }

  // Observe which section is in view
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const sections = TOC_ITEMS.map((t) => document.getElementById(`pd-${t.id}`)).filter(Boolean) as HTMLElement[];

    function onScroll() {
      const scrollTop = container!.scrollTop + 80;
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].offsetTop - container!.offsetTop <= scrollTop) {
          setActiveSection(TOC_ITEMS[i].id);
          return;
        }
      }
    }

    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Planning: compute timeline bounds
  const planningData = useMemo(() => {
    const tasksWithDates = tasks.filter((t) => t.exp_start_date || t.exp_end_date);
    if (tasksWithDates.length === 0) return null;

    const allDates: number[] = [];
    for (const t of tasksWithDates) {
      if (t.exp_start_date) allDates.push(new Date(t.exp_start_date).getTime());
      if (t.exp_end_date) allDates.push(new Date(t.exp_end_date).getTime());
    }
    // Also include project dates
    if (project.expected_start_date) allDates.push(new Date(project.expected_start_date).getTime());
    if (project.expected_end_date) allDates.push(new Date(project.expected_end_date).getTime());

    const minTime = Math.min(...allDates);
    const maxTime = Math.max(...allDates);
    const range = maxTime - minTime || 1;

    // Generate month labels
    const months: { label: string; left: number }[] = [];
    const start = new Date(minTime);
    start.setDate(1);
    const end = new Date(maxTime);
    const cursor = new Date(start);
    while (cursor <= end) {
      const t = cursor.getTime();
      const left = ((t - minTime) / range) * 100;
      months.push({
        label: cursor.toLocaleDateString("nl-NL", { month: "short", year: "2-digit" }),
        left: Math.max(0, Math.min(left, 100)),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return { minTime, range, months, tasksWithDates };
  }, [tasks, project]);

  const tasksDone = tasks.filter((t) => t.status === "Completed").length;
  const tasksOpen = tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-shrink-0 w-[15vw] bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="flex-1 bg-white shadow-2xl flex overflow-hidden">
        {/* TOC Sidebar */}
        <nav className="w-48 flex-shrink-0 border-r border-slate-200 bg-slate-50 p-4 flex flex-col">
          <div className="mb-6">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Project</p>
            <p className="text-sm font-bold text-slate-800 truncate">{project.name}</p>
          </div>
          <div className="space-y-1 flex-1">
            {TOC_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                    activeSection === item.id
                      ? "bg-3bm-teal/10 text-3bm-teal-dark font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>
          <a
            href={`${getErpNextLinkUrl()}/project/${project.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-3bm-teal mt-4"
          >
            <ExternalLink size={14} /> Openen in ERPNext
          </a>
        </nav>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-slate-800">{project.project_name}</h3>
              <p className="text-sm text-slate-500">{project.name}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg cursor-pointer">
              <X size={20} className="text-slate-400" />
            </button>
          </div>

          <div className="p-6 space-y-10">
            {/* ═══ OVERZICHT ═══ */}
            <section id="pd-overzicht">
              <h4 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <FolderKanban size={20} className="text-3bm-teal" /> Overzicht
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Status</p>
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusColors[project.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {project.status}
                  </span>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Voortgang</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-3bm-teal rounded-full" style={{ width: `${project.percent_complete}%` }} />
                    </div>
                    <span className="text-sm font-bold text-slate-700">{project.percent_complete}%</span>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Startdatum</p>
                  <p className="text-sm font-semibold text-slate-700">{project.expected_start_date || "-"}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Einddatum</p>
                  <p className="text-sm font-semibold text-slate-700">{project.expected_end_date || "-"}</p>
                </div>
              </div>
              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg"><ListTodo className="text-blue-600" size={18} /></div>
                  <div>
                    <p className="text-xs text-slate-500">Taken open</p>
                    <p className="text-lg font-bold text-slate-800">{tasksLoading ? "..." : tasksOpen}</p>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg"><CheckCircle2 className="text-green-600" size={18} /></div>
                  <div>
                    <p className="text-xs text-slate-500">Taken afgerond</p>
                    <p className="text-lg font-bold text-slate-800">{tasksLoading ? "..." : tasksDone}</p>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 rounded-lg"><Clock className="text-indigo-600" size={18} /></div>
                  <div>
                    <p className="text-xs text-slate-500">Totaal uren</p>
                    <p className="text-lg font-bold text-slate-800">{totalHours.toFixed(1)}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* ═══ TAKEN ═══ */}
            <section id="pd-taken">
              <h4 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <ListTodo size={20} className="text-3bm-teal" /> Taken
                <span className="text-sm font-normal text-slate-400 ml-1">({tasks.length})</span>
              </h4>
              {tasksLoading ? (
                <div className="text-center text-slate-400 py-8">Laden...</div>
              ) : tasks.length === 0 ? (
                <div className="text-center text-slate-400 py-8 bg-slate-50 rounded-xl">Geen taken</div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Taak</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Toegewezen</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Status</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Prio</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600">Deadline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => {
                        const assignees = parseAssign(t._assign);
                        return (
                          <tr key={t.name} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-2.5">
                              <a
                                href={`${getErpNextLinkUrl()}/task/${t.name}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-3bm-teal hover:text-3bm-teal-dark hover:underline font-medium flex items-center gap-1"
                              >
                                {t.subject || t.name}
                                <ExternalLink size={12} className="flex-shrink-0 opacity-50" />
                              </a>
                            </td>
                            <td className="px-4 py-2.5">
                              {assignees.length > 0 ? (
                                <div className="flex -space-x-1">
                                  {assignees.slice(0, 3).map((a) => (
                                    <div
                                      key={a}
                                      className={`w-6 h-6 rounded-full ${getAvatarColor(a)} flex items-center justify-center text-white text-[8px] font-bold border-2 border-white`}
                                      title={a}
                                    >
                                      {getInitials(a)}
                                    </div>
                                  ))}
                                  {assignees.length > 3 && (
                                    <div className="w-6 h-6 rounded-full bg-slate-300 flex items-center justify-center text-white text-[8px] font-bold border-2 border-white">
                                      +{assignees.length - 3}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-300">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${taskStatusColors[t.status] ?? "bg-slate-100 text-slate-600"}`}>
                                {t.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-sm font-medium ${priorityColors[t.priority] ?? "text-slate-400"}`}>
                                {t.priority || "-"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">
                              {t.exp_end_date || "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ═══ UREN ═══ */}
            <section id="pd-uren">
              <h4 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Clock size={20} className="text-3bm-teal" /> Uren per medewerker
              </h4>
              {sortedHours.length === 0 ? (
                <div className="text-center text-slate-400 py-8 bg-slate-50 rounded-xl">Geen uren geregistreerd</div>
              ) : (
                <div className="space-y-2">
                  {sortedHours.map(([empName, hours], idx) => {
                    const pct = totalHours > 0 ? (hours / totalHours) * 100 : 0;
                    return (
                      <div key={empName} className="flex items-center gap-3">
                        <div className="flex items-center gap-2 w-48 flex-shrink-0">
                          {idx === 0 && <span className="text-yellow-500 text-xs" title="Meeste uren">&#9733;</span>}
                          <div
                            className={`w-7 h-7 rounded-full ${getAvatarColor(empName)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}
                          >
                            {getInitials(empName)}
                          </div>
                          <span className="text-sm text-slate-700 font-medium truncate">{empName}</span>
                        </div>
                        <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden relative">
                          <div
                            className={`h-full rounded-full ${idx === 0 ? "bg-3bm-teal" : "bg-3bm-teal/60"}`}
                            style={{ width: `${pct}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-semibold text-slate-600">
                            {hours.toFixed(1)} uur
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 mt-2">
                    <span className="text-sm font-semibold text-slate-600">Totaal</span>
                    <span className="text-sm font-bold text-slate-800">{totalHours.toFixed(1)} uur</span>
                  </div>
                </div>
              )}
            </section>

            {/* ═══ PLANNING ═══ */}
            <section id="pd-planning">
              <h4 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <CalendarDays size={20} className="text-3bm-teal" /> Planning
              </h4>
              {tasksLoading ? (
                <div className="text-center text-slate-400 py-8">Laden...</div>
              ) : !planningData || planningData.tasksWithDates.length === 0 ? (
                <div className="text-center text-slate-400 py-8 bg-slate-50 rounded-xl flex flex-col items-center gap-2">
                  <AlertCircle size={20} />
                  Geen taken met datums gevonden
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  {/* Month header */}
                  <div className="relative h-8 bg-slate-50 border-b border-slate-200">
                    {planningData.months.map((m, i) => (
                      <span
                        key={i}
                        className="absolute text-[10px] text-slate-500 font-medium top-1/2 -translate-y-1/2"
                        style={{ left: `${Math.max(m.left, 1)}%` }}
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                  {/* Task bars */}
                  <div className="divide-y divide-slate-100">
                    {planningData.tasksWithDates.map((t) => {
                      const start = t.exp_start_date
                        ? new Date(t.exp_start_date).getTime()
                        : new Date(t.exp_end_date).getTime();
                      const end = t.exp_end_date
                        ? new Date(t.exp_end_date).getTime()
                        : start;
                      const leftPct = ((start - planningData.minTime) / planningData.range) * 100;
                      const widthPct = Math.max(((end - start) / planningData.range) * 100, 1);

                      const barColor =
                        t.status === "Completed" ? "bg-green-400"
                          : t.status === "Working" ? "bg-yellow-400"
                            : t.status === "Cancelled" ? "bg-red-300"
                              : "bg-3bm-teal";

                      return (
                        <div key={t.name} className="relative h-9 flex items-center px-2 hover:bg-slate-50">
                          <a
                            href={`${getErpNextLinkUrl()}/task/${t.name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="absolute h-5 rounded-full flex items-center px-2 text-[10px] text-white font-medium truncate hover:opacity-80"
                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 60 }}
                            title={`${t.subject} (${t.exp_start_date || "?"} - ${t.exp_end_date || "?"})`}
                          >
                            <div className={`absolute inset-0 rounded-full ${barColor} opacity-90`} />
                            <span className="relative truncate">{t.subject || t.name}</span>
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── ProjectMap ─── */

function ProjectMap({ projects }: { projects: ProjectRecord[] }) {
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [loading, setLoading] = useState(false);
  const processedRef = useRef<Set<string>>(new Set());

  const geocodeProjects = useCallback(async (projs: ProjectRecord[]) => {
    const toProcess = projs.filter(
      (p) => p.custom_address && !processedRef.current.has(p.name)
    );
    if (toProcess.length === 0) return;

    setLoading(true);
    const newMarkers: MarkerData[] = [];

    for (const p of toProcess) {
      processedRef.current.add(p.name);
      try {
        const addr = await fetchDocument<AddressDoc>("Address", p.custom_address);
        const parts = [addr.address_line1, addr.city, addr.pincode, addr.country].filter(Boolean);
        const query = parts.join(", ");
        if (!query) continue;

        const coords = await geocodeAddress(query);
        if (coords) {
          newMarkers.push({
            projectName: p.name,
            projectTitle: p.project_name,
            address: query,
            lat: coords.lat,
            lng: coords.lng,
          });
        }
      } catch (e) {
        console.warn(`Address ophalen mislukt voor ${p.name}:`, e);
      }
    }

    if (newMarkers.length > 0) {
      setMarkers((prev) => [...prev, ...newMarkers]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    geocodeProjects(projects);
  }, [projects, geocodeProjects]);

  const projectNames = useMemo(() => new Set(projects.map((p) => p.name)), [projects]);
  const visibleMarkers = useMemo(
    () => markers.filter((m) => projectNames.has(m.projectName)),
    [markers, projectNames]
  );

  const projectsWithAddress = projects.filter((p) => p.custom_address);

  return (
    <div className="mb-4 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
        <MapPin size={16} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-600">Projectlocaties</span>
        {loading && <span className="text-xs text-slate-400 ml-2">Geocoding...</span>}
        <span className="text-xs text-slate-400 ml-auto">
          {visibleMarkers.length} locaties van {projectsWithAddress.length} met adres ({projects.length} totaal)
        </span>
      </div>
      {projectsWithAddress.length === 0 && !loading && (
        <div className="px-4 py-6 text-center">
          <MapPin size={32} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Geen projecten met een adres gevonden.</p>
          <p className="text-xs text-slate-400 mt-1">Voeg een adres toe via het veld "custom_address" in ERPNext om locaties op de kaart te zien.</p>
        </div>
      )}
      <MapContainer
        center={NL_CENTER}
        zoom={8}
        style={{ height: "calc(100vh - 280px)", minHeight: 500, width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {visibleMarkers.map((m) => (
          <Marker key={m.projectName} position={[m.lat, m.lng]}>
            <Popup>
              <div className="text-sm">
                <a
                  href={`${getErpNextLinkUrl()}/project/${m.projectName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-blue-600 hover:underline"
                >
                  {m.projectName}
                </a>
                <div className="text-slate-700">{m.projectTitle}</div>
                <div className="text-slate-500 text-xs mt-1">{m.address}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

/* ─── Projects Page ─── */

export default function Projects() {
  const storeProjects = useProjects();
  const companies = useCompanies();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Open");
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [activeTab, setActiveTab] = useState<"lijst" | "kaart">("lijst");

  type SortColumn = "name" | "project_name" | "company" | "status" | "percent_complete" | "expected_start_date" | "expected_end_date";
  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Store full hours map: project → employee → hours
  const [allProjectHours, setAllProjectHours] = useState<Map<string, Map<string, number>>>(new Map());

  // Derive topWorkers from allProjectHours
  const topWorkers = useMemo(() => {
    const result = new Map<string, { name: string; hours: number }>();
    for (const [project, empMap] of allProjectHours) {
      let topName = "";
      let topHours = 0;
      for (const [name, hours] of empMap) {
        if (hours > topHours) {
          topName = name;
          topHours = hours;
        }
      }
      if (topName) result.set(project, { name: topName, hours: topHours });
    }
    return result;
  }, [allProjectHours]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      let tsDetails: TimesheetDetail[] = [];
      let tsParents: TimesheetParent[] = [];
      try {
        [tsDetails, tsParents] = await Promise.all([
          fetchList<TimesheetDetail>("Timesheet Detail", {
            fields: ["project", "hours", "parent"],
            filters: [["project", "is", "set"]],
            limit_page_length: 5000,
          }),
          fetchList<TimesheetParent>("Timesheet", {
            fields: ["name", "employee_name"],
            limit_page_length: 2000,
          }),
        ]);
      } catch (tsError) {
        console.warn("Timesheet data kon niet geladen worden:", tsError);
      }

      const parentToEmployee = new Map<string, string>();
      for (const ts of tsParents) {
        parentToEmployee.set(ts.name, ts.employee_name);
      }

      const projectEmployeeHours = new Map<string, Map<string, number>>();
      for (const detail of tsDetails) {
        if (!detail.project) continue;
        const empName = parentToEmployee.get(detail.parent);
        if (!empName) continue;

        if (!projectEmployeeHours.has(detail.project)) {
          projectEmployeeHours.set(detail.project, new Map());
        }
        const empMap = projectEmployeeHours.get(detail.project)!;
        empMap.set(empName, (empMap.get(empName) || 0) + detail.hours);
      }

      setAllProjectHours(projectEmployeeHours);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const p of storeProjects) {
      if (p.expected_start_date) {
        const year = p.expected_start_date.slice(0, 4);
        if (year) years.add(year);
      }
    }
    return Array.from(years).sort().reverse();
  }, [storeProjects]);

  const filtered = useMemo(() => {
    let list = storeProjects;
    if (statusFilter) {
      list = list.filter((p) => p.status === statusFilter);
    }
    if (companyFilter) {
      list = list.filter((p) => p.company === companyFilter);
    }
    if (yearFilter) {
      list = list.filter(
        (p) => p.expected_start_date && p.expected_start_date.startsWith(yearFilter)
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.project_name.toLowerCase().includes(q) ||
          p.status.toLowerCase().includes(q) ||
          p.company?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [storeProjects, search, yearFilter, companyFilter, statusFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = (a[sortColumn] ?? "") as string | number;
      const bv = (b[sortColumn] ?? "") as string | number;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "nl") * dir;
    });
  }, [filtered, sortColumn, sortDir]);

  function handleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir(col === "name" ? "desc" : "asc");
    }
  }

  const sortIndicator = (col: SortColumn) =>
    sortColumn === col ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Projecten</h2>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextLinkUrl()}/project/new`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Plus size={16} />
            Nieuw
          </a>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Vernieuwen
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex items-center gap-4">
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <FolderKanban className="text-indigo-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Totaal projecten</p>
            <p className="text-2xl font-bold text-slate-800">
              {loading ? "..." : filtered.length}
            </p>
          </div>
        </div>
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal cursor-pointer"
        >
          <option value="">Alle bedrijven</option>
          {companies.map((c) => (
            <option key={c.name} value={c.name}>{c.company_name || c.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal cursor-pointer"
        >
          <option value="">Alle statussen</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal cursor-pointer"
        >
          <option value="">Alle jaren</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <div className="flex-1 relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Zoek op projectnaam, nummer of status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm"
          />
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-4 bg-white border border-slate-200 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("lijst")}
          className={`px-4 py-2 flex items-center gap-1.5 text-sm rounded-md cursor-pointer transition-colors ${
            activeTab === "lijst" ? "bg-3bm-teal text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <List size={16} /> Lijst
        </button>
        <button
          onClick={() => setActiveTab("kaart")}
          className={`px-4 py-2 flex items-center gap-1.5 text-sm rounded-md cursor-pointer transition-colors ${
            activeTab === "kaart" ? "bg-3bm-teal text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <MapIcon size={16} /> Kaart
        </button>
      </div>

      {activeTab === "kaart" ? (
        <ProjectMap projects={filtered} />
      ) : (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th onClick={() => handleSort("name")} className="text-left px-4 py-3 text-sm font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none">Projectnr{sortIndicator("name")}</th>
              <th onClick={() => handleSort("project_name")} className="text-left px-4 py-3 text-sm font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none">Naam{sortIndicator("project_name")}</th>
              <th onClick={() => handleSort("company")} className="text-left px-4 py-3 text-sm font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none">Bedrijf{sortIndicator("company")}</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600">Meeste werk</th>
              <th onClick={() => handleSort("status")} className="text-left px-4 py-3 text-sm font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none">Status{sortIndicator("status")}</th>
              <th onClick={() => handleSort("percent_complete")} className="text-right px-4 py-3 text-sm font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none">Voortgang{sortIndicator("percent_complete")}</th>
              <th onClick={() => handleSort("expected_start_date")} className="text-left px-4 py-3 text-sm font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none">Startdatum{sortIndicator("expected_start_date")}</th>
              <th onClick={() => handleSort("expected_end_date")} className="text-left px-4 py-3 text-sm font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none">Einddatum{sortIndicator("expected_end_date")}</th>
              <th className="text-center px-4 py-3 text-sm font-semibold text-slate-600">Map</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  Laden...
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  {search ? "Geen projecten gevonden" : "Geen projecten"}
                </td>
              </tr>
            ) : (
              sorted.map((p) => {
                const worker = topWorkers.get(p.name);
                return (
                  <tr
                    key={p.name}
                    onClick={() => setSelectedProject(p)}
                    className="border-b border-slate-100 hover:bg-3bm-teal/5 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium">
                      <span className="text-3bm-teal flex items-center gap-1">
                        {p.name}
                        <ChevronRight size={14} className="text-slate-300" />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {p.project_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {p.company || "-"}
                    </td>
                    <td className="px-4 py-3">
                      {worker ? (
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 rounded-full ${getAvatarColor(worker.name)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}
                            title={worker.name}
                          >
                            {getInitials(worker.name)}
                          </div>
                          <div className="min-w-[160px]">
                            <p className="text-sm text-slate-700 font-medium">{worker.name}</p>
                            <p className="text-xs text-slate-400">{worker.hours.toFixed(1)} uur</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusColors[p.status] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-3bm-teal rounded-full"
                            style={{ width: `${p.percent_complete}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {p.percent_complete}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {p.expected_start_date || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {p.expected_end_date || "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        title={getProjectFolderPath(p.name, p.company)}
                        onClick={(e) => { e.stopPropagation(); openFolder(getProjectFolderPath(p.name, p.company)); }}
                        className="inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-3bm-teal hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <FolderOpen size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Project Detail Panel */}
      {selectedProject && (
        <ProjectDetail
          project={selectedProject}
          projectHours={allProjectHours.get(selectedProject.name) || new Map()}
          onClose={() => setSelectedProject(null)}
        />
      )}
    </div>
  );
}
