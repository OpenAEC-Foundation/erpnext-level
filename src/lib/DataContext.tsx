import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { fetchList, fetchAll } from "./erpnext";

/* ─── Types ─── */

export interface Company {
  name: string;
  company_name: string;
  abbr: string;
}

export interface Employee {
  name: string;
  employee_name: string;
  designation: string;
  department: string;
  company: string;
  status: string;
  user_id: string;
  company_email: string;
  date_of_birth: string;
  image: string;
  default_activity_type?: string;
}

export interface ProjectRecord {
  name: string;
  project_name: string;
  status: string;
  percent_complete: number;
  expected_start_date: string;
  expected_end_date: string;
  company: string;
  custom_address: string;
}

export interface LeaveRecord {
  name: string;
  employee: string;
  employee_name: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  total_leave_days: number;
  status: string;
  company: string;
}

interface DataStore {
  companies: Company[];
  employees: Employee[];
  projects: ProjectRecord[];
  leaves: LeaveRecord[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataStore | null>(null);

/* ─── Provider ─── */

const REFRESH_INTERVAL = 60_000; // 60s

export function DataProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const initialDone = useRef(false);

  const refreshData = useCallback(async () => {
    // Only show loading spinner on initial fetch
    if (!initialDone.current) setLoading(true);

    // Fetch each independently so one failure doesn't block the rest
    const [compResult, empResult, projResult, leaveResult] = await Promise.allSettled([
      fetchList<Company>("Company", {
        fields: ["name", "company_name", "abbr"],
        limit_page_length: 0,
      }),
      fetchAll<Employee>(
        "Employee",
        ["name", "employee_name", "designation", "department", "company", "status", "user_id", "company_email", "date_of_birth", "image", "default_activity_type"],
        [],
        "employee_name asc"
      ).catch(() =>
        fetchAll<Employee>(
          "Employee",
          ["name", "employee_name", "designation", "department", "company", "status", "user_id", "company_email", "date_of_birth", "image"],
          [],
          "employee_name asc"
        )
      ),
      // Try with custom_address first (v15), fallback without it (v16)
      fetchAll<ProjectRecord>(
        "Project",
        ["name", "project_name", "status", "percent_complete", "expected_start_date", "expected_end_date", "company", "custom_address"],
        [],
        "creation desc"
      ).catch(() =>
        fetchAll<ProjectRecord>(
          "Project",
          ["name", "project_name", "status", "percent_complete", "expected_start_date", "expected_end_date", "company"],
          [],
          "creation desc"
        )
      ),
      fetchAll<LeaveRecord>(
        "Leave Application",
        ["name", "employee", "employee_name", "leave_type", "from_date", "to_date", "total_leave_days", "status", "company"],
        [],
        "from_date asc"
      ),
    ]);

    if (compResult.status === "fulfilled") setCompanies(compResult.value);
    else console.error("Company fetch error:", compResult.reason);

    if (empResult.status === "fulfilled") setEmployees(empResult.value);
    else console.error("Employee fetch error:", empResult.reason);

    if (projResult.status === "fulfilled") setProjects(projResult.value);
    else console.error("Project fetch error:", projResult.reason);

    if (leaveResult.status === "fulfilled") setLeaves(leaveResult.value);
    else console.error("Leave fetch error:", leaveResult.reason);

    if (!initialDone.current) {
      initialDone.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const id = setInterval(refreshData, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refreshData]);

  return (
    <DataContext.Provider value={{ companies, employees, projects, leaves, loading, refresh: refreshData }}>
      {children}
    </DataContext.Provider>
  );
}

/* ─── Hooks ─── */

export function useDataStore(): DataStore {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataStore must be used inside <DataProvider>");
  return ctx;
}

export function useCompanies(): Company[] {
  return useDataStore().companies;
}

export function useEmployees(): Employee[] {
  return useDataStore().employees;
}

export function useProjects(): ProjectRecord[] {
  return useDataStore().projects;
}

export function useLeaves(): LeaveRecord[] {
  return useDataStore().leaves;
}
