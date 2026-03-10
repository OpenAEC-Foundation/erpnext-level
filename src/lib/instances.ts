/**
 * Instance management for the frontend.
 *
 * Instances are defined on the backend (instances.json + vault).
 * The frontend only stores display preferences (active instance, themes).
 * No credentials are stored in the browser.
 */

export interface InstanceTheme {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  sidebar: string;
  sidebarLight: string;
  sidebarDark: string;
}

export interface ERPInstance {
  id: string;
  name: string;
  url: string;
  color: string;
  theme?: InstanceTheme;
}

const ACTIVE_KEY = "erpnext_active_instance";
const INSTANCES_KEY = "erpnext_instances_v2";

/* ─── Built-in themes ─── */

const THEME_3BM: InstanceTheme = {
  primary: "#45b6a8",
  primaryLight: "#6bc9be",
  primaryDark: "#349488",
  sidebar: "#451a44",
  sidebarLight: "#5e2a5c",
  sidebarDark: "#2d0f2c",
};

const THEME_IMPERTIO: InstanceTheme = {
  primary: "#f97316",
  primaryLight: "#fb923c",
  primaryDark: "#ea580c",
  sidebar: "#171717",
  sidebarLight: "#2a2a2a",
  sidebarDark: "#0a0a0a",
};

const THEME_SYMITECH: InstanceTheme = {
  primary: "#3b82f6",
  primaryLight: "#60a5fa",
  primaryDark: "#2563eb",
  sidebar: "#1e293b",
  sidebarLight: "#334155",
  sidebarDark: "#0f172a",
};

const THEME_DOMERA: InstanceTheme = {
  primary: "#8dab9f",
  primaryLight: "#a3bdb2",
  primaryDark: "#6f8f80",
  sidebar: "#332c2f",
  sidebarLight: "#5d424c",
  sidebarDark: "#231e20",
};

const BUILTIN_THEMES: Record<string, InstanceTheme> = {
  "3bm": THEME_3BM,
  impertio: THEME_IMPERTIO,
  symitech: THEME_SYMITECH,
  domera: THEME_DOMERA,
};

const TAB_COLORS = [
  "#45b6a8", "#f97316", "#3b82f6", "#8dab9f",
  "#6366f1", "#e11d48", "#f59e0b", "#8b5cf6",
  "#059669", "#dc2626",
];

/* ─── Instance list (synced from backend) ─── */

let cachedInstances: ERPInstance[] = [];

/** Load instance list from the backend. Called once on app init. */
export async function loadInstancesFromBackend(): Promise<void> {
  try {
    const res = await fetch("/api/instances");
    if (!res.ok) return;
    const { data } = await res.json() as {
      data: { id: string; name: string; url: string }[];
    };
    if (!Array.isArray(data) || data.length === 0) return;

    cachedInstances = data.map((inst, i) => ({
      id: inst.id,
      name: inst.name,
      url: inst.url,
      color: TAB_COLORS[i % TAB_COLORS.length],
      theme: BUILTIN_THEMES[inst.id],
    }));

    // Persist for offline / quick startup
    localStorage.setItem(INSTANCES_KEY, JSON.stringify(cachedInstances));

    // Apply theme for active instance
    applyTheme(getActiveInstance());
  } catch {
    // Backend not available — use cached
  }
}

export function getInstances(): ERPInstance[] {
  if (cachedInstances.length > 0) return cachedInstances;

  // Try localStorage cache
  try {
    const raw = localStorage.getItem(INSTANCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedInstances = parsed;
        return cachedInstances;
      }
    }
  } catch { /* ignore */ }

  // Fallback: default instance
  cachedInstances = [{
    id: "3bm", name: "3BM", url: "https://3bm.prilk.cloud",
    color: TAB_COLORS[0], theme: THEME_3BM,
  }];
  return cachedInstances;
}

/* ─── Active instance ─── */

export function getActiveInstanceId(): string {
  return localStorage.getItem(ACTIVE_KEY) || getInstances()[0]?.id || "3bm";
}

export function getActiveInstance(): ERPInstance {
  const instances = getInstances();
  const activeId = getActiveInstanceId();
  return instances.find((i) => i.id === activeId) || instances[0];
}

export function activateInstance(id: string): void {
  const inst = getInstances().find((i) => i.id === id);
  if (!inst) return;
  localStorage.setItem(ACTIVE_KEY, id);

  // Load instance-specific preferences into standard keys
  const employee = localStorage.getItem(`pref_${id}_employee`) || "";
  const company = localStorage.getItem(`pref_${id}_company`) || "";
  if (employee) localStorage.setItem("erpnext_default_employee", employee);
  else localStorage.removeItem("erpnext_default_employee");
  if (company) localStorage.setItem("erpnext_default_company", company);
  else localStorage.removeItem("erpnext_default_company");

  applyTheme(inst);
}

/* ─── Theme ─── */

export function applyTheme(inst?: ERPInstance): void {
  const theme = inst?.theme || BUILTIN_THEMES[inst?.id || ""] || THEME_3BM;
  const root = document.documentElement;
  root.style.setProperty("--color-3bm-teal", theme.primary);
  root.style.setProperty("--color-3bm-teal-light", theme.primaryLight);
  root.style.setProperty("--color-3bm-teal-dark", theme.primaryDark);
  root.style.setProperty("--color-3bm-purple", theme.sidebar);
  root.style.setProperty("--color-3bm-purple-light", theme.sidebarLight);
  root.style.setProperty("--color-3bm-purple-dark", theme.sidebarDark);
}

/* ─── Known defaults per instance ─── */

const KNOWN_DEFAULTS: Record<string, { employee?: string; company?: string; nextcloud_url?: string; webmail_url?: string }> = {
  "3bm": { employee: "HR-EMP-00003", company: "3BM Bouwtechniek" },
  impertio: { employee: "HR-EMP-00002" },
  symitech: {
    nextcloud_url: "https://symitech-cloud.prilk.cloud",
    webmail_url: "https://symitech-cloud.prilk.cloud/apps/mail/",
  },
  domera: { employee: "HR-EMP-00007" },
};

/* ─── Init ─── */

export function initInstances(): void {
  // Load from localStorage cache first for instant render
  getInstances();

  // Set known defaults if not already configured
  for (const [id, defaults] of Object.entries(KNOWN_DEFAULTS)) {
    if (!localStorage.getItem(`pref_${id}_employee`) && defaults.employee) {
      localStorage.setItem(`pref_${id}_employee`, defaults.employee);
    }
    if (!localStorage.getItem(`pref_${id}_company`) && defaults.company) {
      localStorage.setItem(`pref_${id}_company`, defaults.company);
      localStorage.setItem("erpnext_default_company", defaults.company);
    }
    if (!localStorage.getItem(`pref_${id}_nextcloud_url`) && defaults.nextcloud_url) {
      localStorage.setItem(`pref_${id}_nextcloud_url`, defaults.nextcloud_url);
    }
    if (!localStorage.getItem(`pref_${id}_webmail_url`) && defaults.webmail_url) {
      localStorage.setItem(`pref_${id}_webmail_url`, defaults.webmail_url);
    }
  }

  // Activate current instance (sets preferences + theme)
  activateInstance(getActiveInstanceId());

  // Then async-load from backend
  loadInstancesFromBackend();
}
