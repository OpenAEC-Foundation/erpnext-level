import { useEffect, useState, useMemo } from "react";
import { fetchList, fetchDocument } from "../lib/erpnext";
import { Users, RefreshCw, Search, Filter, Cake, CalendarClock, FileWarning, Clock } from "lucide-react";
import CompanySelect from "../components/CompanySelect";

interface Employee {
  name: string;
  employee_name: string;
  designation: string;
  department: string;
  status: string;
  company: string;
  date_of_joining: string;
  date_of_birth: string;
  contract_end_date: string;
  cell_phone: string;
  personal_email: string;
  company_email: string;
  image: string;
}

interface ActivityType {
  name: string;
}

interface ShiftAssignment {
  name: string;
  employee: string;
  shift_type: string;
}

interface ShiftTypeDoc {
  name: string;
  start_time: string;
  end_time: string;
}

const statusColors: Record<string, string> = {
  Active: "bg-green-100 text-green-700",
  Inactive: "bg-slate-100 text-slate-600",
  Suspended: "bg-orange-100 text-orange-700",
  Left: "bg-red-100 text-red-700",
};

const MONTH_NAMES_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getColor(name: string): string {
  const colors = [
    "bg-3bm-teal", "bg-green-500", "bg-purple-500", "bg-pink-500",
    "bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-cyan-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/** Format date as "15 maart" */
function formatDutchDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTH_NAMES_NL[d.getMonth()]}`;
}

/** Days until next occurrence of a month/day anniversary from today */
function daysUntilAnniversary(dateStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();

  let next = new Date(thisYear, d.getMonth(), d.getDate());
  next.setHours(0, 0, 0, 0);
  if (next < today) {
    next = new Date(thisYear + 1, d.getMonth(), d.getDate());
    next.setHours(0, 0, 0, 0);
  }
  return Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Calculate years of service */
function yearsOfService(dateOfJoining: string): number {
  if (!dateOfJoining) return 0;
  const join = new Date(dateOfJoining);
  const today = new Date();
  let years = today.getFullYear() - join.getFullYear();
  const monthDiff = today.getMonth() - join.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < join.getDate())) {
    years--;
  }
  return Math.max(0, years);
}

/** Days until a specific date (negative = past) */
function daysUntilDate(dateStr: string): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Get urgency class for upcoming dates */
function urgencyClass(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return "text-red-600 font-semibold";
  if (days < 14) return "text-red-600 font-semibold";
  if (days < 30) return "text-amber-600 font-semibold";
  return "";
}

/** Get urgency badge for days remaining */
function urgencyBadge(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return "bg-red-100 text-red-700";
  if (days < 14) return "bg-red-100 text-red-700";
  if (days < 30) return "bg-amber-100 text-amber-700";
  return "";
}

// ── localStorage helpers (exported for external use) ──

const ACTIVITY_TYPES_KEY = "erpnext_employee_activity_types";
const CONTRACT_HOURS_KEY = "erpnext_employee_contract_hours";

export function getEmployeeActivityTypes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_TYPES_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveEmployeeActivityType(employeeId: string, activityType: string) {
  const current = getEmployeeActivityTypes();
  current[employeeId] = activityType;
  localStorage.setItem(ACTIVITY_TYPES_KEY, JSON.stringify(current));
}

export function getEmployeeContractHours(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CONTRACT_HOURS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveContractHours(data: Record<string, number>) {
  localStorage.setItem(CONTRACT_HOURS_KEY, JSON.stringify(data));
}

/** Parse hours from shift type name, e.g. "8 uur" → 8 */
function parseHoursFromName(name: string): number {
  const match = name.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 8; // default 8 if no number found
}

/** Calculate time difference in hours between two time strings (HH:MM:SS) */
function calcHoursFromTimes(start: string, end: string): number {
  if (!start || !end) return 8;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60; // overnight shift
  return diff / 60;
}

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [employeeActivityMap, setEmployeeActivityMap] = useState<Record<string, string>>(getEmployeeActivityTypes());
  const [contractHours, setContractHours] = useState<Record<string, number>>(getEmployeeContractHours());

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const filters: unknown[][] = [];
      if (statusFilter) filters.push(["status", "=", statusFilter]);
      if (company) filters.push(["company", "=", company]);
      const list = await fetchList<Employee>("Employee", {
        fields: [
          "name", "employee_name", "designation", "department", "status",
          "company", "date_of_joining", "date_of_birth", "contract_end_date",
          "company_email", "image",
        ],
        filters,
        limit_page_length: 200,
        order_by: "employee_name asc",
      });
      setEmployees(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }

  // Load activity types
  async function loadActivityTypes() {
    try {
      const types = await fetchList<ActivityType>("Activity Type", {
        fields: ["name"],
        limit_page_length: 200,
        order_by: "name asc",
      });
      setActivityTypes(types.map((t) => t.name));
    } catch {
      // silently fail - not critical
    }
  }

  // Load shift assignments and calculate contract hours
  async function loadContractHours() {
    try {
      const assignments = await fetchList<ShiftAssignment>("Shift Assignment", {
        fields: ["name", "employee", "shift_type"],
        filters: [["status", "=", "Active"]],
        limit_page_length: 500,
      });

      // Get unique shift types
      const uniqueShiftTypes = [...new Set(assignments.map((a) => a.shift_type))];

      // Fetch each shift type doc for start_time/end_time
      const shiftHoursMap: Record<string, number> = {};
      await Promise.all(
        uniqueShiftTypes.map(async (stName) => {
          try {
            const doc = await fetchDocument<ShiftTypeDoc>("Shift Type", stName);
            const hours = calcHoursFromTimes(doc.start_time, doc.end_time);
            shiftHoursMap[stName] = hours;
          } catch {
            // fallback: parse from name
            shiftHoursMap[stName] = parseHoursFromName(stName);
          }
        })
      );

      // Map employee → weekly hours (assume 5 days if no repeat_on_days info)
      const hoursMap: Record<string, number> = {};
      for (const assignment of assignments) {
        const dailyHours = shiftHoursMap[assignment.shift_type] ?? 8;
        // Default to 5 days per week
        hoursMap[assignment.employee] = dailyHours * 5;
      }

      setContractHours(hoursMap);
      saveContractHours(hoursMap);
    } catch {
      // Shift Assignment might not exist — try without status filter
      try {
        const assignments = await fetchList<ShiftAssignment>("Shift Assignment", {
          fields: ["name", "employee", "shift_type"],
          limit_page_length: 500,
        });

        const uniqueShiftTypes = [...new Set(assignments.map((a) => a.shift_type))];
        const shiftHoursMap: Record<string, number> = {};
        await Promise.all(
          uniqueShiftTypes.map(async (stName) => {
            try {
              const doc = await fetchDocument<ShiftTypeDoc>("Shift Type", stName);
              const hours = calcHoursFromTimes(doc.start_time, doc.end_time);
              shiftHoursMap[stName] = hours;
            } catch {
              shiftHoursMap[stName] = parseHoursFromName(stName);
            }
          })
        );

        const hoursMap: Record<string, number> = {};
        for (const assignment of assignments) {
          const dailyHours = shiftHoursMap[assignment.shift_type] ?? 8;
          hoursMap[assignment.employee] = dailyHours * 5;
        }

        setContractHours(hoursMap);
        saveContractHours(hoursMap);
      } catch {
        // silently fail
      }
    }
  }

  useEffect(() => { loadData(); }, [statusFilter, company]);
  useEffect(() => { loadActivityTypes(); loadContractHours(); }, []);

  function handleActivityChange(employeeId: string, value: string) {
    saveEmployeeActivityType(employeeId, value);
    setEmployeeActivityMap((prev) => ({ ...prev, [employeeId]: value }));
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(
      (e) =>
        e.employee_name?.toLowerCase().includes(q) ||
        e.designation?.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q)
    );
  }, [employees, search]);

  const departments = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      const dept = e.department || "Onbekend";
      map.set(dept, (map.get(dept) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Medewerkers</h2>
        <button onClick={loadData} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Vernieuwen
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      <div className="mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="p-2 bg-3bm-teal/10 rounded-lg">
            <Users className="text-3bm-teal" size={20} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Medewerkers</p>
            <p className="text-2xl font-bold text-slate-800">{loading ? "..." : filtered.length}</p>
          </div>
        </div>

        {departments.slice(0, 4).map(([dept, count]) => (
          <div key={dept} className="bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-400">{dept}</p>
            <p className="text-lg font-bold text-slate-700">{count}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal">
          <option value="">Alle statussen</option>
          <option value="Active">Actief</option>
          <option value="Inactive">Inactief</option>
          <option value="Left">Vertrokken</option>
        </select>
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Zoek op naam, functie of afdeling..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm" />
        </div>
      </div>

      {/* Card grid view */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Laden...</div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-400">Geen medewerkers gevonden</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((emp) => {
            const birthdayDays = daysUntilAnniversary(emp.date_of_birth);
            const joiningDays = daysUntilAnniversary(emp.date_of_joining);
            const serviceYears = yearsOfService(emp.date_of_joining);
            const contractDays = daysUntilDate(emp.contract_end_date);
            const weekHours = contractHours[emp.name];

            return (
              <div key={emp.name} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-4 mb-3">
                  <div className={`w-12 h-12 rounded-full ${getColor(emp.employee_name)} flex items-center justify-center text-white font-bold text-lg`}>
                    {getInitials(emp.employee_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-slate-800 truncate">{emp.employee_name}</h3>
                    <p className="text-sm text-slate-500 truncate">{emp.designation || "-"}</p>
                  </div>
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${statusColors[emp.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {emp.status}
                  </span>
                </div>
                <div className="space-y-1.5 text-sm">
                  {emp.department && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Afdeling</span>
                      <span className="text-slate-700">{emp.department}</span>
                    </div>
                  )}
                  {emp.company_email && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email</span>
                      <span className="text-slate-700 truncate ml-2">{emp.company_email}</span>
                    </div>
                  )}

                  {/* Verjaardag */}
                  {emp.date_of_birth && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Cake size={13} />
                        Verjaardag
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={urgencyClass(birthdayDays)}>
                          {formatDutchDate(emp.date_of_birth)}
                        </span>
                        {birthdayDays !== null && birthdayDays <= 30 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${urgencyBadge(birthdayDays)}`}>
                            {birthdayDays === 0 ? "vandaag" : `${birthdayDays}d`}
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* In dienst sinds + dienstjaren */}
                  {emp.date_of_joining && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 flex items-center gap-1">
                        <CalendarClock size={13} />
                        In dienst sinds
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={urgencyClass(joiningDays)}>
                          {formatDutchDate(emp.date_of_joining)}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                          {serviceYears} jr
                        </span>
                        {joiningDays !== null && joiningDays <= 30 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${urgencyBadge(joiningDays)}`}>
                            {joiningDays === 0 ? "jubileum" : `${joiningDays}d`}
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Contract einddatum */}
                  {emp.contract_end_date && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 flex items-center gap-1">
                        <FileWarning size={13} />
                        Contract einde
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={urgencyClass(contractDays)}>
                          {formatDutchDate(emp.contract_end_date)}
                        </span>
                        {contractDays !== null && contractDays < 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                            Verlopen
                          </span>
                        )}
                        {contractDays !== null && contractDays >= 0 && contractDays <= 30 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${urgencyBadge(contractDays)}`}>
                            {contractDays === 0 ? "vandaag" : `${contractDays}d`}
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Contracturen */}
                  {weekHours !== undefined && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Clock size={13} />
                        Contracturen
                      </span>
                      <span className="text-slate-700 font-medium">{weekHours} uur/week</span>
                    </div>
                  )}

                  {/* Uurtype dropdown */}
                  {activityTypes.length > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Uurtype</span>
                      <select
                        value={employeeActivityMap[emp.name] || ""}
                        onChange={(e) => handleActivityChange(emp.name, e.target.value)}
                        className="text-xs px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-3bm-teal text-slate-700 max-w-[160px]"
                      >
                        <option value="">-- Selecteer --</option>
                        {activityTypes.map((at) => (
                          <option key={at} value={at}>{at}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">
                  {emp.name}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
