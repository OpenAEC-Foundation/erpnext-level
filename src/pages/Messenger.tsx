import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageSquare, Send, Search, Users, Settings, X, Cloud,
  Bot, Phone, Shield, Loader2, AlertCircle, Paperclip, Smile,
  ChevronLeft, CheckCheck,
} from "lucide-react";
import { getActiveInstanceId } from "../lib/instances";

const API = import.meta.env.VITE_API || "";
const API_BASE = import.meta.env.DEV ? "http://localhost:3001" : "";

/* ─── Types ─── */

interface Conversation {
  id: string;
  name: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  participants: number;
  type: string;
  platform: string;
}

interface Message {
  id: string;
  text: string;
  sender: string;
  senderDisplayName: string;
  timestamp: string;
  isOwn: boolean;
  platform: string;
}

interface PlatformConfig {
  configured: boolean;
  label: string;
  color: string;
  bgColor: string;
  icon: typeof MessageSquare;
}

type Platform = "nextcloud-talk" | "telegram" | "whatsapp" | "signal";

/* ─── Platform metadata ─── */

const PLATFORMS: Record<Platform, PlatformConfig> = {
  "nextcloud-talk": { configured: false, label: "NextCloud Talk", color: "text-blue-500", bgColor: "bg-blue-500", icon: Cloud },
  telegram: { configured: false, label: "Telegram", color: "text-sky-500", bgColor: "bg-sky-500", icon: Bot },
  whatsapp: { configured: false, label: "WhatsApp", color: "text-green-500", bgColor: "bg-green-500", icon: Phone },
  signal: { configured: false, label: "Signal", color: "text-indigo-500", bgColor: "bg-indigo-500", icon: Shield },
};

/* ─── Helpers ─── */

function getInstanceId() {
  return getActiveInstanceId();
}

function getPref(key: string): string {
  return localStorage.getItem(`pref_${getInstanceId()}_messenger_${key}`) || "";
}

function setPref(key: string, value: string) {
  localStorage.setItem(`pref_${getInstanceId()}_messenger_${key}`, value);
}

interface BackendServices {
  nextcloud?: { url: string; user: string; pass: string } | null;
  telegram?: { token: string } | null;
  whatsapp?: { enabled: boolean } | null;
}

function buildQuery(platform: Platform, extra: Record<string, string> = {}, backend: BackendServices = {}): string {
  const params = new URLSearchParams({ platform, ...extra });

  if (platform === "nextcloud-talk") {
    const id = getInstanceId();
    const url = backend.nextcloud?.url || getPref("nextcloud-talk_url") || localStorage.getItem(`pref_${id}_nextcloud_url`) || "";
    const user = backend.nextcloud?.user || getPref("nextcloud-talk_user") || localStorage.getItem(`pref_${id}_nextcloud_user`) || "";
    const pass = backend.nextcloud?.pass || getPref("nextcloud-talk_pass") || localStorage.getItem(`pref_${id}_nextcloud_pass`) || "";
    if (url) params.set("url", url);
    if (user) params.set("user", user);
    if (pass) params.set("pass", pass);
  } else if (platform === "telegram") {
    const token = backend.telegram?.token || getPref("telegram_token");
    if (token) params.set("token", token);
  }

  return params.toString();
}

function isPlatformConfigured(platform: Platform, backend: BackendServices = {}): boolean {
  if (platform === "nextcloud-talk") {
    if (backend.nextcloud?.url && backend.nextcloud?.user && backend.nextcloud?.pass) return true;
    const id = getInstanceId();
    const url = getPref("nextcloud-talk_url") || localStorage.getItem(`pref_${id}_nextcloud_url`) || "";
    const user = getPref("nextcloud-talk_user") || localStorage.getItem(`pref_${id}_nextcloud_user`) || "";
    const pass = getPref("nextcloud-talk_pass") || localStorage.getItem(`pref_${id}_nextcloud_pass`) || "";
    return !!(url && user && pass);
  }
  if (platform === "telegram") return !!(backend.telegram?.token || getPref("telegram_token"));
  if (platform === "whatsapp") return !!backend.whatsapp?.enabled;
  return false;
}

function formatTime(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Gisteren";
  if (diffDays < 7) {
    return d.toLocaleDateString("nl-NL", { weekday: "short" });
  }
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function formatMessageTime(isoStr: string): string {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function formatDateHeader(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Vandaag";
  if (diffDays === 1) return "Gisteren";
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function getInitials(name: string): string {
  return name
    .split(/[\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-teal-500",
  "bg-orange-500", "bg-pink-500",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/* ─── Component ─── */

export default function Messenger() {
  const [activePlatform, setActivePlatform] = useState<Platform>("nextcloud-talk");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [configPlatform, setConfigPlatform] = useState<Platform>("nextcloud-talk");
  const [mobileShowChat, setMobileShowChat] = useState(false);

  // Backend service credentials (from vault)
  const [backendServices, setBackendServices] = useState<{
    nextcloud?: { url: string; user: string; pass: string } | null;
    telegram?: { token: string } | null;
    whatsapp?: { enabled: boolean } | null;
  }>({});

  // Load service credentials from backend on mount
  useEffect(() => {
    const id = getInstanceId();
    fetch(`${API_BASE}/api/instances/${id}/services`)
      .then(r => r.json())
      .then(json => {
        if (json.data) {
          setBackendServices(json.data);
        }
      })
      .catch(() => {});
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const convoPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ─── Config form state ─── */
  const [cfgNcUrl, setCfgNcUrl] = useState("");
  const [cfgNcUser, setCfgNcUser] = useState("");
  const [cfgNcPass, setCfgNcPass] = useState("");
  const [cfgTgToken, setCfgTgToken] = useState("");

  // Load config from localStorage when opening config modal
  useEffect(() => {
    if (!showConfig) return;
    const id = getInstanceId();
    setCfgNcUrl(backendServices.nextcloud?.url || getPref("nextcloud-talk_url") || localStorage.getItem(`pref_${id}_nextcloud_url`) || "");
    setCfgNcUser(backendServices.nextcloud?.user || getPref("nextcloud-talk_user") || localStorage.getItem(`pref_${id}_nextcloud_user`) || "");
    setCfgNcPass(backendServices.nextcloud?.pass || getPref("nextcloud-talk_pass") || localStorage.getItem(`pref_${id}_nextcloud_pass`) || "");
    setCfgTgToken(backendServices.telegram?.token || getPref("telegram_token"));
  }, [showConfig]);

  /* ─── Scroll to bottom ─── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ─── Load conversations ─── */
  const loadConversations = useCallback(async (silent = false) => {
    if (!isPlatformConfigured(activePlatform, backendServices)) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const qs = buildQuery(activePlatform, {}, backendServices);
      const resp = await fetch(`${API}/api/messenger/conversations?${qs}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Fout bij laden gesprekken");
      if (json.config && !json.data?.length) {
        // Platform not configured / placeholder
        setConversations([]);
      } else {
        setConversations(json.data || []);
      }
    } catch (err) {
      if (!silent) setError((err as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activePlatform, backendServices]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Poll conversations every 15s
  useEffect(() => {
    if (convoPollerRef.current) clearInterval(convoPollerRef.current);
    if (isPlatformConfigured(activePlatform, backendServices)) {
      convoPollerRef.current = setInterval(() => loadConversations(true), 15000);
    }
    return () => {
      if (convoPollerRef.current) clearInterval(convoPollerRef.current);
    };
  }, [activePlatform, loadConversations]);

  /* ─── Load messages ─── */
  const loadMessages = useCallback(async (convo: Conversation, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const qs = buildQuery(convo.platform as Platform, { conversation: convo.id }, backendServices);
      const resp = await fetch(`${API}/api/messenger/messages?${qs}`);
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Fout bij laden berichten");
      setMessages(json.data || []);

      // Mark as read
      if (convo.unreadCount > 0) {
        const id = getInstanceId();
        const ncUrl = backendServices.nextcloud?.url || getPref("nextcloud-talk_url") || localStorage.getItem(`pref_${id}_nextcloud_url`) || "";
        const ncUser = backendServices.nextcloud?.user || getPref("nextcloud-talk_user") || localStorage.getItem(`pref_${id}_nextcloud_user`) || "";
        const ncPass = backendServices.nextcloud?.pass || getPref("nextcloud-talk_pass") || localStorage.getItem(`pref_${id}_nextcloud_pass`) || "";
        const tgToken = backendServices.telegram?.token || getPref("telegram_token");
        fetch(`${API}/api/messenger/mark-read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: convo.platform,
            conversation: convo.id,
            ...(convo.platform === "nextcloud-talk"
              ? { url: ncUrl, user: ncUser, pass: ncPass }
              : {}),
            ...(convo.platform === "telegram" ? { token: tgToken } : {}),
          }),
        }).catch(() => {});
      }
    } catch (err) {
      if (!silent) setError((err as Error).message);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [backendServices]);

  // Poll messages every 5s when conversation is open
  useEffect(() => {
    if (msgPollerRef.current) clearInterval(msgPollerRef.current);
    if (selectedConvo) {
      msgPollerRef.current = setInterval(() => loadMessages(selectedConvo, true), 5000);
    }
    return () => {
      if (msgPollerRef.current) clearInterval(msgPollerRef.current);
    };
  }, [selectedConvo, loadMessages]);

  /* ─── Send message ─── */
  async function handleSend() {
    if (!messageInput.trim() || !selectedConvo || sending) return;
    setSending(true);
    try {
      const body: Record<string, string> = {
        platform: selectedConvo.platform,
        conversation: selectedConvo.id,
        message: messageInput.trim(),
      };
      if (selectedConvo.platform === "nextcloud-talk") {
        const id = getInstanceId();
        body.url = backendServices.nextcloud?.url || getPref("nextcloud-talk_url") || localStorage.getItem(`pref_${id}_nextcloud_url`) || "";
        body.user = backendServices.nextcloud?.user || getPref("nextcloud-talk_user") || localStorage.getItem(`pref_${id}_nextcloud_user`) || "";
        body.pass = backendServices.nextcloud?.pass || getPref("nextcloud-talk_pass") || localStorage.getItem(`pref_${id}_nextcloud_pass`) || "";
      } else if (selectedConvo.platform === "telegram") {
        body.token = backendServices.telegram?.token || getPref("telegram_token");
      }

      const resp = await fetch(`${API}/api/messenger/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Fout bij versturen");

      setMessageInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      // Reload messages immediately
      await loadMessages(selectedConvo, true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  /* ─── Save config ─── */
  function handleSaveConfig() {
    setPref("nextcloud-talk_url", cfgNcUrl.replace(/\/+$/, ""));
    setPref("nextcloud-talk_user", cfgNcUser);
    setPref("nextcloud-talk_pass", cfgNcPass);
    setPref("telegram_token", cfgTgToken);
    setShowConfig(false);
    // Reload conversations with new config
    setTimeout(() => loadConversations(), 100);
  }

  /* ─── Select conversation ─── */
  function handleSelectConvo(convo: Conversation) {
    setSelectedConvo(convo);
    setMessages([]);
    setMobileShowChat(true);
    loadMessages(convo);
  }

  /* ─── Auto-resize textarea ─── */
  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setMessageInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  /* ─── Filter conversations ─── */
  const filtered = conversations.filter(
    (c) => c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  /* ─── Group messages by date ─── */
  const groupedMessages: { date: string; messages: Message[] }[] = [];
  let currentDate = "";
  for (const msg of messages) {
    const d = msg.timestamp ? new Date(msg.timestamp).toDateString() : "unknown";
    if (d !== currentDate) {
      currentDate = d;
      groupedMessages.push({ date: msg.timestamp, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  const configured = isPlatformConfigured(activePlatform, backendServices);

  return (
    <div className="h-full flex bg-slate-100">
      {/* ─── Left sidebar: conversation list ─── */}
      <div className={`w-80 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col ${mobileShowChat ? "hidden lg:flex" : "flex"}`}>
        {/* Platform tabs */}
        <div className="p-3 border-b border-slate-200 bg-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-white">Berichten</h1>
            <button
              onClick={() => { setConfigPlatform(activePlatform); setShowConfig(true); }}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
              title="Instellingen"
            >
              <Settings size={18} />
            </button>
          </div>
          <div className="flex gap-1">
            {(Object.entries(PLATFORMS) as [Platform, PlatformConfig][]).map(([key, p]) => {
              const Icon = p.icon;
              const active = activePlatform === key;
              const isConfigured = isPlatformConfigured(key, backendServices);
              return (
                <button
                  key={key}
                  onClick={() => { setActivePlatform(key); setSelectedConvo(null); setMessages([]); setMobileShowChat(false); }}
                  className={`flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-slate-700 text-white"
                      : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-300"
                  }`}
                  title={p.label}
                >
                  <div className="relative">
                    <Icon size={18} />
                    {isConfigured && (
                      <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full" />
                    )}
                  </div>
                  <span className="truncate w-full text-center" style={{ fontSize: "10px" }}>{p.label.split(" ").pop()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Zoeken..."
              className="w-full pl-9 pr-3 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {!configured && (
            <div className="p-6 text-center space-y-3">
              <div className="p-3 bg-slate-100 rounded-xl inline-block">
                <Settings size={32} className="text-slate-400" />
              </div>
              <p className="text-sm text-slate-500">
                {activePlatform === "whatsapp" || activePlatform === "signal"
                  ? `${PLATFORMS[activePlatform].label} is nog niet beschikbaar.`
                  : `Configureer ${PLATFORMS[activePlatform].label} om te beginnen.`}
              </p>
              {(activePlatform === "nextcloud-talk" || activePlatform === "telegram") && (
                <button
                  onClick={() => { setConfigPlatform(activePlatform); setShowConfig(true); }}
                  className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
                >
                  Configureren
                </button>
              )}
            </div>
          )}

          {configured && loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
          )}

          {configured && !loading && error && (
            <div className="p-4">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {configured && !loading && !error && filtered.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm text-slate-400">Geen gesprekken gevonden</p>
            </div>
          )}

          {filtered.map((convo) => {
            const active = selectedConvo?.id === convo.id;
            const PIcon = PLATFORMS[convo.platform as Platform]?.icon || MessageSquare;
            return (
              <button
                key={convo.id}
                onClick={() => handleSelectConvo(convo)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer border-b border-slate-100 ${
                  active ? "bg-blue-50" : "hover:bg-slate-50"
                }`}
              >
                {/* Avatar */}
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${avatarColor(convo.name)}`}>
                  {getInitials(convo.name)}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-slate-800 truncate">{convo.name}</span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{formatTime(convo.lastMessageTime)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-slate-500 truncate">{convo.lastMessage || "\u00A0"}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <PIcon size={10} className={PLATFORMS[convo.platform as Platform]?.color || "text-slate-400"} />
                      {convo.unreadCount > 0 && (
                        <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {convo.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Right pane: messages ─── */}
      <div className={`flex-1 flex flex-col min-w-0 ${!mobileShowChat && !selectedConvo ? "" : ""}`}>
        {!selectedConvo ? (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center bg-slate-50">
            <div className="text-center space-y-3">
              <div className="p-4 bg-slate-200/50 rounded-2xl inline-block">
                <MessageSquare size={48} className="text-slate-300" />
              </div>
              <p className="text-slate-400 text-sm">Selecteer een gesprek om berichten te bekijken</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-4 py-3 bg-slate-800 text-white flex items-center gap-3 flex-shrink-0">
              <button
                onClick={() => { setMobileShowChat(false); }}
                className="lg:hidden p-1 hover:bg-slate-700 rounded cursor-pointer"
              >
                <ChevronLeft size={20} />
              </button>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${avatarColor(selectedConvo.name)}`}>
                {getInitials(selectedConvo.name)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-sm truncate">{selectedConvo.name}</h2>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  {selectedConvo.participants > 0 && (
                    <span className="flex items-center gap-1">
                      <Users size={12} />
                      {selectedConvo.participants} deelnemers
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PLATFORMS[selectedConvo.platform as Platform]?.bgColor || "bg-slate-600"} text-white`}>
                    {PLATFORMS[selectedConvo.platform as Platform]?.label || selectedConvo.platform}
                  </span>
                </div>
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto bg-slate-100 px-4 py-3">
              {loadingMessages && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-slate-400" />
                </div>
              )}

              {!loadingMessages && messages.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-slate-400">Geen berichten in dit gesprek</p>
                </div>
              )}

              {groupedMessages.map((group, gi) => (
                <div key={gi}>
                  {/* Date separator */}
                  <div className="flex items-center justify-center my-4">
                    <span className="px-3 py-1 bg-white rounded-full text-[11px] text-slate-500 font-medium shadow-sm">
                      {formatDateHeader(group.date)}
                    </span>
                  </div>
                  {/* Messages */}
                  {group.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex mb-2 ${msg.isOwn ? "justify-end" : "justify-start"}`}
                    >
                      {!msg.isOwn && (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-semibold mr-2 mt-1 flex-shrink-0 ${avatarColor(msg.senderDisplayName)}`}>
                          {getInitials(msg.senderDisplayName)}
                        </div>
                      )}
                      <div className={`max-w-[70%] ${msg.isOwn ? "order-1" : ""}`}>
                        {!msg.isOwn && (
                          <span className="text-[10px] text-slate-500 font-medium ml-1 mb-0.5 block">
                            {msg.senderDisplayName}
                          </span>
                        )}
                        <div
                          className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                            msg.isOwn
                              ? "bg-blue-500 text-white rounded-br-md"
                              : "bg-white text-slate-800 rounded-bl-md shadow-sm"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                          <div className={`flex items-center justify-end gap-1 mt-1 ${msg.isOwn ? "text-blue-100" : "text-slate-400"}`}>
                            <span className="text-[10px]">{formatMessageTime(msg.timestamp)}</span>
                            {msg.isOwn && <CheckCheck size={12} />}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="px-4 py-3 bg-white border-t border-slate-200 flex items-end gap-2 flex-shrink-0">
              <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer flex-shrink-0 mb-0.5" title="Bijlage">
                <Paperclip size={20} />
              </button>
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={messageInput}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Typ een bericht..."
                  rows={1}
                  className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-0 resize-none overflow-hidden"
                  style={{ minHeight: 40, maxHeight: 120 }}
                />
              </div>
              <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer flex-shrink-0 mb-0.5" title="Emoji">
                <Smile size={20} />
              </button>
              <button
                onClick={handleSend}
                disabled={!messageInput.trim() || sending}
                className="p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex-shrink-0 mb-0.5"
                title="Versturen"
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ─── Config Modal ─── */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfig(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Berichtenplatforms configureren</h2>
              <button onClick={() => setShowConfig(false)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={20} />
              </button>
            </div>

            {/* Platform tabs */}
            <div className="px-6 pt-4 flex gap-2">
              {(Object.entries(PLATFORMS) as [Platform, PlatformConfig][]).map(([key, p]) => {
                const Icon = p.icon;
                return (
                  <button
                    key={key}
                    onClick={() => setConfigPlatform(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      configPlatform === key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <Icon size={14} />
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Config form */}
            <div className="p-6 space-y-4">
              {configPlatform === "nextcloud-talk" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">NextCloud URL</label>
                    <input
                      type="url"
                      value={cfgNcUrl}
                      onChange={(e) => setCfgNcUrl(e.target.value)}
                      placeholder="https://cloud.example.com"
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Gebruikersnaam</label>
                    <input
                      type="text"
                      value={cfgNcUser}
                      onChange={(e) => setCfgNcUser(e.target.value)}
                      placeholder="admin"
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Wachtwoord</label>
                    <input
                      type="password"
                      value={cfgNcPass}
                      onChange={(e) => setCfgNcPass(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-slate-400 mt-1">Gebruik een app-wachtwoord voor betere beveiliging.</p>
                  </div>
                </>
              )}

              {configPlatform === "telegram" && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bot Token</label>
                  <input
                    type="password"
                    value={cfgTgToken}
                    onChange={(e) => setCfgTgToken(e.target.value)}
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Maak een bot aan via @BotFather in Telegram en plak het token hier.
                  </p>
                </div>
              )}

              {configPlatform === "whatsapp" && (
                <div className="space-y-3">
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm font-medium text-amber-800 mb-2">Binnenkort beschikbaar</p>
                    <p className="text-xs text-amber-700">
                      WhatsApp Business API vereist een apart account en goedkeuring van Meta.
                    </p>
                  </div>
                  <div className="space-y-2 text-xs text-slate-600">
                    <p className="font-medium text-slate-700">Vereiste stappen:</p>
                    <ol className="list-decimal ml-4 space-y-1">
                      <li>Maak een Meta Business Account aan op business.facebook.com</li>
                      <li>Registreer een WhatsApp Business API nummer</li>
                      <li>Verkrijg een permanent access token via de Meta Developer Console</li>
                      <li>Configureer een webhook URL voor inkomende berichten</li>
                    </ol>
                  </div>
                </div>
              )}

              {configPlatform === "signal" && (
                <div className="space-y-3">
                  <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <p className="text-sm font-medium text-indigo-800 mb-2">Binnenkort beschikbaar</p>
                    <p className="text-xs text-indigo-700">
                      Signal vereist signal-cli of signal-cli-rest-api als backend.
                    </p>
                  </div>
                  <div className="space-y-2 text-xs text-slate-600">
                    <p className="font-medium text-slate-700">Vereiste stappen:</p>
                    <ol className="list-decimal ml-4 space-y-1">
                      <li>Installeer signal-cli (github.com/AsamK/signal-cli)</li>
                      <li>Of gebruik signal-cli-rest-api via Docker</li>
                      <li>Registreer je telefoonnummer met signal-cli</li>
                      <li>Configureer de API URL</li>
                    </ol>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Annuleren
              </button>
              {(configPlatform === "nextcloud-talk" || configPlatform === "telegram") && (
                <button
                  onClick={handleSaveConfig}
                  className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
                >
                  Opslaan
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
