/**
 * Health Check & Auto Tests
 *
 * Runs connectivity tests for email (IMAP/SMTP) and messenger services
 * across all configured instances. Results are cached and refreshed periodically.
 *
 * - GET /api/health          → full health report
 * - GET /api/health/run      → force re-run all tests
 * - GET /api/health/mail     → mail-only results
 * - GET /api/health/messenger → messenger-only results
 */

import type { Request, Response } from "express";
import { getAllInstances, getInstance, proxyRequest } from "./erpnext-client.js";
import { readVault } from "./vault.js";
import { ImapFlow } from "imapflow";

/* ─── Types ─── */

interface TestResult {
  service: string;
  instance: string;
  status: "ok" | "fail" | "skip";
  message: string;
  durationMs: number;
  timestamp: string;
}

interface HealthReport {
  overall: "ok" | "degraded" | "fail";
  lastRun: string;
  tests: TestResult[];
}

let cachedReport: HealthReport | null = null;
let running = false;

/* ─── Test runners ─── */

async function testImapConnection(
  host: string, port: number, user: string, pass: string,
  secure: boolean, authMode?: string, accessToken?: string
): Promise<{ ok: boolean; message: string; durationMs: number }> {
  const start = Date.now();
  try {
    const auth = authMode === "oauth2"
      ? { user, accessToken: accessToken! }
      : { user, pass };

    const client = new ImapFlow({
      host, port, secure,
      auth: auth as any,
      logger: false,
      emitLogs: false,
    });

    await client.connect();
    // Quick mailbox check
    const lock = await client.getMailboxLock("INBOX");
    const count = client.mailbox?.exists ?? 0;
    lock.release();
    await client.logout();

    return { ok: true, message: `INBOX: ${count} berichten`, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, message: (err as Error).message, durationMs: Date.now() - start };
  }
}

async function testMailAutoConfig(instanceId: string, email: string): Promise<TestResult> {
  const start = Date.now();
  const inst = getInstance(instanceId);
  if (!inst) {
    return { service: "mail-config", instance: instanceId, status: "fail", message: "Instance niet gevonden", durationMs: 0, timestamp: new Date().toISOString() };
  }

  try {
    // Fetch Email Account
    const emailAccResult = await proxyRequest(inst,
      `/api/resource/Email Account?filters=${encodeURIComponent(JSON.stringify([["email_id", "=", email]]))}&fields=${encodeURIComponent(JSON.stringify(["name", "email_id", "email_server", "incoming_port", "use_ssl"]))}`
    );
    const accounts = JSON.parse(emailAccResult.body)?.data || [];
    if (accounts.length === 0) {
      return { service: "mail-config", instance: instanceId, status: "skip", message: `Geen Email Account voor ${email}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() };
    }
    return { service: "mail-config", instance: instanceId, status: "ok", message: `Email Account gevonden: ${accounts[0].name}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() };
  } catch (err) {
    return { service: "mail-config", instance: instanceId, status: "fail", message: (err as Error).message, durationMs: Date.now() - start, timestamp: new Date().toISOString() };
  }
}

async function testMailForInstance(instanceId: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const inst = getInstance(instanceId);
  if (!inst) return results;

  // Find email accounts for this instance
  try {
    const result = await proxyRequest(inst,
      `/api/resource/Email Account?fields=${encodeURIComponent(JSON.stringify(["name", "email_id", "email_server", "incoming_port", "use_ssl"]))}&limit_page_length=20`
    );
    const accounts = JSON.parse(result.body)?.data || [];

    // Check Connected Apps for OAuth2
    const connAppResult = await proxyRequest(inst,
      `/api/resource/Connected App?fields=${encodeURIComponent(JSON.stringify(["name", "client_id", "provider_name", "token_uri"]))}&limit_page_length=10`
    );
    const connApps = (JSON.parse(connAppResult.body)?.data || [])
      .filter((a: any) => a.provider_name?.toLowerCase().includes("microsoft") || a.client_id);
    const hasOAuth = connApps.length > 0;
    const connApp = connApps[0];

    // Get vault entry for password fallback
    const vaultEntries = readVault();
    const vaultEntry = vaultEntries.find(e => e.id === instanceId);

    for (const acc of accounts) {
      if (!acc.email_id || !acc.email_server) continue;

      const email = acc.email_id;
      const host = acc.email_server;
      const port = parseInt(acc.incoming_port || "993");
      const secure = acc.use_ssl !== 0;

      if (hasOAuth && connApp) {
        // Test OAuth2 IMAP
        try {
          const tokenName = `${connApp.name}-${email}`;
          const atResult = await proxyRequest(inst,
            `/api/method/frappe.client.get_password?doctype=Token+Cache&name=${encodeURIComponent(tokenName)}&fieldname=access_token`
          );
          const accessToken = JSON.parse(atResult.body)?.message || "";

          const rtResult = await proxyRequest(inst,
            `/api/method/frappe.client.get_password?doctype=Token+Cache&name=${encodeURIComponent(tokenName)}&fieldname=refresh_token`
          );
          const refreshToken = JSON.parse(rtResult.body)?.message || "";

          if (!accessToken && !refreshToken) {
            results.push({ service: "mail-imap", instance: instanceId, status: "skip", message: `${email}: Geen OAuth tokens in Token Cache`, durationMs: 0, timestamp: new Date().toISOString() });
            continue;
          }

          // Try to refresh token
          let finalToken = accessToken;
          if (refreshToken && connApp.client_id && connApp.token_uri) {
            try {
              const secretResult = await proxyRequest(inst,
                `/api/method/frappe.client.get_password?doctype=Connected+App&name=${encodeURIComponent(connApp.name)}&fieldname=client_secret`
              );
              const clientSecret = JSON.parse(secretResult.body)?.message || "";

              const tokenResp = await fetch(connApp.token_uri, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  client_id: connApp.client_id, client_secret: clientSecret,
                  refresh_token: refreshToken, grant_type: "refresh_token",
                  scope: "https://outlook.office365.com/IMAP.AccessAsUser.All https://outlook.office365.com/SMTP.Send offline_access",
                }),
              });
              const tokenData = await tokenResp.json() as { access_token?: string; error?: string };
              if (tokenData.access_token) finalToken = tokenData.access_token;
            } catch { /* use existing token */ }
          }

          const imap = await testImapConnection(host, port, email, "", secure, "oauth2", finalToken);
          results.push({
            service: "mail-imap", instance: instanceId,
            status: imap.ok ? "ok" : "fail",
            message: `${email} (OAuth2): ${imap.message}`,
            durationMs: imap.durationMs,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          results.push({ service: "mail-imap", instance: instanceId, status: "fail", message: `${email} (OAuth2): ${(err as Error).message}`, durationMs: 0, timestamp: new Date().toISOString() });
        }
      } else {
        // Test password IMAP
        let password = "";
        try {
          const pwResult = await proxyRequest(inst,
            `/api/method/frappe.client.get_password?doctype=Email+Account&name=${encodeURIComponent(acc.name)}&fieldname=password`
          );
          password = JSON.parse(pwResult.body)?.message || "";
        } catch { /* ignore */ }

        if (!password && vaultEntry?.mailPass && vaultEntry?.mailUser === email) {
          password = vaultEntry.mailPass;
        }

        if (!password) {
          results.push({ service: "mail-imap", instance: instanceId, status: "skip", message: `${email}: Geen wachtwoord beschikbaar`, durationMs: 0, timestamp: new Date().toISOString() });
          continue;
        }

        const imap = await testImapConnection(host, port, email, password, secure);
        results.push({
          service: "mail-imap", instance: instanceId,
          status: imap.ok ? "ok" : "fail",
          message: `${email}: ${imap.message}`,
          durationMs: imap.durationMs,
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    results.push({ service: "mail-imap", instance: instanceId, status: "fail", message: `Email accounts ophalen mislukt: ${(err as Error).message}`, durationMs: 0, timestamp: new Date().toISOString() });
  }

  return results;
}

async function testMessengerForInstance(instanceId: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const vaultEntries = readVault();
  const entry = vaultEntries.find(e => e.id === instanceId);
  if (!entry) return results;

  // Test NextCloud Talk
  if (entry.nextcloudUrl && entry.nextcloudUser && entry.nextcloudPass) {
    const start = Date.now();
    try {
      const url = entry.nextcloudUrl.replace(/\/+$/, "");
      const resp = await fetch(
        `${url}/ocs/v2.php/apps/spreed/api/v4/room?format=json`,
        {
          headers: {
            "OCS-APIRequest": "true",
            Authorization: "Basic " + Buffer.from(`${entry.nextcloudUser}:${entry.nextcloudPass}`).toString("base64"),
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        const rooms = data?.ocs?.data?.length ?? 0;
        results.push({ service: "messenger-nextcloud", instance: instanceId, status: "ok", message: `NextCloud Talk: ${rooms} gesprekken`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
      } else {
        results.push({ service: "messenger-nextcloud", instance: instanceId, status: "fail", message: `NextCloud Talk: HTTP ${resp.status}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
      }
    } catch (err) {
      results.push({ service: "messenger-nextcloud", instance: instanceId, status: "fail", message: `NextCloud Talk: ${(err as Error).message}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
    }
  }

  // Test Telegram
  if (entry.telegramBotToken) {
    const start = Date.now();
    try {
      const resp = await fetch(`https://api.telegram.org/bot${entry.telegramBotToken}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        results.push({ service: "messenger-telegram", instance: instanceId, status: "ok", message: `Telegram bot: @${data.result?.username}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
      } else {
        results.push({ service: "messenger-telegram", instance: instanceId, status: "fail", message: `Telegram: HTTP ${resp.status}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
      }
    } catch (err) {
      results.push({ service: "messenger-telegram", instance: instanceId, status: "fail", message: `Telegram: ${(err as Error).message}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
    }
  }

  return results;
}

/* ─── Frontend-simulation tests ─── */
/* These simulate exactly what the UI does: auto-config → folders → messages */

async function testFrontendMailFlow(instanceId: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const inst = getInstance(instanceId);
  if (!inst) return results;

  // Step 1: Find a primary email for this instance
  let primaryEmail = "";
  try {
    const empResult = await proxyRequest(inst,
      `/api/resource/Employee?fields=${encodeURIComponent(JSON.stringify(["name", "company_email", "user_id"]))}&limit_page_length=5`
    );
    const employees = JSON.parse(empResult.body)?.data || [];
    const withEmail = employees.find((e: any) => e.company_email);
    primaryEmail = withEmail?.company_email || employees[0]?.user_id || "";
  } catch { /* ignore */ }

  // Fallback: check vault
  if (!primaryEmail) {
    const vaultEntry = readVault().find(e => e.id === instanceId);
    if (vaultEntry?.mailUser) primaryEmail = vaultEntry.mailUser;
  }

  if (!primaryEmail) {
    results.push({ service: "frontend-mail", instance: instanceId, status: "skip", message: "Geen email adres gevonden", durationMs: 0, timestamp: new Date().toISOString() });
    return results;
  }

  // Step 2: Auto-config (exactly what frontend calls)
  const start = Date.now();
  let autoConfigData: any = null;
  try {
    // We call the internal mail auto-config logic directly
    const { mailAutoConfigInternal } = await import("./mail.js");
    autoConfigData = await mailAutoConfigInternal(instanceId, primaryEmail);
    if (!autoConfigData?.host) {
      results.push({ service: "frontend-autoconfig", instance: instanceId, status: "fail", message: `Auto-config voor ${primaryEmail}: geen host teruggegeven`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
      return results;
    }
    results.push({ service: "frontend-autoconfig", instance: instanceId, status: "ok", message: `Auto-config ${primaryEmail}: ${autoConfigData.authMode} via ${autoConfigData.host}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
  } catch (err) {
    results.push({ service: "frontend-autoconfig", instance: instanceId, status: "fail", message: `Auto-config: ${(err as Error).message}`, durationMs: Date.now() - start, timestamp: new Date().toISOString() });
    return results;
  }

  // Step 3: Load folders (simulates /api/mail/folders)
  const folderStart = Date.now();
  try {
    const { listFoldersInternal } = await import("./mail.js");
    const folders = await listFoldersInternal({
      host: autoConfigData.host,
      port: autoConfigData.port || 993,
      user: autoConfigData.user || primaryEmail,
      pass: autoConfigData.pass || "",
      secure: autoConfigData.secure !== false,
      authMode: autoConfigData.authMode,
      accessToken: autoConfigData.accessToken,
    });
    if (folders && folders.length > 0) {
      results.push({ service: "frontend-folders", instance: instanceId, status: "ok", message: `${folders.length} mappen geladen (${folders.map((f: any) => f.name).slice(0, 5).join(", ")})`, durationMs: Date.now() - folderStart, timestamp: new Date().toISOString() });
    } else {
      results.push({ service: "frontend-folders", instance: instanceId, status: "fail", message: "Geen mappen gevonden", durationMs: Date.now() - folderStart, timestamp: new Date().toISOString() });
    }
  } catch (err) {
    results.push({ service: "frontend-folders", instance: instanceId, status: "fail", message: `Mappen laden: ${(err as Error).message}`, durationMs: Date.now() - folderStart, timestamp: new Date().toISOString() });
  }

  // Step 4: Load INBOX messages (simulates /api/mail/messages?folder=INBOX)
  const msgStart = Date.now();
  try {
    const { listMessagesInternal } = await import("./mail.js");
    const result = await listMessagesInternal({
      host: autoConfigData.host,
      port: autoConfigData.port || 993,
      user: autoConfigData.user || primaryEmail,
      pass: autoConfigData.pass || "",
      secure: autoConfigData.secure !== false,
      authMode: autoConfigData.authMode,
      accessToken: autoConfigData.accessToken,
      folder: "INBOX",
      pageSize: 10,
    });
    const msgs = result?.messages || [];
    const total = result?.total || 0;
    if (msgs.length > 0) {
      results.push({ service: "frontend-inbox", instance: instanceId, status: "ok", message: `INBOX: ${msgs.length} berichten geladen (totaal: ${total}), eerste: "${(msgs[0]?.subject || "?").slice(0, 50)}"`, durationMs: Date.now() - msgStart, timestamp: new Date().toISOString() });
    } else {
      results.push({ service: "frontend-inbox", instance: instanceId, status: total > 0 ? "fail" : "ok", message: `INBOX: 0 berichten geladen (totaal: ${total})`, durationMs: Date.now() - msgStart, timestamp: new Date().toISOString() });
    }
  } catch (err) {
    results.push({ service: "frontend-inbox", instance: instanceId, status: "fail", message: `INBOX laden: ${(err as Error).message}`, durationMs: Date.now() - msgStart, timestamp: new Date().toISOString() });
  }

  return results;
}

async function testVaultCredentials(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const entries = readVault();
  const instances = getAllInstances();

  for (const inst of instances) {
    const entry = entries.find(e => e.id === inst.id);
    if (!entry) {
      results.push({ service: "vault", instance: inst.id, status: "fail", message: "Niet in vault", durationMs: 0, timestamp: new Date().toISOString() });
      continue;
    }

    const checks: string[] = [];
    if (entry.apiKey && entry.apiSecret) checks.push("API");
    if (entry.nextcloudUrl && entry.nextcloudUser && entry.nextcloudPass) checks.push("NextCloud");
    if (entry.mailUser && entry.mailPass) checks.push("Mail");
    if (entry.telegramBotToken) checks.push("Telegram");

    results.push({
      service: "vault",
      instance: inst.id,
      status: checks.length > 0 ? "ok" : "skip",
      message: checks.length > 0 ? `Credentials: ${checks.join(", ")}` : "Geen credentials opgeslagen",
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });
  }
  return results;
}

/* ─── Run all tests ─── */

export async function runAllTests(): Promise<HealthReport> {
  if (running) return cachedReport || { overall: "ok", lastRun: "", tests: [] };
  running = true;

  const allTests: TestResult[] = [];
  const instances = getAllInstances();

  console.log(`[health] Running tests for ${instances.length} instances...`);

  for (const inst of instances) {
    // Mail tests
    try {
      const mailResults = await testMailForInstance(inst.id);
      allTests.push(...mailResults);
    } catch (err) {
      allTests.push({ service: "mail", instance: inst.id, status: "fail", message: (err as Error).message, durationMs: 0, timestamp: new Date().toISOString() });
    }

    // Messenger tests
    try {
      const msgResults = await testMessengerForInstance(inst.id);
      allTests.push(...msgResults);
    } catch (err) {
      allTests.push({ service: "messenger", instance: inst.id, status: "fail", message: (err as Error).message, durationMs: 0, timestamp: new Date().toISOString() });
    }
  }

  // Vault credential checks
  try {
    const vaultResults = await testVaultCredentials();
    allTests.push(...vaultResults);
  } catch (err) {
    allTests.push({ service: "vault", instance: "all", status: "fail", message: (err as Error).message, durationMs: 0, timestamp: new Date().toISOString() });
  }

  // Frontend-simulation tests (auto-config → folders → messages)
  for (const inst of instances) {
    try {
      const feResults = await testFrontendMailFlow(inst.id);
      allTests.push(...feResults);
    } catch (err) {
      allTests.push({ service: "frontend-mail", instance: inst.id, status: "fail", message: (err as Error).message, durationMs: 0, timestamp: new Date().toISOString() });
    }
  }

  const failCount = allTests.filter(t => t.status === "fail").length;
  const okCount = allTests.filter(t => t.status === "ok").length;

  const report: HealthReport = {
    overall: failCount === 0 ? "ok" : okCount > 0 ? "degraded" : "fail",
    lastRun: new Date().toISOString(),
    tests: allTests,
  };

  console.log(`[health] Done: ${okCount} ok, ${failCount} fail, ${allTests.length - okCount - failCount} skip`);
  cachedReport = report;
  running = false;
  return report;
}

/* ─── Express handlers ─── */

export function healthGetReport(_req: Request, res: Response) {
  if (!cachedReport) {
    return res.json({ overall: "pending", lastRun: null, tests: [], message: "Tests nog niet uitgevoerd. Gebruik /api/health/run" });
  }
  res.json(cachedReport);
}

export async function healthRunTests(_req: Request, res: Response) {
  try {
    const report = await runAllTests();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export function healthGetMail(_req: Request, res: Response) {
  if (!cachedReport) return res.json({ tests: [] });
  res.json({ tests: cachedReport.tests.filter(t => t.service.startsWith("mail")) });
}

export function healthGetMessenger(_req: Request, res: Response) {
  if (!cachedReport) return res.json({ tests: [] });
  res.json({ tests: cachedReport.tests.filter(t => t.service.startsWith("messenger")) });
}
