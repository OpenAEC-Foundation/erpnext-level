import { useState, useEffect, useCallback } from "react";
import Sidebar, { type Page, type ViewMode } from "./components/Sidebar";
import InstanceBar from "./components/InstanceBar";
import GlobalSearch from "./components/GlobalSearch";
import AgentPanel from "./components/AgentPanel";

import { DataProvider } from "./lib/DataContext";
import { getActiveInstanceId } from "./lib/instances";
import SalesInvoices from "./pages/SalesInvoices";
import PurchaseInvoices from "./pages/PurchaseInvoices";
import Quotations from "./pages/Quotations";
import SalesOrders from "./pages/SalesOrders";
import Projects from "./pages/Projects";
import Tasks from "./pages/Tasks";
import Planning from "./pages/Planning";
import Employees from "./pages/Employees";
import Omzet from "./pages/Omzet";
import Openstaand from "./pages/Openstaand";
import Kosteninzicht from "./pages/Kosteninzicht";
import Jaarrekening from "./pages/Jaarrekening";
import BTW from "./pages/BTW";
import Loonaangifte from "./pages/Loonaangifte";
import Onkosten from "./pages/Onkosten";
import DeliveryNotes from "./pages/DeliveryNotes";
import Timesheets from "./pages/Timesheets";
import Vakantieplanning from "./pages/Vakantieplanning";
import SettingsPage from "./pages/Settings";
import Todo from "./pages/Todo";
import FinancieelDashboard from "./pages/FinancieelDashboard";
import Dashboard from "./pages/Dashboard";
import Rendabiliteit from "./pages/Rendabiliteit";
import NextCloudFiles from "./pages/NextCloudFiles";
import NextCloudTalk from "./pages/NextCloudTalk";
import Webmail from "./pages/Webmail";
import Subtasks from "./pages/Subtasks";
import Grootboeken from "./pages/Grootboeken";
import Banktransacties from "./pages/Banktransacties";
import Boekingsprogramma from "./pages/Boekingsprogramma";
import Wiki from "./pages/Wiki";
import Agenda from "./pages/Agenda";
import Passwords from "./pages/Passwords";
import Messenger from "./pages/Messenger";

function App() {
  const [page, _setPage] = useState<Page>(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("page");
    if (p) return p as Page;
    return "dashboard";
  });

  // Wrap setPage to also update the URL
  const setPage = useCallback((p: Page) => {
    _setPage(p);
    const url = new URL(window.location.href);
    if (p === "dashboard") {
      url.searchParams.delete("page");
    } else {
      url.searchParams.set("page", p);
    }
    window.history.pushState({}, "", url.toString());
  }, []);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("view_mode") as ViewMode) || "werkgever"
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [instanceKey, setInstanceKey] = useState(getActiveInstanceId);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      setSearchOpen((open) => !open);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const p = params.get("page");
      _setPage((p || "dashboard") as Page);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function handleInstanceSwitch() {
    setInstanceKey(getActiveInstanceId());
    setPage("dashboard");
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("view_mode", mode);
    setPage("dashboard");
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      <DataProvider key={instanceKey}>
        <InstanceBar
          onSwitch={handleInstanceSwitch}
          onRefresh={() => setInstanceKey(getActiveInstanceId() + "-" + Date.now())}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />
        <div className="flex flex-1 min-h-0">
          <Sidebar
            activePage={page}
            onNavigate={setPage}
            onSearchOpen={() => setSearchOpen(true)}
            viewMode={viewMode}
          />
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <main className="flex-1 overflow-auto">
              {page === "dashboard" && <Dashboard onNavigate={setPage} viewMode={viewMode} />}
              {page === "sales" && <SalesInvoices />}
              {page === "purchase" && <PurchaseInvoices />}
              {page === "quotations" && <Quotations />}
              {page === "salesorders" && <SalesOrders />}
              {page === "projects" && <Projects />}
              {page === "tasks" && <Tasks />}
              {page === "subtasks" && <Subtasks />}
              {page === "planning" && <Planning />}
              {page === "calendar" && <Agenda />}
              {page === "employees" && <Employees />}
              {page === "financieel-dashboard" && <FinancieelDashboard />}
              {page === "omzet" && <Omzet />}
              {page === "openstaand" && <Openstaand />}
              {page === "kosteninzicht" && <Kosteninzicht />}
              {page === "jaarrekening" && <Jaarrekening />}
              {page === "btw" && <BTW />}
              {page === "loonaangifte" && <Loonaangifte />}
              {page === "onkosten" && <Onkosten />}
              {page === "deliverynotes" && <DeliveryNotes />}
              {page === "timesheets" && <Timesheets />}
              {page === "vakantieplanning" && <Vakantieplanning />}
              {page === "rendabiliteit" && <Rendabiliteit />}
              {page === "webmail" && <Webmail />}
              {page === "nextcloud-files" && <NextCloudFiles />}
              {page === "nextcloud-talk" && <NextCloudTalk />}
              {page === "grootboeken" && <Grootboeken />}
              {page === "banktransacties" && <Banktransacties />}
              {page === "boekingsprogramma" && <Boekingsprogramma />}
              {page === "settings" && <SettingsPage />}
              {page === "todo" && <Todo />}
              {page === "wiki" && <Wiki />}
              {page === "passwords" && <Passwords />}
              {page === "messenger" && <Messenger />}
            </main>
          </div>
          {viewMode === "werkgever" && <AgentPanel />}

          {searchOpen && (
            <GlobalSearch
              onNavigate={setPage}
              onClose={() => setSearchOpen(false)}
            />
          )}
        </div>
      </DataProvider>
    </div>
  );
}

export default App;
