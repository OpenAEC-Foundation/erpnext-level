/**
 * ERPNext Level — Backend
 *
 * - Multi-instance: caches data from all configured ERPNext instances
 * - Polls for changes every 60 seconds per instance
 * - Serves cached data via ERPNext-compatible API
 * - Routes requests to the correct instance via ?instance=<id> or X-Instance header
 * - Proxies write operations to the correct ERPNext instance
 */

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { exec } from "child_process";

// In ESM (dev via tsx): derive __dirname from import.meta.url
// In CJS (esbuild bundle for Electron): esbuild injects __dirname automatically
// Use try/catch to handle both cases
let _serverDir: string;
try {
  _serverDir = dirname(fileURLToPath(import.meta.url));
} catch {
  _serverDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
}
import { MultiCacheManager } from "./cache.js";
import { matchesFilters, applyOrderBy, selectFields } from "./filter.js";
import { getAllInstances, getInstance, proxyRequest, getConfigFilePath, reloadInstances } from "./erpnext-client.js";
import { handleAgentChat } from "./agent.js";
import { readVault, writeVault, upsertVaultEntry, removeVaultEntry, getVaultFilePath, type VaultEntry } from "./vault.js";
import { readPasswords, upsertPasswordEntry, removePasswordEntry, importPasswords, type PasswordEntry } from "./passwords.js";
import { handleTerminalConnection } from "./terminal.js";
import { mailTestConnection, mailListFolders, mailListMessages, mailGetMessage, mailGetAttachment, mailSend, mailDeleteMessage, mailMoveMessage, mailCreateFolder, mailWarmup, mailCacheStats, mailMarkUnread, mailRenameFolder, mailAutoConfig, mailStartupWarmup, mailIsWarm } from "./mail.js";
import { nextcloudListFiles, nextcloudDownloadUrl, nextcloudDownload, nextcloudUpload } from "./nextcloud.js";
import { healthGetReport, healthRunTests, healthGetMail, healthGetMessenger, runAllTests } from "./health.js";
import { messengerListConversations, messengerGetMessages, messengerSendMessage, messengerMarkRead, messengerAllConversations } from "./messenger.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Static file serving is set up lazily in startServer() so that
// ERPNEXT_LEVEL_DIST can be set by electron/main.ts before evaluation.
let distDir = "";

const multiCache = new MultiCacheManager(getAllInstances());

/** Resolve instance ID from request: query param, header, or default to first */
function resolveInstanceId(req: express.Request): string {
  return (req.query.instance as string)
    || (req.headers["x-instance"] as string)
    || getAllInstances()[0]?.id
    || "3bm";
}

/* ─── Health / Status ─── */

app.get("/api/status", (_req, res) => {
  res.json(multiCache.getStatus());
});

/* ─── List instances ─── */

app.get("/api/instances", (_req, res) => {
  res.json({
    data: getAllInstances().map((i) => ({
      id: i.id,
      name: i.name,
      url: i.url,
    })),
  });
});

/* ─── Instance service credentials ─── */

app.get("/api/instances/:id/services", (req, res) => {
  try {
    const entries = readVault();
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.json({ data: {} });
    // Return service configs only, NOT ERPNext API credentials
    res.json({
      data: {
        nextcloud: entry.nextcloudUrl ? {
          url: entry.nextcloudUrl,
          user: entry.nextcloudUser || "",
          pass: entry.nextcloudPass || "",
        } : null,
        mail: entry.mailHost ? {
          host: entry.mailHost,
          port: entry.mailPort || 993,
          user: entry.mailUser || "",
          pass: entry.mailPass || "",
          secure: entry.mailSecure !== false,
          smtpHost: entry.smtpHost || "",
          smtpPort: entry.smtpPort || 587,
          smtpUser: entry.smtpUser || "",
          smtpPass: entry.smtpPass || "",
        } : null,
        telegram: entry.telegramBotToken ? {
          token: entry.telegramBotToken,
        } : null,
        whatsapp: entry.whatsappEnabled ? { enabled: true } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/instances/:id/services", (req, res) => {
  try {
    const entries = readVault();
    const idx = entries.findIndex(e => e.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "Instance not found in vault" });

    const services = req.body as Record<string, any>;
    // Merge service fields into the vault entry
    if (services.nextcloud) {
      entries[idx].nextcloudUrl = services.nextcloud.url;
      entries[idx].nextcloudUser = services.nextcloud.user;
      entries[idx].nextcloudPass = services.nextcloud.pass;
    }
    if (services.mail) {
      entries[idx].mailHost = services.mail.host;
      entries[idx].mailPort = services.mail.port;
      entries[idx].mailUser = services.mail.user;
      entries[idx].mailPass = services.mail.pass;
      entries[idx].mailSecure = services.mail.secure;
      entries[idx].smtpHost = services.mail.smtpHost;
      entries[idx].smtpPort = services.mail.smtpPort;
      entries[idx].smtpUser = services.mail.smtpUser;
      entries[idx].smtpPass = services.mail.smtpPass;
    }
    if (services.telegram) {
      entries[idx].telegramBotToken = services.telegram.token;
    }
    if (services.whatsapp !== undefined) {
      entries[idx].whatsappEnabled = !!services.whatsapp?.enabled;
    }

    writeVault(entries);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ─── Cached data: GET /api/resource/:doctype ─── */

app.get("/api/resource/:doctype", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  const cache = multiCache.get(instanceId);
  if (!cache) return res.status(404).json({ error: `Unknown instance: ${instanceId}` });

  await cache.waitReady();
  const doctype = req.params.doctype;

  // If not cached, proxy to ERPNext
  if (!cache.isCached(doctype)) {
    return proxyAndRespond(req, res, instanceId);
  }

  try {
    let docs = cache.getAll(doctype);

    // Apply filters
    const filtersParam = req.query.filters as string;
    if (filtersParam) {
      const filters = JSON.parse(filtersParam) as unknown[][];
      docs = docs.filter((doc) => matchesFilters(doc, filters));
    }

    // Apply order_by
    const orderBy = req.query.order_by as string;
    if (orderBy) {
      docs = applyOrderBy(docs, orderBy);
    }

    // Apply field selection
    const fieldsParam = req.query.fields as string;
    if (fieldsParam) {
      const fields = JSON.parse(fieldsParam) as string[];
      docs = selectFields(docs, fields);
    }

    // Apply pagination
    const limitStart = parseInt(req.query.limit_start as string || "0", 10);
    const limitPageLength = parseInt(req.query.limit_page_length as string || "500", 10);

    if (limitPageLength === 0) {
      docs = docs.slice(limitStart);
    } else {
      docs = docs.slice(limitStart, limitStart + limitPageLength);
    }

    res.json({ data: docs });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/* ─── Stats: GET /api/stats/uren ─── */
// Pre-computed uren statistics: employee monthly, project monthly, billable %
interface UrenStatsCache {
  data: {
    employeeMonthly: { employee: string; name: string; months: number[]; billableMonths: number[]; total: number; totalBillable: number }[];
    projectMonthly: { project: string; name: string; months: number[]; total: number }[];
    totalHours: number;
    totalBillable: number;
    billablePercent: number;
  };
  ts: number;
}
const urenStatsCache = new Map<string, UrenStatsCache>();
const UREN_STATS_TTL = 5 * 60_000; // 5 min

app.get("/api/stats/uren", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  const cache = multiCache.get(instanceId);
  if (!cache) return res.status(404).json({ error: `Unknown instance: ${instanceId}` });

  await cache.waitReady();
  const year = req.query.year as string || new Date().getFullYear().toString();
  const cacheKey = `${instanceId}:${year}`;

  // Return cached if fresh
  const cached = urenStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < UREN_STATS_TTL) {
    return res.json(cached.data);
  }

  try {
    // Build employee → company map for filtering
    const company = req.query.company as string || "";
    const empCompanyMap = new Map<string, string>();
    const employees = cache.getAll("Employee");
    for (const emp of employees) {
      empCompanyMap.set(emp.name as string, emp.company as string || "");
    }

    const timesheets = cache.getAll("Timesheet").filter((ts) => {
      if (ts.docstatus !== 1) return false;
      if (typeof ts.start_date !== "string" || !(ts.start_date as string).startsWith(year)) return false;
      // Filter by company via employee lookup
      if (company) {
        const empCompany = empCompanyMap.get(ts.employee as string) || "";
        if (empCompany !== company) return false;
      }
      return true;
    });

    const inst = getInstance(instanceId);
    if (!inst) return res.status(404).json({ error: "Instance not found" });

    // Fetch time_logs from individual timesheets in parallel batches
    const empMap = new Map<string, { employee: string; name: string; months: number[]; billableMonths: number[]; total: number; totalBillable: number }>();
    const projMap = new Map<string, { project: string; name: string; months: number[]; total: number }>();
    let totalHours = 0, totalBillable = 0;
    // Per-month totals for billable percentage
    const monthTotalHours = new Array(12).fill(0);
    const monthBillableHours = new Array(12).fill(0);
    // Bureau Algemeen: non-billable hours by activity type
    const activityMap = new Map<string, { activity: string; months: number[]; total: number }>();

    const batchSize = 20;
    for (let i = 0; i < timesheets.length; i += batchSize) {
      const batch = timesheets.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (ts) => {
          const result = await proxyRequest(inst, `/api/resource/Timesheet/${encodeURIComponent(ts.name as string)}`);
          return { ts, doc: JSON.parse(result.body)?.data };
        })
      );

      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value.doc) continue;
        const { ts, doc } = r.value;
        const emp = ts.employee as string;
        const empName = ts.employee_name as string;
        const monthIdx = parseInt((ts.start_date as string).slice(5, 7)) - 1;

        if (!empMap.has(emp)) {
          empMap.set(emp, { employee: emp, name: empName, months: new Array(12).fill(0), billableMonths: new Array(12).fill(0), total: 0, totalBillable: 0 });
        }
        const empEntry = empMap.get(emp)!;
        empEntry.months[monthIdx] += (ts.total_hours as number) || 0;
        empEntry.total += (ts.total_hours as number) || 0;
        totalHours += (ts.total_hours as number) || 0;
        monthTotalHours[monthIdx] += (ts.total_hours as number) || 0;

        for (const log of (doc.time_logs || [])) {
          const hours = log.hours || 0;
          const isBillable = log.is_billable || 0;
          const proj = log.project || "(geen project)";

          if (isBillable) {
            empEntry.billableMonths[monthIdx] += hours;
            empEntry.totalBillable += hours;
            totalBillable += hours;
            monthBillableHours[monthIdx] += hours;
          } else {
            // Track non-billable by activity type
            const activity = log.activity_type || "(geen activiteit)";
            if (!activityMap.has(activity)) {
              activityMap.set(activity, { activity, months: new Array(12).fill(0), total: 0 });
            }
            const actEntry = activityMap.get(activity)!;
            actEntry.months[monthIdx] += hours;
            actEntry.total += hours;
          }

          if (!projMap.has(proj)) {
            // Lookup project name from cache
            const projDoc = cache.getAll("Project").find(p => p.name === proj);
            const projDisplayName = projDoc ? `${proj} — ${projDoc.project_name}` : proj;
            projMap.set(proj, { project: proj, name: projDisplayName, months: new Array(12).fill(0), total: 0 });
          }
          const projEntry = projMap.get(proj)!;
          projEntry.months[monthIdx] += hours;
          projEntry.total += hours;
        }
      }
    }

    const monthBillablePercent = monthTotalHours.map((t, i) => t > 0 ? Math.round((monthBillableHours[i] / t) * 100) : 0);

    const data = {
      employeeMonthly: Array.from(empMap.values()).sort((a, b) => b.total - a.total),
      projectMonthly: Array.from(projMap.values()).sort((a, b) => b.total - a.total),
      totalHours,
      totalBillable,
      billablePercent: totalHours > 0 ? Math.round((totalBillable / totalHours) * 100) : 0,
      monthTotalHours,
      monthBillableHours,
      monthBillablePercent,
      bureauActivities: Array.from(activityMap.values()).sort((a, b) => b.total - a.total),
    };

    urenStatsCache.set(cacheKey, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ─── Stats: GET /api/stats/uren/detail ─── */
// Detail view: individual time_logs for a specific employee + month
app.get("/api/stats/uren/detail", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  const cache = multiCache.get(instanceId);
  if (!cache) return res.status(404).json({ error: `Unknown instance: ${instanceId}` });

  await cache.waitReady();
  const year = req.query.year as string || new Date().getFullYear().toString();
  const month = parseInt(req.query.month as string || "0", 10); // 0-based
  const employee = req.query.employee as string;

  if (!employee) return res.status(400).json({ error: "Missing employee parameter" });

  try {
    const timesheets = cache.getAll("Timesheet").filter((ts) =>
      ts.docstatus === 1 &&
      ts.employee === employee &&
      typeof ts.start_date === "string" &&
      (ts.start_date as string).startsWith(year) &&
      parseInt((ts.start_date as string).slice(5, 7)) - 1 === month
    );

    const inst = getInstance(instanceId);
    if (!inst) return res.status(404).json({ error: "Instance not found" });

    const logs: { date: string; project: string; activity: string; hours: number; isBillable: boolean; description: string }[] = [];

    // Build project name lookup
    const projNameMap = new Map<string, string>();
    const projects = cache.getAll("Project");
    for (const p of projects) {
      projNameMap.set(p.name as string, p.project_name as string || p.name as string);
    }

    const results = await Promise.allSettled(
      timesheets.map(async (ts) => {
        const result = await proxyRequest(inst, `/api/resource/Timesheet/${encodeURIComponent(ts.name as string)}`);
        return JSON.parse(result.body)?.data;
      })
    );

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const doc = r.value;
      for (const log of (doc.time_logs || [])) {
        const projId = log.project || "";
        const projName = projId ? projNameMap.get(projId) : "";
        const projDisplay = projName ? `${projId} — ${projName}` : projId;
        logs.push({
          date: log.from_time?.split(" ")[0] || doc.start_date || "",
          project: projDisplay,
          activity: log.activity_type || "",
          hours: log.hours || 0,
          isBillable: !!(log.is_billable),
          description: log.description || "",
        });
      }
    }

    logs.sort((a, b) => a.date.localeCompare(b.date));

    const totalHours = logs.reduce((s, l) => s + l.hours, 0);
    const billableHours = logs.filter(l => l.isBillable).reduce((s, l) => s + l.hours, 0);

    res.json({
      employee,
      month,
      year,
      logs,
      totalHours,
      billableHours,
      billablePercent: totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ─── Single document: GET /api/resource/:doctype/:name ─── */
// Always proxy to ERPNext for full documents (cache doesn't include child tables)

app.get("/api/resource/:doctype/:name", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  return proxyAndRespond(req, res, instanceId);
});

/* ─── Proxy write operations: POST /api/resource/:doctype ─── */

app.post("/api/resource/:doctype", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  const inst = getInstance(instanceId);
  if (!inst) return res.status(404).json({ error: `Unknown instance: ${instanceId}` });
  const cache = multiCache.get(instanceId);

  try {
    const result = await proxyRequest(
      inst,
      `/api/resource/${encodeURIComponent(req.params.doctype)}`,
      "POST",
      JSON.stringify(req.body)
    );
    cache?.invalidate(req.params.doctype);
    res.status(result.status).type("json").send(result.body);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.put("/api/resource/:doctype/:name", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  const inst = getInstance(instanceId);
  if (!inst) return res.status(404).json({ error: `Unknown instance: ${instanceId}` });
  const cache = multiCache.get(instanceId);

  try {
    const result = await proxyRequest(
      inst,
      `/api/resource/${encodeURIComponent(req.params.doctype)}/${encodeURIComponent(req.params.name)}`,
      "PUT",
      JSON.stringify(req.body)
    );
    cache?.invalidate(req.params.doctype);
    res.status(result.status).type("json").send(result.body);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.delete("/api/resource/:doctype/:name", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  const inst = getInstance(instanceId);
  if (!inst) return res.status(404).json({ error: `Unknown instance: ${instanceId}` });
  const cache = multiCache.get(instanceId);

  try {
    const result = await proxyRequest(
      inst,
      `/api/resource/${encodeURIComponent(req.params.doctype)}/${encodeURIComponent(req.params.name)}`,
      "DELETE"
    );
    cache?.invalidate(req.params.doctype);
    res.status(result.status).type("json").send(result.body);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/* ─── Proxy method calls: POST/GET /api/method/:method ─── */

app.all("/api/method/:method(*)", async (req, res) => {
  const instanceId = resolveInstanceId(req);
  const cache = multiCache.get(instanceId);
  const inst = getInstance(instanceId);
  if (!inst) return res.status(404).json({ error: `Unknown instance: ${instanceId}` });

  if (cache) await cache.waitReady();
  const methodPath = req.params.method;
  const fullPath = `/api/method/${methodPath}`;

  // Special handling: frappe.client.get_count → use cache
  if (cache && methodPath === "frappe.client.get_count" && req.method === "GET") {
    const doctype = (req.query.doctype as string) || "";
    if (cache.isCached(doctype)) {
      let docs = cache.getAll(doctype);
      const filtersParam = req.query.filters as string;
      if (filtersParam) {
        const filters = JSON.parse(filtersParam) as unknown[][];
        docs = docs.filter((doc) => matchesFilters(doc, filters));
      }
      return res.json({ message: docs.length });
    }
  }

  // Otherwise proxy to ERPNext
  try {
    const qs = new URL(req.url, "http://localhost").search;
    const result = await proxyRequest(
      inst,
      `${fullPath}${qs}`,
      req.method,
      req.method === "POST" ? JSON.stringify(req.body) : undefined
    );
    res.status(result.status).type("json").send(result.body);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/* ─── ERPNext proxy (for frontend multi-instance via URL) ─── */

app.all("/erpnext-proxy", async (req, res) => {
  try {
    const targetBase = req.query.url as string;
    const apiPath = req.query.path as string;
    const queryStr = (req.query.qs as string) || "";

    if (!targetBase || !apiPath) {
      return res.status(400).json({ error: "Missing url or path parameter" });
    }

    // Try to find the instance by URL to use its auth
    const inst = getAllInstances().find((i) => i.url === targetBase);

    const targetUrl = `${targetBase}${apiPath}${queryStr ? "?" + queryStr : ""}`;
    const headers: Record<string, string> = {
      "Content-Type": req.headers["content-type"] || "application/json",
      Accept: "application/json",
    };
    // Use instance auth if found, otherwise pass through from request
    if (inst) {
      headers["Authorization"] = `token ${inst.apiKey}:${inst.apiSecret}`;
    } else if (req.headers.authorization) {
      headers["Authorization"] = req.headers.authorization;
    }

    const fetchOptions: RequestInit = { method: req.method || "GET", headers };
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(targetUrl, fetchOptions);
    const body = await upstream.text();
    res.status(upstream.status)
      .set("Content-Type", upstream.headers.get("content-type") || "application/json")
      .send(body);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

/* ─── Credential vault ─── */

app.get("/api/vault", (_req, res) => {
  try {
    const entries = readVault();
    // Return entries with masked secrets for display
    res.json({
      data: entries.map((e) => ({
        ...e,
        apiKey: e.apiKey ? `${e.apiKey.slice(0, 4)}${"*".repeat(Math.max(0, e.apiKey.length - 4))}` : "",
        apiSecret: e.apiSecret ? "********" : "",
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/vault/full", (_req, res) => {
  try {
    res.json({ data: readVault() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/vault", (req, res) => {
  try {
    const entry = req.body as VaultEntry;
    if (!entry.id || !entry.url) {
      return res.status(400).json({ error: "id and url are required" });
    }
    upsertVaultEntry(entry);
    // Reload instances so new credentials take effect immediately
    reloadInstances();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/vault/:id", (req, res) => {
  try {
    removeVaultEntry(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/vault-path", (_req, res) => {
  res.json({ path: getVaultFilePath() });
});

/* ─── Password manager ─── */

app.get("/api/passwords", (_req, res) => {
  try {
    res.json({ data: readPasswords() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/passwords", (req, res) => {
  try {
    const entry = req.body as PasswordEntry;
    if (!entry.id || !entry.title) {
      return res.status(400).json({ error: "id and title are required" });
    }
    upsertPasswordEntry(entry);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/passwords/:id", (req, res) => {
  try {
    removePasswordEntry(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/passwords/export", (_req, res) => {
  try {
    const entries = readPasswords();
    res.json({ data: entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/passwords/import", (req, res) => {
  try {
    const { entries, replace } = req.body as { entries: PasswordEntry[]; replace?: boolean };
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "entries must be an array" });
    }
    const count = importPasswords(entries, replace);
    res.json({ ok: true, imported: count });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ─── Mail (IMAP) ─── */

/* ─── Health checks ─── */

app.get("/api/health", healthGetReport);
app.get("/api/health/run", healthRunTests);
app.get("/api/health/mail", healthGetMail);
app.get("/api/health/messenger", healthGetMessenger);

app.get("/api/mail/test", mailTestConnection);
app.get("/api/mail/folders", mailListFolders);
app.get("/api/mail/messages", mailListMessages);
app.get("/api/mail/message", mailGetMessage);
app.get("/api/mail/attachment", mailGetAttachment);
app.post("/api/mail/send", mailSend);
app.delete("/api/mail/message", mailDeleteMessage);
app.post("/api/mail/move", mailMoveMessage);
app.post("/api/mail/folder", mailCreateFolder);
app.post("/api/mail/warmup", mailWarmup);
app.get("/api/mail/warmup", mailWarmup);
app.get("/api/mail/cache-stats", mailCacheStats);
app.post("/api/mail/mark-unread", mailMarkUnread);
app.post("/api/mail/rename-folder", mailRenameFolder);
app.get("/api/mail/auto-config", mailAutoConfig);
app.get("/api/mail/warm", mailIsWarm);

/* ─── NextCloud WebDAV ─── */

app.get("/api/nextcloud/files", nextcloudListFiles);
app.get("/api/nextcloud/download-url", nextcloudDownloadUrl);
app.get("/api/nextcloud/download", nextcloudDownload);
app.put("/api/nextcloud/upload", express.raw({ type: "*/*", limit: "100mb" }), nextcloudUpload);

/* ─── Messenger (multi-platform) ─── */

app.get("/api/messenger/conversations", messengerListConversations);
app.get("/api/messenger/all-conversations", messengerAllConversations);
app.get("/api/messenger/messages", messengerGetMessages);
app.post("/api/messenger/send", messengerSendMessage);
app.post("/api/messenger/mark-read", messengerMarkRead);

/* ─── Office 365 Calendar via Microsoft Graph ─── */

app.get("/api/calendar/o365", async (req, res) => {
  const instanceId = req.query.instance as string;
  const email = req.query.email as string;
  const startDate = req.query.start as string; // ISO date: 2026-03-01
  const endDate = req.query.end as string;     // ISO date: 2026-03-31

  if (!instanceId || !email) return res.status(400).json({ error: "Missing instance or email" });

  try {
    // Get fresh OAuth2 token via mail auto-config
    const { mailAutoConfigInternal } = await import("./mail.js");
    const config = await mailAutoConfigInternal(instanceId, email);
    if (!config?.accessToken) {
      return res.status(401).json({ error: "Geen OAuth2 token beschikbaar voor " + email });
    }

    // Microsoft Graph needs a different token scope — try with the IMAP token first
    // The IMAP token includes User.Read which gives basic calendar access
    // For full calendar: need Calendars.Read scope (may need to be added to Connected App)
    const graphUrl = new URL("https://graph.microsoft.com/v1.0/me/calendarview");
    graphUrl.searchParams.set("startdatetime", (startDate || new Date().toISOString().split("T")[0]) + "T00:00:00Z");
    graphUrl.searchParams.set("enddatetime", (endDate || (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().split("T")[0]; })()) + "T23:59:59Z");
    graphUrl.searchParams.set("$top", "200");
    graphUrl.searchParams.set("$select", "id,subject,start,end,isAllDay,location,bodyPreview,organizer,attendees,webLink,isCancelled");
    graphUrl.searchParams.set("$orderby", "start/dateTime");

    // The IMAP token won't work for Graph — we need to get a Graph token
    // Refresh the token with Graph scopes
    if (!config.refreshToken || !config.clientId || !config.clientSecret || !config.tokenUri) {
      return res.status(400).json({ error: "OAuth2 refresh credentials niet beschikbaar" });
    }

    // Try with Calendars.Read first, fallback to broader scope
    const tokenResp = await fetch(config.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/.default offline_access",
      }),
    });
    const tokenData = await tokenResp.json() as { access_token?: string; error?: string; error_description?: string };
    if (!tokenData.access_token) {
      return res.status(401).json({ error: `Graph token refresh failed: ${tokenData.error_description || tokenData.error || "unknown"}` });
    }

    const graphResp = await fetch(graphUrl.toString(), {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
        Prefer: 'outlook.timezone="Europe/Amsterdam"',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!graphResp.ok) {
      const errText = await graphResp.text();
      console.error("[o365-calendar] Graph API error:", graphResp.status, errText.slice(0, 200));
      return res.status(graphResp.status).json({ error: `Graph API: ${graphResp.status}` });
    }

    const graphData = await graphResp.json() as { value: any[] };
    const events = (graphData.value || [])
      .filter((e: any) => !e.isCancelled)
      .map((e: any) => ({
        id: e.id,
        subject: e.subject || "(Geen titel)",
        start: e.start?.dateTime || "",
        end: e.end?.dateTime || "",
        isAllDay: e.isAllDay || false,
        location: e.location?.displayName || "",
        bodyPreview: e.bodyPreview || "",
        organizer: e.organizer?.emailAddress?.name || "",
        attendees: (e.attendees || []).map((a: any) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean),
        webLink: e.webLink || "",
      }));

    console.log(`[o365-calendar] Loaded ${events.length} events for ${email}`);
    res.json({ data: events });
  } catch (err) {
    console.error("[o365-calendar] Error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ─── iCal calendar proxy ─── */

app.get("/api/calendar/ical", async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: "Missing url parameter" });

  try {
    // Normalize webcal:// to https://
    const fetchUrl = url.replace(/^webcal:\/\//, "https://");
    const response = await fetch(fetchUrl, {
      headers: { Accept: "text/calendar, text/plain, */*" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream returned ${response.status}` });
    }
    const text = await response.text();

    // Parse VEVENT blocks into simple event objects
    const events: Array<{
      uid: string; summary: string; dtstart: string; dtend: string;
      description: string; location: string; allDay: boolean;
    }> = [];

    const veventBlocks = text.split("BEGIN:VEVENT");
    for (let i = 1; i < veventBlocks.length; i++) {
      const block = veventBlocks[i].split("END:VEVENT")[0];

      const getField = (name: string): string => {
        // Handle folded lines (RFC 5545: continuation lines start with space/tab)
        const regex = new RegExp(`^${name}[;:](.*)`, "m");
        const match = block.match(regex);
        if (!match) return "";
        let val = match[1];
        // Unfold continuation lines
        const startIdx = block.indexOf(match[0]);
        const afterMatch = block.substring(startIdx + match[0].length);
        const continuationMatch = afterMatch.match(/^(\r?\n[ \t].*)*/);
        if (continuationMatch && continuationMatch[0]) {
          val += continuationMatch[0].replace(/\r?\n[ \t]/g, "");
        }
        return val.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\").trim();
      };

      const dtstart = getField("DTSTART");
      const dtend = getField("DTEND");
      const summary = getField("SUMMARY");
      const uid = getField("UID") || `ical-${i}`;
      const description = getField("DESCRIPTION");
      const location = getField("LOCATION");

      // Determine if all-day (DATE format = 8 chars, no T)
      const allDay = /^\d{8}$/.test(dtstart);

      // Parse date values
      const parseICalDate = (val: string): string => {
        if (!val) return "";
        // Remove TZID parameter prefix if present (e.g., "Europe/Amsterdam:20250101T090000")
        const colonIdx = val.indexOf(":");
        const dateStr = colonIdx >= 0 ? val.substring(colonIdx + 1) : val;
        // All-day: 20250101
        if (/^\d{8}$/.test(dateStr)) {
          return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        }
        // DateTime: 20250101T090000 or 20250101T090000Z
        if (/^\d{8}T\d{6}Z?$/.test(dateStr)) {
          const d = dateStr.replace("Z", "");
          return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}`;
        }
        return val;
      };

      events.push({
        uid,
        summary: summary || "(Geen titel)",
        dtstart: parseICalDate(dtstart),
        dtend: parseICalDate(dtend),
        description,
        location,
        allDay,
      });
    }

    res.json({ data: events });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/* ─── Open folder on host ─── */

app.post("/api/open-folder", (req, res) => {
  const folderPath = req.body?.path;
  if (!folderPath || typeof folderPath !== "string") {
    return res.status(400).json({ error: "Missing path parameter" });
  }
  // Sanitize: only allow paths starting with a drive letter
  if (!/^[A-Za-z]:[\\/]/.test(folderPath)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  // Use explorer.exe on Windows to open the folder
  const normalized = folderPath.replace(/\//g, "\\");
  exec(`explorer.exe "${normalized}"`, (err) => {
    if (err) {
      console.warn("[open-folder] Error:", err.message);
      // Explorer returns exit code 1 even on success sometimes
    }
  });
  res.json({ ok: true });
});

/* ─── Open folder ─── */

app.post("/api/open-folder", (req, res) => {
  const folderPath = (req.body as { path?: string })?.path;
  if (!folderPath) return res.status(400).json({ error: "Missing path" });
  const normalized = folderPath.replace(/\//g, "\\");
  exec(`explorer "${normalized}"`, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

/* ─── Agent chat ─── */

app.post("/api/agent/chat", handleAgentChat);

/* ─── Generic proxy fallback ─── */

async function proxyAndRespond(req: express.Request, res: express.Response, instanceId?: string) {
  const id = instanceId || resolveInstanceId(req);
  const inst = getInstance(id);
  if (!inst) return res.status(404).json({ error: `Unknown instance: ${id}` });

  try {
    const qs = new URL(req.url, "http://localhost").search;
    const result = await proxyRequest(inst, `${req.path}${qs}`, req.method);
    res.status(result.status).type("json").send(result.body);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

/* ─── SPA fallback is registered in startServer() after distDir is resolved ─── */

/* ─── Config info endpoint ─── */

app.get("/api/config-path", (_req, res) => {
  res.json({ path: getConfigFilePath() });
});

/* ─── Start ─── */

export async function startServer(port?: number): Promise<number> {
  const listenPort = port !== undefined ? port : PORT;
  const instances = getAllInstances();
  console.log(`[server] Config: ${getConfigFilePath()}`);
  console.log(`[server] Starting with ${instances.length} instance(s):`);
  for (const inst of instances) {
    console.log(`  - ${inst.name} (${inst.id}): ${inst.url}`);
  }

  if (instances.length === 0) {
    console.log(`[server] No instances configured. Add them to the config file above.`);
  }

  // Ensure 3BM NextCloud credentials are always present in vault
  const vaultEntries = readVault();
  const bmEntry = vaultEntries.find(e => e.id === "3bm");
  if (bmEntry) {
    const needsSeed = !bmEntry.nextcloudUrl || !bmEntry.nextcloudUser || !bmEntry.nextcloudPass;
    if (needsSeed) {
      upsertVaultEntry({
        id: "3bm",
        nextcloudUrl: "https://nextcloud.3bm.cloud",
        nextcloudUser: "maarten@3bm.co.nl",
        nextcloudPass: "5ngz4wdVl8ft",
      });
      console.log("[server] Seeded/restored 3BM NextCloud credentials into vault");
    }
  }
  // Ensure Impertio mail credentials are always present
  const impEntry = vaultEntries.find(e => e.id === "impertio");
  if (impEntry && (!impEntry.mailUser || !impEntry.mailPass)) {
    upsertVaultEntry({
      id: "impertio",
      mailHost: "mail.impertio.nl",
      mailPort: 993,
      mailUser: "maarten@impertio.nl",
      mailPass: "Welkom2026",
      mailSecure: true,
      smtpHost: "mail.impertio.nl",
      smtpPort: 587,
      smtpUser: "maarten@impertio.nl",
      smtpPass: "Welkom2026",
    });
    console.log("[server] Seeded/restored Impertio mail credentials into vault");
  }

  // Set up static file serving (lazy so ERPNEXT_LEVEL_DIST from electron is available)
  distDir = resolve(process.env.ERPNEXT_LEVEL_DIST || join(_serverDir, "..", "dist"));
  if (existsSync(distDir)) {
    console.log(`[server] Serving static files from ${distDir}`);
    app.use(express.static(distDir));
    // SPA fallback — must be after all API routes, skip /api/* paths
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(join(distDir, "index.html"));
    });
  }

  console.log("[server] Loading caches...");
  await multiCache.start();

  // Create HTTP server from Express app
  const server = createServer(app);

  // Attach WebSocket server for terminal
  const wss = new WebSocketServer({ server, path: "/ws/terminal" });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://localhost");
    const instanceId = url.searchParams.get("instance") || getAllInstances()[0]?.id || "3bm";
    handleTerminalConnection(ws, instanceId);
  });
  console.log("[server] WebSocket terminal enabled at /ws/terminal");

  return new Promise((resolve) => {
    server.listen(listenPort, () => {
      const actualPort = (server.address() as { port: number }).port;
      console.log(`[server] Backend running on http://localhost:${actualPort}`);

      // Eagerly warm up all mail accounts (IMAP connections + INBOX preload)
      mailStartupWarmup().catch(err => console.error("[mail-warmup] Startup error:", err));

      // Run health checks in background after startup (30s delay to let caches load)
      setTimeout(() => {
        console.log("[server] Starting automatic health checks...");
        runAllTests().catch(err => console.error("[health] Auto-run failed:", err));
      }, 30_000);

      resolve(actualPort);
    });
  });
}

// Run directly if not imported
const isMain = !process.env.ELECTRON && (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js")
);

// Prevent crashes from unhandled promise rejections (e.g. IMAP timeouts)
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
});

if (isMain) {
  startServer().catch((err) => {
    console.error("[server] Fatal error:", err);
    process.exit(1);
  });
}
