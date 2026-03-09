/**
 * CacheManager: fetches all configured doctypes from ERPNext on startup,
 * then polls for incremental changes every POLL_INTERVAL_MS.
 * Full refresh every FULL_REFRESH_MS to catch deletions.
 *
 * Supports multiple instances via MultiCacheManager.
 */

import { fetchAll, type ERPInstanceConfig } from "./erpnext-client.js";

export interface DoctypeConfig {
  doctype: string;
  fields: string[];           // must include "name" and "modified"
  baseFilters?: unknown[][];  // always applied when fetching
}

type Doc = Record<string, unknown>;

const POLL_INTERVAL_MS = 60_000;       // 1 minute - incremental
const FULL_REFRESH_MS = 10 * 60_000;   // 10 minutes - full

export const CACHED_DOCTYPES: DoctypeConfig[] = [
  {
    doctype: "Company",
    fields: ["name", "company_name", "abbr", "modified"],
  },
  {
    doctype: "Sales Invoice",
    fields: [
      "name", "customer_name", "contact_email", "grand_total", "net_total",
      "base_net_total", "outstanding_amount", "posting_date", "due_date",
      "status", "company", "currency", "is_return", "payment_terms_template",
      "custom_date_paid", "docstatus", "modified",
    ],
  },
  {
    doctype: "Purchase Invoice",
    fields: [
      "name", "supplier_name", "grand_total", "net_total", "outstanding_amount",
      "posting_date", "status", "company", "docstatus", "modified",
    ],
  },
  {
    doctype: "Quotation",
    fields: [
      "name", "party_name", "grand_total", "net_total", "transaction_date",
      "valid_till", "status", "company", "docstatus", "modified",
    ],
  },
  {
    doctype: "Sales Order",
    fields: [
      "name", "customer_name", "grand_total", "net_total", "transaction_date",
      "delivery_date", "status", "company", "per_delivered", "per_billed",
      "docstatus", "modified",
    ],
  },
  {
    doctype: "Project",
    fields: [
      "name", "project_name", "status", "percent_complete", "expected_start_date",
      "expected_end_date", "company", "custom_address", "estimated_costing",
      "total_costing_amount", "modified",
    ],
  },
  {
    doctype: "Task",
    fields: [
      "name", "subject", "project", "status", "priority", "exp_start_date",
      "exp_end_date", "completed_on", "_assign", "description", "company", "modified",
    ],
  },
  {
    doctype: "Employee",
    fields: [
      "name", "employee_name", "designation", "department", "company", "status",
      "user_id", "company_email", "date_of_birth", "date_of_joining",
      "image", "modified",
    ],
  },
  {
    doctype: "Leave Application",
    fields: [
      "name", "employee", "employee_name", "leave_type", "from_date", "to_date",
      "total_leave_days", "status", "company", "docstatus", "modified",
    ],
  },
  {
    doctype: "Timesheet",
    fields: [
      "name", "employee", "employee_name", "start_date", "end_date",
      "total_hours", "status", "company", "docstatus", "modified",
    ],
  },
  {
    doctype: "Delivery Note",
    fields: [
      "name", "customer_name", "posting_date", "grand_total", "net_total",
      "status", "company", "docstatus", "modified",
    ],
  },
  {
    doctype: "Expense Claim",
    fields: [
      "name", "employee", "employee_name", "posting_date", "total_claimed_amount",
      "status", "company", "approval_status", "docstatus", "modified",
    ],
  },
  {
    doctype: "GL Entry",
    fields: [
      "name", "posting_date", "account", "debit", "credit", "voucher_type",
      "voucher_no", "party", "party_type", "company", "against", "cost_center",
      "is_cancelled", "fiscal_year", "remarks", "modified",
    ],
    baseFilters: [["is_cancelled", "=", 0]],
  },
  {
    doctype: "Communication",
    fields: [
      "name", "subject", "sender", "recipients", "communication_date",
      "reference_doctype", "reference_name", "sent_or_received", "status",
      "communication_type", "content", "modified",
    ],
  },
  {
    doctype: "ToDo",
    fields: [
      "name", "description", "status", "priority", "date", "allocated_to",
      "reference_type", "reference_name", "modified",
    ],
  },
  {
    doctype: "Address",
    fields: ["name", "address_line1", "city", "pincode", "country", "modified"],
  },
];

export class CacheManager {
  /** doctype -> Map<name, document> */
  private store = new Map<string, Map<string, Doc>>();
  /** doctype -> last sync timestamp */
  private lastSync = new Map<string, string>();
  private configs: DoctypeConfig[];
  private instance: ERPInstanceConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private fullTimer: ReturnType<typeof setInterval> | null = null;
  private ready = false;
  private initializing: Promise<void> | null = null;

  constructor(instance: ERPInstanceConfig, configs: DoctypeConfig[] = CACHED_DOCTYPES) {
    this.instance = instance;
    this.configs = configs;
    for (const cfg of configs) {
      this.store.set(cfg.doctype, new Map());
    }
  }

  get instanceId(): string {
    return this.instance.id;
  }

  get instanceName(): string {
    return this.instance.name;
  }

  getInstanceConfig(): ERPInstanceConfig {
    return this.instance;
  }

  /** Start the cache: full load + periodic polling */
  async start(): Promise<void> {
    console.log(`[cache:${this.instance.id}] Starting initial load of ${this.configs.length} doctypes...`);
    this.initializing = this.fullRefreshAll();
    await this.initializing;
    this.initializing = null;
    this.ready = true;
    console.log(`[cache:${this.instance.id}] Initial load complete. Starting polling.`);

    this.pollTimer = setInterval(() => this.incrementalRefreshAll(), POLL_INTERVAL_MS);
    this.fullTimer = setInterval(() => this.fullRefreshAll(), FULL_REFRESH_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.fullTimer) clearInterval(this.fullTimer);
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Wait until initial load is done */
  async waitReady(): Promise<void> {
    if (this.ready) return;
    if (this.initializing) await this.initializing;
  }

  /** Get all cached documents for a doctype */
  getAll(doctype: string): Doc[] {
    const map = this.store.get(doctype);
    if (!map) return [];
    return Array.from(map.values());
  }

  /** Get a single document by name */
  getOne(doctype: string, name: string): Doc | undefined {
    return this.store.get(doctype)?.get(name);
  }

  /** Get count of cached documents */
  getCount(doctype: string): number {
    return this.store.get(doctype)?.size ?? 0;
  }

  /** Check if a doctype is configured for caching */
  isCached(doctype: string): boolean {
    return this.store.has(doctype);
  }

  /** Get status info */
  getStatus(): Record<string, unknown> {
    const doctypes: Record<string, unknown> = {};
    for (const cfg of this.configs) {
      doctypes[cfg.doctype] = {
        count: this.store.get(cfg.doctype)?.size ?? 0,
        lastSync: this.lastSync.get(cfg.doctype) || null,
      };
    }
    return { instance: this.instance.id, name: this.instance.name, ready: this.ready, doctypes };
  }

  /** Invalidate a doctype (force next poll to full refresh) */
  invalidate(doctype: string): void {
    this.lastSync.delete(doctype);
  }

  // ─── Internal ───

  private async fullRefreshAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.configs.map((cfg) => this.fullRefreshOne(cfg))
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        console.error(`[cache:${this.instance.id}] Full refresh failed for ${this.configs[i].doctype}:`, (results[i] as PromiseRejectedResult).reason?.message);
      }
    }
  }

  private async fullRefreshOne(cfg: DoctypeConfig): Promise<void> {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const docs = await fetchAll(this.instance, cfg.doctype, cfg.fields, cfg.baseFilters || []);
    const map = new Map<string, Doc>();
    for (const doc of docs) {
      map.set(doc.name as string, doc);
    }
    this.store.set(cfg.doctype, map);
    this.lastSync.set(cfg.doctype, now);
    console.log(`[cache:${this.instance.id}] ${cfg.doctype}: ${docs.length} documents`);
  }

  private async incrementalRefreshAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.configs.map((cfg) => this.incrementalRefreshOne(cfg))
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        console.error(`[cache:${this.instance.id}] Incremental refresh failed for ${this.configs[i].doctype}:`, (results[i] as PromiseRejectedResult).reason?.message);
      }
    }
  }

  private async incrementalRefreshOne(cfg: DoctypeConfig): Promise<void> {
    const lastSync = this.lastSync.get(cfg.doctype);
    if (!lastSync) {
      return this.fullRefreshOne(cfg);
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const filters: unknown[][] = [
      ...(cfg.baseFilters || []),
      ["modified", ">=", lastSync],
    ];
    const modified = await fetchAll(this.instance, cfg.doctype, cfg.fields, filters);

    if (modified.length > 0) {
      const map = this.store.get(cfg.doctype)!;
      for (const doc of modified) {
        map.set(doc.name as string, doc);
      }
      console.log(`[cache:${this.instance.id}] ${cfg.doctype}: ${modified.length} updated`);
    }

    this.lastSync.set(cfg.doctype, now);
  }
}

/**
 * MultiCacheManager: manages one CacheManager per ERPNext instance.
 */
export class MultiCacheManager {
  private caches = new Map<string, CacheManager>();

  constructor(instances: ERPInstanceConfig[], configs: DoctypeConfig[] = CACHED_DOCTYPES) {
    for (const inst of instances) {
      this.caches.set(inst.id, new CacheManager(inst, configs));
    }
  }

  /** Start all caches in parallel */
  async start(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.caches.values()).map((c) => c.start())
    );
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[multi-cache] Instance failed to start:", r.reason?.message);
      }
    }
  }

  stop(): void {
    for (const c of this.caches.values()) c.stop();
  }

  /** Get cache for a specific instance, or the first one as default */
  get(instanceId: string): CacheManager | undefined {
    return this.caches.get(instanceId);
  }

  /** Get the default (first) cache */
  getDefault(): CacheManager {
    return this.caches.values().next().value!;
  }

  /** Get all instance IDs */
  getInstanceIds(): string[] {
    return Array.from(this.caches.keys());
  }

  /** Get combined status for all instances */
  getStatus(): Record<string, unknown> {
    const instances: Record<string, unknown> = {};
    for (const [id, cache] of this.caches) {
      instances[id] = cache.getStatus();
    }
    return { instances };
  }

  /** Wait for all caches to be ready */
  async waitReady(): Promise<void> {
    await Promise.all(Array.from(this.caches.values()).map((c) => c.waitReady()));
  }
}
