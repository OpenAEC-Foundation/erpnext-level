/**
 * ERPNext API client — all requests go through the backend server.
 * The backend handles authentication and caching.
 * Instance selection via ?instance=<id> query parameter.
 */

import { getActiveInstanceId, getActiveInstance } from "./instances";

/** Build API URL: always relative (through backend), with instance query param */
function buildApiUrl(path: string, extraParams?: URLSearchParams): string {
  const params = extraParams || new URLSearchParams();
  params.set("instance", getActiveInstanceId());
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Get the ERPNext app URL for the active instance (for links, file URLs, etc.) */
export function getErpNextAppUrl(): string {
  return getActiveInstance().url;
}

/** Get the ERPNext link URL for document links (appends /app to the instance URL) */
export function getErpNextLinkUrl(): string {
  return `${getErpNextAppUrl()}/app`;
}

/** Minimal headers — no auth needed, backend handles that */
function getHeaders(): HeadersInit {
  return {
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

  const url = buildApiUrl(`/api/resource/${doctype}`, searchParams);
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
  const params = new URLSearchParams();
  params.set("instance", getActiveInstanceId());
  const url = `/api/resource/${doctype}/${encodeURIComponent(name)}?${params}`;
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
  return `${getErpNextAppUrl()}${fileUrl}`;
}

export function getAuthHeaders(): HeadersInit {
  return getHeaders();
}

export async function callMethod(
  method: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("instance", getActiveInstanceId());
  const url = `/api/method/${method}?${params}`;
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
  const params = new URLSearchParams();
  params.set("instance", getActiveInstanceId());
  const url = `/api/resource/${doctype}?${params}`;
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
  const params = new URLSearchParams();
  params.set("instance", getActiveInstanceId());
  const url = `/api/resource/${doctype}/${encodeURIComponent(name)}?${params}`;
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
  const params = new URLSearchParams();
  params.set("instance", getActiveInstanceId());
  const url = `/api/resource/${doctype}/${encodeURIComponent(name)}?${params}`;
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
  searchParams.set("instance", getActiveInstanceId());
  const url = `/api/method/frappe.client.get_count?${searchParams}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`ERPNext API error: ${res.status}`);
  const json: ERPNextCountResponse = await res.json();
  return json.message;
}
