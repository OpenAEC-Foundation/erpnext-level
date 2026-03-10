import { useEffect, useState, useMemo } from "react";
import { fetchList } from "../lib/erpnext";
import { Users, RefreshCw, Search, Filter } from "lucide-react";
import CompanySelect from "../components/CompanySelect";

interface Employee {
  name: string;
  employee_name: string;
  designation: string;
  department: string;
  status: string;
  company: string;
  date_of_joining: string;
  cell_phone: string;
  personal_email: string;
  company_email: string;
  image: string;
}

const statusColors: Record<string, string> = {
  Active: "bg-green-100 text-green-700",
  Inactive: "bg-slate-100 text-slate-600",
  Suspended: "bg-orange-100 text-orange-700",
  Left: "bg-red-100 text-red-700",
};

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

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");

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
          "company", "date_of_joining", "company_email", "image",
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

  useEffect(() => { loadData(); }, [statusFilter, company]);

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
          {filtered.map((emp) => (
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
              <div className="space-y-1 text-sm">
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
                {emp.date_of_joining && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">In dienst sinds</span>
                    <span className="text-slate-700">{emp.date_of_joining}</span>
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">
                {emp.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
