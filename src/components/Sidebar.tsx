import {
  FileText, ShoppingCart, FolderKanban, Mail, CheckSquare,
  FileBarChart, ClipboardCheck, Users, CalendarDays, Search,
  TrendingUp, Clock, PieChart, BookOpen, Receipt, Truck, Timer,
  FileSpreadsheet, Wallet, CalendarCheck, Settings, BarChart3,
  ListTodo, LayoutDashboard, UserCheck,
} from "lucide-react";
import { getActiveInstance } from "../lib/instances";

export type Page =
  | "dashboard"
  | "sales" | "purchase" | "quotations" | "salesorders"
  | "projects" | "tasks" | "planning" | "employees" | "email"
  | "financieel-dashboard" | "omzet" | "openstaand" | "kosteninzicht" | "jaarrekening"
  | "btw" | "loonaangifte" | "onkosten" | "deliverynotes" | "timesheets"
  | "vakantieplanning" | "todo" | "settings" | "rendabiliteit";

export type ViewMode = "werkgever" | "werknemer";

/** Pages visible in werknemer mode */
const WERKNEMER_PAGES: Set<Page> = new Set([
  "dashboard", "projects", "tasks", "planning", "timesheets",
  "vakantieplanning", "onkosten", "settings",
]);

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  onSearchOpen: () => void;
  viewMode: ViewMode;
}

interface NavSection {
  title: string;
  items: { id: Page; label: string; icon: typeof FileText }[];
}

const sections: NavSection[] = [
  {
    title: "",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Projecten",
    items: [
      { id: "projects", label: "Projecten", icon: FolderKanban },
      { id: "salesorders", label: "Opdrachtbevestigingen", icon: ClipboardCheck },
      { id: "tasks", label: "Taken", icon: CheckSquare },
      { id: "planning", label: "Planning", icon: CalendarDays },
      { id: "timesheets", label: "Timesheets", icon: Timer },
    ],
  },
  {
    title: "Verkoop & Inkoop",
    items: [
      { id: "sales", label: "Verkoopfacturen", icon: FileText },
      { id: "purchase", label: "Inkoopfacturen", icon: ShoppingCart },
      { id: "quotations", label: "Offertes", icon: FileBarChart },
      { id: "deliverynotes", label: "Delivery Notes", icon: Truck },
    ],
  },
  {
    title: "Financieel",
    items: [
      { id: "financieel-dashboard", label: "Dashboard", icon: BarChart3 },
      { id: "omzet", label: "Omzet", icon: TrendingUp },
      { id: "openstaand", label: "Openstaand", icon: Clock },
      { id: "kosteninzicht", label: "Kosteninzicht", icon: PieChart },
      { id: "jaarrekening", label: "Jaarrekening", icon: BookOpen },
      { id: "btw", label: "BTW-aangifte", icon: FileSpreadsheet },
      { id: "loonaangifte", label: "Loonaangifte", icon: Wallet },
      { id: "rendabiliteit", label: "Rendabiliteit", icon: UserCheck },
    ],
  },
  {
    title: "Overig",
    items: [
      { id: "employees", label: "Medewerkers", icon: Users },
      { id: "vakantieplanning", label: "Vakantieplanning", icon: CalendarCheck },
      { id: "onkosten", label: "Onkostenvergoedingen", icon: Receipt },
      { id: "todo", label: "Todo", icon: ListTodo },
      { id: "email", label: "Email", icon: Mail },
      { id: "settings", label: "Instellingen", icon: Settings },
    ],
  },
];

export default function Sidebar({ activePage, onNavigate, onSearchOpen, viewMode }: SidebarProps) {
  const filteredSections = viewMode === "werkgever"
    ? sections
    : sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => WERKNEMER_PAGES.has(item.id)),
        }))
        .filter((section) => section.items.length > 0);

  return (
    <aside className="w-64 bg-3bm-purple-dark text-white flex flex-col h-full flex-shrink-0">
      <div className="p-5 border-b border-3bm-purple-light">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-extrabold tracking-tight text-3bm-teal">{getActiveInstance().name}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-3bm-teal-light/40">powered by</span>
          <span className="text-[10px] font-semibold text-3bm-teal-light/60">ERPNext Level</span>
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

      <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
        {filteredSections.map((section) => (
          <div key={section.title}>
            {section.title && (
              <p className="px-4 py-1 text-[10px] font-semibold text-3bm-teal/60 uppercase tracking-wider">
                {section.title}
              </p>
            )}
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
