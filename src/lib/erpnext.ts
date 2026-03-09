// When erpnext_url is empty, requests go through Vite proxy (/api → 3bm.prilk.cloud)
// When set, requests go through /erpnext-proxy to avoid CORS
function getBaseUrl(): string {
  return localStorage.getItem("erpnext_url") || "";
}

// Build the actual fetch URL: uses the local proxy for non-empty URLs
function buildApiUrl(path: string, queryString?: string): string {
  const base = getBaseUrl();
  if (!base) {
    // Empty URL = use Vite dev proxy (relative path)
    return queryString ? `${path}?${queryString}` : path;
  }
  // Non-empty URL = route through our proxy middleware to avoid CORS
  const params = new URLSearchParams();
  params.set("url", base);
  params.set("path", path);
  if (queryString) params.set("qs", queryString);
  return `/erpnext-proxy?${params}`;
}

export function getErpNextAppUrl(): string {
  return localStorage.getItem("erpnext_url") || "https://3bm.prilk.cloud";
}

function getApiKey(): string {
  return localStorage.getItem("erpnext_api_key") || "9e2e953e4f88df5";
}

function getApiSecret(): string {
  return localStorage.getItem("erpnext_api_secret") || "4e5ffaaa308ba9d";
}

function getHeaders(): HeadersInit {
  const key = getApiKey();
  const secret = getApiSecret();
  if (!key || !secret) {
    console.warn("ERPNext API credentials niet ingesteld. Ga naar Instellingen.");
  }
  return {
    Authorization: `token ${key}:${secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export interface ERPNextListResponse<T = Record<string, unknown>> {
  data: T[];
}

export interface ERPNextCountResponse {
  message: number;
}

export async function fetchList<T = Record<string, unknown>>(
  doctype: string,
  params?: {
    fields?: string[];
    filters?: unknown[][];
    limit_page_length?: number;
    limit_start?: number;
    order_by?: string;
  }
): Promise<T[]> {
  const searchParams = new URLSearchParams();
  if (params?.fields) {
    searchParams.set("fields", JSON.stringify(params.fields));
  }
  if (params?.filters) {
    searchParams.set("filters", JSON.stringify(params.filters));
  }
  if (params?.limit_page_length !== undefined) {
    searchParams.set("limit_page_length", String(params.limit_page_length));
  }
  if (params?.limit_start !== undefined) {
    searchParams.set("limit_start", String(params.limit_start));
  }
  if (params?.order_by) {
    searchParams.set("order_by", params.order_by);
  }

  const url = buildApiUrl(`/api/resource/${doctype}`, searchParams.toString());
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`ERPNext API error: ${res.status}`);
  const json: ERPNextListResponse<T> = await res.json();
  return json.data;
}

/** Fetch ALL records with automatic pagination */
export async function fetchAll<T = Record<string, unknown>>(
  doctype: string,
  fields: string[],
  filters?: unknown[][],
  orderBy?: string
): Promise<T[]> {
  const pageSize = 500;
  let allResults: T[] = [];
  let start = 0;
  while (true) {
    const batch = await fetchList<T>(doctype, {
      fields,
      filters,
      order_by: orderBy,
      limit_page_length: pageSize,
      limit_start: start,
    });
    allResults = [...allResults, ...batch];
    if (batch.length < pageSize) break;
    start += pageSize;
  }
  return allResults;
}

export async function fetchDocument<T = Record<string, unknown>>(
  doctype: string,
  name: string
): Promise<T> {
  const url = buildApiUrl(`/api/resource/${doctype}/${encodeURIComponent(name)}`);
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`ERPNext API error: ${res.status}`);
  const json = await res.json();
  return json.data;
}

export interface FileInfo {
  name: string;
  file_name: string;
  file_url: string;
  file_size: number;
  is_private: number;
}

export async function fetchAttachments(
  doctype: string,
  docname: string
): Promise<FileInfo[]> {
  return fetchList<FileInfo>("File", {
    fields: ["name", "file_name", "file_url", "file_size", "is_private"],
    filters: [
      ["attached_to_doctype", "=", doctype],
      ["attached_to_name", "=", docname],
    ],
    limit_page_length: 50,
  });
}

export function getFileUrl(fileUrl: string): string {
  return `${getBaseUrl()}${fileUrl}`;
}

export function getAuthHeaders(): HeadersInit {
  return getHeaders();
}

export async function callMethod(
  method: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const url = buildApiUrl(`/api/method/${method}`);
  const res = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`ERPNext API error: ${res.status}`);
  const json = await res.json();
  return json.message;
}

export async function createDocument<T = Record<string, unknown>>(
  doctype: string,
  data: Record<string, unknown>
): Promise<T> {
  const url = buildApiUrl(`/api/resource/${doctype}`);
  const res = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.exc || `ERPNext API error: ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

export async function updateDocument<T = Record<string, unknown>>(
  doctype: string,
  name: string,
  data: Record<string, unknown>
): Promise<T> {
  const url = buildApiUrl(`/api/resource/${doctype}/${encodeURIComponent(name)}`);
  const res = await fetch(url, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.exc || `ERPNext API error: ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

export async function deleteDocument(
  doctype: string,
  name: string
): Promise<void> {
  const url = buildApiUrl(`/api/resource/${doctype}/${encodeURIComponent(name)}`);
  const res = await fetch(url, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.exc || `ERPNext API error: ${res.status}`);
  }
}

export async function fetchCount(
  doctype: string,
  filters?: unknown[][]
): Promise<number> {
  const args: Record<string, string> = { doctype };
  if (filters) {
    args.filters = JSON.stringify(filters);
  }
  const searchParams = new URLSearchParams(args);
  const url = buildApiUrl(`/api/method/frappe.client.get_count`, searchParams.toString());
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`ERPNext API error: ${res.status}`);
  const json: ERPNextCountResponse = await res.json();
  return json.message;
}
