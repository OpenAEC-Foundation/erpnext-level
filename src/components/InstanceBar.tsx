import { useState } from "react";
import { Plus, X, Server, Building2, User, MessageSquarePlus, RefreshCw } from "lucide-react";
import {
  getInstances,
  getActiveInstanceId,
  activateInstance,
  addInstance,
  removeInstance,
  type ERPInstance,
} from "../lib/instances";
import type { ViewMode } from "./Sidebar";

const TAB_COLORS = [
  "#0d9488", // teal
  "#6366f1", // indigo
  "#e11d48", // rose
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#059669", // emerald
  "#dc2626", // red
  "#2563eb", // blue
];

interface InstanceBarProps {
  onSwitch: () => void;
  onRefresh?: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export default function InstanceBar({ onSwitch, onRefresh, viewMode, onViewModeChange }: InstanceBarProps) {
  const [instances, setInstances] = useState(getInstances);
  const [activeId, setActiveId] = useState(getActiveInstanceId);
  const [showAdd, setShowAdd] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [fbTitle, setFbTitle] = useState("");
  const [fbBody, setFbBody] = useState("");
  const [fbType, setFbType] = useState<"bug" | "feature" | "question">("bug");
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newSecret, setNewSecret] = useState("");

  function handleSwitch(id: string) {
    if (id === activeId) return;
    activateInstance(id);
    setActiveId(id);
    setInstances(getInstances());
    onSwitch();
  }

  function handleAdd() {
    if (!newName.trim() || !newUrl.trim()) return;
    const id = newName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const color = TAB_COLORS[instances.length % TAB_COLORS.length];
    const inst: ERPInstance = {
      id,
      name: newName.trim(),
      color,
      url: newUrl.trim(),
      apiKey: newKey.trim(),
      apiSecret: newSecret.trim(),
      defaultCompany: "",
      defaultEmployee: "",
      baseDir: "",
    };
    addInstance(inst);
    setInstances(getInstances());
    setNewName("");
    setNewUrl("");
    setNewKey("");
    setNewSecret("");
    setShowAdd(false);
    // Activate it immediately
    handleSwitch(id);
  }

  function handleRemove(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (instances.length <= 1) return;
    removeInstance(id);
    const updated = getInstances();
    setInstances(updated);
    if (id === activeId) {
      setActiveId(updated[0].id);
      onSwitch();
    }
  }

  return (
    <div className="bg-slate-800 flex items-center gap-0 px-2 h-9 flex-shrink-0 relative">
      <Server size={14} className="text-slate-500 mr-2 flex-shrink-0" />

      {instances.map((inst) => {
        const isActive = inst.id === activeId;
        return (
          <button
            key={inst.id}
            onClick={() => handleSwitch(inst.id)}
            className={`group flex items-center gap-1.5 px-3 h-7 rounded-t-md text-xs font-medium transition-colors cursor-pointer relative ${
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
            {instances.length > 1 && (
              <span
                onClick={(e) => handleRemove(e, inst.id)}
                className={`ml-1 rounded-sm hover:bg-slate-300/30 p-0.5 ${
                  isActive ? "text-slate-400" : "text-slate-500 opacity-0 group-hover:opacity-100"
                }`}
              >
                <X size={10} />
              </span>
            )}
          </button>
        );
      })}

      <button
        onClick={() => setShowAdd(true)}
        className="flex items-center gap-1 px-2 h-7 text-xs text-slate-500 hover:text-white hover:bg-slate-700 rounded-md transition-colors cursor-pointer ml-1"
        title="Instance toevoegen"
      >
        <Plus size={12} />
      </button>

      {/* Centered logos */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2.5">
        {/* ERPNext logo */}
        <svg viewBox="0 0 80 18" className="h-4" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="1" width="16" height="16" rx="3" fill="#0089FF" />
          <text x="8" y="13.5" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" fill="white">E</text>
          <text x="22" y="14" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" fill="rgba(255,255,255,0.85)">RPNext</text>
        </svg>
        <span className="text-xs text-slate-500 font-medium">×</span>
        {/* OpenAEC Foundation logo */}
        <svg viewBox="0 0 140 18" className="h-4" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="1" width="16" height="16" rx="3" fill="#10b981" />
          <text x="8" y="13" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="10" fill="white">&#x2B21;</text>
          <text x="22" y="14" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="10.5" fill="rgba(255,255,255,0.75)">OpenAEC Foundation</text>
        </svg>
      </div>

      {/* Refresh + Feedback + View Mode Toggle */}
      <div className="ml-auto flex items-center gap-2">
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

      {/* Add Instance Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-slate-800">ERPNext-instance toevoegen</h3>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Naam *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="bijv. Domera"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">URL *</label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://domera.prilk.cloud"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="API key"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API Secret</label>
              <input
                type="password"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder="API secret"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Annuleren
              </button>
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || !newUrl.trim()}
                className="px-4 py-2 text-sm text-white bg-3bm-teal rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer"
              >
                Toevoegen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
