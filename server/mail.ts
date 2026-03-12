/**
 * IMAP mail backend with aggressive caching.
 *
 * - MailAccountCache keeps a persistent IMAP connection per account
 * - ALL message bodies (text + html, excl. attachments) are pre-loaded into memory
 * - Folders and message lists refresh every 30s
 * - New messages get their bodies fetched automatically in background
 * - API requests served from cache instantly (< 5ms)
 * - SMTP sending via nodemailer
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import type { Request, Response } from "express";
import { getInstance, getAllInstances, proxyRequest } from "./erpnext-client.js";

/* ─── Types ─── */

interface MailCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  // OAuth2 fields (Office 365)
  authMode?: "password" | "oauth2";
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUri?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
}

interface CachedFolder {
  path: string;
  name: string;
  delimiter: string;
  flags: string[];
  specialUse: string | null;
  listed: boolean;
  messages: number | null;
  unseen: number | null;
}

interface CachedMessage {
  uid: number;
  seq: number;
  flags: string[];
  date: string | null;
  subject: string;
  from: { name: string; address: string }[];
  to: { name: string; address: string }[];
  seen: boolean;
  flagged: boolean;
  hasAttachments: boolean;
}

interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  cid?: string; // content-id for inline images
}

interface CachedFullMessage extends CachedMessage {
  cc: { name: string; address: string }[];
  textBody: string;
  htmlBody: string;
  attachments: AttachmentMeta[];
}

interface FolderCache {
  messages: CachedMessage[];
  total: number;
  ts: number;
}

/* ─── Per-account cache ─── */

class MailAccountCache {
  private creds: MailCredentials;
  private client: ImapFlow | null = null;
  private connected = false;
  private connecting = false;
  private folders: CachedFolder[] = [];
  private foldersTs = 0;
  private folderMessages = new Map<string, FolderCache>();
  private fullMessages = new Map<string, CachedFullMessage>(); // key: folder:uid
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = Date.now();
  private preloadingBodies = false;
  private static readonly FOLDER_TTL = 120_000;    // 2 min
  private static readonly MSG_LIST_TTL = 30_000;    // 30s
  private static readonly IDLE_TIMEOUT = 600_000;   // 10 min without activity → disconnect

  constructor(creds: MailCredentials) {
    this.creds = creds;
  }

  private get key() { return `${this.creds.host}:${this.creds.user}`; }

  /** Update credentials (e.g. new OAuth2 tokens from frontend) */
  updateCredentials(creds: MailCredentials) {
    const authModeChanged = this.creds.authMode !== creds.authMode;
    const tokenChanged = creds.authMode === "oauth2" && creds.accessToken && creds.accessToken !== this.creds.accessToken;

    // Always update OAuth fields if provided
    if (creds.authMode === "oauth2") {
      if (creds.accessToken) this.creds.accessToken = creds.accessToken;
      if (creds.refreshToken) this.creds.refreshToken = creds.refreshToken;
      if (creds.clientId) this.creds.clientId = creds.clientId;
      if (creds.clientSecret) this.creds.clientSecret = creds.clientSecret;
      if (creds.tokenUri) this.creds.tokenUri = creds.tokenUri;
    }

    // If auth mode changed, destroy existing connection so it reconnects
    if (authModeChanged) {
      this.creds.authMode = creds.authMode;
      this.creds.pass = creds.pass;
      if (this.client) {
        this.client.logout().catch(() => {});
        this.client = null;
        this.connected = false;
      }
    }
  }

  /** Ensure OAuth2 access token is fresh (refresh if expired or expiring within 5 min) */
  private async ensureTokenFresh(): Promise<void> {
    if (this.creds.authMode !== "oauth2" || !this.creds.accessToken) return;

    try {
      // Decode JWT payload (base64url) to check expiration
      const parts = this.creds.accessToken.split(".");
      if (parts.length < 2) return;
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      const exp = payload.exp as number;
      if (!exp) return;

      const nowSec = Math.floor(Date.now() / 1000);
      if (exp - nowSec > 300) return; // still valid for >5 min

      console.log(`[mail-cache] OAuth2 token expired or expiring soon for ${this.key}, refreshing...`);
    } catch {
      // If we can't decode, try refreshing anyway
      console.log(`[mail-cache] Could not decode JWT for ${this.key}, attempting refresh...`);
    }

    if (!this.creds.refreshToken || !this.creds.tokenUri || !this.creds.clientId || !this.creds.clientSecret) {
      console.warn(`[mail-cache] Missing refresh credentials for ${this.key}`);
      return;
    }

    try {
      const resp = await fetch(this.creds.tokenUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
          refresh_token: this.creds.refreshToken,
          scope: "https://outlook.office365.com/IMAP.AccessAsUser.All https://outlook.office365.com/SMTP.Send offline_access",
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error(`[mail-cache] Token refresh failed (${resp.status}):`, text.slice(0, 200));
        return;
      }

      const data = await resp.json();
      if (data.access_token) {
        this.creds.accessToken = data.access_token;
        console.log(`[mail-cache] OAuth2 token refreshed for ${this.key}`);
      }
      if (data.refresh_token) {
        this.creds.refreshToken = data.refresh_token;
      }
    } catch (err) {
      console.error(`[mail-cache] Token refresh error for ${this.key}:`, (err as Error).message);
    }
  }

  /** Ensure we have a live IMAP connection */
  private async ensureConnected(): Promise<ImapFlow> {
    this.lastActivity = Date.now();

    // Refresh OAuth2 token if needed (even if already connected, token might have expired)
    if (this.creds.authMode === "oauth2") {
      await this.ensureTokenFresh();
    }

    if (this.client && this.connected) return this.client;
    if (this.connecting) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!this.connecting) { clearInterval(check); resolve(); }
        }, 50);
      });
      if (this.client && this.connected) return this.client;
    }

    this.connecting = true;
    try {
      const authConfig = this.creds.authMode === "oauth2"
        ? { user: this.creds.user, accessToken: this.creds.accessToken! }
        : { user: this.creds.user, pass: this.creds.pass };

      this.client = new ImapFlow({
        host: this.creds.host,
        port: this.creds.port,
        secure: this.creds.secure,
        auth: authConfig,
        logger: false,
        emitLogs: false,
      });

      this.client.on("close", () => {
        this.connected = false;
        console.log(`[mail-cache] Connection closed for ${this.key}`);
      });
      this.client.on("error", () => {
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;
      console.log(`[mail-cache] Connected to ${this.key} (${this.creds.authMode || "password"})`);

      // Start background refresh
      if (!this.refreshTimer) {
        this.refreshTimer = setInterval(() => this.backgroundRefresh(), 30_000);
      }

      return this.client;
    } catch (err) {
      this.client = null;
      this.connected = false;
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  /** Background refresh: re-fetch ALL INBOX messages + preload new bodies */
  private async backgroundRefresh() {
    if (Date.now() - this.lastActivity > MailAccountCache.IDLE_TIMEOUT) {
      this.destroy();
      return;
    }

    try {
      await this.fetchFolders(true);
      // Fetch inbox messages — use large pageSize to get all
      const result = await this.fetchMessages("INBOX", true, 1, 5000);
      // Preload bodies for any new messages not yet cached
      this.preloadBodies("INBOX", result.messages).catch(() => {});
    } catch {
      this.connected = false;
    }
  }

  /** Fetch and cache folder list */
  async fetchFolders(force = false): Promise<CachedFolder[]> {
    if (!force && this.folders.length > 0 && Date.now() - this.foldersTs < MailAccountCache.FOLDER_TTL) {
      return this.folders;
    }

    const client = await this.ensureConnected();
    const list = await client.list();
    this.folders = list.map((f) => ({
      path: f.path,
      name: f.name,
      delimiter: f.delimiter,
      flags: Array.from(f.flags || []),
      specialUse: f.specialUse || null,
      listed: f.listed,
      messages: f.status?.messages ?? null,
      unseen: f.status?.unseen ?? null,
    }));
    this.foldersTs = Date.now();
    return this.folders;
  }

  /** Fetch and cache messages for a folder */
  async fetchMessages(folder: string, force = false, page = 1, pageSize = 50, sinceDays?: number): Promise<{ messages: CachedMessage[]; total: number }> {
    // pageSize=0 means "all" — use large number
    if (pageSize === 0) pageSize = 5000;
    const cacheKey = `${folder}:${page}:${pageSize}:${sinceDays || "all"}`;

    if (!force) {
      const cached = this.folderMessages.get(cacheKey);
      if (cached && Date.now() - cached.ts < MailAccountCache.MSG_LIST_TTL) {
        return { messages: cached.messages, total: cached.total };
      }
    }

    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      const status = client.mailbox;
      const total = status?.exists || 0;

      // Note: Office365 may report exists=0 even when there ARE messages.
      // We don't short-circuit here — let the fetch attempt run.

      // Use IMAP SEARCH with SINCE date filter when sinceDays is specified
      let fetchRange: string | number[];
      if (sinceDays && sinceDays > 0) {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - sinceDays);
        const uids = await client.search({ since: sinceDate }, { uid: true });
        if (!uids || uids.length === 0) {
          const result = { messages: [] as CachedMessage[], total: 0 };
          this.folderMessages.set(cacheKey, { ...result, ts: Date.now() });
          return result;
        }
        const sortedUids = [...uids].sort((a, b) => b - a);
        const startIdx = (page - 1) * pageSize;
        const pageUids = sortedUids.slice(startIdx, startIdx + pageSize);
        if (pageUids.length === 0) {
          return { messages: [], total: sortedUids.length };
        }
        fetchRange = pageUids;
      } else {
        const end = total;
        const start = Math.max(1, end - (page * pageSize) + 1);
        const fetchEnd = Math.max(1, end - ((page - 1) * pageSize));
        fetchRange = `${start}:${fetchEnd}`;
      }

      const messages: CachedMessage[] = [];
      const fetchOptions = { envelope: true, flags: true, bodyStructure: true, uid: true };
      const useUidFetch = Array.isArray(fetchRange);
      const fetchSource = useUidFetch
        ? client.fetch(fetchRange as number[], fetchOptions, { uid: true })
        : client.fetch(fetchRange as string, fetchOptions);
      for await (const msg of fetchSource) {
        let hasAttachments = false;
        if (msg.bodyStructure) {
          const checkParts = (part: typeof msg.bodyStructure): boolean => {
            if (part.disposition === "attachment" || (part.disposition === "inline" && part.type !== "text/plain" && part.type !== "text/html")) return true;
            if (part.childNodes) return part.childNodes.some(checkParts);
            return false;
          };
          hasAttachments = checkParts(msg.bodyStructure);
        }

        messages.push({
          uid: msg.uid,
          seq: msg.seq,
          flags: Array.from(msg.flags || []),
          date: msg.envelope?.date?.toISOString() || null,
          subject: msg.envelope?.subject || "(geen onderwerp)",
          from: msg.envelope?.from?.map((a) => ({ name: a.name || "", address: `${a.mailbox}@${a.host}` })) || [],
          to: msg.envelope?.to?.map((a) => ({ name: a.name || "", address: `${a.mailbox}@${a.host}` })) || [],
          seen: msg.flags?.has("\\Seen") || false,
          flagged: msg.flags?.has("\\Flagged") || false,
          hasAttachments,
        });
      }

      messages.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

      this.folderMessages.set(cacheKey, { messages, total, ts: Date.now() });
      return { messages, total };
    } finally {
      lock.release();
    }
  }

  /**
   * Parse a message source into a CachedFullMessage.
   * Extracts text/html body and attachment metadata, then discards binary content.
   */
  private static async parseMessage(
    envelope: any, flags: any, source: Buffer | null
  ): Promise<{ textBody: string; htmlBody: string; attachments: AttachmentMeta[] }> {
    let textBody = "";
    let htmlBody = "";
    const attachments: AttachmentMeta[] = [];

    if (source) {
      const parsed = await simpleParser(source);
      textBody = parsed.text || "";
      htmlBody = parsed.html || "";
      // Extract attachment metadata only — discard binary content immediately
      if (parsed.attachments?.length) {
        for (const a of parsed.attachments) {
          attachments.push({
            filename: a.filename || "bijlage",
            contentType: a.contentType || "application/octet-stream",
            size: a.size || 0,
            cid: a.cid || undefined,
          });
        }
      }
      // parsed object (with binary content) goes out of scope and gets GC'd
    }

    return { textBody, htmlBody, attachments };
  }

  private static buildFullMessage(
    uid: number, envelope: any, flags: any,
    body: { textBody: string; htmlBody: string; attachments: AttachmentMeta[] },
    markSeen = false
  ): CachedFullMessage {
    return {
      uid,
      seq: 0,
      flags: Array.from(flags || []),
      date: envelope?.date?.toISOString() || null,
      subject: envelope?.subject || "(geen onderwerp)",
      from: envelope?.from?.map((a: any) => ({ name: a.name || "", address: `${a.mailbox}@${a.host}` })) || [],
      to: envelope?.to?.map((a: any) => ({ name: a.name || "", address: `${a.mailbox}@${a.host}` })) || [],
      cc: envelope?.cc?.map((a: any) => ({ name: a.name || "", address: `${a.mailbox}@${a.host}` })) || [],
      seen: markSeen || flags?.has?.("\\Seen") || false,
      flagged: flags?.has?.("\\Flagged") || false,
      hasAttachments: body.attachments.length > 0,
      textBody: body.textBody,
      htmlBody: body.htmlBody,
      attachments: body.attachments,
    };
  }

  /**
   * Preload message bodies for a folder.
   * Downloads source but discards attachment binary content immediately.
   * Only metadata (filename, size, type) is kept.
   */
  async preloadBodies(folder: string, messages: CachedMessage[]): Promise<void> {
    if (this.preloadingBodies) return;
    this.preloadingBodies = true;

    const uncachedUids = messages
      .filter(m => !this.fullMessages.has(`${folder}:${m.uid}`))
      .map(m => m.uid);

    if (uncachedUids.length === 0) {
      this.preloadingBodies = false;
      return;
    }

    console.log(`[mail-cache] Preloading ${uncachedUids.length} message bodies for ${folder} (${this.key})`);
    const startTime = Date.now();

    try {
      const client = await this.ensureConnected();
      const lock = await client.getMailboxLock(folder);
      try {
        for (const uid of uncachedUids) {
          const cacheKey = `${folder}:${uid}`;
          if (this.fullMessages.has(cacheKey)) continue;

          try {
            const msg = await client.fetchOne(`${uid}`, {
              envelope: true, flags: true, source: true, uid: true,
            }, { uid: true });

            const body = await MailAccountCache.parseMessage(msg.envelope, msg.flags, msg.source);
            const fullMsg = MailAccountCache.buildFullMessage(msg.uid, msg.envelope, msg.flags, body);
            this.fullMessages.set(cacheKey, fullMsg);
          } catch (err) {
            console.warn(`[mail-cache] Failed to preload uid ${uid}:`, (err as Error).message);
          }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[mail-cache] Preloaded ${uncachedUids.length} bodies for ${folder} in ${elapsed}s. Total cached: ${this.fullMessages.size}`);
      } finally {
        lock.release();
      }
    } catch (err) {
      console.error(`[mail-cache] Preload error for ${folder}:`, (err as Error).message);
    } finally {
      this.preloadingBodies = false;
    }
  }

  /** Fetch a full message with body (served from cache if available) */
  async fetchFullMessage(folder: string, uid: number): Promise<CachedFullMessage> {
    const cacheKey = `${folder}:${uid}`;
    const cached = this.fullMessages.get(cacheKey);
    if (cached) return cached;

    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });

      const msg = await client.fetchOne(`${uid}`, {
        envelope: true, flags: true, source: true, uid: true,
      }, { uid: true });

      const body = await MailAccountCache.parseMessage(msg.envelope, msg.flags, msg.source);
      const fullMsg = MailAccountCache.buildFullMessage(msg.uid, msg.envelope, msg.flags, body, true);

      this.fullMessages.set(cacheKey, fullMsg);
      return fullMsg;
    } finally {
      lock.release();
    }
  }

  /** Remove a message from local caches only (for optimistic delete) */
  removeCachedMessage(folder: string, uid: number) {
    this.fullMessages.delete(`${folder}:${uid}`);
    // Remove from all folder message list caches
    for (const [key, cache] of this.folderMessages) {
      if (key.startsWith(`${folder}:`)) {
        cache.messages = cache.messages.filter(m => m.uid !== uid);
        cache.total = Math.max(0, cache.total - 1);
      }
    }
  }

  /** Delete a message via IMAP */
  async deleteMessage(folder: string, uid: number): Promise<void> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageDelete({ uid }, { uid: true });
    } finally {
      lock.release();
    }
    // Clean up any remaining cached data
    this.fullMessages.delete(`${folder}:${uid}`);
    for (const [key, cache] of this.folderMessages) {
      if (key.startsWith(`${folder}:`)) {
        cache.messages = cache.messages.filter(m => m.uid !== uid);
      }
    }
  }

  /** Move a message to another folder */
  async moveMessage(fromFolder: string, uid: number, toFolder: string): Promise<void> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(fromFolder);
    try {
      await client.messageMove({ uid }, toFolder, { uid: true });
    } finally {
      lock.release();
    }
    // Move cached body to new folder key
    const oldKey = `${fromFolder}:${uid}`;
    const cached = this.fullMessages.get(oldKey);
    if (cached) {
      this.fullMessages.delete(oldKey);
      // Don't set new key since UID changes after move
    }
    // Invalidate both folder caches
    this.invalidateFolder(fromFolder);
    this.invalidateFolder(toFolder);
  }

  /** Fetch a specific attachment's binary content */
  async fetchAttachment(folder: string, uid: number, index: number): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(`${uid}`, { source: true, uid: true }, { uid: true });
      if (!msg.source) return null;

      const parsed = await simpleParser(msg.source);
      const att = parsed.attachments?.[index];
      if (!att) return null;

      return {
        filename: att.filename || "bijlage",
        contentType: att.contentType || "application/octet-stream",
        content: att.content,
      };
    } finally {
      lock.release();
    }
  }

  /** Create a new mailbox folder */
  async createFolder(name: string): Promise<void> {
    const client = await this.ensureConnected();
    await client.mailboxCreate(name);
    // Refresh folder list
    this.foldersTs = 0;
    await this.fetchFolders(true);
  }

  /** Invalidate message list cache for a folder */
  invalidateFolder(folder: string) {
    for (const [key] of this.folderMessages) {
      if (key.startsWith(`${folder}:`)) this.folderMessages.delete(key);
    }
  }

  /** Append a raw message to a folder (for saving sent mail) */
  async appendMessage(folder: string, rawMessage: Buffer, flags: string[] = ["\\Seen"]): Promise<void> {
    const client = await this.ensureConnected();
    await client.append(folder, rawMessage, flags);
    this.invalidateFolder(folder);
  }

  /** Mark a message as unread */
  async markUnread(folder: string, uid: number): Promise<void> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsRemove({ uid }, ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }
    const cacheKey = `${folder}:${uid}`;
    const cached = this.fullMessages.get(cacheKey);
    if (cached) cached.seen = false;
    this.invalidateFolder(folder);
  }

  /** Rename a mailbox folder */
  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    const client = await this.ensureConnected();
    await client.mailboxRename(oldPath, newPath);
    this.foldersTs = 0;
    await this.fetchFolders(true);
  }

  /** Get cache stats */
  getStats() {
    return {
      folders: this.folders.length,
      folderCaches: this.folderMessages.size,
      cachedBodies: this.fullMessages.size,
      connected: this.connected,
      preloading: this.preloadingBodies,
    };
  }

  /** Disconnect and clean up */
  destroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.client) {
      this.client.logout().catch(() => {});
      this.client = null;
    }
    this.connected = false;
    console.log(`[mail-cache] Destroyed cache for ${this.key}`);
  }
}

/* ─── Global cache registry ─── */

const accountCaches = new Map<string, MailAccountCache>();

function getAccountCache(creds: MailCredentials): MailAccountCache {
  const key = `${creds.host}:${creds.port}:${creds.user}`;
  let cache = accountCaches.get(key);
  if (!cache) {
    cache = new MailAccountCache(creds);
    accountCaches.set(key, cache);
    console.log(`[mail-cache] Created cache for ${creds.user}@${creds.host} (${creds.authMode || "password"})`);
  } else {
    // Update credentials (e.g. refreshed OAuth2 tokens)
    cache.updateCredentials(creds);
  }
  return cache;
}

/* ─── Cached resolved credentials per instance+email ─── */
const resolvedCredsCache = new Map<string, { creds: MailCredentials; ts: number }>();
const CREDS_CACHE_TTL = 4 * 60 * 1000; // 4 min (OAuth2 tokens last 5 min)

/** Resolve credentials server-side from instance+email, with caching */
async function resolveCredentials(instanceId: string, email: string): Promise<MailCredentials | null> {
  const cacheKey = `${instanceId}:${email}`;
  const cached = resolvedCredsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CREDS_CACHE_TTL) return cached.creds;

  const data = await mailAutoConfigInternal(instanceId, email);
  if (!data?.host) return null;

  const creds: MailCredentials = {
    host: data.host,
    port: data.port || 993,
    user: data.user || email,
    pass: data.pass || "",
    secure: data.secure !== false,
    authMode: data.authMode || "password",
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    tokenUri: data.tokenUri,
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort,
    smtpSecure: data.smtpSecure,
  };
  resolvedCredsCache.set(cacheKey, { creds, ts: Date.now() });
  return creds;
}

/* ─── Helpers ─── */

async function getCredentials(req: Request): Promise<MailCredentials | null> {
  // New approach: resolve from instance + email (server-side)
  const instanceId = req.query.instance as string;
  const email = req.query.email as string;
  if (instanceId && email) {
    return resolveCredentials(instanceId, email);
  }

  // Legacy: full credentials in query params
  const host = req.query.host as string;
  const port = parseInt(req.query.port as string || "993", 10);
  const user = req.query.user as string;
  const pass = req.query.pass as string || "";
  const secure = req.query.secure !== "false";
  const authMode = (req.query.authMode as string) || "password";

  if (authMode === "oauth2") {
    if (!host || !user) return null;
    return {
      host, port, user, pass, secure,
      authMode: "oauth2",
      accessToken: req.query.accessToken as string,
      refreshToken: req.query.refreshToken as string,
      clientId: req.query.clientId as string,
      clientSecret: req.query.clientSecret as string,
      tokenUri: req.query.tokenUri as string,
    };
  }

  if (!host || !user || !pass) return null;
  return { host, port, user, pass, secure };
}

function getCredentialsFromBody(body: Record<string, unknown>): MailCredentials | null {
  const host = body.host as string;
  const port = parseInt(String(body.port || "993"), 10);
  const user = body.user as string;
  const pass = (body.pass as string) || "";
  const secure = body.secure !== false;
  const authMode = (body.authMode as string) || "password";

  if (authMode === "oauth2") {
    if (!host || !user) return null;
    return {
      host, port, user, pass, secure,
      authMode: "oauth2",
      accessToken: body.accessToken as string,
      refreshToken: body.refreshToken as string,
      clientId: body.clientId as string,
      clientSecret: body.clientSecret as string,
      tokenUri: body.tokenUri as string,
      smtpHost: body.smtpHost as string,
      smtpPort: body.smtpPort ? parseInt(String(body.smtpPort), 10) : undefined,
      smtpSecure: body.smtpSecure as boolean | undefined,
    };
  }

  if (!host || !user || !pass) return null;
  return { host, port, user, pass, secure };
}

/** One-off connection for test only */
async function withClient<T>(
  creds: MailCredentials,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const authConfig = creds.authMode === "oauth2"
    ? { user: creds.user, accessToken: creds.accessToken! }
    : { user: creds.user, pass: creds.pass };

  const client = new ImapFlow({
    host: creds.host, port: creds.port, secure: creds.secure,
    auth: authConfig, logger: false,
  });
  await client.connect();
  try { return await fn(client); }
  finally { await client.logout().catch(() => {}); }
}

/* ─── API Handlers ─── */

/** Test connection */
export async function mailTestConnection(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing host, user, or pass" });

  try {
    await withClient(creds, async () => {});
    getAccountCache(creds);
    res.json({ ok: true, message: `Verbonden als ${creds.user}` });
  } catch (err) {
    res.status(401).json({ ok: false, error: (err as Error).message });
  }
}

/** List mailbox folders — served from cache */
export async function mailListFolders(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  try {
    const cache = getAccountCache(creds);
    const folders = await cache.fetchFolders();
    res.json({ data: folders });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** List messages — served from cache */
export async function mailListMessages(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  const folder = (req.query.folder as string) || "INBOX";
  const page = parseInt(req.query.page as string || "1", 10);
  const pageSize = parseInt(req.query.pageSize as string || "50", 10);
  const sinceDays = req.query.sinceDays ? parseInt(req.query.sinceDays as string, 10) : undefined;

  try {
    const cache = getAccountCache(creds);
    const result = await cache.fetchMessages(folder, false, page, pageSize, sinceDays);
    // Preload message bodies in background for fast opening
    if (result.messages.length > 0) {
      cache.preloadBodies(folder, result.messages).catch(() => {});
    }
    res.json({ data: { ...result, page, pageSize } });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Get single message with body — served from cache */
export async function mailGetMessage(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  const folder = (req.query.folder as string) || "INBOX";
  const uid = parseInt(req.query.uid as string || "0", 10);
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  try {
    const cache = getAccountCache(creds);
    const result = await cache.fetchFullMessage(folder, uid);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Send an email via SMTP */
export async function mailSend(req: Request, res: Response) {
  const { smtp: smtpInput, imap: imapInput, instance, email,
    from, to, cc, bcc, subject, html, text, inReplyTo, references, attachments: rawAttachments } = req.body as {
    smtp?: { host: string; port: number; user: string; pass: string; secure: boolean; authMode?: string; accessToken?: string };
    imap?: { host: string; port: number; user: string; pass: string; secure: boolean; authMode?: string; accessToken?: string; refreshToken?: string; clientId?: string; clientSecret?: string; tokenUri?: string };
    instance?: string; email?: string;
    from: string; to: string[]; cc?: string[]; bcc?: string[];
    subject: string; html?: string; text?: string;
    inReplyTo?: string; references?: string;
    attachments?: { filename: string; content: string; contentType: string }[];
  };

  if (!to || to.length === 0) return res.status(400).json({ error: "Missing recipients" });

  // Resolve credentials server-side if instance + email provided
  let smtp = smtpInput;
  let imap = imapInput;
  if (!smtp && instance && email) {
    try {
      const resolved = await resolveCredentials(instance, email);
      if (resolved) {
        smtp = {
          host: resolved.smtpHost || resolved.host,
          port: resolved.smtpPort || 587,
          user: resolved.user, pass: resolved.pass,
          secure: resolved.smtpSecure ?? false,
          authMode: resolved.authMode,
          accessToken: resolved.accessToken,
        };
        imap = {
          host: resolved.host, port: resolved.port,
          user: resolved.user, pass: resolved.pass, secure: resolved.secure,
          authMode: resolved.authMode, accessToken: resolved.accessToken,
          refreshToken: resolved.refreshToken, clientId: resolved.clientId,
          clientSecret: resolved.clientSecret, tokenUri: resolved.tokenUri,
        };
      }
    } catch { /* fallthrough */ }
  }

  if (!smtp?.host || !smtp?.user) return res.status(400).json({ error: "Missing SMTP credentials" });
  if (smtp.authMode !== "oauth2" && !smtp.pass) return res.status(400).json({ error: "Missing SMTP password" });

  try {
    const smtpAuth = smtp.authMode === "oauth2"
      ? { type: "OAuth2" as const, user: smtp.user, accessToken: smtp.accessToken! }
      : { user: smtp.user, pass: smtp.pass };

    const transport = createTransport({
      host: smtp.host, port: smtp.port || 587,
      secure: smtp.authMode === "oauth2" ? false : (smtp.secure ?? (smtp.port === 465)),
      auth: smtpAuth,
    } as any);

    const mailAttachments = rawAttachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
      contentType: a.contentType,
    }));

    const mailOptions = {
      from: from || smtp.user, to: to.join(", "),
      cc: cc?.join(", "), bcc: bcc?.join(", "),
      subject, html, text, inReplyTo, references,
      attachments: mailAttachments,
    };

    const info = await transport.sendMail(mailOptions);

    // Save to Sent folder via IMAP APPEND (fire-and-forget)
    if (imap?.host && imap?.user && (imap?.pass || imap?.authMode === "oauth2")) {
      (async () => {
        try {
          const imapCreds: MailCredentials = {
            host: imap.host, port: imap.port || 993,
            user: imap.user, pass: imap.pass || "", secure: imap.secure ?? true,
            ...(imap.authMode === "oauth2" ? {
              authMode: "oauth2" as const,
              accessToken: imap.accessToken,
              refreshToken: imap.refreshToken,
              clientId: imap.clientId,
              clientSecret: imap.clientSecret,
              tokenUri: imap.tokenUri,
            } : {}),
          };
          const cache = getAccountCache(imapCreds);

          // Build raw MIME message using streamTransport
          const rawTransport = createTransport({ streamTransport: true } as any);
          const rawResult = await rawTransport.sendMail(mailOptions);
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            rawResult.message.on("data", (chunk: Buffer) => chunks.push(chunk));
            rawResult.message.on("end", () => resolve());
            rawResult.message.on("error", reject);
          });
          const rawMessage = Buffer.concat(chunks);

          // Find Sent folder
          const folders = await cache.fetchFolders();
          const sentFolder = folders.find(f =>
            f.specialUse === "\\Sent" ||
            f.path === "Sent" ||
            f.path === "INBOX.Sent" ||
            f.path === "Sent Items" ||
            f.path === "Sent Messages"
          );

          if (sentFolder) {
            await cache.appendMessage(sentFolder.path, rawMessage, ["\\Seen"]);
            console.log(`[mail] Saved sent message to ${sentFolder.path}`);
          }
        } catch (err) {
          console.warn("[mail] Failed to save to Sent:", (err as Error).message);
        }
      })();
    }

    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Delete a message */
export async function mailDeleteMessage(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  const folder = (req.query.folder as string) || "INBOX";
  const uid = parseInt(req.query.uid as string || "0", 10);
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  // Respond immediately — delete in background
  const cache = getAccountCache(creds);
  // Remove from cache immediately so frontend sees it gone
  cache.removeCachedMessage(folder, uid);
  res.json({ ok: true });
  // Async IMAP delete
  cache.deleteMessage(folder, uid).catch(err => {
    console.error(`[mail] Background delete failed for uid ${uid}:`, (err as Error).message);
  });
}

/**
 * Warm up cache — call from frontend on app init.
 * Accepts POST with credentials in body (more secure than query params).
 * Falls back to GET with query params for compatibility.
 *
 * This does:
 * 1. Connect to IMAP (persistent connection)
 * 2. Fetch folder list
 * 3. Fetch INBOX message list
 * 4. Preload ALL INBOX message bodies (excl. attachments) in background
 */
export async function mailWarmup(req: Request, res: Response) {
  const creds = req.method === "POST"
    ? getCredentialsFromBody(req.body)
    : await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  try {
    const cache = getAccountCache(creds);

    // Fire and forget: load folders + INBOX + preload all bodies
    (async () => {
      try {
        await cache.fetchFolders(true);
        const result = await cache.fetchMessages("INBOX", true);
        console.log(`[mail-cache] Warmup: ${result.messages.length} messages in INBOX, starting body preload...`);
        await cache.preloadBodies("INBOX", result.messages);
      } catch (err) {
        console.error(`[mail-cache] Warmup error:`, (err as Error).message);
      }
    })();

    res.json({ ok: true, message: "Cache warming started — all bodies will be preloaded" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Download a specific attachment from a message */
export async function mailGetAttachment(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  const folder = (req.query.folder as string) || "INBOX";
  const uid = parseInt(req.query.uid as string || "0", 10);
  const attachIdx = parseInt(req.query.index as string || "0", 10);
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  try {
    const cache = getAccountCache(creds);
    const result = await cache.fetchAttachment(folder, uid, attachIdx);
    if (!result) return res.status(404).json({ error: "Attachment not found" });

    res.set("Content-Type", result.contentType);
    res.set("Content-Disposition", `inline; filename="${encodeURIComponent(result.filename)}"`);
    res.send(result.content);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Create a new mailbox folder */
export async function mailCreateFolder(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  const folderName = req.query.name as string;
  if (!folderName) return res.status(400).json({ error: "Missing folder name" });

  try {
    const cache = getAccountCache(creds);
    await cache.createFolder(folderName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Move a message to another folder */
export async function mailMoveMessage(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  const fromFolder = (req.query.folder as string) || "INBOX";
  const uid = parseInt(req.query.uid as string || "0", 10);
  const toFolder = req.query.toFolder as string;
  if (!uid) return res.status(400).json({ error: "Missing uid" });
  if (!toFolder) return res.status(400).json({ error: "Missing toFolder" });

  // Respond immediately — move in background
  const cache = getAccountCache(creds);
  cache.removeCachedMessage(fromFolder, uid);
  res.json({ ok: true });
  cache.moveMessage(fromFolder, uid, toFolder).catch(err => {
    console.error(`[mail] Background move failed for uid ${uid}:`, (err as Error).message);
  });
}

/** Mark a message as unread */
export async function mailMarkUnread(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  const folder = (req.query.folder as string) || "INBOX";
  const uid = parseInt(req.query.uid as string || "0", 10);
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  try {
    const cache = getAccountCache(creds);
    await cache.markUnread(folder, uid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Rename a mailbox folder */
export async function mailRenameFolder(req: Request, res: Response) {
  const creds = await getCredentials(req);
  if (!creds) return res.status(400).json({ error: "Missing credentials" });

  // Read from body (preferred) or fall back to query params for backward compat
  const oldPath = (req.body?.oldPath as string) || (req.query.oldPath as string);
  const newPath = (req.body?.newPath as string) || (req.query.newPath as string);
  if (!oldPath || !newPath) return res.status(400).json({ error: "Missing oldPath or newPath" });

  try {
    const cache = getAccountCache(creds);
    await cache.renameFolder(oldPath, newPath);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[Mail] Failed to rename folder "${oldPath}" -> "${newPath}":`, (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
}

/** Get cache stats */
export async function mailCacheStats(_req: Request, res: Response) {
  const stats: Record<string, unknown> = {};
  for (const [key, cache] of accountCaches) {
    stats[key] = cache.getStats();
  }
  res.json({ data: stats });
}

/** Auto-configure mail from ERPNext (fetches OAuth tokens for Office 365) */
/** Internal auto-config logic (no Express dependency) */
export async function mailAutoConfigInternal(instanceId: string, email: string): Promise<any> {
  const inst = getInstance(instanceId);
  if (!inst) throw new Error("Unknown instance: " + instanceId);

  // Fetch Email Account
  const emailAccResult = await proxyRequest(inst,
    `/api/resource/Email Account?filters=${encodeURIComponent(JSON.stringify([["email_id", "=", email]]))}&fields=${encodeURIComponent(JSON.stringify(["name", "email_id", "email_server", "incoming_port", "use_ssl", "smtp_server", "smtp_port", "use_tls", "signature"]))}`
  );
  const emailAccounts = JSON.parse(emailAccResult.body)?.data || [];
  if (emailAccounts.length === 0) throw new Error("Email Account not found in ERPNext");
  const emailAcc = emailAccounts[0];

  // Fetch Connected App (Microsoft 365)
  const connAppResult = await proxyRequest(inst,
    `/api/resource/Connected App?fields=${encodeURIComponent(JSON.stringify(["name", "client_id", "provider_name", "token_uri"]))}&limit_page_length=10`
  );
  const allConnApps = JSON.parse(connAppResult.body)?.data || [];
  const connApps = allConnApps.filter((a: any) => a.provider_name?.toLowerCase().includes("microsoft") || a.client_id);

  if (connApps.length === 0) {
    // No Connected App found — return basic config with password from ERPNext
    let password = "";
    try {
      const pwResult = await proxyRequest(inst,
        `/api/method/frappe.client.get_password?doctype=Email+Account&name=${encodeURIComponent(emailAcc.name)}&fieldname=password`
      );
      password = JSON.parse(pwResult.body)?.message || "";
    } catch { /* ignore */ }

    // Also check vault for stored credentials
    if (!password) {
      try {
        const vaultEntries = (await import("./vault.js")).readVault();
        const entry = vaultEntries.find((e: any) => e.id === instanceId);
        if (entry?.mailPass && entry?.mailUser === email) {
          password = entry.mailPass;
        }
      } catch { /* ignore */ }
    }

    return {
      authMode: "password",
      host: emailAcc.email_server || "",
      port: parseInt(emailAcc.incoming_port || "993"),
      user: email,
      pass: password,
      secure: !!emailAcc.use_ssl,
      smtpHost: emailAcc.smtp_server || "",
      smtpPort: parseInt(emailAcc.smtp_port || "587"),
      smtpSecure: false,
      signature: emailAcc.signature || "",
    };
  }

  const connApp = connApps[0];

  // Get client secret
  const secretResult = await proxyRequest(inst,
    `/api/method/frappe.client.get_password?doctype=Connected+App&name=${encodeURIComponent(connApp.name)}&fieldname=client_secret`
  );
  const clientSecret = JSON.parse(secretResult.body)?.message || "";

  // Get Token Cache
  const tokenName = `${connApp.name}-${email}`;
  const accessTokenResult = await proxyRequest(inst,
    `/api/method/frappe.client.get_password?doctype=Token+Cache&name=${encodeURIComponent(tokenName)}&fieldname=access_token`
  );
  const accessToken = JSON.parse(accessTokenResult.body)?.message || "";

  const refreshTokenResult = await proxyRequest(inst,
    `/api/method/frappe.client.get_password?doctype=Token+Cache&name=${encodeURIComponent(tokenName)}&fieldname=refresh_token`
  );
  const refreshToken = JSON.parse(refreshTokenResult.body)?.message || "";

  // Always try to refresh the token (it's likely expired)
  let finalAccessToken = accessToken;
  if (refreshToken && clientSecret && connApp.client_id && connApp.token_uri) {
    try {
      console.log("[mail-auto-config] Refreshing OAuth2 token for", email);
      const tokenBody = new URLSearchParams({
        client_id: connApp.client_id,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "https://outlook.office365.com/IMAP.AccessAsUser.All https://outlook.office365.com/SMTP.Send offline_access",
      });
      const tokenResp = await fetch(connApp.token_uri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      });
      const tokenResult = await tokenResp.json() as { access_token?: string; error?: string; error_description?: string };
      if (tokenResult.access_token) {
        finalAccessToken = tokenResult.access_token;
        console.log("[mail-auto-config] Token refreshed successfully for", email);
      } else {
        console.error("[mail-auto-config] Token refresh returned error:", tokenResult.error, tokenResult.error_description);
      }
    } catch (e) {
      console.error("[mail-auto-config] Token refresh fetch failed:", (e as Error).message);
    }
  }

  return {
    authMode: finalAccessToken ? "oauth2" : "password",
    host: emailAcc.email_server || "outlook.office365.com",
    port: parseInt(emailAcc.incoming_port || "993"),
    user: email,
    secure: emailAcc.use_ssl !== 0,
    smtpHost: emailAcc.smtp_server || "smtp.office365.com",
    smtpPort: parseInt(emailAcc.smtp_port || "587"),
    smtpSecure: false, // O365 uses STARTTLS
    accessToken: finalAccessToken,
    refreshToken,
    clientId: connApp.client_id,
    clientSecret,
    tokenUri: connApp.token_uri,
    signature: emailAcc.signature || "",
  };
}

export async function mailAutoConfig(req: Request, res: Response) {
  const instanceId = req.query.instance as string;
  const email = req.query.email as string;
  if (!instanceId || !email) return res.status(400).json({ error: "Missing instance or email" });

  try {
    const data = await mailAutoConfigInternal(instanceId, email);
    res.json({ data });
  } catch (err) {
    console.error("[mail-auto-config] Error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
}

/* ─── Startup warmup: preload all configured mail accounts ─── */

/**
 * Called once on server startup. Discovers all email accounts across instances
 * and eagerly connects + preloads INBOX so the frontend loads instantly.
 */
export async function mailStartupWarmup(): Promise<void> {
  const instances = getAllInstances();
  console.log(`[mail-warmup] Starting eager warmup for ${instances.length} instance(s)...`);

  for (const inst of instances) {
    try {
      // Find all Email Account doctypes for this instance
      const result = await proxyRequest(inst,
        `/api/resource/Email Account?fields=${encodeURIComponent(JSON.stringify(["name", "email_id", "enable_incoming"]))}&filters=${encodeURIComponent(JSON.stringify([["enable_incoming", "=", 1]]))}&limit_page_length=20`
      );
      const accounts = JSON.parse(result.body)?.data || [];

      for (const acc of accounts) {
        const email = acc.email_id;
        if (!email) continue;

        console.log(`[mail-warmup] Warming up ${email} (${inst.id})...`);
        try {
          const creds = await resolveCredentials(inst.id, email);
          if (!creds) {
            console.warn(`[mail-warmup] No credentials for ${email}`);
            continue;
          }

          const cache = getAccountCache(creds);

          // Fetch folders + INBOX message list + preload bodies — all in background
          const folders = await cache.fetchFolders(true);
          console.log(`[mail-warmup] ${email}: ${folders.length} folders`);

          const msgResult = await cache.fetchMessages("INBOX", true, 1, 5000);
          console.log(`[mail-warmup] ${email}: ${msgResult.messages.length} messages in INBOX`);

          // Preload bodies in background (fire-and-forget)
          if (msgResult.messages.length > 0) {
            cache.preloadBodies("INBOX", msgResult.messages).catch(() => {});
          }
        } catch (err) {
          console.error(`[mail-warmup] Failed for ${email}:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.error(`[mail-warmup] Failed to list accounts for ${inst.id}:`, (err as Error).message);
    }
  }

  console.log(`[mail-warmup] Startup warmup complete`);
}

/** Check if a mail account cache is warm (has messages loaded) */
export function mailIsWarm(req: Request, res: Response) {
  const instanceId = req.query.instance as string;
  const email = req.query.email as string;
  if (!instanceId || !email) return res.json({ warm: false });

  // Check if we already have a cache for this email
  for (const [key, cache] of accountCaches) {
    if (key.includes(email)) {
      const stats = cache.getStats();
      const warm = stats.folderCaches > 0 || stats.cachedBodies > 0;
      return res.json({ warm, stats });
    }
  }
  res.json({ warm: false });
}

/* ─── Internal functions for health checks ─── */

export async function listFoldersInternal(creds: MailCredentials): Promise<CachedFolder[]> {
  const cache = getAccountCache(creds);
  return cache.fetchFolders();
}

export async function listMessagesInternal(opts: MailCredentials & { folder?: string; pageSize?: number }): Promise<{ messages: CachedMessage[]; total: number }> {
  const cache = getAccountCache(opts);
  return cache.fetchMessages(opts.folder || "INBOX", false, 1, opts.pageSize || 50);
}
