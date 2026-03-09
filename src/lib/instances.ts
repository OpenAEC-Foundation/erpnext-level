export interface InstanceTheme {
  primary: string;       // main accent (buttons, links, highlights)
  primaryLight: string;
  primaryDark: string;
  sidebar: string;       // sidebar background
  sidebarLight: string;
  sidebarDark: string;
}

export interface ERPInstance {
  id: string;
  name: string;
  color: string;
  url: string;
  apiKey: string;
  apiSecret: string;
  defaultCompany: string;
  defaultEmployee: string;
  baseDir: string;
  theme?: InstanceTheme;
}

const STORAGE_KEY = "erpnext_instances";
const ACTIVE_KEY = "erpnext_active_instance";

const THEME_3BM: InstanceTheme = {
  primary: "#45b6a8",       // teal
  primaryLight: "#6bc9be",
  primaryDark: "#349488",
  sidebar: "#451a44",       // purple
  sidebarLight: "#5e2a5c",
  sidebarDark: "#2d0f2c",
};

const THEME_IMPERTIO: InstanceTheme = {
  primary: "#f97316",       // orange
  primaryLight: "#fb923c",
  primaryDark: "#ea580c",
  sidebar: "#171717",       // black/near-black
  sidebarLight: "#2a2a2a",
  sidebarDark: "#0a0a0a",
};

const THEME_SYMITECH: InstanceTheme = {
  primary: "#3b82f6",       // blue
  primaryLight: "#60a5fa",
  primaryDark: "#2563eb",
  sidebar: "#1e293b",       // slate-dark
  sidebarLight: "#334155",
  sidebarDark: "#0f172a",
};

const DEFAULT_INSTANCE: ERPInstance = {
  id: "3bm",
  name: "3BM",
  color: "#45b6a8",
  url: "https://3bm.prilk.cloud",
  apiKey: "",
  apiSecret: "",
  defaultCompany: "",
  defaultEmployee: "",
  baseDir: "",
  theme: THEME_3BM,
};

export function getInstances(): ERPInstance[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  // Initialize with empty default — user configures via Settings or InstanceBar
  const instances = [DEFAULT_INSTANCE];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(instances));
  return instances;
}

export function saveInstances(instances: ERPInstance[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(instances));
}

export function getActiveInstanceId(): string {
  return localStorage.getItem(ACTIVE_KEY) || getInstances()[0]?.id || "3bm";
}

export function getActiveInstance(): ERPInstance {
  const instances = getInstances();
  const activeId = getActiveInstanceId();
  return instances.find((i) => i.id === activeId) || instances[0] || DEFAULT_INSTANCE;
}

/** Activate an instance: write its credentials to the standard localStorage keys
 *  so all existing code (erpnext.ts, Settings, etc.) keeps working. */
export function activateInstance(id: string): void {
  // First, save current instance's credentials back (in case Settings page changed them)
  syncCurrentInstanceBack();

  const instances = getInstances();
  const inst = instances.find((i) => i.id === id);
  if (!inst) return;

  localStorage.setItem(ACTIVE_KEY, id);

  // Write to standard keys
  localStorage.setItem("erpnext_url", inst.url);
  localStorage.setItem("erpnext_api_key", inst.apiKey);
  localStorage.setItem("erpnext_api_secret", inst.apiSecret);
  if (inst.defaultCompany) {
    localStorage.setItem("erpnext_default_company", inst.defaultCompany);
  } else {
    localStorage.removeItem("erpnext_default_company");
  }
  if (inst.defaultEmployee) {
    localStorage.setItem("erpnext_default_employee", inst.defaultEmployee);
  } else {
    localStorage.removeItem("erpnext_default_employee");
  }
  if (inst.baseDir) {
    localStorage.setItem("erpnext_base_dir", inst.baseDir);
  } else {
    localStorage.removeItem("erpnext_base_dir");
  }

  // Apply theme
  applyTheme(inst);
}

/** Sync current standard localStorage keys back into the active instance object */
export function syncCurrentInstanceBack(): void {
  const instances = getInstances();
  const activeId = getActiveInstanceId();
  const idx = instances.findIndex((i) => i.id === activeId);
  if (idx === -1) return;

  instances[idx] = {
    ...instances[idx],
    url: localStorage.getItem("erpnext_url") || instances[idx].url,
    apiKey: localStorage.getItem("erpnext_api_key") || instances[idx].apiKey,
    apiSecret: localStorage.getItem("erpnext_api_secret") || instances[idx].apiSecret,
    defaultCompany: localStorage.getItem("erpnext_default_company") || "",
    defaultEmployee: localStorage.getItem("erpnext_default_employee") || "",
    baseDir: localStorage.getItem("erpnext_base_dir") || instances[idx].baseDir || "",
  };

  saveInstances(instances);
}

export function addInstance(inst: ERPInstance): void {
  const instances = getInstances();
  instances.push(inst);
  saveInstances(instances);
}

export function removeInstance(id: string): void {
  let instances = getInstances();
  instances = instances.filter((i) => i.id !== id);
  if (instances.length === 0) instances = [DEFAULT_INSTANCE];
  saveInstances(instances);

  // If we removed the active one, switch to first
  if (getActiveInstanceId() === id) {
    activateInstance(instances[0].id);
  }
}

export function updateInstance(id: string, updates: Partial<ERPInstance>): void {
  const instances = getInstances();
  const idx = instances.findIndex((i) => i.id === id);
  if (idx === -1) return;
  instances[idx] = { ...instances[idx], ...updates };
  saveInstances(instances);

  // If updating the active instance, also update standard keys
  if (id === getActiveInstanceId()) {
    activateInstance(id);
  }
}

/** Apply instance theme colors to CSS custom properties */
export function applyTheme(inst?: ERPInstance): void {
  const theme = inst?.theme || getActiveInstance().theme || THEME_3BM;
  const root = document.documentElement;
  root.style.setProperty("--color-3bm-teal", theme.primary);
  root.style.setProperty("--color-3bm-teal-light", theme.primaryLight);
  root.style.setProperty("--color-3bm-teal-dark", theme.primaryDark);
  root.style.setProperty("--color-3bm-purple", theme.sidebar);
  root.style.setProperty("--color-3bm-purple-light", theme.sidebarLight);
  root.style.setProperty("--color-3bm-purple-dark", theme.sidebarDark);
}

/** Get the built-in theme for an instance (even if localStorage is stale) */
function getBuiltinTheme(id: string): InstanceTheme | undefined {
  if (id === "3bm") return THEME_3BM;
  if (id === "impertio") return THEME_IMPERTIO;
  if (id === "symitech") return THEME_SYMITECH;
  if (id === "domera") return THEME_DOMERA;
  return undefined;
}

const THEME_DOMERA: InstanceTheme = {
  primary: "#8dab9f",       // sage green (Domera huisstijl)
  primaryLight: "#a3bdb2",
  primaryDark: "#6f8f80",
  sidebar: "#332c2f",       // dark brown/charcoal
  sidebarLight: "#5d424c",  // dusty mauve
  sidebarDark: "#231e20",
};

const DOMERA_INSTANCE: ERPInstance = {
  id: "domera",
  name: "Domera",
  color: "#8dab9f",
  url: "https://domera.prilk.cloud",
  apiKey: "",
  apiSecret: "",
  defaultCompany: "",
  defaultEmployee: "",
  baseDir: "",
  theme: THEME_DOMERA,
};

const IMPERTIO_INSTANCE: ERPInstance = {
  id: "impertio",
  name: "Impertio",
  color: "#f97316",
  url: "https://impertire.prilk.cloud",
  apiKey: "",
  apiSecret: "",
  defaultCompany: "",
  defaultEmployee: "",
  baseDir: "",
  theme: THEME_IMPERTIO,
};

const SYMITECH_INSTANCE: ERPInstance = {
  id: "symitech",
  name: "Symitech",
  color: "#3b82f6",
  url: "https://symitech.prilk.cloud",
  apiKey: "",
  apiSecret: "",
  defaultCompany: "",
  defaultEmployee: "",
  baseDir: "",
  theme: THEME_SYMITECH,
};

/** Load credentials from encrypted vault and merge into instances */
export async function loadFromVault(): Promise<void> {
  try {
    const res = await fetch("/api/vault/full");
    if (!res.ok) return;
    const { data } = await res.json() as { data: { id: string; name: string; url: string; apiKey: string; apiSecret: string; defaultCompany?: string; defaultEmployee?: string }[] };
    if (!Array.isArray(data) || data.length === 0) return;

    const instances = getInstances();
    let changed = false;

    for (const vaultEntry of data) {
      const idx = instances.findIndex((i) => i.id === vaultEntry.id);
      if (idx >= 0) {
        // Merge vault credentials into existing instance (vault is the source of truth for secrets)
        if (vaultEntry.apiKey && vaultEntry.apiSecret) {
          instances[idx].url = vaultEntry.url || instances[idx].url;
          instances[idx].apiKey = vaultEntry.apiKey;
          instances[idx].apiSecret = vaultEntry.apiSecret;
          if (vaultEntry.defaultCompany) instances[idx].defaultCompany = vaultEntry.defaultCompany;
          if (vaultEntry.defaultEmployee) instances[idx].defaultEmployee = vaultEntry.defaultEmployee;
          changed = true;
        }
      }
    }

    if (changed) {
      saveInstances(instances);
      // Re-activate to update localStorage keys
      activateInstance(getActiveInstanceId());
    }
  } catch {
    // Vault not available (e.g. server not running) — no problem, use localStorage
  }
}

// On first load, ensure the instances array exists.
export function initInstances(): void {
  const instances = getInstances();
  let changed = false;

  // Inject built-in instances if not present
  if (!instances.find((i) => i.id === "impertio")) {
    instances.push(IMPERTIO_INSTANCE);
    changed = true;
  }
  if (!instances.find((i) => i.id === "symitech")) {
    instances.push(SYMITECH_INSTANCE);
    changed = true;
  }
  if (!instances.find((i) => i.id === "domera")) {
    instances.push(DOMERA_INSTANCE);
    changed = true;
  }

  // Ensure themes are set on instances that match built-in IDs
  for (const inst of instances) {
    const builtin = getBuiltinTheme(inst.id);
    if (builtin && !inst.theme) {
      inst.theme = builtin;
      changed = true;
    }
  }

  if (changed) saveInstances(instances);

  // Apply theme for active instance
  applyTheme(getActiveInstance());
}
