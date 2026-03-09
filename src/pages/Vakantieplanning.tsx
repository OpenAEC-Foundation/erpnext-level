import { useEffect, useState, useMemo, useRef } from "react";
import { fetchList, getErpNextAppUrl } from "../lib/erpnext";
import CompanySelect from "../components/CompanySelect";
import { HOLIDAYS } from "../lib/holidays";
import {
  CalendarCheck, RefreshCw, Search, Filter, ExternalLink,
  CheckCircle2, Clock, XCircle, CalendarDays, ZoomIn, ZoomOut, RotateCcw,
} from "lucide-react";

interface LeaveApplication {
  name: string;
  employee_name: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  total_leave_days: number;
  status: string;
  company: string;
}

const statusColors: Record<string, string> = {
  Approved: "bg-3bm-teal/10 text-3bm-teal-dark",
  Open: "bg-orange-100 text-orange-700",
  Rejected: "bg-red-100 text-red-700",
};

const MONTHS = [
  "Jan", "Feb", "Mrt", "Apr", "Mei", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dec",
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function dayOfYear(dateStr: string, year: number): number {
  const d = new Date(dateStr);
  const start = new Date(year, 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

function totalDaysInYear(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
}

function isZiekte(leaveType: string): boolean {
  return leaveType.toLowerCase().includes("ziekte");
}

function getBarColor(status: string, leaveType: string): string {
  if (status === "Approved" && isZiekte(leaveType)) return "bg-red-400";
  if (status === "Approved") return "bg-3bm-teal";
  if (status === "Open") return "bg-orange-400";
  return "bg-slate-300";
}

export default function Vakantieplanning() {
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState("");
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [activeTab, setActiveTab] = useState<"kalender" | "aanvragen">("kalender");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [];
      if (company) filters.push(["company", "=", company]);
      if (statusFilter) filters.push(["status", "=", statusFilter]);
      // Fetch leaves that overlap with the selected year
      filters.push(["from_date", "<=", `${year}-12-31`]);
      filters.push(["to_date", ">=", `${year}-01-01`]);

      const list = await fetchList<LeaveApplication>("Leave Application", {
        fields: [
          "name", "employee_name", "leave_type", "from_date", "to_date",
          "total_leave_days", "status", "company",
        ],
        filters,
        limit_page_length: 500,
        order_by: "from_date asc",
      });
      setLeaves(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [year, statusFilter, company]);

  const filtered = useMemo(() => {
    if (!search.trim()) return leaves;
    const q = search.toLowerCase();
    return leaves.filter((l) => l.employee_name.toLowerCase().includes(q));
  }, [leaves, search]);

  // Group by employee for calendar
  const employeeLeaves = useMemo(() => {
    const map = new Map<string, LeaveApplication[]>();
    for (const l of filtered) {
      if (!map.has(l.employee_name)) map.set(l.employee_name, []);
      map.get(l.employee_name)!.push(l);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // KPI counts
  const totalCount = filtered.length;
  const approvedCount = filtered.filter((l) => l.status === "Approved").length;
  const openCount = filtered.filter((l) => l.status === "Open").length;
  const rejectedCount = filtered.filter((l) => l.status === "Rejected").length;

  const totalDays = totalDaysInYear(year);

  // Calculate month start positions as percentages
  const monthPositions = useMemo(() => {
    const positions: { left: number; width: number }[] = [];
    let dayCount = 0;
    for (let m = 0; m < 12; m++) {
      const days = daysInMonth(year, m);
      positions.push({
        left: (dayCount / totalDays) * 100,
        width: (days / totalDays) * 100,
      });
      dayCount += days;
    }
    return positions;
  }, [year, totalDays]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Vakantieplanning</h2>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Vernieuwen
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      {/* KPI Cards */}
      <div className="mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-3bm-teal/10 rounded-lg">
            <CalendarCheck className="text-3bm-teal" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Totaal aanvragen</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : totalCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-3bm-teal/10 rounded-lg">
            <CheckCircle2 className="text-3bm-teal" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Goedgekeurd</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : approvedCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-orange-100 rounded-lg">
            <Clock className="text-orange-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Open</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : openCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-red-100 rounded-lg">
            <XCircle className="text-red-600" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Afgewezen</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : rejectedCount}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          <option value={2024}>2024</option>
          <option value={2025}>2025</option>
          <option value={2026}>2026</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          <option value="">Alle statussen</option>
          <option value="Approved">Goedgekeurd</option>
          <option value="Open">Open</option>
          <option value="Rejected">Afgewezen</option>
        </select>
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Zoek op medewerker..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setActiveTab("kalender")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            activeTab === "kalender"
              ? "bg-3bm-teal text-white"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <CalendarDays size={16} />
          Kalender
        </button>
        <button
          onClick={() => setActiveTab("aanvragen")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            activeTab === "aanvragen"
              ? "bg-3bm-teal text-white"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <CalendarCheck size={16} />
          Aanvragen
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Laden...</div>
      ) : activeTab === "kalender" ? (
        <CalendarView
          employeeLeaves={employeeLeaves}
          year={year}
          totalDays={totalDays}
          monthPositions={monthPositions}
        />
      ) : (
        <AanvragenView leaves={filtered} />
      )}
    </div>
  );
}

/* ──────────── Calendar View ──────────── */

interface MergedLeave {
  from_date: string;
  to_date: string;
  status: string;
  leave_type: string;
  employee_name: string;
  names: string[];
}

function mergeLeaves(apps: LeaveApplication[]): MergedLeave[] {
  if (apps.length === 0) return [];

  // Group by status + leave_type so only compatible leaves merge
  const groups = new Map<string, LeaveApplication[]>();
  for (const app of apps) {
    const key = `${app.status}|||${app.leave_type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(app);
  }

  const merged: MergedLeave[] = [];

  for (const [, group] of groups) {
    // Sort by from_date within each group
    const sorted = [...group].sort((a, b) => a.from_date.localeCompare(b.from_date));

    let current: MergedLeave = {
      from_date: sorted[0].from_date,
      to_date: sorted[0].to_date,
      status: sorted[0].status,
      leave_type: sorted[0].leave_type,
      employee_name: sorted[0].employee_name,
      names: [sorted[0].name],
    };

    for (let i = 1; i < sorted.length; i++) {
      const app = sorted[i];
      // Gap = calendar days between end of current strip and start of next
      // e.g. Fri to Mon = (Mon - Fri) / day = 3, which bridges a weekend
      // Use <= 5 to cover part-time workers (Mon/Wed/Fri patterns)
      const currentEnd = new Date(current.to_date);
      const nextStart = new Date(app.from_date);
      const gapDays = (nextStart.getTime() - currentEnd.getTime()) / 86400000;

      if (gapDays <= 5) {
        // Merge: extend end date to the later of the two
        if (app.to_date > current.to_date) current.to_date = app.to_date;
        current.names.push(app.name);
      } else {
        merged.push(current);
        current = {
          from_date: app.from_date,
          to_date: app.to_date,
          status: app.status,
          leave_type: app.leave_type,
          employee_name: app.employee_name,
          names: [app.name],
        };
      }
    }
    merged.push(current);
  }

  // Sort final merged strips by from_date for consistent rendering
  merged.sort((a, b) => a.from_date.localeCompare(b.from_date));
  return merged;
}

function CalendarView({
  employeeLeaves,
  year,
  totalDays,
  monthPositions,
}: {
  employeeLeaves: [string, LeaveApplication[]][];
  year: number;
  totalDays: number;
  monthPositions: { left: number; width: number }[];
}) {
  const [tooltip, setTooltip] = useState<{
    leave: MergedLeave;
    x: number;
    y: number;
  } | null>(null);

  const [holidayTooltip, setHolidayTooltip] = useState<{
    name: string;
    x: number;
    y: number;
  } | null>(null);

  const [zoom, setZoom] = useState(1);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Ctrl+scroll zoom on the calendar grid only
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        setZoom((z) => Math.min(3, Math.max(0.5, z - e.deltaY * 0.001)));
      }
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Document-level listener to block browser Ctrl+scroll zoom when cursor is over calendar
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    function handleDocumentWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      // Check if the mouse is over the calendar container
      const rect = el!.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        e.preventDefault();
      }
    }

    document.addEventListener("wheel", handleDocumentWheel, { passive: false });
    return () => document.removeEventListener("wheel", handleDocumentWheel);
  }, []);

  // Calculate holiday positions for the current year
  const holidayPositions = useMemo(() => {
    const holidays = HOLIDAYS[year] || [];
    return holidays.map((h) => {
      const day = dayOfYear(h.date, year);
      const left = (day / totalDays) * 100;
      return { ...h, left };
    });
  }, [year, totalDays]);

  if (employeeLeaves.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        Geen verlofaanvragen gevonden voor dit jaar
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Legend */}
      <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-3bm-teal inline-block" /> Goedgekeurd
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-orange-400 inline-block" /> Open
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-400 inline-block" /> Ziekteverlof
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-3 border-l-2 border-dashed border-red-400 inline-block" /> Feestdag
        </span>
      </div>

      {/* Zoom controls */}
      <div className="px-4 py-1.5 border-b border-slate-100 flex items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <ZoomIn size={14} />
          Zoom: {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs cursor-pointer"
          title="Inzoomen"
        >
          <ZoomIn size={12} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs cursor-pointer"
          title="Uitzoomen"
        >
          <ZoomOut size={12} />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs cursor-pointer flex items-center gap-1"
          title="Zoom resetten"
        >
          <RotateCcw size={12} />
          Reset
        </button>
        <span className="text-slate-400 ml-1">Ctrl+Scroll om te zoomen</span>
      </div>

      <div className="overflow-x-auto" ref={scrollContainerRef}>
        <div style={{ minWidth: `${900 * zoom}px` }}>
          {/* Month headers */}
          <div className="flex border-b border-slate-200">
            <div className="w-48 flex-shrink-0 px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500">
              Medewerker
            </div>
            <div className="flex-1 relative h-8">
              {monthPositions.map((pos, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full flex items-center justify-center text-xs font-medium text-slate-500 border-l border-slate-100"
                  style={{ left: `${pos.left}%`, width: `${pos.width}%` }}
                >
                  {MONTHS[i]}
                </div>
              ))}
              {/* Holiday dots in month header */}
              {holidayPositions.map((h) => (
                <div
                  key={h.date}
                  className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-red-400"
                  style={{ left: `${h.left}%`, transform: "translateX(-50%)" }}
                  title={h.name}
                />
              ))}
            </div>
          </div>

          {/* Employee rows */}
          {employeeLeaves.map(([name, apps]) => (
            <div key={name} className="flex border-b border-slate-100 hover:bg-slate-50/50">
              <div className="w-48 flex-shrink-0 px-4 py-2 text-sm font-medium text-slate-700 truncate">
                {name}
              </div>
              <div className="flex-1 relative h-10">
                {/* Month grid lines */}
                {monthPositions.map((pos, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full border-l border-slate-100"
                    style={{ left: `${pos.left}%` }}
                  />
                ))}
                {/* Holiday vertical markers */}
                {holidayPositions.map((h) => (
                  <div
                    key={h.date}
                    className="absolute top-0 h-full border-l-[1.5px] border-dashed border-red-300 z-[1] cursor-help"
                    style={{ left: `${h.left}%` }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHolidayTooltip({
                        name: h.name,
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                      });
                    }}
                    onMouseLeave={() => setHolidayTooltip(null)}
                  />
                ))}
                {/* Leave bars */}
                {mergeLeaves(apps).map((leave, idx) => {
                  const fromDay = Math.max(0, dayOfYear(leave.from_date, year));
                  const toDay = Math.min(totalDays - 1, dayOfYear(leave.to_date, year));
                  const left = (fromDay / totalDays) * 100;
                  const width = Math.max(0.3, ((toDay - fromDay + 1) / totalDays) * 100);

                  return (
                    <div
                      key={leave.names.join("-") || idx}
                      className={`absolute top-1.5 h-7 rounded-sm ${getBarColor(leave.status, leave.leave_type)} opacity-80 hover:opacity-100 cursor-pointer transition-opacity z-[2]`}
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: "3px" }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({ leave, x: rect.left + rect.width / 2, y: rect.top });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leave tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="font-semibold">{tooltip.leave.employee_name}</p>
          <p>{tooltip.leave.leave_type}</p>
          <p>
            {tooltip.leave.from_date} — {tooltip.leave.to_date}
          </p>
          <p>{tooltip.leave.status}{tooltip.leave.names.length > 1 ? ` (${tooltip.leave.names.length} aanvragen)` : ""}</p>
        </div>
      )}

      {/* Holiday tooltip */}
      {holidayTooltip && (
        <div
          className="fixed z-50 bg-red-700 text-white text-xs rounded-lg px-3 py-1.5 shadow-lg pointer-events-none"
          style={{
            left: holidayTooltip.x,
            top: holidayTooltip.y - 8,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="font-semibold">{holidayTooltip.name}</p>
        </div>
      )}
    </div>
  );
}

/* ──────────── Aanvragen View ──────────── */

function AanvragenView({ leaves }: { leaves: LeaveApplication[] }) {
  if (leaves.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        Geen verlofaanvragen gevonden
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-slate-600">
            <th className="px-4 py-3 font-semibold">Medewerker</th>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Van</th>
            <th className="px-4 py-3 font-semibold">Tot</th>
            <th className="px-4 py-3 font-semibold text-right">Dagen</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {leaves.map((l) => (
            <tr key={l.name} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800">{l.employee_name}</td>
              <td className="px-4 py-3 text-slate-600">{l.leave_type}</td>
              <td className="px-4 py-3 text-slate-600">{l.from_date}</td>
              <td className="px-4 py-3 text-slate-600">{l.to_date}</td>
              <td className="px-4 py-3 text-right font-medium text-slate-800">
                {l.total_leave_days}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                    statusColors[l.status] ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  {l.status}
                </span>
              </td>
              <td className="px-4 py-3">
                <a
                  href={`${getErpNextAppUrl()}/leave-application/${l.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-3bm-teal hover:text-3bm-teal-dark"
                >
                  <ExternalLink size={14} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
