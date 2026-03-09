/**
 * Server-side ERPNext HTTP client.
 * Supports multiple instances via ERPInstanceConfig.
 *
 * Instances are loaded from instances.json in the app data directory,
 * NOT hardcoded in the source code.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ERPInstanceConfig {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** App data directory for config files */
function getConfigDir(): string {
  const dir = process.env.ERPNEXT_LEVEL_CONFIG_DIR
    || join(homedir(), ".erpnext-level");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getConfigPath(): string {
  return join(getConfigDir(), "instances.json");
}

/** Load instances from config file */
function loadInstances(): ERPInstanceConfig[] {
  const path = getConfigPath();
  if (!existsSync(path)) {
    console.log(`[config] No instances.json found at ${path}`);
    console.log(`[config] Create it with your ERPNext instances. Example:`);
    console.log(JSON.stringify([
      { id: "my-erp", name: "My ERP", url: "https://myerp.example.com", apiKey: "your_key", apiSecret: "your_secret" },
    ], null, 2));
    // Write empty array so the file exists for users to edit
    writeFileSync(path, "[\n\n]\n", "utf-8");
    return [];
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error(`[config] instances.json must be an array`);
      return [];
    }
    return parsed.filter((i: ERPInstanceConfig) => i.id && i.url && i.apiKey && i.apiSecret);
  } catch (err) {
    console.error(`[config] Error reading instances.json:`, err);
    return [];
  }
}

let INSTANCES: ERPInstanceConfig[] = loadInstances();

/** Reload instances from disk (e.g. after user edits config) */
export function reloadInstances(): ERPInstanceConfig[] {
  INSTANCES = loadInstances();
  return INSTANCES;
}

/** Save instances to config file */
export function saveInstances(instances: ERPInstanceConfig[]): void {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(instances, null, 2), "utf-8");
  INSTANCES = instances;
}

export function getConfigFilePath(): string {
  return getConfigPath();
}

export function getAllInstances(): ERPInstanceConfig[] {
  return INSTANCES;
}

export function getInstance(id: string): ERPInstanceConfig | undefined {
  return INSTANCES.find((i) => i.id === id);
}

function authHeaders(inst: ERPInstanceConfig): Record<string, string> {
  return {
    Authorization: `token ${inst.apiKey}:${inst.apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Generic fetch wrapper with auth for a specific instance */
export async function erpFetch(inst: ERPInstanceConfig, path: string, options?: RequestInit): Promise<Response> {
  const url = `${inst.url}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(inst), ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ERPNext [${inst.id}] ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return res;
}

/** Fetch a list page from ERPNext */
export async function fetchList(
  inst: ERPInstanceConfig,
  doctype: string,
  fields: string[],
  filters: unknown[][] = [],
  orderBy = "modified desc",
  limitPageLength = 500,
  limitStart = 0
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    fields: JSON.stringify(fields),
    filters: JSON.stringify(filters),
    limit_page_length: String(limitPageLength),
    limit_start: String(limitStart),
    order_by: orderBy,
  });
  const res = await erpFetch(inst, `/api/resource/${encodeURIComponent(doctype)}?${params}`);
  const json = await res.json();
  return json.data || [];
}

/** Fetch ALL records with automatic pagination */
export async function fetchAll(
  inst: ERPInstanceConfig,
  doctype: string,
  fields: string[],
  filters: unknown[][] = [],
  orderBy = "modified desc"
): Promise<Record<string, unknown>[]> {
  const PAGE = 500;
  let all: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const batch = await fetchList(inst, doctype, fields, filters, orderBy, PAGE, offset);
    all = all.concat(batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

/** Proxy a raw request to a specific ERPNext instance */
export async function proxyRequest(
  inst: ERPInstanceConfig,
  path: string,
  method: string,
  body?: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const url = `${inst.url}${path}`;
  const opts: RequestInit = {
    method,
    headers: { ...authHeaders(inst), ...extraHeaders },
  };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { responseHeaders[k] = v; });
  return { status: res.status, headers: responseHeaders, body: text };
}
