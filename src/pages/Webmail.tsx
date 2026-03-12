import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Mail, Inbox, Send, Trash2, Star, Archive, FolderOpen,
  RefreshCw, Settings, Wifi, Eye, EyeOff, User,
  PenSquare, Reply, ReplyAll, Forward,
  ChevronRight, ChevronDown, X, Paperclip,
  FileText, FileImage, FileSpreadsheet, File,
  FolderInput, Plus, ExternalLink, Pencil, Check,
} from "lucide-react";
import { getActiveInstanceId } from "../lib/instances";

/* ─── Types ─── */

interface MailAddress {
  name: string;
  address: string;
}

interface MailMessage {
  uid: number;
  subject: string;
  from: MailAddress[];
  to: MailAddress[];
  date: string | null;
  seen: boolean;
  flagged: boolean;
  hasAttachments?: boolean;
}

interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  cid?: string;
}

interface MailMessageFull extends MailMessage {
  cc: MailAddress[];
  textBody: string;
  htmlBody: string;
  attachments?: AttachmentMeta[];
}

interface MailFolder {
  path: string;
  name: string;
  specialUse: string | null;
}

interface ImapConfig {
  host: string;
  port: string;
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
  smtpPort?: string;
  smtpSecure?: boolean;
}

interface ComposeState {
  mode: "new" | "reply" | "replyAll" | "forward";
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

/* ─── Caches (persist across re-renders for speed) ─── */

const folderMsgCache = new Map<string, { messages: MailMessage[]; total: number; ts: number }>();
const fullMsgCache = new Map<string, MailMessageFull>(); // key: folder:uid
const signatureCache = new Map<string, string>(); // key: email address, value: HTML signature

/* ─── Helpers ─── */

function getImapConfig(): ImapConfig {
  const id = getActiveInstanceId();
  const authMode = (localStorage.getItem(`pref_${id}_imap_authMode`) || "password") as "password" | "oauth2";
  return {
    host: localStorage.getItem(`pref_${id}_imap_host`) || "",
    port: localStorage.getItem(`pref_${id}_imap_port`) || "993",
    user: localStorage.getItem(`pref_${id}_imap_user`) || "",
    pass: localStorage.getItem(`pref_${id}_imap_pass`) || "",
    secure: localStorage.getItem(`pref_${id}_imap_secure`) !== "false",
    authMode,
    accessToken: localStorage.getItem(`pref_${id}_imap_accessToken`) || undefined,
    refreshToken: localStorage.getItem(`pref_${id}_imap_refreshToken`) || undefined,
    clientId: localStorage.getItem(`pref_${id}_imap_clientId`) || undefined,
    clientSecret: localStorage.getItem(`pref_${id}_imap_clientSecret`) || undefined,
    tokenUri: localStorage.getItem(`pref_${id}_imap_tokenUri`) || undefined,
    smtpHost: localStorage.getItem(`pref_${id}_smtp_host`) || undefined,
    smtpPort: localStorage.getItem(`pref_${id}_smtp_port`) || undefined,
    smtpSecure: localStorage.getItem(`pref_${id}_smtp_secure`) === "true",
  };
}

function saveImapConfig(config: ImapConfig) {
  const id = getActiveInstanceId();
  localStorage.setItem(`pref_${id}_imap_host`, config.host);
  localStorage.setItem(`pref_${id}_imap_port`, config.port);
  localStorage.setItem(`pref_${id}_imap_user`, config.user);
  localStorage.setItem(`pref_${id}_imap_pass`, config.pass);
  localStorage.setItem(`pref_${id}_imap_secure`, String(config.secure));
  localStorage.setItem(`pref_${id}_imap_authMode`, config.authMode || "password");
  // OAuth2 fields
  if (config.accessToken) localStorage.setItem(`pref_${id}_imap_accessToken`, config.accessToken);
  if (config.refreshToken) localStorage.setItem(`pref_${id}_imap_refreshToken`, config.refreshToken);
  if (config.clientId) localStorage.setItem(`pref_${id}_imap_clientId`, config.clientId);
  if (config.clientSecret) localStorage.setItem(`pref_${id}_imap_clientSecret`, config.clientSecret);
  if (config.tokenUri) localStorage.setItem(`pref_${id}_imap_tokenUri`, config.tokenUri);
  // SMTP fields from auto-config
  if (config.smtpHost) localStorage.setItem(`pref_${id}_smtp_host`, config.smtpHost);
  if (config.smtpPort) localStorage.setItem(`pref_${id}_smtp_port`, config.smtpPort);
  if (config.smtpSecure !== undefined) localStorage.setItem(`pref_${id}_smtp_secure`, String(config.smtpSecure));
  // For OAuth2, SMTP user = IMAP user
  if (config.authMode === "oauth2") {
    localStorage.setItem(`pref_${id}_smtp_user`, config.user);
  }
}

function buildQuery(config: ImapConfig, extra?: Record<string, string>): string {
  // New approach: just pass instance + email — server resolves credentials
  const instanceId = getActiveInstanceId();
  const params = new URLSearchParams({
    instance: instanceId,
    email: config.user,
    ...extra,
  });
  return params.toString();
}

async function fetchEmailSignature(emailAddress: string): Promise<string> {
  // Check cache first
  const cached = signatureCache.get(emailAddress);
  if (cached !== undefined) return cached;

  // Also check localStorage
  const id = getActiveInstanceId();
  const lsKey = `mail_signature_${id}_${emailAddress}`;
  const stored = localStorage.getItem(lsKey);
  if (stored !== null) {
    signatureCache.set(emailAddress, stored);
    return stored;
  }

  try {
    // Try Email Account doctype first
    const params = new URLSearchParams({
      filters: JSON.stringify([["email_id", "=", emailAddress]]),
      fields: JSON.stringify(["signature"]),
      instance: id,
    });
    const res = await fetch(`/api/resource/Email Account?${params}`);
    if (res.ok) {
      const data = await res.json();
      if (data.data?.[0]?.signature) {
        const sig = data.data[0].signature;
        signatureCache.set(emailAddress, sig);
        localStorage.setItem(lsKey, sig);
        return sig;
      }
    }

    // Fallback: try User doctype
    const userParams = new URLSearchParams({
      filters: JSON.stringify([["email", "=", emailAddress]]),
      fields: JSON.stringify(["email_signature"]),
      instance: id,
    });
    const userRes = await fetch(`/api/resource/User?${userParams}`);
    if (userRes.ok) {
      const userData = await userRes.json();
      if (userData.data?.[0]?.email_signature) {
        const sig = userData.data[0].email_signature;
        signatureCache.set(emailAddress, sig);
        localStorage.setItem(lsKey, sig);
        return sig;
      }
    }
  } catch (err) {
    console.warn("[Webmail] Failed to fetch email signature:", err);
  }

  // Cache empty result to avoid repeated fetches
  signatureCache.set(emailAddress, "");
  localStorage.setItem(lsKey, "");
  return "";
}

function formatSender(addrs: MailAddress[]): { name: string; email: string } {
  const a = addrs[0];
  if (!a) return { name: "", email: "" };
  return { name: a.name || a.address.split("@")[0], email: a.address };
}

function formatAddress(addrs: MailAddress[]): string {
  return addrs.map((a) => a.name || a.address).join(", ");
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Gisteren";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function formatFullDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("nl-NL", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function getInitials(name: string): string {
  return name.split(/[\s@]+/).filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500",
    "bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-cyan-500",
    "bg-rose-500", "bg-amber-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

const FOLDER_ICONS: Record<string, typeof Inbox> = {
  "\\Inbox": Inbox, "\\Sent": Send, "\\Trash": Trash2, "\\Junk": Trash2,
  "\\Flagged": Star, "\\Archive": Archive, "\\Drafts": FolderOpen,
};

/* ─── Send sound (Web Audio API "whoosh") ─── */
function playSendSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.12);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close(), 500);
  } catch { /* audio not supported */ }
}

/* ─── Email categories ─── */
const EMAIL_CATEGORIES = [
  { id: "belangrijk", name: "Belangrijk", color: "bg-red-500", textColor: "text-red-700", bgLight: "bg-red-50" },
  { id: "werk", name: "Werk", color: "bg-blue-500", textColor: "text-blue-700", bgLight: "bg-blue-50" },
  { id: "persoonlijk", name: "Persoonlijk", color: "bg-green-500", textColor: "text-green-700", bgLight: "bg-green-50" },
  { id: "financieel", name: "Financieel", color: "bg-amber-500", textColor: "text-amber-700", bgLight: "bg-amber-50" },
  { id: "actie", name: "Actie vereist", color: "bg-purple-500", textColor: "text-purple-700", bgLight: "bg-purple-50" },
] as const;

function getCategoryMap(): Record<string, string> {
  try {
    const id = getActiveInstanceId();
    return JSON.parse(localStorage.getItem(`mail_categories_${id}`) || "{}");
  } catch { return {}; }
}

function setCategoryForMessage(folder: string, uid: number, categoryId: string | null) {
  const id = getActiveInstanceId();
  const map = getCategoryMap();
  const key = `${folder}:${uid}`;
  if (categoryId) map[key] = categoryId;
  else delete map[key];
  localStorage.setItem(`mail_categories_${id}`, JSON.stringify(map));
}

/* ─── Setup screen ─── */

function ImapSetup({ config, onSave }: { config: ImapConfig; onSave: (c: ImapConfig) => void }) {
  const [form, setForm] = useState(config);
  const [testing, setTesting] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showPass, setShowPass] = useState(false);

  async function handleTest() {
    setTesting(true); setResult(null);
    try {
      const res = await fetch(`/api/mail/test?${buildQuery(form)}`);
      const data = await res.json();
      setResult({ ok: data.ok, message: data.message || data.error });
    } catch (err) { setResult({ ok: false, message: (err as Error).message }); }
    finally { setTesting(false); }
  }

  async function handleAutoConfig() {
    setAutoLoading(true); setResult(null);
    try {
      const instanceId = getActiveInstanceId();
      // Try to get user email from ERPNext — fetch the logged-in user's info
      // First try: get employees to find company_email
      const empRes = await fetch(`/api/resource/Employee?fields=${encodeURIComponent(JSON.stringify(["company_email", "user_id"]))}&filters=${encodeURIComponent(JSON.stringify([["status", "=", "Active"]]))}&limit_page_length=100&instance=${instanceId}`);
      const empData = await empRes.json();
      const employees = empData.data || [];

      // Find emails that have an Email Account in ERPNext
      let email = form.user; // Use existing user field if already filled
      if (!email && employees.length > 0) {
        // Try company_email first, then user_id
        for (const emp of employees) {
          if (emp.company_email) { email = emp.company_email; break; }
          if (emp.user_id) { email = emp.user_id; break; }
        }
      }

      if (!email) {
        setResult({ ok: false, message: "Vul eerst een e-mailadres in bij 'Gebruikersnaam'" });
        setAutoLoading(false);
        return;
      }

      const res = await fetch(`/api/mail/auto-config?instance=${instanceId}&email=${encodeURIComponent(email)}`);
      if (!res.ok) {
        const data = await res.json();
        setResult({ ok: false, message: data.error || `Fout ${res.status}` });
        setAutoLoading(false);
        return;
      }

      const { data } = await res.json();
      const newForm: ImapConfig = {
        host: data.host || form.host,
        port: String(data.port || 993),
        user: data.user || email,
        pass: form.pass, // keep existing password (OAuth doesn't need it)
        secure: data.secure !== false,
        authMode: data.authMode || "password",
        accessToken: data.accessToken || undefined,
        refreshToken: data.refreshToken || undefined,
        clientId: data.clientId || undefined,
        clientSecret: data.clientSecret || undefined,
        tokenUri: data.tokenUri || undefined,
        smtpHost: data.smtpHost || undefined,
        smtpPort: data.smtpPort ? String(data.smtpPort) : undefined,
        smtpSecure: data.smtpSecure ?? false,
      };
      setForm(newForm);

      // Store signature if returned
      if (data.signature) {
        const id = getActiveInstanceId();
        const lsKey = `mail_signature_${id}_${email}`;
        localStorage.setItem(lsKey, data.signature);
        signatureCache.set(email, data.signature);
      }

      if (data.authMode === "oauth2" && data.accessToken) {
        setResult({ ok: true, message: "Office 365 configuratie geladen vanuit ERPNext (OAuth2)" });
      } else {
        setResult({ ok: true, message: "E-mail configuratie geladen vanuit ERPNext" });
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setAutoLoading(false);
    }
  }

  const canSave = form.host && form.user && (form.pass || form.authMode === "oauth2");
  const canTest = canSave;

  return (
    <div className="p-6 flex items-center justify-center h-full bg-slate-50">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg"><Mail className="text-blue-600" size={24} /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">E-mail instellen</h2>
            <p className="text-xs text-slate-500">IMAP-verbinding voor deze instance</p>
          </div>
        </div>

        {/* Auto-configure from ERPNext */}
        <button
          onClick={handleAutoConfig}
          disabled={autoLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 text-sm font-medium cursor-pointer shadow-sm"
        >
          <ExternalLink size={14} className={autoLoading ? "animate-spin" : ""} />
          {autoLoading ? "Laden..." : "Laden vanuit ERPNext"}
        </button>

        {form.authMode === "oauth2" && (
          <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs flex items-center gap-2">
            <Check size={14} />
            Office 365 OAuth2 modus — geen wachtwoord nodig
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">IMAP Server</label>
            <input type="text" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder="imap.example.com" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Poort</label>
            <input type="text" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })}
              placeholder="993" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Gebruikersnaam</label>
          <input type="text" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}
            placeholder="user@example.com" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {form.authMode !== "oauth2" && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Wachtwoord</label>
            <div className="relative">
              <input type={showPass ? "text" : "password"} value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })}
                placeholder="Wachtwoord" className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => setShowPass(!showPass)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })} className="rounded border-slate-300" />
          SSL/TLS (aanbevolen)
        </label>
        {result && (
          <div className={`p-3 rounded-lg text-sm ${result.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>{result.message}</div>
        )}
        <div className="flex gap-2">
          <button onClick={handleTest} disabled={testing || !canTest}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm font-medium cursor-pointer">
            <Wifi size={14} className={testing ? "animate-pulse" : ""} />
            {testing ? "Testen..." : "Test verbinding"}
          </button>
          <button onClick={() => { saveImapConfig(form); onSave(form); }} disabled={!canSave}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium cursor-pointer">
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Compose window (Outlook-style, bottom-right floating) ─── */

function ComposeWindow({ compose, onClose, onSent, config }: {
  compose: ComposeState; onClose: () => void; onSent: () => void; config: ImapConfig;
}) {
  const [from] = useState(compose.from || config.user);
  const [to, setTo] = useState(compose.to);
  const [cc, setCc] = useState(compose.cc);
  const [bcc, setBcc] = useState(compose.bcc);
  const [subject, setSubject] = useState(compose.subject);
  const [body, setBody] = useState(compose.body);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(!!compose.cc || !!compose.bcc);
  const [minimized, setMinimized] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Draggable & resizable state
  const [pos, setPos] = useState({ x: 0, y: 0 }); // offset from default position
  const [size, setSize] = useState({ w: 560, h: 520 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; origPosX: number; origPosY: number } | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  const toInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focus "Aan" field when composing new or forwarding, body field for reply
    setTimeout(() => {
      if (compose.mode === "new" || compose.mode === "forward") toInputRef.current?.focus();
      else bodyRef.current?.focus();
    }, 100);
  }, []);

  // Load email signature from ERPNext
  useEffect(() => {
    const emailAddr = from || config.user;
    if (!emailAddr) return;
    fetchEmailSignature(emailAddr).then((sig) => {
      if (!sig) return;
      setSignatureHtml(sig);
      // Convert HTML signature to plain text for the textarea
      const tmp = document.createElement("div");
      tmp.innerHTML = sig;
      const sigText = tmp.textContent || tmp.innerText || "";
      // Insert signature into body
      setBody((prev) => {
        // For replies/forwards, insert signature between new content area and quoted text
        const separatorIdx = prev.indexOf("\n\n---\n");
        const sigBlock = `\n\n--\n${sigText}`;
        if (separatorIdx > -1) {
          return prev.slice(0, separatorIdx) + sigBlock + prev.slice(separatorIdx);
        }
        // For new messages, append at the bottom
        return prev + sigBlock;
      });
    });
  }, []);

  // Drag handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
      }
      if (resizeRef.current) {
        const dx = resizeRef.current.startX - e.clientX;
        const dy = resizeRef.current.startY - e.clientY;
        setSize({
          w: Math.max(400, resizeRef.current.origW + dx),
          h: Math.max(300, resizeRef.current.origH + dy),
        });
        setPos({
          x: resizeRef.current.origPosX - dx,
          y: resizeRef.current.origPosY - dy,
        });
      }
    }
    function onMouseUp() { dragRef.current = null; resizeRef.current = null; }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, []);

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    e.preventDefault();
  }

  function startResize(e: React.MouseEvent) {
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h, origPosX: pos.x, origPosY: pos.y };
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setAttachments(prev => [...prev, ...files]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length) setAttachments(prev => [...prev, ...files]);
    e.target.value = "";
  }

  function removeAttachment(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleSend() {
    if (!to.trim()) { setError("Vul een ontvanger in"); return; }
    setSending(true); setError("");
    // Convert attachments to base64
    const attachmentData: { filename: string; content: string; contentType: string }[] = [];
    for (const file of attachments) {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      attachmentData.push({ filename: file.name, content: base64, contentType: file.type || "application/octet-stream" });
    }

    try {
      // Build HTML body: convert plain text but replace signature separator with HTML signature if available
      let htmlBody = body;
      if (signatureHtml) {
        // Find the signature separator in the plain text body and replace with HTML version
        const sigSepIdx = htmlBody.indexOf("\n\n--\n");
        if (sigSepIdx > -1) {
          // Find where the signature text ends (before quoted text separator or end of message)
          const afterSigSep = htmlBody.slice(sigSepIdx + 4); // after "\n\n--\n"
          const quoteSepIdx = afterSigSep.indexOf("\n\n---\n");
          const sigTextEnd = quoteSepIdx > -1 ? sigSepIdx + 4 + quoteSepIdx : sigSepIdx + 4 + afterSigSep.length;
          // Get parts: before signature, quoted text (if any)
          const beforeSig = htmlBody.slice(0, sigSepIdx);
          const afterSig = sigTextEnd < htmlBody.length ? htmlBody.slice(sigTextEnd) : "";
          htmlBody = beforeSig.replace(/\n/g, "<br>") + `<br><br>--<br>${signatureHtml}` + (afterSig ? afterSig.replace(/\n/g, "<br>") : "");
        } else {
          htmlBody = htmlBody.replace(/\n/g, "<br>");
        }
      } else {
        htmlBody = htmlBody.replace(/\n/g, "<br>");
      }

      const instanceId = getActiveInstanceId();
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance: instanceId,
          email: config.user,
          from: from,
          to: to.split(/[,;]\s*/).filter(Boolean),
          cc: cc ? cc.split(/[,;]\s*/).filter(Boolean) : undefined,
          bcc: bcc ? bcc.split(/[,;]\s*/).filter(Boolean) : undefined,
          subject,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#334155;line-height:1.6;">${htmlBody}</div>`,
          text: body, inReplyTo: compose.inReplyTo, references: compose.references,
          attachments: attachmentData.length > 0 ? attachmentData : undefined,
        }),
      });
      const text = await res.text();
      if (!text) {
        if (res.ok) { playSendSound(); onSent(); onClose(); return; }
        throw new Error(`Server returned ${res.status} without response body`);
      }
      let data: { ok?: boolean; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`); }
      if (data.error) throw new Error(data.error);
      playSendSound(); onSent(); onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setSending(false); }
  }

  const title = compose.mode === "new" ? "Nieuw bericht" :
    compose.mode === "reply" ? "Beantwoorden" :
    compose.mode === "replyAll" ? "Allen beantwoorden" : "Doorsturen";

  if (minimized) {
    return (
      <div className="fixed bottom-0 right-6 w-80 bg-blue-600 text-white rounded-t-lg shadow-2xl z-50 cursor-pointer" onClick={() => setMinimized(false)}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-sm font-medium truncate">{title}{subject ? ` - ${subject}` : ""}</span>
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); setMinimized(false); }} className="text-white/80 hover:text-white cursor-pointer p-0.5"><ChevronRight size={14} className="rotate-[-90deg]" /></button>
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-white/80 hover:text-white cursor-pointer p-0.5"><X size={14} /></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={windowRef} className="fixed bg-white rounded-t-xl shadow-2xl border border-slate-300 flex flex-col z-50"
      style={{ bottom: -pos.y, right: 24 - pos.x, width: size.w, height: size.h, maxHeight: "90vh" }}>
      {/* Resize handle (top-left corner) */}
      <div className="absolute -top-1 -left-1 w-4 h-4 cursor-nwse-resize z-10" onMouseDown={startResize} />
      {/* Header — draggable */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-blue-600 rounded-t-xl flex-shrink-0 cursor-move select-none" onMouseDown={startDrag}>
        <span className="text-white font-semibold text-sm">{title}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(true)} className="text-white/80 hover:text-white cursor-pointer p-1"><ChevronDown size={14} /></button>
          <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer p-1"><X size={14} /></button>
        </div>
      </div>

      {/* From / To / CC / BCC / Subject */}
      <div className="flex-shrink-0 divide-y divide-slate-100">
        <div className="flex items-center px-4 py-1.5">
          <label className="text-xs font-medium text-slate-500 w-16">Van</label>
          <span className="flex-1 text-sm text-slate-700 py-1">{from}</span>
        </div>
        <div className="flex items-center px-4 py-1.5">
          <label className="text-xs font-medium text-slate-500 w-16">Aan</label>
          <input ref={toInputRef} type="text" value={to} onChange={(e) => setTo(e.target.value)}
            className="flex-1 text-sm border-0 focus:outline-none focus:ring-0 py-1" placeholder="ontvanger@example.com" />
          {!showCcBcc && (
            <button onClick={() => setShowCcBcc(true)} className="text-xs text-blue-600 hover:underline cursor-pointer ml-2">CC/BCC</button>
          )}
        </div>
        {showCcBcc && (
          <>
            <div className="flex items-center px-4 py-1.5">
              <label className="text-xs font-medium text-slate-500 w-16">CC</label>
              <input type="text" value={cc} onChange={(e) => setCc(e.target.value)}
                className="flex-1 text-sm border-0 focus:outline-none focus:ring-0 py-1" />
            </div>
            <div className="flex items-center px-4 py-1.5">
              <label className="text-xs font-medium text-slate-500 w-16">BCC</label>
              <input type="text" value={bcc} onChange={(e) => setBcc(e.target.value)}
                className="flex-1 text-sm border-0 focus:outline-none focus:ring-0 py-1" />
            </div>
          </>
        )}
        <div className="flex items-center px-4 py-1.5">
          <label className="text-xs font-medium text-slate-500 w-16">Onderwerp</label>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
            className="flex-1 text-sm border-0 focus:outline-none focus:ring-0 py-1 font-medium" />
        </div>
      </div>

      {/* Body with drag-and-drop */}
      <div className={`flex-1 min-h-0 overflow-auto border-t border-slate-200 relative ${dragging ? "bg-blue-50" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}>
        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 border-2 border-dashed border-blue-400 rounded z-10 pointer-events-none">
            <div className="text-center">
              <Paperclip size={24} className="mx-auto text-blue-500 mb-1" />
              <p className="text-sm font-medium text-blue-600">Sleep bestanden hier</p>
            </div>
          </div>
        )}
        <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)}
          className="w-full h-full min-h-[180px] p-4 text-sm resize-none border-0 focus:outline-none focus:ring-0 leading-relaxed"
          placeholder="Typ uw bericht..." />
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700">
                <Paperclip size={10} className="text-slate-400" />
                <span className="truncate max-w-[120px]">{file.name}</span>
                <span className="text-slate-400">({formatFileSize(file.size)})</span>
                <button onClick={() => removeAttachment(idx)} className="text-slate-400 hover:text-red-500 cursor-pointer"><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="px-4 py-2 bg-red-50 text-xs text-red-600 border-t border-red-200">{error}</div>}

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-200 bg-slate-50 rounded-b-none flex-shrink-0">
        <button onClick={handleSend} disabled={sending || !to.trim()}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
          <Send size={14} /> {sending ? "Verzenden..." : "Verzenden"}
        </button>
        <button onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-2 text-slate-500 text-sm hover:bg-slate-200 rounded-lg cursor-pointer">
          <Paperclip size={14} /> Bijlage
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        <div className="flex-1" />
        <button onClick={onClose} className="px-4 py-2 text-slate-500 text-sm hover:bg-slate-200 rounded-lg cursor-pointer">Annuleren</button>
      </div>
    </div>
  );
}

/* ─── Reading pane ─── */

function ReadingPane({ message, onReply, onReplyAll, onForward, onDelete, onOpenAttachment }: {
  message: MailMessageFull | null; onReply: () => void; onReplyAll: () => void; onForward: () => void; onDelete: () => void;
  onOpenAttachment?: (index: number) => void;
}) {
  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50/50">
        <div className="text-center text-slate-400">
          <Mail size={48} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm">Selecteer een bericht om te lezen</p>
        </div>
      </div>
    );
  }

  const sender = formatSender(message.from);

  return (
    <div className="flex-1 flex flex-col bg-white min-w-0">
      <div className="px-6 py-4 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-800 flex-1 min-w-0">{message.subject || "(Geen onderwerp)"}</h2>
          <div className="flex items-center gap-1 ml-3 flex-shrink-0">
            <button onClick={onReply} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 rounded hover:bg-blue-50 hover:text-blue-600 cursor-pointer"><Reply size={14} /> Beantwoorden</button>
            <button onClick={onReplyAll} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 rounded hover:bg-blue-50 hover:text-blue-600 cursor-pointer"><ReplyAll size={14} /> Allen</button>
            <button onClick={onForward} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 rounded hover:bg-blue-50 hover:text-blue-600 cursor-pointer"><Forward size={14} /> Doorsturen</button>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button onClick={onDelete} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 rounded hover:bg-red-50 hover:text-red-600 cursor-pointer"><Trash2 size={14} /> Verwijderen</button>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full ${getAvatarColor(sender.email)} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
            {getInitials(sender.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{sender.name}</span>
              <span className="text-xs text-slate-400">&lt;{sender.email}&gt;</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Aan: {formatAddress(message.to)}
              {message.cc.length > 0 && <span className="ml-2">CC: {formatAddress(message.cc)}</span>}
            </div>
          </div>
          <span className="text-xs text-slate-400 shrink-0 pt-0.5">{formatFullDate(message.date)}</span>
        </div>
      </div>
      {/* Attachments bar — compact, scrollable when many */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="px-6 py-2 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Paperclip size={12} className="text-slate-400" />
            <span className="text-[11px] font-semibold text-slate-600">{message.attachments.length} bijlage{message.attachments.length > 1 ? "n" : ""}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-[72px] overflow-y-auto">
            {message.attachments.map((att, idx) => {
              const isImage = att.contentType.startsWith("image/");
              const isPdf = att.contentType === "application/pdf";
              const isSpreadsheet = att.contentType.includes("spreadsheet") || att.contentType.includes("excel") || att.filename.match(/\.(xlsx?|csv)$/i);
              const AttIcon = isImage ? FileImage : isPdf ? FileText : isSpreadsheet ? FileSpreadsheet : File;
              const sizeStr = att.size < 1024 ? `${att.size} B` : att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(1)} KB` : `${(att.size / (1024 * 1024)).toFixed(1)} MB`;

              return (
                <button key={`${att.filename}-${idx}`} onClick={() => onOpenAttachment?.(idx)}
                  className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded hover:border-blue-300 hover:bg-blue-50/50 transition-colors cursor-pointer text-[11px]"
                  title="Klik om te openen">
                  <AttIcon size={13} className={`flex-shrink-0 ${isImage ? "text-green-500" : isPdf ? "text-red-500" : isSpreadsheet ? "text-emerald-600" : "text-slate-400"}`} />
                  <span className="font-medium text-slate-700 truncate max-w-[120px]">{att.filename}</span>
                  <span className="text-slate-400">({sizeStr})</span>
                  <ExternalLink size={10} className="text-slate-300 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {message.htmlBody ? (
          <iframe
            srcDoc={`<!DOCTYPE html><html><head><base target="_blank"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#334155;line-height:1.6;margin:16px 24px;}img{max-width:100%}a{color:#2563eb;}</style></head><body>${message.htmlBody}</body></html>`}
            className="w-full h-full border-0" title="Email content" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        ) : (
          <pre className="p-6 text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{message.textBody || "(Geen inhoud)"}</pre>
        )}
      </div>
    </div>
  );
}

/* ─── Folder tree ─── */

interface FolderNode { folder: MailFolder; children: FolderNode[]; }

function buildFolderTree(folders: MailFolder[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const nodeMap = new Map<string, FolderNode>();
  const sorted = [...folders].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const node: FolderNode = { folder: f, children: [] };
    nodeMap.set(f.path, node);
    const sepIdx = Math.max(f.path.lastIndexOf("/"), f.path.lastIndexOf("."));
    const parentPath = sepIdx > 0 ? f.path.slice(0, sepIdx) : null;
    const parent = parentPath ? nodeMap.get(parentPath) : null;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  return roots;
}

function FolderTree({ folders, activeFolder, onSelect, onDropMessage, onCreateFolder, onRenameFolder }: {
  folders: MailFolder[]; activeFolder: string; onSelect: (path: string) => void;
  onDropMessage?: (toFolder: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRenameFolder?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["INBOX"]));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  function toggle(path: string) {
    setExpanded(prev => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  }

  function handleDragOver(e: React.DragEvent, path: string) {
    if (path === activeFolder) return; // Can't drop on same folder
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(path);
  }

  function handleDrop(e: React.DragEvent, path: string) {
    e.preventDefault();
    setDropTarget(null);
    if (onDropMessage) onDropMessage(path);
  }

  function handleContextMenu(e: React.MouseEvent, path: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  }

  // Close context menu on click elsewhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  function renderNode(node: FolderNode, depth: number) {
    const f = node.folder;
    const Icon = (f.specialUse && FOLDER_ICONS[f.specialUse]) || FolderOpen;
    const active = f.path === activeFolder;
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(f.path);
    const isInbox = f.specialUse === "\\Inbox" || f.path === "INBOX";
    const isDragOver = dropTarget === f.path;

    return (
      <div key={f.path}>
        <div className="flex items-center"
          onDragOver={(e) => handleDragOver(e, f.path)}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => handleDrop(e, f.path)}
          onContextMenu={(e) => handleContextMenu(e, f.path)}>
          {hasChildren ? (
            <button onClick={() => toggle(f.path)} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer flex-shrink-0" style={{ marginLeft: depth * 12 }}>
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="w-5 flex-shrink-0" style={{ marginLeft: depth * 12 }} />
          )}
          <button onClick={() => onSelect(f.path)}
            className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-left transition-colors cursor-pointer rounded-r ${
              isDragOver ? "bg-blue-100 text-blue-700 ring-2 ring-blue-400" :
              active ? "bg-blue-50 text-blue-700 font-semibold" :
              "text-slate-600 hover:bg-slate-50"
            }`}>
            <Icon size={15} className={active || isDragOver ? "text-blue-600" : "text-slate-400"} />
            <span className={`text-sm truncate ${isInbox && !active ? "font-medium" : ""}`}>{f.name}</span>
            {isDragOver && <FolderInput size={12} className="text-blue-500 ml-auto" />}
          </button>
        </div>
        {hasChildren && isExpanded && <div>{node.children.map(child => renderNode(child, depth + 1))}</div>}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-2 relative">
      {folders.length === 0 && <p className="text-xs text-slate-400 px-4 py-2">Laden...</p>}
      {tree.map(node => renderNode(node, 0))}

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => { onCreateFolder?.(contextMenu.path); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer flex items-center gap-2">
            <Plus size={12} /> Nieuwe map aanmaken
          </button>
          {contextMenu.path !== "INBOX" && (
            <button onClick={() => { onRenameFolder?.(contextMenu.path); setContextMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer flex items-center gap-2">
              <Pencil size={12} /> Hernoemen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main component ─── */

export default function Webmail() {
  const [config, setConfig] = useState(getImapConfig);
  const [showSetup, setShowSetup] = useState(!config.host || !config.user || (!config.pass && config.authMode !== "oauth2"));
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState("INBOX");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<MailMessageFull | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [error, setError] = useState("");
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [categories, setCategories] = useState<Record<string, string>>(getCategoryMap);
  const [emailContextMenu, setEmailContextMenu] = useState<{ x: number; y: number; uid: number } | null>(null);
  const preloaded = useRef(false);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }
  }, [toast]);

  // Close email context menu on click
  useEffect(() => {
    if (!emailContextMenu) return;
    const close = () => setEmailContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [emailContextMenu]);

  const isConfigured = config.host && config.user && (config.pass || config.authMode === "oauth2");

  const loadFolders = useCallback(async () => {
    if (!config.user) return;
    try {
      const res = await fetch(`/api/mail/folders?${buildQuery(config)}`);
      const text = await res.text();
      if (!text) return;
      const data = JSON.parse(text);
      if (data.data) setFolders(data.data);
    } catch (err) { console.error("[Webmail] loadFolders error:", err); }
  }, [config]);

  const loadMessages = useCallback(async (folder?: string, force = false) => {
    if (!config.user) return;
    const f = folder || activeFolder;

    // Use cache if available and fresh (< 30s)
    if (!force) {
      const cached = folderMsgCache.get(f);
      if (cached && Date.now() - cached.ts < 30_000) {
        setMessages(cached.messages);
        setTotal(cached.total);
        return;
      }
    }

    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/mail/messages?${buildQuery(config, { folder: f, pageSize: "5000" })}`);
      const text = await res.text();
      if (!text) { setError("Leeg antwoord van server"); setMessages([]); setLoading(false); return; }
      const data = JSON.parse(text);
      if (data.error) {
        setError(data.error); setMessages([]);
      } else {
        const msgs = data.data?.messages || [];
        const tot = data.data?.total || 0;
        setMessages(msgs);
        setTotal(tot);
        folderMsgCache.set(f, { messages: msgs, total: tot, ts: Date.now() });
      }
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, [config, activeFolder]);

  // Auto-load config from ERPNext, then preload mail
  // Server handles token refresh — frontend just sends instance + email
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoLoaded.current) return;
    autoLoaded.current = true;

    const instanceId = getActiveInstanceId();

    (async () => {
      let finalConfig = config;

      if (!isConfigured) {
        // Not configured — try auto-config with employee email
        const defaultEmployee = localStorage.getItem(`pref_${instanceId}_employee`) || "";
        let email = "";
        try {
          const empResp = await fetch(`/api/resource/Employee?instance=${instanceId}&fields=${encodeURIComponent(JSON.stringify(["name","company_email","user_id"]))}&limit_page_length=50`);
          const empData = await empResp.json();
          const employees = empData?.data || [];
          if (defaultEmployee) {
            const emp = employees.find((e: any) => e.name === defaultEmployee);
            email = emp?.company_email || emp?.user_id || "";
          }
          if (!email && employees.length > 0) {
            const withEmail = employees.find((e: any) => e.company_email);
            email = withEmail?.company_email || employees[0]?.user_id || "";
          }
        } catch { /* ignore */ }

        if (email) {
          try {
            const res = await fetch(`/api/mail/auto-config?instance=${instanceId}&email=${encodeURIComponent(email)}`);
            if (res.ok) {
              const { data } = await res.json();
              if (data?.host) {
                finalConfig = {
                  host: data.host, port: String(data.port || 993), user: data.user || email,
                  pass: data.pass || "", secure: data.secure !== false,
                  authMode: data.authMode || "password",
                  accessToken: data.accessToken, refreshToken: data.refreshToken,
                  clientId: data.clientId, clientSecret: data.clientSecret, tokenUri: data.tokenUri,
                  smtpHost: data.smtpHost, smtpPort: String(data.smtpPort || 587), smtpSecure: data.smtpSecure || false,
                };
                saveImapConfig(finalConfig);
                if (data.signature) localStorage.setItem(`pref_${instanceId}_email_signature`, data.signature);
                setConfig(finalConfig);
                setShowSetup(false);
              }
            }
          } catch { /* ignore */ }
        }
      }

      // Preload mail — server resolves credentials from instance + email
      const ready = finalConfig.host && finalConfig.user;
      if (!ready || preloaded.current) return;
      preloaded.current = true;

      const q = buildQuery(finalConfig);
      console.log("[Webmail] Loading mail for", finalConfig.user, "via instance", instanceId);

      // Load folders
      try {
        const fRes = await fetch(`/api/mail/folders?${q}`);
        const fText = await fRes.text();
        if (fText) {
          const fData = JSON.parse(fText);
          if (fData.error) console.error("[Webmail] Folders error:", fData.error);
          if (fData.data) { setFolders(fData.data); console.log("[Webmail] Loaded", fData.data.length, "folders"); }
        }
      } catch (err) { console.error("[Webmail] loadFolders error:", err); }

      // Load messages
      try {
        setLoading(true);
        const mRes = await fetch(`/api/mail/messages?${q}&folder=INBOX&pageSize=5000`);
        const mText = await mRes.text();
        if (!mText) { setLoading(false); return; }
        const mData = JSON.parse(mText);
        if (mData.error) {
          setError(mData.error);
        } else {
          const msgs = mData.data?.messages || [];
          const tot = mData.data?.total || 0;
          console.log("[Webmail] Loaded", msgs.length, "messages from INBOX");
          setMessages(msgs);
          setTotal(tot);
          folderMsgCache.set("INBOX", { messages: msgs, total: tot, ts: Date.now() });
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function openMessage(msg: MailMessage) {
    setSelectedUid(msg.uid);

    // Check full message cache first
    const cacheKey = `${activeFolder}:${msg.uid}`;
    const cached = fullMsgCache.get(cacheKey);
    if (cached) {
      setSelectedMsg(cached);
      setMessages(prev => prev.map(m => m.uid === msg.uid ? { ...m, seen: true } : m));
      return;
    }

    setLoadingMsg(true);
    try {
      const res = await fetch(`/api/mail/message?${buildQuery(config, { folder: activeFolder, uid: String(msg.uid) })}`);
      const data = await res.json();
      if (data.data) {
        setSelectedMsg(data.data);
        fullMsgCache.set(cacheKey, data.data);
        setMessages(prev => prev.map(m => m.uid === msg.uid ? { ...m, seen: true } : m));
      }
    } catch { /* ignore */ }
    finally { setLoadingMsg(false); }
  }

  function switchFolder(folder: string) {
    setActiveFolder(folder);
    setSelectedUid(null);
    setSelectedMsg(null);
    // Try cache first for instant switch
    const cached = folderMsgCache.get(folder);
    if (cached) {
      setMessages(cached.messages);
      setTotal(cached.total);
      // Refresh in background if stale
      if (Date.now() - cached.ts > 30_000) loadMessages(folder, true);
    } else {
      setMessages([]);
      loadMessages(folder, true);
    }
  }

  function handleDeleteMsg(uid: number) {
    // Optimistic: remove from UI immediately
    setMessages(prev => prev.filter(m => m.uid !== uid));
    if (selectedUid === uid) { setSelectedUid(null); setSelectedMsg(null); }
    folderMsgCache.delete(activeFolder);
    fullMsgCache.delete(`${activeFolder}:${uid}`);
    // Fire-and-forget: backend deletes in background
    fetch(`/api/mail/message?${buildQuery(config, { folder: activeFolder, uid: String(uid) })}`, { method: "DELETE" }).catch(() => {});
  }

  function handleMoveMsg(uid: number, toFolder: string) {
    // Optimistic: remove from UI immediately
    setMessages(prev => prev.filter(m => m.uid !== uid));
    if (selectedUid === uid) { setSelectedUid(null); setSelectedMsg(null); }
    folderMsgCache.delete(activeFolder);
    folderMsgCache.delete(toFolder);
    fullMsgCache.delete(`${activeFolder}:${uid}`);
    // Fire-and-forget: backend moves in background
    fetch(`/api/mail/move?${buildQuery(config, { folder: activeFolder, uid: String(uid), toFolder })}`, { method: "POST" }).catch(() => {});
  }

  const [showMoveDropdown, setShowMoveDropdown] = useState(false);

  async function handleCreateFolder(parentPath: string) {
    const name = prompt("Mapnaam:", "");
    if (!name?.trim()) return;
    // Create under parent: INBOX subfolders get "INBOX." prefix, nested folders get "parent." prefix
    const isRoot = !parentPath || parentPath === "INBOX";
    const fullPath = isRoot ? `INBOX.${name.trim()}` : `${parentPath}.${name.trim()}`;
    try {
      const resp = await fetch(`/api/mail/folder?${buildQuery(config, { name: fullPath })}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(`Fout bij aanmaken map: ${data.error || resp.statusText}`);
        return;
      }
      loadFolders();
    } catch (err) {
      alert(`Fout bij aanmaken map: ${(err as Error).message}`);
    }
  }

  async function handleRenameFolder(oldPath: string) {
    const currentName = oldPath.split(/[./]/).pop() || oldPath;
    const newName = prompt("Nieuwe naam:", currentName);
    if (!newName?.trim() || newName.trim() === currentName) return;
    // Keep the parent path (including INBOX prefix), just change the last segment
    const sepIdx = Math.max(oldPath.lastIndexOf("/"), oldPath.lastIndexOf("."));
    const newPath = sepIdx > 0 ? `${oldPath.slice(0, sepIdx + 1)}${newName.trim()}` : newName.trim();
    try {
      const resp = await fetch(`/api/mail/rename-folder?${buildQuery(config)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath, newPath }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(`Fout bij hernoemen: ${data.error || resp.statusText}`);
        return;
      }
      loadFolders();
    } catch (err) {
      alert(`Fout bij hernoemen: ${(err as Error).message}`);
    }
  }

  async function handleMarkUnread(uid: number) {
    try {
      await fetch(`/api/mail/mark-unread?${buildQuery(config, { folder: activeFolder, uid: String(uid) })}`, { method: "POST" });
      setMessages(prev => prev.map(m => m.uid === uid ? { ...m, seen: false } : m));
      if (selectedUid === uid && selectedMsg) setSelectedMsg({ ...selectedMsg, seen: false });
      folderMsgCache.delete(activeFolder);
    } catch { /* ignore */ }
  }

  function openAttachment(uid: number, index: number) {
    const url = `/api/mail/attachment?${buildQuery(config, { folder: activeFolder, uid: String(uid), index: String(index) })}`;
    window.open(url, "_blank");
  }

  /* ─── Compose helpers ─── */

  function openCompose() {
    setCompose({ mode: "new", from: config.user, to: "", cc: "", bcc: "", subject: "", body: "\n\n" });
  }

  function openReply() {
    if (!selectedMsg) return;
    const sender = formatSender(selectedMsg.from);
    setCompose({
      mode: "reply", from: config.user, to: sender.email, cc: "", bcc: "",
      subject: selectedMsg.subject.startsWith("Re:") ? selectedMsg.subject : `Re: ${selectedMsg.subject}`,
      body: `\n\n---\nOp ${formatFullDate(selectedMsg.date)} schreef ${sender.name} <${sender.email}>:\n\n${selectedMsg.textBody}`,
    });
  }

  function openReplyAll() {
    if (!selectedMsg) return;
    const sender = formatSender(selectedMsg.from);
    const allTo = [...selectedMsg.to, ...selectedMsg.from].filter(a => a.address !== config.user);
    setCompose({
      mode: "replyAll", from: config.user, to: sender.email,
      cc: allTo.map(a => a.address).filter(a => a !== sender.email).join(", "),
      bcc: "",
      subject: selectedMsg.subject.startsWith("Re:") ? selectedMsg.subject : `Re: ${selectedMsg.subject}`,
      body: `\n\n---\nOp ${formatFullDate(selectedMsg.date)} schreef ${sender.name} <${sender.email}>:\n\n${selectedMsg.textBody}`,
    });
  }

  function openForward() {
    if (!selectedMsg) return;
    const sender = formatSender(selectedMsg.from);
    setCompose({
      mode: "forward", from: config.user, to: "", cc: "", bcc: "",
      subject: selectedMsg.subject.startsWith("Fwd:") ? selectedMsg.subject : `Fwd: ${selectedMsg.subject}`,
      body: `\n\n---\nDoorgestuurd bericht van ${sender.name} <${sender.email}> op ${formatFullDate(selectedMsg.date)}:\n\n${selectedMsg.textBody}`,
    });
  }

  if (showSetup) {
    return <ImapSetup config={config} onSave={(c) => { setConfig(c); setShowSetup(false); }} />;
  }

  const hasSelection = !!selectedMsg;

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* Ribbon */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-white border-b border-slate-200 flex-shrink-0">
        <button onClick={openCompose} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 cursor-pointer">
          <PenSquare size={14} /> Nieuw
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={openReply} disabled={!hasSelection} className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 rounded text-xs font-medium hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default cursor-pointer">
          <Reply size={14} /> Beantwoorden
        </button>
        <button onClick={openReplyAll} disabled={!hasSelection} className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 rounded text-xs font-medium hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default cursor-pointer">
          <ReplyAll size={14} /> Allen
        </button>
        <button onClick={openForward} disabled={!hasSelection} className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 rounded text-xs font-medium hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default cursor-pointer">
          <Forward size={14} /> Doorsturen
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={() => selectedUid && handleDeleteMsg(selectedUid)} disabled={!hasSelection}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 rounded text-xs font-medium hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:cursor-default cursor-pointer">
          <Trash2 size={14} /> Verwijderen
        </button>
        {/* Move dropdown */}
        <div className="relative">
          <button onClick={() => setShowMoveDropdown(!showMoveDropdown)} disabled={!hasSelection}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 rounded text-xs font-medium hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default cursor-pointer">
            <FolderInput size={14} /> Verplaatsen <ChevronDown size={10} />
          </button>
          {showMoveDropdown && selectedUid && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 max-h-64 overflow-y-auto">
              {folders.filter(f => f.path !== activeFolder).map(f => (
                <button key={f.path} onClick={() => { handleMoveMsg(selectedUid, f.path); setShowMoveDropdown(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer flex items-center gap-2">
                  <FolderOpen size={12} className="text-slate-400" /> {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button disabled={!hasSelection} className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 rounded text-xs font-medium hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default cursor-pointer">
          <Archive size={14} /> Archiveren
        </button>
        <button disabled={!hasSelection} className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 rounded text-xs font-medium hover:bg-amber-50 hover:text-amber-600 disabled:opacity-30 disabled:cursor-default cursor-pointer">
          <Star size={14} />
        </button>
        <div className="flex-1" />
        <button onClick={() => loadMessages(undefined, true)} disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-500 rounded text-xs hover:bg-slate-100 cursor-pointer disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* 3-pane layout */}
      <div className="flex flex-1 min-h-0">
        {/* Folder pane */}
        <div className="w-52 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          <div className="px-4 py-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0"><User size={14} /></div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{config.user.split("@")[0]}</p>
                <p className="text-[10px] text-slate-400 truncate">{config.user}</p>
              </div>
            </div>
          </div>
          <FolderTree folders={folders} activeFolder={activeFolder} onSelect={switchFolder}
            onDropMessage={(toFolder) => { if (selectedUid) handleMoveMsg(selectedUid, toFolder); }}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder} />
          <div className="p-2 border-t border-slate-200">
            <button onClick={() => setShowSetup(true)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer">
              <Settings size={12} /> Instellingen
            </button>
          </div>
        </div>

        {/* Message list pane with delete-on-hover */}
        <div className="w-80 xl:w-96 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          <div className="px-4 py-2.5 border-b border-slate-200 flex-shrink-0 bg-white">
            <span className="text-sm font-semibold text-slate-800">{activeFolder}</span>
            <span className="text-xs text-slate-400 ml-2">{total} berichten</span>
          </div>
          {error && <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-600">{error}</div>}
          <div className="flex-1 overflow-y-auto">
            {loading && messages.length === 0 && <div className="p-8 text-center text-sm text-slate-400">E-mail laden...</div>}
            {!loading && messages.length === 0 && !error && <div className="p-8 text-center text-sm text-slate-400">Geen berichten</div>}
            {messages.map((msg) => {
              const sender = formatSender(msg.from);
              const isSelected = selectedUid === msg.uid;
              const catId = categories[`${activeFolder}:${msg.uid}`];
              const cat = catId ? EMAIL_CATEGORIES.find(c => c.id === catId) : null;
              return (
                <div key={msg.uid} draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/x-mail-uid", String(msg.uid));
                    e.dataTransfer.effectAllowed = "move";
                    setSelectedUid(msg.uid);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setEmailContextMenu({ x: e.clientX, y: e.clientY, uid: msg.uid });
                    setSelectedUid(msg.uid);
                  }}
                  className={`group relative border-b border-slate-100 transition-colors ${
                  isSelected ? "bg-blue-50 border-l-2 border-l-blue-600"
                  : !msg.seen ? "bg-white border-l-2 border-l-blue-400 hover:bg-slate-50"
                  : "border-l-2 border-l-transparent hover:bg-slate-50"
                }`}>
                  <button onClick={() => openMessage(msg)} disabled={loadingMsg}
                    className="w-full text-left px-3 pr-10 py-2.5 cursor-pointer">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {cat && <span className={`w-2 h-2 rounded-full ${cat.color} flex-shrink-0`} title={cat.name} />}
                        <span className={`text-sm truncate ${!msg.seen ? "font-semibold text-slate-900" : "text-slate-700"}`}>{sender.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {msg.hasAttachments && <Paperclip size={11} className="text-slate-400" />}
                        {msg.flagged && <Star size={11} className="text-amber-400 fill-amber-400" />}
                        <span className="text-[11px] text-slate-400">{formatDate(msg.date)}</span>
                      </div>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${!msg.seen ? "font-medium text-slate-800" : "text-slate-500"}`}>
                      {msg.subject || "(Geen onderwerp)"}
                    </p>
                  </button>
                  {/* Delete on hover */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteMsg(msg.uid); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                    title="Verwijderen"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            {/* Email context menu */}
            {emailContextMenu && (
              <div className="fixed bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[180px]"
                style={{ left: emailContextMenu.x, top: emailContextMenu.y }}>
                <button onClick={() => { handleMarkUnread(emailContextMenu.uid); setEmailContextMenu(null); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer flex items-center gap-2">
                  <EyeOff size={12} /> Markeren als ongelezen
                </button>
                <div className="border-t border-slate-100 my-0.5" />
                <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase">Categorie</div>
                {EMAIL_CATEGORIES.map(c => {
                  const isActive = categories[`${activeFolder}:${emailContextMenu.uid}`] === c.id;
                  return (
                    <button key={c.id} onClick={() => {
                      const key = `${activeFolder}:${emailContextMenu.uid}`;
                      if (isActive) {
                        setCategoryForMessage(activeFolder, emailContextMenu.uid, null);
                        setCategories(prev => { const n = { ...prev }; delete n[key]; return n; });
                      } else {
                        setCategoryForMessage(activeFolder, emailContextMenu.uid, c.id);
                        setCategories(prev => ({ ...prev, [key]: c.id }));
                      }
                      setEmailContextMenu(null);
                    }}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${c.color}`} />
                      {c.name}
                      {isActive && <Check size={12} className="ml-auto text-blue-600" />}
                    </button>
                  );
                })}
                {categories[`${activeFolder}:${emailContextMenu.uid}`] && (
                  <button onClick={() => {
                    setCategoryForMessage(activeFolder, emailContextMenu.uid, null);
                    setCategories(prev => { const n = { ...prev }; delete n[`${activeFolder}:${emailContextMenu.uid}`]; return n; });
                    setEmailContextMenu(null);
                  }}
                    className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 cursor-pointer flex items-center gap-2">
                    <X size={12} /> Categorie verwijderen
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Reading pane */}
        {loadingMsg && !selectedMsg ? (
          <div className="flex-1 flex items-center justify-center bg-slate-50/50">
            <div className="text-center text-slate-400">
              <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-blue-500" />
              <p className="text-sm">Bericht laden...</p>
            </div>
          </div>
        ) : (
          <ReadingPane message={selectedMsg} onReply={openReply} onReplyAll={openReplyAll} onForward={openForward}
            onDelete={() => selectedUid && handleDeleteMsg(selectedUid)}
            onOpenAttachment={(idx) => selectedUid && openAttachment(selectedUid, idx)} />
        )}
      </div>

      {/* Compose window */}
      {compose && (
        <ComposeWindow compose={compose} onClose={() => setCompose(null)} onSent={() => { loadMessages(undefined, true); setToast("Bericht verzonden"); }} config={config} />
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-fade-in">
          <div className="flex items-center gap-2.5 px-5 py-3 bg-slate-800 text-white rounded-xl shadow-lg">
            <Check size={16} className="text-green-400" />
            <span className="text-sm font-medium">{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
