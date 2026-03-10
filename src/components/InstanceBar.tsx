import { useState, useEffect } from "react";
import { Plus, Server, Building2, User, MessageSquarePlus, RefreshCw } from "lucide-react";
import {
  getInstances,
  getActiveInstanceId,
  activateInstance,
  loadInstancesFromBackend,
} from "../lib/instances";
import { useCompanies, useEmployees } from "../lib/DataContext";
import type { ViewMode } from "./Sidebar";

interface InstanceBarProps {
  onSwitch: () => void;
  onRefresh?: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export default function InstanceBar({ onSwitch, onRefresh, viewMode, onViewModeChange }: InstanceBarProps) {
  const [instances, setInstances] = useState(getInstances);
  const [activeId, setActiveId] = useState(getActiveInstanceId);
  const [showFeedback, setShowFeedback] = useState(false);
  const [fbTitle, setFbTitle] = useState("");
  const [fbBody, setFbBody] = useState("");
  const [fbType, setFbType] = useState<"bug" | "feature" | "question">("bug");

  // Company & Employee selectors
  const companies = useCompanies();
  const employees = useEmployees();
  const [selectedCompany, setSelectedCompany] = useState(
    () => localStorage.getItem(`pref_${getActiveInstanceId()}_company`) || ""
  );
  const [selectedEmployee, setSelectedEmployee] = useState(
    () => localStorage.getItem(`pref_${getActiveInstanceId()}_employee`) || ""
  );

  // Filter employees by selected company
  const filteredEmployees = selectedCompany
    ? employees.filter(e => e.company === selectedCompany && e.status === "Active")
    : employees.filter(e => e.status === "Active");

  function handleCompanyChange(company: string) {
    setSelectedCompany(company);
    localStorage.setItem(`pref_${activeId}_company`, company);
    localStorage.setItem("erpnext_default_company", company);
  }

  function handleEmployeeChange(employee: string) {
    setSelectedEmployee(employee);
    localStorage.setItem(`pref_${activeId}_employee`, employee);
    localStorage.setItem("erpnext_default_employee", employee);
  }

  // Load instances from backend on mount
  useEffect(() => {
    loadInstancesFromBackend().then(() => {
      setInstances(getInstances());
    });
  }, []);

  function handleSwitch(id: string) {
    if (id === activeId) return;
    activateInstance(id);
    setActiveId(id);
    onSwitch();
  }

  return (
    <div className="bg-slate-800 flex items-center px-2 h-9 flex-shrink-0 relative">
      <Server size={14} className="text-slate-500 mr-2 flex-shrink-0" />

      {/* Scrollable instance tabs */}
      <div className="flex items-center gap-0 overflow-x-auto scrollbar-none flex-shrink min-w-0">
        {instances.map((inst) => {
          const isActive = inst.id === activeId;
          return (
            <button
              key={inst.id}
              onClick={() => handleSwitch(inst.id)}
              className={`flex items-center gap-1.5 px-3 h-7 rounded-t-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                isActive
                  ? "bg-slate-100 text-slate-800"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
              }`}
              style={isActive ? { borderBottom: `2px solid ${inst.color}` } : undefined}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: inst.color }}
              />
              {inst.name}
            </button>
          );
        })}
      </div>

      <button
        onClick={async () => {
          await loadInstancesFromBackend();
          setInstances(getInstances());
        }}
        className="flex items-center gap-1 px-2 h-7 text-xs text-slate-500 hover:text-white hover:bg-slate-700 rounded-md transition-colors cursor-pointer ml-1 flex-shrink-0"
        title="Instances herladen"
      >
        <Plus size={12} />
      </button>

      {/* Centered logos */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2.5 pointer-events-none">
        <svg viewBox="0 0 80 18" className="h-4" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="1" width="16" height="16" rx="3" fill="#0089FF" />
          <text x="8" y="13.5" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" fill="white">E</text>
          <text x="22" y="14" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" fill="rgba(255,255,255,0.85)">RPNext</text>
        </svg>
        <span className="text-xs text-slate-500 font-medium">×</span>
        <svg viewBox="0 0 140 18" className="h-4" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="1" width="16" height="16" rx="3" fill="#10b981" />
          <text x="8" y="13" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="10" fill="white">&#x2B21;</text>
          <text x="22" y="14" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="10.5" fill="rgba(255,255,255,0.75)">OpenAEC Foundation</text>
        </svg>
      </div>

      {/* Right side controls */}
      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        {/* Company & Employee selectors (werkgever mode) */}
        {viewMode === "werkgever" && companies.length > 0 && (
          <>
            <div className="flex items-center gap-1">
              <Building2 size={12} className="text-slate-500" />
              <select
                value={selectedCompany}
                onChange={e => handleCompanyChange(e.target.value)}
                className="bg-slate-700 text-slate-300 text-xs h-6 px-1.5 rounded border-none outline-none cursor-pointer max-w-[140px]"
              >
                <option value="">Alle bedrijven</option>
                {companies.map(c => (
                  <option key={c.name} value={c.name}>{c.company_name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <User size={12} className="text-slate-500" />
              <select
                value={selectedEmployee}
                onChange={e => handleEmployeeChange(e.target.value)}
                className="bg-slate-700 text-slate-300 text-xs h-6 px-1.5 rounded border-none outline-none cursor-pointer max-w-[160px]"
              >
                <option value="">Alle medewerkers</option>
                {filteredEmployees.map(e => (
                  <option key={e.name} value={e.name}>{e.employee_name}</option>
                ))}
              </select>
            </div>
            <div className="w-px h-5 bg-slate-600" />
          </>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 px-2 h-7 text-xs text-slate-500 hover:text-white hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
            title="Data vernieuwen"
          >
            <RefreshCw size={12} />
          </button>
        )}
        <button
          onClick={() => setShowFeedback(true)}
          className="flex items-center gap-1 px-2 h-7 text-xs text-slate-500 hover:text-white hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
          title="Feedback / Issue melden"
        >
          <MessageSquarePlus size={12} />
          <span className="hidden sm:inline">Feedback</span>
        </button>
        <div className="flex items-center bg-slate-700 rounded-md p-0.5 gap-0.5">
          <button
            onClick={() => onViewModeChange("werkgever")}
            className={`flex items-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium transition-colors cursor-pointer ${
              viewMode === "werkgever"
                ? "bg-3bm-teal text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Building2 size={12} />
            Werkgever
          </button>
          <button
            onClick={() => onViewModeChange("werknemer")}
            className={`flex items-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium transition-colors cursor-pointer ${
              viewMode === "werknemer"
                ? "bg-3bm-teal text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <User size={12} />
            Werknemer
          </button>
        </div>
      </div>

      {/* Feedback Modal */}
      {showFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowFeedback(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4">
            <h3 className="text-lg font-semibold text-slate-800">Feedback / Issue melden</h3>
            <p className="text-xs text-slate-500">
              Dit opent een GitHub Issue op <span className="font-mono">OpenAEC-Foundation/erpnext-level</span>.
              Je hebt een GitHub-account nodig.
            </p>

            <div className="flex gap-2">
              {(["bug", "feature", "question"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFbType(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${
                    fbType === t
                      ? "bg-3bm-teal text-white border-3bm-teal"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  }`}
                >
                  {t === "bug" ? "Bug" : t === "feature" ? "Feature request" : "Vraag"}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Titel *</label>
              <input
                type="text"
                value={fbTitle}
                onChange={(e) => setFbTitle(e.target.value)}
                placeholder="Korte samenvatting..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Beschrijving</label>
              <textarea
                value={fbBody}
                onChange={(e) => setFbBody(e.target.value)}
                placeholder="Wat ging er mis? Wat verwacht je? Stappen om te reproduceren..."
                rows={5}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowFeedback(false); setFbTitle(""); setFbBody(""); }}
                className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Annuleren
              </button>
              <button
                onClick={() => {
                  const labels = fbType === "bug" ? "bug" : fbType === "feature" ? "enhancement" : "question";
                  const prefix = fbType === "bug" ? "[Bug] " : fbType === "feature" ? "[Feature] " : "[Vraag] ";
                  const meta = `\n\n---\n*Instance: ${instances.find(i => i.id === activeId)?.name || activeId} | ${new Date().toLocaleDateString("nl-NL")}*`;
                  const body = (fbBody || "") + meta;
                  const url = new URL("https://github.com/OpenAEC-Foundation/erpnext-level/issues/new");
                  url.searchParams.set("title", prefix + fbTitle);
                  url.searchParams.set("body", body);
                  url.searchParams.set("labels", labels);
                  window.open(url.toString(), "_blank");
                  setShowFeedback(false);
                  setFbTitle("");
                  setFbBody("");
                }}
                disabled={!fbTitle.trim()}
                className="px-4 py-2 text-sm text-white bg-3bm-teal rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer"
              >
                Openen op GitHub
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
