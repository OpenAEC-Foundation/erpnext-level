import { useState, useEffect, useRef, useCallback } from "react";
import { fetchList } from "../lib/erpnext";
import {
  Search, X, FileText, ShoppingCart, FileBarChart,
  ClipboardCheck, FolderKanban, CheckSquare, Users, Loader2,
  CalendarCheck,
} from "lucide-react";
import type { Page } from "./Sidebar";

interface SearchResult {
  doctype: string;
  name: string;
  label: string;
  description: string;
  page: Page;
  icon: typeof FileText;
}

interface GlobalSearchProps {
  onNavigate: (page: Page) => void;
  onClose: () => void;
}

const searchTargets: {
  doctype: string;
  page: Page;
  icon: typeof FileText;
  labelField: string;
  descField: string;
  label: string;
}[] = [
  { doctype: "Sales Invoice", page: "sales", icon: FileText, labelField: "name", descField: "customer_name", label: "Verkoopfactuur" },
  { doctype: "Purchase Invoice", page: "purchase", icon: ShoppingCart, labelField: "name", descField: "supplier_name", label: "Inkoopfactuur" },
  { doctype: "Quotation", page: "quotations", icon: FileBarChart, labelField: "name", descField: "party_name", label: "Offerte" },
  { doctype: "Sales Order", page: "salesorders", icon: ClipboardCheck, labelField: "name", descField: "customer_name", label: "Opdrachtbevestiging" },
  { doctype: "Project", page: "projects", icon: FolderKanban, labelField: "name", descField: "project_name", label: "Project" },
  { doctype: "Task", page: "tasks", icon: CheckSquare, labelField: "name", descField: "subject", label: "Taak" },
  { doctype: "Employee", page: "employees", icon: Users, labelField: "name", descField: "employee_name", label: "Medewerker" },
  { doctype: "Leave Application", page: "vakantieplanning", icon: CalendarCheck, labelField: "name", descField: "employee_name", label: "Verlofaanvraag" },
];

export default function GlobalSearch({ onNavigate, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const promises = searchTargets.map(async (target) => {
        try {
          const orFilters = `["${target.labelField}","like","%${q}%"]`;
          const descFilter = `["${target.descField}","like","%${q}%"]`;

          // Search by name/id
          const byName = await fetchList<Record<string, string>>(target.doctype, {
            fields: [target.labelField, target.descField],
            filters: [[target.labelField, "like", `%${q}%`]],
            limit_page_length: 5,
          });

          // Search by description field
          const byDesc = await fetchList<Record<string, string>>(target.doctype, {
            fields: [target.labelField, target.descField],
            filters: [[target.descField, "like", `%${q}%`]],
            limit_page_length: 5,
          });

          // Merge and deduplicate
          const seen = new Set<string>();
          const merged: SearchResult[] = [];
          for (const item of [...byName, ...byDesc]) {
            const name = item[target.labelField];
            if (seen.has(name)) continue;
            seen.add(name);
            merged.push({
              doctype: target.label,
              name,
              label: name,
              description: item[target.descField] || "",
              page: target.page,
              icon: target.icon,
            });
          }
          return merged;
        } catch {
          return [];
        }
      });

      const allResults = (await Promise.all(promises)).flat();
      setResults(allResults.slice(0, 30));
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timerRef.current);
  }, [query, doSearch]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      onNavigate(results[selectedIndex].page);
      onClose();
    }
  }

  function handleSelect(result: SearchResult) {
    onNavigate(result.page);
    onClose();
  }

  // Group results by doctype
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.doctype]) acc[r.doctype] = [];
    acc[r.doctype].push(r);
    return acc;
  }, {});

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-slate-200">
          <Search size={20} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Zoek op factuur, offerte, project, taak, medewerker..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 py-4 text-base outline-none placeholder:text-slate-400"
          />
          {loading && <Loader2 size={18} className="text-slate-400 animate-spin" />}
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded cursor-pointer">
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {query.length < 2 ? (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              Typ minimaal 2 tekens om te zoeken...
            </div>
          ) : !loading && results.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              Geen resultaten gevonden voor "{query}"
            </div>
          ) : (
            Object.entries(grouped).map(([doctype, items]) => (
              <div key={doctype}>
                <div className="px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide sticky top-0">
                  {doctype}
                </div>
                {items.map((result) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const Icon = result.icon;
                  return (
                    <button
                      key={`${result.doctype}-${result.name}`}
                      onClick={() => handleSelect(result)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                        idx === selectedIndex ? "bg-3bm-teal/10" : "hover:bg-slate-50"
                      }`}
                    >
                      <Icon size={18} className="text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">{result.label}</p>
                        {result.description && (
                          <p className="text-xs text-slate-500 truncate">{result.description}</p>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {result.doctype}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center gap-4 text-xs text-slate-400">
          <span><kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px]">↑↓</kbd> navigeren</span>
          <span><kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px]">Enter</kbd> openen</span>
          <span><kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px]">Esc</kbd> sluiten</span>
        </div>
      </div>
    </div>
  );
}
