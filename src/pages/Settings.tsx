import { useState } from "react";
import { Settings, Eye, EyeOff, Save, Wifi, FolderOpen, Building2, ExternalLink } from "lucide-react";
import { useCompanies, useEmployees } from "../lib/DataContext";
import { syncCurrentInstanceBack, getActiveInstance, getActiveInstanceId } from "../lib/instances";
import { getErpNextAppUrl } from "../lib/erpnext";

type SettingsTab = "general" | "companies";

export default function SettingsPage() {
  const companies = useCompanies();
  const allEmployees = useEmployees();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [url, setUrl] = useState(localStorage.getItem("erpnext_url") || "");
  const [apiKey, setApiKey] = useState(localStorage.getItem("erpnext_api_key") || "");
  const [apiSecret, setApiSecret] = useState(localStorage.getItem("erpnext_api_secret") || "");
  const [defaultCompany, setDefaultCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [defaultEmployee, setDefaultEmployee] = useState(localStorage.getItem("erpnext_default_employee") || "HR-EMP-00003");
  const [baseDir, setBaseDir] = useState(() => getActiveInstance().baseDir || "");
  const [showSecret, setShowSecret] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSave() {
    if (url) {
      localStorage.setItem("erpnext_url", url);
    } else {
      localStorage.removeItem("erpnext_url");
    }
    if (apiKey) {
      localStorage.setItem("erpnext_api_key", apiKey);
    } else {
      localStorage.removeItem("erpnext_api_key");
    }
    if (apiSecret) {
      localStorage.setItem("erpnext_api_secret", apiSecret);
    } else {
      localStorage.removeItem("erpnext_api_secret");
    }
    if (defaultCompany) {
      localStorage.setItem("erpnext_default_company", defaultCompany);
    } else {
      localStorage.removeItem("erpnext_default_company");
    }
    if (defaultEmployee) {
      localStorage.setItem("erpnext_default_employee", defaultEmployee);
    } else {
      localStorage.removeItem("erpnext_default_employee");
    }

    // Save baseDir to active instance
    localStorage.setItem("erpnext_base_dir", baseDir);

    // Sync back to active instance
    syncCurrentInstanceBack();

    // Persist credentials to encrypted vault
    if (apiKey && apiSecret && url) {
      try {
        const inst = getActiveInstance();
        await fetch("/api/vault", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: inst.id || getActiveInstanceId(),
            name: inst.name,
            url,
            apiKey,
            apiSecret,
            defaultCompany,
            defaultEmployee,
          }),
        });
      } catch {
        // Vault save failed silently — localStorage still works
      }
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const baseUrl = url || "";
      const key = apiKey;
      const secret = apiSecret;

      if (!key || !secret) {
        setTestResult({ ok: false, message: "Vul eerst je API Key en Secret in." });
        setTesting(false);
        return;
      }

      const res = await fetch(
        `${baseUrl}/api/method/frappe.auth.get_logged_user`,
        {
          headers: {
            Authorization: `token ${key}:${secret}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      if (res.ok) {
        const json = await res.json();
        setTestResult({
          ok: true,
          message: `Verbinding gelukt! Ingelogd als: ${json.message}`,
        });
      } else {
        setTestResult({
          ok: false,
          message: `Verbinding mislukt: HTTP ${res.status}`,
        });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: `Verbinding mislukt: ${e instanceof Error ? e.message : "Onbekende fout"}`,
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-3bm-teal/10 rounded-lg">
          <Settings className="text-3bm-teal" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Instellingen</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {([
          ["general", "Algemeen", Settings],
          ["companies", "Bedrijven", Building2],
        ] as [SettingsTab, string, typeof Settings][]).map(([tab, label, Icon]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
              activeTab === tab
                ? "border-3bm-teal text-3bm-teal"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "companies" && (
        <div className="max-w-4xl">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-700">Bedrijven in ERPNext</h3>
              <a
                href={`${getErpNextAppUrl()}/app/company`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-3bm-teal hover:text-3bm-teal-dark"
              >
                <ExternalLink size={14} /> Beheren in ERPNext
              </a>
            </div>
            {companies.length === 0 ? (
              <div className="px-6 py-12 text-center text-slate-400">Geen bedrijven gevonden</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600">Bedrijf</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600">Afkorting</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600">Medewerkers</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-600"></th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => {
                    const empCount = allEmployees.filter((e) => e.company === c.name && e.status === "Active").length;
                    return (
                      <tr key={c.name} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-6 py-3 text-sm font-medium text-slate-700">{c.company_name || c.name}</td>
                        <td className="px-6 py-3 text-sm text-slate-500 font-mono">{c.abbr}</td>
                        <td className="px-6 py-3 text-sm text-slate-500">{empCount} actief</td>
                        <td className="px-6 py-3 text-right">
                          <a
                            href={`${getErpNextAppUrl()}/app/company/${encodeURIComponent(c.name)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-3bm-teal hover:text-3bm-teal-dark"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === "general" && <>
      {/* Current connection banner */}
      <div className="max-w-2xl mb-6 bg-gradient-to-r from-3bm-purple-dark to-3bm-purple rounded-xl p-4 text-white">
        <p className="text-sm font-medium text-3bm-teal-light/80 mb-1">Verbonden met</p>
        <p className="text-lg font-bold font-mono">{url || "(proxy / localhost)"}</p>
        <p className="text-sm text-white/60 mt-1">
          Standaard bedrijf: <span className="text-white/80">{defaultCompany || "Alle bedrijven"}</span>
          {defaultEmployee && (
            <> · Medewerker: <span className="text-white/80">{allEmployees.find(e => e.name === defaultEmployee)?.employee_name || defaultEmployee}</span></>
          )}
        </p>
      </div>

      <div className="max-w-2xl bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
        {/* ERPNext Instance URL */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            ERPNext Instance URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://jouw-instance.erpnext.com"
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm"
          />
          <p className="text-xs text-slate-400 mt-1">
            Laat leeg om de standaard proxy te gebruiken (dev mode).
          </p>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Je ERPNext API key"
              className="w-full px-4 py-2.5 pr-12 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* API Secret */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            API Secret
          </label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Je ERPNext API secret"
              className="w-full px-4 py-2.5 pr-12 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Default Company - from ERPNext */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            Standaard bedrijf
          </label>
          <select
            value={defaultCompany}
            onChange={(e) => setDefaultCompany(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm cursor-pointer"
          >
            <option value="">Alle bedrijven</option>
            {companies.map((c) => (
              <option key={c.name} value={c.name}>
                {c.company_name || c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Bedrijven worden automatisch uit ERPNext geladen.
          </p>
        </div>

        {/* Default Employee */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            Standaard medewerker
          </label>
          <select
            value={defaultEmployee}
            onChange={(e) => setDefaultEmployee(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm cursor-pointer"
          >
            <option value="">Geen standaard</option>
            {allEmployees
              .filter((e) => e.status === "Active")
              .map((e) => (
                <option key={e.name} value={e.name}>
                  {e.employee_name} ({e.name})
                </option>
              ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Wordt automatisch ingevuld bij uren boeken.
          </p>
        </div>

        {/* AI Agent base directory */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            <span className="flex items-center gap-1.5">
              <FolderOpen size={14} />
              AI Agent basismap
            </span>
          </label>
          <input
            type="text"
            value={baseDir}
            onChange={(e) => setBaseDir(e.target.value)}
            placeholder="C:\Users\...\mijn-project"
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-3bm-teal text-sm font-mono"
          />
          <p className="text-xs text-slate-400 mt-1">
            De werkmap waarin de AI Assistent draait. Claude Code heeft dan toegang tot bestanden in deze map.
          </p>
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={`p-4 rounded-lg text-sm ${
              testResult.ok
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}
          >
            {testResult.message}
          </div>
        )}

        {/* Saved confirmation */}
        {saved && (
          <div className="p-4 rounded-lg text-sm bg-3bm-teal/10 border border-3bm-teal/20 text-3bm-teal-dark">
            Instellingen opgeslagen!
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-3bm-teal text-3bm-teal rounded-lg hover:bg-3bm-teal/5 disabled:opacity-50 text-sm font-medium cursor-pointer"
          >
            <Wifi size={16} className={testing ? "animate-pulse" : ""} />
            {testing ? "Testen..." : "Test verbinding"}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2.5 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark text-sm font-medium cursor-pointer"
          >
            <Save size={16} />
            Opslaan
          </button>
        </div>

        {/* Current configuration */}
        <div className="border-t border-slate-200 pt-6 mt-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Huidige configuratie</h3>
          <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Instance URL:</span>
              <span className="text-slate-700 font-mono">{url || "(standaard proxy)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">API Key:</span>
              <span className="text-slate-700 font-mono">{apiKey || "(niet ingesteld)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">API Secret:</span>
              <span className="text-slate-700 font-mono">{apiSecret ? `${apiSecret.slice(0, 4)}${"*".repeat(Math.max(0, apiSecret.length - 4))}` : "(niet ingesteld)"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Standaard bedrijf:</span>
              <span className="text-slate-700">{defaultCompany || "Alle bedrijven"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Standaard medewerker:</span>
              <span className="text-slate-700">{defaultEmployee ? allEmployees.find(e => e.name === defaultEmployee)?.employee_name || defaultEmployee : "(niet ingesteld)"}</span>
            </div>
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
