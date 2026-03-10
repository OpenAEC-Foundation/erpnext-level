import { useState } from "react";
import {
  FileText, ShoppingCart, FolderKanban, Mail, CheckSquare,
  FileBarChart, ClipboardCheck, Users, CalendarDays, Search,
  TrendingUp, Clock, PieChart, BookOpen, Receipt, Truck, Timer,
  FileSpreadsheet, Wallet, CalendarCheck, Settings, BarChart3,
  ListTodo, LayoutDashboard, UserCheck, Cloud, MessageCircle, ListTree,
  Calendar, ChevronDown, ChevronRight, Landmark, BookMarked, Shield, MessageSquare,
} from "lucide-react";
import { getActiveInstance } from "../lib/instances";

export type Page =
  | "dashboard"
  | "sales" | "purchase" | "quotations" | "salesorders"
  | "projects" | "tasks" | "planning" | "employees"
  | "financieel-dashboard" | "omzet" | "openstaand" | "kosteninzicht" | "jaarrekening"
  | "btw" | "loonaangifte" | "onkosten" | "deliverynotes" | "timesheets"
  | "vakantieplanning" | "todo" | "settings" | "rendabiliteit"
  | "nextcloud-files" | "nextcloud-talk" | "webmail" | "subtasks"
  | "calendar" | "grootboeken" | "banktransacties" | "boekingsprogramma"
  | "wiki" | "passwords" | "messenger";

export type ViewMode = "werkgever" | "werknemer";

/** Pages visible in werknemer mode */
const WERKNEMER_PAGES: Set<Page> = new Set([
  "dashboard", "projects", "tasks", "planning", "timesheets",
  "vakantieplanning", "onkosten", "settings", "webmail", "calendar",
]);

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  onSearchOpen: () => void;
  viewMode: ViewMode;
}

interface NavSection {
  title: string;
  collapsible: boolean;
  items: { id: Page; label: string; icon: typeof FileText }[];
}

const sections: NavSection[] = [
  {
    title: "",
    collapsible: false,
    items: [
      { id: "dashboard", label: "Quick Start", icon: LayoutDashboard },
      { id: "webmail", label: "Email", icon: Mail },
      { id: "messenger", label: "Berichten", icon: MessageSquare },
      { id: "calendar", label: "Agenda", icon: Calendar },
      { id: "nextcloud-files", label: "Bestanden", icon: Cloud },
      { id: "financieel-dashboard", label: "Statistieken", icon: BarChart3 },
    ],
  },
  {
    title: "Projecten",
    collapsible: true,
    items: [
      { id: "projects", label: "Projecten", icon: FolderKanban },
      { id: "quotations", label: "Offertes", icon: FileBarChart },
      { id: "salesorders", label: "Opdrachtbevestigingen", icon: ClipboardCheck },
      { id: "deliverynotes", label: "Delivery Notes", icon: Truck },
    ],
  },
  {
    title: "Taken & Planning",
    collapsible: true,
    items: [
      { id: "tasks", label: "Taken", icon: CheckSquare },
      { id: "subtasks", label: "Subtaken", icon: ListTree },
      { id: "planning", label: "Planning", icon: CalendarDays },
      { id: "timesheets", label: "Timesheets", icon: Timer },
      { id: "todo", label: "Todo", icon: ListTodo },
      { id: "wiki", label: "Wiki", icon: BookOpen },
    ],
  },
  {
    title: "Boekhouding",
    collapsible: true,
    items: [
      { id: "grootboeken", label: "Grootboeken", icon: BookOpen },
      { id: "banktransacties", label: "Banktransacties", icon: Landmark },
      { id: "sales", label: "Verkoopfacturen", icon: FileText },
      { id: "purchase", label: "Inkoopfacturen", icon: ShoppingCart },
      { id: "boekingsprogramma", label: "Boekingsprogramma", icon: BookMarked },
      { id: "btw", label: "BTW-aangifte", icon: FileSpreadsheet },
      { id: "jaarrekening", label: "Jaarrekening", icon: BookOpen },
    ],
  },
  {
    title: "Financieel",
    collapsible: true,
    items: [
      { id: "omzet", label: "Omzet", icon: TrendingUp },
      { id: "openstaand", label: "Openstaand", icon: Clock },
      { id: "kosteninzicht", label: "Kosteninzicht", icon: PieChart },
      { id: "rendabiliteit", label: "Rendabiliteit", icon: UserCheck },
      { id: "loonaangifte", label: "Loonaangifte", icon: Wallet },
    ],
  },
  {
    title: "HR & Personeel",
    collapsible: true,
    items: [
      { id: "employees", label: "Medewerkers", icon: Users },
      { id: "vakantieplanning", label: "Vakantieplanning", icon: CalendarCheck },
      { id: "onkosten", label: "Onkostenvergoedingen", icon: Receipt },
    ],
  },
  {
    title: "",
    collapsible: false,
    items: [
      { id: "passwords", label: "Wachtwoorden", icon: Shield },
      { id: "settings", label: "Instellingen", icon: Settings },
    ],
  },
];

export default function Sidebar({ activePage, onNavigate, onSearchOpen, viewMode }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const filteredSections = viewMode === "werkgever"
    ? sections
    : sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => WERKNEMER_PAGES.has(item.id)),
        }))
        .filter((section) => section.items.length > 0);

  function toggleSection(title: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  }

  // Auto-expand if active page is in a collapsed section
  const activeSection = filteredSections.find((s) => s.items.some((i) => i.id === activePage));
  if (activeSection?.title && collapsed.has(activeSection.title)) {
    collapsed.delete(activeSection.title);
  }

  return (
    <aside className="w-64 bg-3bm-purple-dark text-white flex flex-col h-full flex-shrink-0">
      <div className="p-5 border-b border-3bm-purple-light">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-3bm-teal to-3bm-teal-dark flex items-center justify-center shadow-lg shadow-3bm-teal/20">
            <span className="text-xl font-black text-white tracking-tighter">Y</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-extrabold tracking-tight text-white">Y-app</span>
              <span className="text-[10px] text-3bm-teal-light/50 font-medium">v1.0</span>
            </div>
            <span className="text-[11px] text-3bm-teal-light/70 font-medium">{getActiveInstance().name}</span>
          </div>
        </div>
      </div>

      {/* Search button */}
      <div className="px-3 pt-3">
        <button
          onClick={onSearchOpen}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-3bm-purple text-3bm-teal-light/60 hover:text-white hover:bg-3bm-purple-light transition-colors cursor-pointer"
        >
          <Search size={16} />
          <span className="text-sm flex-1 text-left">Zoeken...</span>
          <kbd className="text-[10px] bg-3bm-purple-light px-1.5 py-0.5 rounded">Ctrl+K</kbd>
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {filteredSections.map((section, idx) => {
          const key = section.title || `section-${idx}`;
          const isCollapsed = section.collapsible && collapsed.has(section.title);

          return (
            <div key={key}>
              {section.title && (
                <button
                  onClick={() => section.collapsible && toggleSection(section.title)}
                  className={`w-full flex items-center gap-1 px-4 py-1.5 mt-2 text-[10px] font-semibold text-3bm-teal/60 uppercase tracking-wider ${
                    section.collapsible ? "hover:text-3bm-teal cursor-pointer" : ""
                  }`}
                >
                  {section.collapsible && (
                    isCollapsed
                      ? <ChevronRight size={12} className="flex-shrink-0" />
                      : <ChevronDown size={12} className="flex-shrink-0" />
                  )}
                  {section.title}
                </button>
              )}
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = activePage === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onNavigate(item.id)}
                        className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                          active
                            ? "bg-3bm-teal text-white"
                            : "text-slate-300 hover:bg-3bm-purple-light hover:text-white"
                        }`}
                      >
                        <Icon size={18} />
                        <span className="font-medium text-sm">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
