import { useState, useEffect } from "react";
import { Settings, Save, Building2, ExternalLink, Shield, CheckCircle, XCircle, Key, Eye, EyeOff, Mail, Cloud, Wifi } from "lucide-react";
import { useCompanies, useEmployees } from "../lib/DataContext";
import { getActiveInstance, getActiveInstanceId } from "../lib/instances";
import { getErpNextLinkUrl } from "../lib/erpnext";

type SettingsTab = "general" | "companies" | "credentials" | "status";

interface VaultEntry {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  apiSecret: string;
}

export default function SettingsPage() {
  const companies = useCompanies();
  const allEmployees = useEmployees();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const activeInstance = getActiveInstance();

  const instanceId = getActiveInstanceId();

  const [defaultCompany, setDefaultCompany] = useState(
    () => localStorage.getItem(`pref_${instanceId}_company`) || ""
  );
  const [defaultEmployee, setDefaultEmployee] = useState(
    () => localStorage.getItem(`pref_${instanceId}_employee`) || ""
  );
  // NextCloud
  const [nextcloudUrl, setNextcloudUrl] = useState(
    () => localStorage.getItem(`pref_${instanceId}_nextcloud_url`) || ""
  );
  // IMAP
  const [imapHost, setImapHost] = useState(() => localStorage.getItem(`pref_${instanceId}_imap_host`) || "");
  const [imapPort, setImapPort] = useState(() => localStorage.getItem(`pref_${instanceId}_imap_port`) || "993");
  const [imapUser, setImapUser] = useState(() => localStorage.getItem(`pref_${instanceId}_imap_user`) || "");
  const [imapPass, setImapPass] = useState(() => localStorage.getItem(`pref_${instanceId}_imap_pass`) || "");
  const [imapSecure, setImapSecure] = useState(() => localStorage.getItem(`pref_${instanceId}_imap_secure`) !== "false");
  const [showImapPass, setShowImapPass] = useState(false);
  const [imapTesting, setImapTesting] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [saved, setSaved] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<Record<string, unknown> | null>(null);
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [editingVault, setEditingVault] = useState<VaultEntry | null>(null);
  const [vaultSaved, setVaultSaved] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setCacheStatus)
      .catch(() => {});
    fetch("/api/vault")
      .then((r) => r.json())
      .then((d) => setVaultEntries(d.data || []))
      .catch(() => {});
  }, []);

  async function handleTestImap() {
    setImapTesting(true);
    setImapTestResult(null);
    try {
      const params = new URLSearchParams({
        host: imapHost, port: imapPort, user: imapUser, pass: imapPass, secure: String(imapSecure),
      });
      const res = await fetch(`/api/mail/test?${params}`);
      const data = await res.json();
      setImapTestResult({ ok: data.ok, message: data.message || data.error });
    } catch (err) {
      setImapTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setImapTesting(false);
    }
  }

  function handleSave() {
    const id = getActiveInstanceId();
    if (defaultCompany) {
      localStorage.setItem(`pref_${id}_company`, defaultCompany);
      localStorage.setItem("erpnext_default_company", defaultCompany);
    } else {
      localStorage.removeItem(`pref_${id}_company`);
      localStorage.removeItem("erpnext_default_company");
    }
    if (defaultEmployee) {
      localStorage.setItem(`pref_${id}_employee`, defaultEmployee);
      localStorage.setItem("erpnext_default_employee", defaultEmployee);
    } else {
      localStorage.removeItem(`pref_${id}_employee`);
      localStorage.removeItem("erpnext_default_employee");
    }
    // NextCloud
    const cleanNcUrl = nextcloudUrl.replace(/\/+$/, "");
    if (cleanNcUrl) {
      localStorage.setItem(`pref_${id}_nextcloud_url`, cleanNcUrl);
    } else {
      localStorage.removeItem(`pref_${id}_nextcloud_url`);
    }
    // IMAP
    if (imapHost) localStorage.setItem(`pref_${id}_imap_host`, imapHost); else localStorage.removeItem(`pref_${id}_imap_host`);
    localStorage.setItem(`pref_${id}_imap_port`, imapPort || "993");
    if (imapUser) localStorage.setItem(`pref_${id}_imap_user`, imapUser); else localStorage.removeItem(`pref_${id}_imap_user`);
    if (imapPass) localStorage.setItem(`pref_${id}_imap_pass`, imapPass); else localStorage.removeItem(`pref_${id}_imap_pass`);
    localStorage.setItem(`pref_${id}_imap_secure`, String(imapSecure));

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-3bm-teal/10 rounded-lg">
          <Settings className="text-3bm-teal" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Instellingen</h2>
        <span className="ml-2 text-sm text-slate-500">
          Instance: <strong>{activeInstance.name}</strong>
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {([
          ["general", "Algemeen", Settings],
          ["companies", "Bedrijven", Building2],
          ["credentials", "Credentials", Key],
          ["status", "Backend Status", Shield],
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
                href={`${getErpNextLinkUrl()}/company`}
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
                            href={`${getErpNextLinkUrl()}/company/${encodeURIComponent(c.name)}`}
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

      {activeTab === "credentials" && (
        <div className="max-w-4xl space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-700">Encrypted Vault</h3>
              <p className="text-xs text-slate-400 mt-1">
                Credentials worden versleuteld opgeslagen op de server (AES-256-GCM).
              </p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600">Instance</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600">URL</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600">API Key</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-600">API Secret</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-600"></th>
                </tr>
              </thead>
              <tbody>
                {vaultEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-6 py-3 text-sm font-medium text-slate-700">{entry.name}</td>
                    <td className="px-6 py-3 text-sm text-slate-500 font-mono text-xs">{entry.url}</td>
                    <td className="px-6 py-3 text-sm text-slate-500 font-mono text-xs">{entry.apiKey}</td>
                    <td className="px-6 py-3 text-sm text-slate-500 font-mono text-xs">
                      <button
                        onClick={() => setShowSecrets((s) => ({ ...s, [entry.id]: !s[entry.id] }))}
                        className="flex items-center gap-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showSecrets[entry.id] ? (
                          <><EyeOff size={12} /> {entry.apiSecret}</>
                        ) : (
                          <><Eye size={12} /> ********</>
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => setEditingVault(entry)}
                        className="text-xs text-3bm-teal hover:text-3bm-teal-dark cursor-pointer"
                      >
                        Bewerken
                      </button>
                    </td>
                  </tr>
                ))}
                {vaultEntries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                      Geen credentials in vault. Voeg instances toe via de backend config.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {vaultSaved && (
            <div className="p-4 rounded-lg text-sm bg-3bm-teal/10 border border-3bm-teal/20 text-3bm-teal-dark">
              Credentials opgeslagen in encrypted vault!
            </div>
          )}

          {/* Edit vault entry modal */}
          {editingVault && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setEditingVault(null)} />
              <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
                <h3 className="text-lg font-semibold text-slate-800">
                  Credentials: {editingVault.name}
                </h3>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
                  <input
                    type="url"
                    value={editingVault.url}
                    onChange={(e) => setEditingVault({ ...editingVault, url: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                  <input
                    type="text"
                    value={editingVault.apiKey}
                    onChange={(e) => setEditingVault({ ...editingVault, apiKey: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">API Secret</label>
                  <input
                    type="password"
                    value={editingVault.apiSecret}
                    onChange={(e) => setEditingVault({ ...editingVault, apiSecret: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-3bm-teal"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setEditingVault(null)}
                    className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Annuleren
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await fetch("/api/vault", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(editingVault),
                        });
                        setEditingVault(null);
                        setVaultSaved(true);
                        setTimeout(() => setVaultSaved(false), 2500);
                        // Reload vault entries
                        const res = await fetch("/api/vault");
                        const d = await res.json();
                        setVaultEntries(d.data || []);
                      } catch { /* ignore */ }
                    }}
                    className="px-4 py-2 text-sm text-white bg-3bm-teal rounded-lg hover:bg-3bm-teal-dark cursor-pointer"
                  >
                    Opslaan in Vault
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "status" && (
        <div className="max-w-4xl space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-700 mb-4">Cache Status</h3>
            {cacheStatus ? (
              <div className="space-y-4">
                {Object.entries((cacheStatus as { instances: Record<string, Record<string, unknown>> }).instances || {}).map(([id, info]) => (
                  <div key={id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      {(info as { ready: boolean }).ready ? (
                        <CheckCircle size={16} className="text-green-500" />
                      ) : (
                        <XCircle size={16} className="text-amber-500" />
                      )}
                      <span className="font-semibold text-slate-700">
                        {(info as { name: string }).name || id}
                      </span>
                      <span className="text-xs text-slate-400">({id})</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {Object.entries((info as { doctypes: Record<string, { count: number; lastSync: string | null }> }).doctypes || {}).map(([dt, dtInfo]) => (
                        <div key={dt} className="bg-slate-50 rounded p-2">
                          <div className="text-xs font-medium text-slate-600">{dt}</div>
                          <div className="text-lg font-bold text-slate-800">{dtInfo.count}</div>
                          {dtInfo.lastSync && (
                            <div className="text-[10px] text-slate-400">
                              {new Date(dtInfo.lastSync).toLocaleTimeString("nl-NL")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400">Backend niet bereikbaar</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "general" && (
        <div className="max-w-2xl space-y-6">
          {/* Connection info */}
          <div className="bg-gradient-to-r from-3bm-purple-dark to-3bm-purple rounded-xl p-4 text-white">
            <p className="text-sm font-medium text-3bm-teal-light/80 mb-1">Verbonden met</p>
            <p className="text-lg font-bold font-mono">{activeInstance.url}</p>
            <p className="text-xs text-white/50 mt-2">
              Credentials worden beheerd via de encrypted vault op de server.
              Instances worden geconfigureerd in <code className="bg-white/10 px-1 rounded">~/.erpnext-level/</code>
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
            {/* Default Company */}
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
            </div>

            {/* Saved confirmation */}
            {saved && (
              <div className="p-4 rounded-lg text-sm bg-3bm-teal/10 border border-3bm-teal/20 text-3bm-teal-dark">
                Instellingen opgeslagen!
              </div>
            )}

            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2.5 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark text-sm font-medium cursor-pointer"
            >
              <Save size={16} />
              Opslaan
            </button>
          </div>

          {/* NextCloud */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Cloud size={20} className="text-blue-500" />
              <h3 className="text-base font-semibold text-slate-700">NextCloud</h3>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">NextCloud URL</label>
              <input
                type="url"
                value={nextcloudUrl}
                onChange={(e) => setNextcloudUrl(e.target.value)}
                placeholder="https://cloud.example.com"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">Basis-URL van de NextCloud instance (zonder trailing slash)</p>
            </div>
          </div>

          {/* IMAP / E-mail */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Mail size={20} className="text-rose-500" />
              <h3 className="text-base font-semibold text-slate-700">E-mail (IMAP)</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">IMAP Server</label>
                <input
                  type="text" value={imapHost}
                  onChange={(e) => setImapHost(e.target.value)}
                  placeholder="imap.example.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Poort</label>
                <input
                  type="text" value={imapPort}
                  onChange={(e) => setImapPort(e.target.value)}
                  placeholder="993"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Gebruikersnaam</label>
              <input
                type="text" value={imapUser}
                onChange={(e) => setImapUser(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Wachtwoord</label>
              <div className="relative">
                <input
                  type={showImapPass ? "text" : "password"} value={imapPass}
                  onChange={(e) => setImapPass(e.target.value)}
                  placeholder="Wachtwoord"
                  className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <button onClick={() => setShowImapPass(!showImapPass)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                  {showImapPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={imapSecure}
                onChange={(e) => setImapSecure(e.target.checked)}
                className="rounded border-slate-300"
              />
              SSL/TLS (aanbevolen)
            </label>

            {imapTestResult && (
              <div className={`p-3 rounded-lg text-sm ${imapTestResult.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                {imapTestResult.message}
              </div>
            )}

            <button onClick={handleTestImap} disabled={imapTesting || !imapHost || !imapUser || !imapPass}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-rose-300 text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-50 text-sm font-medium cursor-pointer">
              <Wifi size={14} className={imapTesting ? "animate-pulse" : ""} />
              {imapTesting ? "Testen..." : "Test verbinding"}
            </button>
          </div>

          {/* Save all button (bottom) */}
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2.5 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark text-sm font-medium cursor-pointer"
          >
            <Save size={16} />
            Alles opslaan
          </button>
        </div>
      )}
    </div>
  );
}
