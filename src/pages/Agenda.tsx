import { useEffect, useState, useMemo, useCallback } from "react";
import { fetchList, createDocument } from "../lib/erpnext";
import { useLeaves } from "../lib/DataContext";
import { getActiveInstanceId } from "../lib/instances";
import {
  Calendar, ChevronLeft, ChevronRight, Clock, MapPin, Users,
  Plus, RefreshCw, X, Send, Video, CheckSquare, CalendarDays,
  Settings, Trash2,
} from "lucide-react";

/* ─── Types ─── */

interface EventItem {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  type: "event" | "task" | "leave" | "timesheet" | "ical";
  color: string;
  description?: string;
  location?: string;
  owner?: string;
  calendarId?: string;
}

type ViewType = "month" | "week" | "day";

interface CreateForm {
  type: "event" | "task";
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  description: string;
  location: string;
  assignTo: string;
  inviteEmails: string;
  jitsiRoom: string;
  withJitsi: boolean;
}

interface CustomCalendar {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
}

/* ─── ERPNext source toggle types ─── */

type ErpSourceKey = "events" | "tasks" | "leaves" | "timesheets";

interface ErpSourceConfig {
  key: ErpSourceKey;
  label: string;
  color: string;
}

const ERP_SOURCES: ErpSourceConfig[] = [
  { key: "events", label: "Afspraken", color: "#3b82f6" },
  { key: "tasks", label: "Taken", color: "#f59e0b" },
  { key: "leaves", label: "Verlofaanvragen", color: "#ef4444" },
  { key: "timesheets", label: "Timesheets", color: "#10b981" },
];

const TYPE_COLORS: Record<string, string> = {
  event: "#3b82f6",
  task: "#f59e0b",
  leave: "#ef4444",
  timesheet: "#10b981",
  ical: "#8b5cf6",
};

const TYPE_LABELS: Record<string, string> = {
  event: "Afspraak",
  task: "Taak",
  leave: "Verlof",
  timesheet: "Timesheet",
  ical: "Agenda",
};

const CALENDAR_COLORS = [
  "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316",
  "#6366f1", "#84cc16", "#e11d48", "#0ea5e9", "#a855f7",
];

/* ─── Helpers ─── */

function getMonthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay();
  const startOffset = startDay === 0 ? 6 : startDay - 1;
  const start = new Date(first);
  start.setDate(start.getDate() - startOffset);
  const endDay = last.getDay();
  const endOffset = endDay === 0 ? 0 : 7 - endDay;
  const end = new Date(last);
  end.setDate(end.getDate() + endOffset);
  const days: Date[] = [];
  const current = new Date(start);
  while (current <= end) { days.push(new Date(current)); current.setDate(current.getDate() + 1); }
  return days;
}

function getWeekDays(date: Date): Date[] {
  const day = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); days.push(d); }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function generateJitsiRoom(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let room = "erpnext-";
  for (let i = 0; i < 10; i++) room += chars[Math.floor(Math.random() * chars.length)];
  return room;
}

const WEEKDAY_NAMES = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const MONTH_NAMES = [
  "Januari", "Februari", "Maart", "April", "Mei", "Juni",
  "Juli", "Augustus", "September", "Oktober", "November", "December",
];

/* ─── Preferences helpers ─── */

function getPrefKey(suffix: string): string {
  const id = getActiveInstanceId();
  return `pref_${id}_agenda_${suffix}`;
}

function getErpSourceEnabled(key: ErpSourceKey): boolean {
  const stored = localStorage.getItem(getPrefKey(`show_${key}`));
  if (stored === null) return false; // Default: all hidden
  return stored === "true";
}

function setErpSourceEnabled(key: ErpSourceKey, enabled: boolean): void {
  localStorage.setItem(getPrefKey(`show_${key}`), String(enabled));
}

function getCustomCalendars(): CustomCalendar[] {
  try {
    const raw = localStorage.getItem(getPrefKey("calendars"));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveCustomCalendars(calendars: CustomCalendar[]): void {
  localStorage.setItem(getPrefKey("calendars"), JSON.stringify(calendars));
}

/* ─── SMTP helpers (reuse from Webmail config) ─── */

function getSmtpConfig() {
  const id = getActiveInstanceId();
  return {
    host: localStorage.getItem(`pref_${id}_smtp_host`) || localStorage.getItem(`pref_${id}_imap_host`) || "",
    port: localStorage.getItem(`pref_${id}_smtp_port`) || "587",
    user: localStorage.getItem(`pref_${id}_smtp_user`) || localStorage.getItem(`pref_${id}_imap_user`) || "",
    pass: localStorage.getItem(`pref_${id}_smtp_pass`) || localStorage.getItem(`pref_${id}_imap_pass`) || "",
    secure: localStorage.getItem(`pref_${id}_smtp_secure`) === "true",
  };
}

/* ─── Add Calendar Modal ─── */

function AddCalendarModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (cal: CustomCalendar) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState(CALENDAR_COLORS[0]);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  async function handleAdd() {
    if (!name.trim()) { setError("Vul een naam in"); return; }
    if (!url.trim()) { setError("Vul een URL in"); return; }
    setTesting(true);
    setError("");
    try {
      const res = await fetch(`/api/calendar/ical?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Kon agenda niet ophalen" }));
        setError(data.error || `Fout: ${res.status}`);
        return;
      }
      onAdd({
        id: `cal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        url: url.trim(),
        color,
        enabled: true,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[420px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-800">Agenda toevoegen</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded cursor-pointer"><X size={16} className="text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Naam</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Bijv. Feestdagen NL, Persoonlijk..." autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">URL (iCal / .ics / webcal://)</label>
            <input type="text" value={url} onChange={e => setUrl(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://... of webcal://..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Kleur</label>
            <div className="flex items-center gap-2 flex-wrap">
              {CALENDAR_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full cursor-pointer transition-transform ${color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : "hover:scale-105"}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {error && <div className="p-2 bg-red-50 text-xs text-red-600 rounded border border-red-200">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer">Annuleren</button>
          <button onClick={handleAdd} disabled={testing || !name.trim() || !url.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
            {testing ? "Testen..." : <><Plus size={14} /> Toevoegen</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Settings Panel ─── */

function SettingsPanel({ erpSources, calendars, onErpToggle, onCalendarToggle, onCalendarRemove, onAddCalendar }: {
  erpSources: Record<ErpSourceKey, boolean>;
  calendars: CustomCalendar[];
  onErpToggle: (key: ErpSourceKey) => void;
  onCalendarToggle: (id: string) => void;
  onCalendarRemove: (id: string) => void;
  onAddCalendar: () => void;
}) {
  return (
    <div className="w-64 bg-white border-l border-slate-200 flex flex-col flex-shrink-0 overflow-y-auto">
      {/* ERPNext Sources */}
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Bronnen (ERPNext)</h3>
        <div className="space-y-2">
          {ERP_SOURCES.map(src => (
            <label key={src.key} className="flex items-center gap-2.5 cursor-pointer group">
              <button onClick={() => onErpToggle(src.key)}
                className={`relative w-8 h-[18px] rounded-full transition-colors cursor-pointer ${erpSources[src.key] ? "bg-blue-500" : "bg-slate-300"}`}>
                <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${erpSources[src.key] ? "left-[16px]" : "left-[2px]"}`} />
              </button>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: src.color }} />
              <span className="text-xs text-slate-700 group-hover:text-slate-900">{src.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom Calendars */}
      <div className="px-4 py-3 flex-1">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Agenda's (extern)</h3>
        <div className="space-y-2 mb-3">
          {calendars.length === 0 && (
            <p className="text-[11px] text-slate-400 italic">Geen externe agenda's</p>
          )}
          {calendars.map(cal => (
            <div key={cal.id} className="flex items-center gap-2 group">
              <button onClick={() => onCalendarToggle(cal.id)}
                className={`relative w-8 h-[18px] rounded-full transition-colors cursor-pointer flex-shrink-0 ${cal.enabled ? "bg-blue-500" : "bg-slate-300"}`}>
                <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${cal.enabled ? "left-[16px]" : "left-[2px]"}`} />
              </button>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cal.color }} />
              <span className="text-xs text-slate-700 flex-1 truncate" title={cal.name}>{cal.name}</span>
              <button onClick={() => onCalendarRemove(cal.id)}
                className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={onAddCalendar}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer w-full">
          <Plus size={13} /> Agenda toevoegen
        </button>
      </div>
    </div>
  );
}

/* ─── Create/Edit modal ─── */

function CreateModal({ initial, onClose, onCreated }: {
  initial: Partial<CreateForm>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateForm>({
    type: initial.type || "event",
    title: initial.title || "",
    date: initial.date || formatDateKey(new Date()),
    startTime: initial.startTime || "09:00",
    endTime: initial.endTime || "10:00",
    allDay: initial.allDay ?? false,
    description: initial.description || "",
    location: initial.location || "",
    assignTo: "",
    inviteEmails: "",
    jitsiRoom: "",
    withJitsi: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);

  function toggleJitsi() {
    setForm(f => ({
      ...f,
      withJitsi: !f.withJitsi,
      jitsiRoom: !f.withJitsi ? (f.jitsiRoom || generateJitsiRoom()) : f.jitsiRoom,
    }));
  }

  const jitsiUrl = form.jitsiRoom ? `https://meet.jit.si/${form.jitsiRoom}` : "";

  async function handleSave() {
    if (!form.title.trim()) { setError("Vul een titel in"); return; }
    setSaving(true); setError("");

    try {
      const startDt = form.allDay ? form.date : `${form.date} ${form.startTime}:00`;
      const endDt = form.allDay ? form.date : `${form.date} ${form.endTime}:00`;

      let description = form.description;
      if (form.withJitsi && jitsiUrl) {
        description += `\n\n🎥 Jitsi Meeting: ${jitsiUrl}`;
      }

      if (form.type === "event") {
        await createDocument("Event", {
          subject: form.title,
          starts_on: startDt,
          ends_on: endDt,
          all_day: form.allDay ? 1 : 0,
          event_type: "Public",
          description,
          location: form.location,
          status: "Open",
        });
      } else {
        await createDocument("Task", {
          subject: form.title,
          exp_start_date: form.date,
          exp_end_date: form.date,
          description,
          priority: "Medium",
          status: "Open",
        });
      }

      // Send invitation emails if specified
      if (form.inviteEmails.trim()) {
        const smtp = getSmtpConfig();
        if (smtp.host && smtp.user && smtp.pass) {
          setSendingInvite(true);
          const recipients = form.inviteEmails.split(/[,;]\s*/).filter(Boolean);
          const timeInfo = form.allDay ? "Hele dag" : `${form.startTime} - ${form.endTime}`;
          let bodyHtml = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;">
              <h2 style="color:#1e293b;margin-bottom:4px;">📅 ${form.title}</h2>
              <p style="color:#64748b;margin:4px 0;"><strong>Datum:</strong> ${new Date(form.date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
              <p style="color:#64748b;margin:4px 0;"><strong>Tijd:</strong> ${timeInfo}</p>
              ${form.location ? `<p style="color:#64748b;margin:4px 0;"><strong>Locatie:</strong> ${form.location}</p>` : ""}
              ${form.description ? `<p style="color:#475569;margin:12px 0;">${form.description.replace(/\n/g, "<br>")}</p>` : ""}
              ${form.withJitsi && jitsiUrl ? `
                <div style="margin:16px 0;padding:12px 16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
                  <p style="margin:0 0 8px;font-weight:600;color:#1d4ed8;">🎥 Jitsi Videovergadering</p>
                  <a href="${jitsiUrl}" style="color:#2563eb;text-decoration:none;font-size:14px;">${jitsiUrl}</a>
                </div>
              ` : ""}
            </div>
          `;

          try {
            await fetch("/api/mail/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                smtp: { host: smtp.host, port: parseInt(smtp.port), user: smtp.user, pass: smtp.pass, secure: smtp.secure },
                from: smtp.user,
                to: recipients,
                subject: `Uitnodiging: ${form.title} — ${form.date}`,
                html: bodyHtml,
                text: `Uitnodiging: ${form.title}\nDatum: ${form.date}\nTijd: ${timeInfo}${form.location ? `\nLocatie: ${form.location}` : ""}${form.withJitsi ? `\nJitsi: ${jitsiUrl}` : ""}`,
              }),
            });
          } catch {
            // Don't block on invitation errors
          }
        }
      }

      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      setSendingInvite(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-800">
            {form.type === "event" ? "Nieuwe afspraak" : "Nieuwe taak"}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded cursor-pointer"><X size={16} className="text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Type toggle */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
            <button onClick={() => setForm(f => ({ ...f, type: "event" }))}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${form.type === "event" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>
              <CalendarDays size={13} /> Afspraak
            </button>
            <button onClick={() => setForm(f => ({ ...f, type: "task" }))}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${form.type === "task" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500"}`}>
              <CheckSquare size={13} /> Taak
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Titel</label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Vergadering, Klantgesprek..." autoFocus />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Datum</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {!form.allDay && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Van</label>
                  <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tot</label>
                  <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={form.allDay} onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))} className="rounded border-slate-300" />
            Hele dag
          </label>

          {/* Location (events only) */}
          {form.type === "event" && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Locatie</label>
              <input type="text" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Kantoor, Teams, Online..." />
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Beschrijving</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3} placeholder="Optionele details..." />
          </div>

          {/* Jitsi toggle */}
          <div className="bg-slate-50 rounded-lg p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer font-medium">
              <input type="checkbox" checked={form.withJitsi} onChange={toggleJitsi} className="rounded border-slate-300" />
              <Video size={15} className="text-blue-600" /> Jitsi videovergadering toevoegen
            </label>
            {form.withJitsi && (
              <div className="ml-6">
                <div className="flex items-center gap-2">
                  <input type="text" value={form.jitsiRoom} onChange={e => setForm(f => ({ ...f, jitsiRoom: e.target.value }))}
                    className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="room-name" />
                </div>
                {jitsiUrl && (
                  <a href={jitsiUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-1 inline-block">{jitsiUrl}</a>
                )}
              </div>
            )}
          </div>

          {/* Invite emails */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              <Send size={11} className="inline mr-1" />
              Uitnodiging versturen naar (optioneel)
            </label>
            <input type="text" value={form.inviteEmails} onChange={e => setForm(f => ({ ...f, inviteEmails: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="collega@bedrijf.nl, klant@ander.nl" />
            <p className="text-[10px] text-slate-400 mt-0.5">Meerdere adressen scheiden met komma of puntkomma</p>
          </div>

          {error && <div className="p-2 bg-red-50 text-xs text-red-600 rounded border border-red-200">{error}</div>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer">Annuleren</button>
          <button onClick={handleSave} disabled={saving || !form.title.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
            {saving ? (sendingInvite ? "Uitnodiging versturen..." : "Opslaan...") : (
              <><Plus size={14} /> {form.inviteEmails.trim() ? "Opslaan & uitnodigen" : "Opslaan"}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Component ─── */

export default function Agenda() {
  const [viewType, setViewType] = useState<ViewType>("month");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [events, setEvents] = useState<EventItem[]>([]);
  const [icalEvents, setIcalEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [createModal, setCreateModal] = useState<Partial<CreateForm> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [addCalendarModal, setAddCalendarModal] = useState(false);
  const leaves = useLeaves();

  // ERPNext source toggles
  const [erpSources, setErpSources] = useState<Record<ErpSourceKey, boolean>>({
    events: getErpSourceEnabled("events"),
    tasks: getErpSourceEnabled("tasks"),
    leaves: getErpSourceEnabled("leaves"),
    timesheets: getErpSourceEnabled("timesheets"),
  });

  // Custom calendars
  const [calendars, setCalendars] = useState<CustomCalendar[]>(() => getCustomCalendars());

  const today = useMemo(() => new Date(), []);

  const dateRange = useMemo(() => {
    if (viewType === "month") {
      const days = getMonthDays(currentDate.getFullYear(), currentDate.getMonth());
      return { start: formatDateKey(days[0]), end: formatDateKey(days[days.length - 1]) };
    } else if (viewType === "week") {
      const days = getWeekDays(currentDate);
      return { start: formatDateKey(days[0]), end: formatDateKey(days[6]) };
    } else {
      const key = formatDateKey(currentDate);
      return { start: key, end: key };
    }
  }, [currentDate, viewType]);

  /* ─── Toggle handlers ─── */

  function handleErpToggle(key: ErpSourceKey) {
    setErpSources(prev => {
      const next = { ...prev, [key]: !prev[key] };
      setErpSourceEnabled(key, next[key]);
      return next;
    });
  }

  function handleCalendarToggle(id: string) {
    setCalendars(prev => {
      const next = prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c);
      saveCustomCalendars(next);
      return next;
    });
  }

  function handleCalendarRemove(id: string) {
    setCalendars(prev => {
      const next = prev.filter(c => c.id !== id);
      saveCustomCalendars(next);
      return next;
    });
  }

  function handleAddCalendar(cal: CustomCalendar) {
    setCalendars(prev => {
      const next = [...prev, cal];
      saveCustomCalendars(next);
      return next;
    });
  }

  /* ─── Load ERPNext events ─── */

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const fetches: Promise<any>[] = [];
      const fetchLabels: string[] = [];

      if (erpSources.events) {
        fetches.push(fetchList<{
          name: string; subject: string; starts_on: string; ends_on: string;
          all_day: number; event_type: string; description: string; location: string;
        }>("Event", {
          fields: ["name", "subject", "starts_on", "ends_on", "all_day", "event_type", "description", "location"],
          filters: [
            ["starts_on", ">=", dateRange.start],
            ["starts_on", "<=", dateRange.end + " 23:59:59"],
            ["status", "=", "Open"],
          ],
          limit_page_length: 200,
          order_by: "starts_on asc",
        }));
        fetchLabels.push("events");
      }

      if (erpSources.tasks) {
        fetches.push(fetchList<{
          name: string; subject: string; exp_start_date: string; exp_end_date: string;
          status: string; priority: string;
        }>("Task", {
          fields: ["name", "subject", "exp_start_date", "exp_end_date", "status", "priority"],
          filters: [
            ["exp_start_date", ">=", dateRange.start],
            ["exp_start_date", "<=", dateRange.end],
            ["status", "not in", ["Cancelled", "Completed"]],
          ],
          limit_page_length: 200,
        }));
        fetchLabels.push("tasks");
      }

      if (erpSources.timesheets) {
        fetches.push(fetchList<{
          name: string; title: string; start_date: string; end_date: string;
          total_hours: number; employee_name: string;
        }>("Timesheet", {
          fields: ["name", "title", "start_date", "end_date", "total_hours", "employee_name"],
          filters: [
            ["start_date", ">=", dateRange.start],
            ["start_date", "<=", dateRange.end],
            ["docstatus", "=", 1],
          ],
          limit_page_length: 200,
        }));
        fetchLabels.push("timesheets");
      }

      const results = await Promise.allSettled(fetches);
      const items: EventItem[] = [];

      results.forEach((result, idx) => {
        if (result.status !== "fulfilled") return;
        const label = fetchLabels[idx];

        if (label === "events") {
          for (const e of result.value) {
            items.push({
              id: `event-${e.name}`, title: e.subject || "(Geen titel)",
              start: e.starts_on, end: e.ends_on || undefined,
              allDay: !!e.all_day, type: "event", color: TYPE_COLORS.event,
              description: e.description, location: e.location,
            });
          }
        } else if (label === "tasks") {
          for (const t of result.value) {
            if (t.exp_start_date) {
              items.push({
                id: `task-${t.name}`, title: t.subject,
                start: t.exp_start_date, end: t.exp_end_date || undefined,
                allDay: true, type: "task", color: TYPE_COLORS.task,
              });
            }
          }
        } else if (label === "timesheets") {
          for (const ts of result.value) {
            items.push({
              id: `ts-${ts.name}`, title: ts.title || `${ts.employee_name} - ${ts.total_hours}u`,
              start: ts.start_date, end: ts.end_date || undefined,
              allDay: true, type: "timesheet", color: TYPE_COLORS.timesheet,
              owner: ts.employee_name,
            });
          }
        }
      });

      // Leaves
      if (erpSources.leaves) {
        for (const lv of leaves) {
          if (lv.status !== "Approved") continue;
          if (lv.from_date <= dateRange.end && lv.to_date >= dateRange.start) {
            items.push({
              id: `leave-${lv.name}`, title: `${lv.employee_name} - ${lv.leave_type}`,
              start: lv.from_date, end: lv.to_date,
              allDay: true, type: "leave", color: TYPE_COLORS.leave,
              owner: lv.employee_name,
            });
          }
        }
      }

      setEvents(items);
    } catch (err) {
      console.error("Agenda fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [dateRange.start, dateRange.end, leaves, erpSources]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  /* ─── Load iCal events ─── */

  const loadIcalEvents = useCallback(async () => {
    const enabledCals = calendars.filter(c => c.enabled);
    if (enabledCals.length === 0) { setIcalEvents([]); return; }

    const allIcalItems: EventItem[] = [];

    await Promise.allSettled(enabledCals.map(async (cal) => {
      try {
        const res = await fetch(`/api/calendar/ical?url=${encodeURIComponent(cal.url)}`);
        if (!res.ok) return;
        const { data } = await res.json() as {
          data: Array<{
            uid: string; summary: string; dtstart: string; dtend: string;
            description: string; location: string; allDay: boolean;
          }>;
        };

        for (const ev of data) {
          // Filter to date range
          const evStart = ev.dtstart.split(" ")[0];
          const evEnd = ev.dtend ? ev.dtend.split(" ")[0] : evStart;
          if (evEnd < dateRange.start || evStart > dateRange.end) continue;

          allIcalItems.push({
            id: `ical-${cal.id}-${ev.uid}`,
            title: ev.summary,
            start: ev.dtstart,
            end: ev.dtend || undefined,
            allDay: ev.allDay,
            type: "ical",
            color: cal.color,
            description: ev.description,
            location: ev.location,
            calendarId: cal.id,
          });
        }
      } catch (err) {
        console.warn(`[agenda] Failed to load calendar ${cal.name}:`, err);
      }
    }));

    setIcalEvents(allIcalItems);
  }, [calendars, dateRange.start, dateRange.end]);

  useEffect(() => { loadIcalEvents(); }, [loadIcalEvents]);

  /* ─── Combined events ─── */

  const allEvents = useMemo(() => [...events, ...icalEvents], [events, icalEvents]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of allEvents) {
      const startDate = e.start.split("T")[0].split(" ")[0];
      const endDate = e.end ? e.end.split("T")[0].split(" ")[0] : startDate;
      const current = new Date(startDate + "T00:00:00");
      const last = new Date(endDate + "T00:00:00");
      while (current <= last) {
        const key = formatDateKey(current);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        current.setDate(current.getDate() + 1);
      }
    }
    return map;
  }, [allEvents]);

  /* ─── Active legend (only show visible sources) ─── */

  const activeLegend = useMemo(() => {
    const items: Array<{ label: string; color: string }> = [];
    if (erpSources.events) items.push({ label: "Afspraken", color: TYPE_COLORS.event });
    if (erpSources.tasks) items.push({ label: "Taken", color: TYPE_COLORS.task });
    if (erpSources.leaves) items.push({ label: "Verlof", color: TYPE_COLORS.leave });
    if (erpSources.timesheets) items.push({ label: "Timesheets", color: TYPE_COLORS.timesheet });
    for (const cal of calendars) {
      if (cal.enabled) items.push({ label: cal.name, color: cal.color });
    }
    return items;
  }, [erpSources, calendars]);

  /* ─── Click-to-create handler ─── */

  function handleSlotClick(date: string, hour?: number) {
    const startTime = hour !== undefined ? `${String(hour).padStart(2, "0")}:00` : "09:00";
    const endHour = hour !== undefined ? hour + 1 : 10;
    const endTime = `${String(endHour).padStart(2, "0")}:00`;
    setCreateModal({
      type: "event",
      date,
      startTime,
      endTime,
      allDay: hour === undefined,
    });
  }

  /* ─── Navigation ─── */

  function navigate(dir: number) {
    const d = new Date(currentDate);
    if (viewType === "month") d.setMonth(d.getMonth() + dir);
    else if (viewType === "week") d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  }

  function goToday() { setCurrentDate(new Date()); }

  /* ─── Month view ─── */

  function renderMonthView() {
    const days = getMonthDays(currentDate.getFullYear(), currentDate.getMonth());

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAY_NAMES.map((name) => (
            <div key={name} className="px-2 py-2 text-xs font-semibold text-slate-500 text-center">{name}</div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
          {days.map((day) => {
            const key = formatDateKey(day);
            const isToday = isSameDay(day, today);
            const isCurrentMonth = day.getMonth() === currentDate.getMonth();
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const dayEvents = eventsByDate.get(key) || [];

            return (
              <div key={key} onClick={() => setSelectedDate(day)}
                onDoubleClick={() => handleSlotClick(key)}
                className={`border-b border-r border-slate-100 p-1 min-h-[80px] cursor-pointer transition-colors ${
                  isSelected ? "bg-blue-50" : "hover:bg-slate-50"
                } ${!isCurrentMonth ? "bg-slate-50/50" : ""}`}>
                <div className="flex items-center justify-between px-1">
                  <span className={`text-xs font-medium ${
                    isToday ? "bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center" :
                    isCurrentMonth ? "text-slate-700" : "text-slate-400"
                  }`}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <div key={e.id} className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] truncate"
                      style={{ backgroundColor: e.color + "20", color: e.color }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                      <span className="truncate font-medium">{e.title}</span>
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] text-slate-400 px-1">+{dayEvents.length - 3} meer</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ─── Week view ─── */

  function renderWeekView() {
    const days = getWeekDays(currentDate);
    const hours = Array.from({ length: 14 }, (_, i) => i + 7);

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <div />
          {days.map((day, idx) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={formatDateKey(day)} className="px-2 py-2 text-center border-l border-slate-200">
                <div className="text-[10px] text-slate-500 uppercase">{WEEKDAY_NAMES[idx]}</div>
                <div className={`text-lg font-semibold mt-0.5 ${isToday ? "text-blue-600" : "text-slate-700"}`}>{day.getDate()}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-slate-200 bg-white flex-shrink-0 min-h-[28px]">
          <div className="text-[10px] text-slate-400 px-2 py-1">Hele dag</div>
          {days.map((day) => {
            const key = formatDateKey(day);
            const allDayEvents = (eventsByDate.get(key) || []).filter(e => e.allDay);
            return (
              <div key={key} className="border-l border-slate-200 px-1 py-0.5 space-y-0.5 cursor-pointer"
                onDoubleClick={() => handleSlotClick(key)}>
                {allDayEvents.slice(0, 2).map((e) => (
                  <div key={e.id} className="text-[10px] px-1 py-0.5 rounded truncate font-medium"
                    style={{ backgroundColor: e.color + "20", color: e.color }}>
                    {e.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="flex-1 overflow-y-auto">
          {hours.map((hour) => (
            <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-slate-100 min-h-[48px]">
              <div className="text-[10px] text-slate-400 px-2 py-1 text-right pr-3">{String(hour).padStart(2, "0")}:00</div>
              {days.map((day) => {
                const key = formatDateKey(day);
                const hourEvents = (eventsByDate.get(key) || []).filter(e => {
                  if (e.allDay) return false;
                  return new Date(e.start).getHours() === hour;
                });
                return (
                  <div key={`${key}-${hour}`}
                    className="border-l border-slate-100 px-1 py-0.5 relative cursor-pointer hover:bg-blue-50/30 transition-colors"
                    onDoubleClick={() => handleSlotClick(key, hour)}>
                    {hourEvents.map((e) => (
                      <div key={e.id} className="text-[10px] px-1.5 py-1 rounded mb-0.5 font-medium"
                        style={{ backgroundColor: e.color + "20", color: e.color, borderLeft: `3px solid ${e.color}` }}>
                        <div className="truncate">{e.title}</div>
                        <div className="text-[9px] opacity-70">{formatTime(e.start)}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ─── Day view ─── */

  function renderDayView() {
    const key = formatDateKey(currentDate);
    const dayEvents = eventsByDate.get(key) || [];
    const allDayEvents = dayEvents.filter(e => e.allDay);
    const timedEvents = dayEvents.filter(e => !e.allDay);
    const hours = Array.from({ length: 14 }, (_, i) => i + 7);

    return (
      <div className="flex-1 flex flex-col min-h-0">
        {allDayEvents.length > 0 && (
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex-shrink-0">
            <div className="text-[10px] text-slate-400 mb-1">Hele dag</div>
            <div className="flex flex-wrap gap-1">
              {allDayEvents.map((e) => (
                <span key={e.id} className="text-xs px-2 py-1 rounded font-medium"
                  style={{ backgroundColor: e.color + "20", color: e.color }}>
                  {e.title}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {hours.map((hour) => {
            const hourEvents = timedEvents.filter(e => new Date(e.start).getHours() === hour);
            return (
              <div key={hour} className="flex border-b border-slate-100 min-h-[56px] cursor-pointer hover:bg-blue-50/30 transition-colors"
                onDoubleClick={() => handleSlotClick(key, hour)}>
                <div className="w-16 text-xs text-slate-400 px-3 py-2 text-right shrink-0">{String(hour).padStart(2, "0")}:00</div>
                <div className="flex-1 px-2 py-1 border-l border-slate-200">
                  {hourEvents.map((e) => (
                    <div key={e.id} className="px-3 py-2 rounded mb-1"
                      style={{ backgroundColor: e.color + "15", borderLeft: `4px solid ${e.color}` }}>
                      <div className="text-sm font-medium" style={{ color: e.color }}>{e.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <span>{formatTime(e.start)}{e.end ? ` - ${formatTime(e.end)}` : ""}</span>
                        {e.location && <span className="ml-3"><MapPin size={10} className="inline mr-0.5" />{e.location}</span>}
                      </div>
                      {e.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{e.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ─── Selected date detail panel ─── */

  function renderDayDetail() {
    if (!selectedDate) return null;
    const key = formatDateKey(selectedDate);
    const dayEvents = eventsByDate.get(key) || [];

    return (
      <div className="w-72 bg-white border-l border-slate-200 flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {selectedDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <p className="text-xs text-slate-400">{dayEvents.length} items</p>
            </div>
            <button onClick={() => handleSlotClick(key)}
              className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer" title="Nieuw item">
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {dayEvents.length === 0 && (
            <div className="text-center py-6">
              <p className="text-xs text-slate-400 mb-2">Geen afspraken</p>
              <button onClick={() => handleSlotClick(key)}
                className="text-xs text-blue-600 hover:underline cursor-pointer">+ Nieuw item aanmaken</button>
            </div>
          )}
          {dayEvents.map((e) => (
            <div key={e.id} className="p-3 rounded-lg border border-slate-100" style={{ borderLeftColor: e.color, borderLeftWidth: 3 }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: e.color + "20", color: e.color }}>
                  {e.type === "ical" ? (calendars.find(c => c.id === e.calendarId)?.name || "Agenda") : TYPE_LABELS[e.type]}
                </span>
                {!e.allDay && <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Clock size={9} />{formatTime(e.start)}</span>}
              </div>
              <p className="text-sm font-medium text-slate-800">{e.title}</p>
              {e.location && <p className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin size={10} />{e.location}</p>}
              {e.owner && <p className="text-xs text-slate-500 flex items-center gap-1 mt-1"><Users size={10} />{e.owner}</p>}
              {e.description?.includes("meet.jit.si") && (
                <a href={e.description.match(/https:\/\/meet\.jit\.si\/\S+/)?.[0] || "#"}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 mt-2 text-xs text-blue-600 hover:underline">
                  <Video size={11} /> Jitsi Meeting openen
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ─── Header title ─── */

  const headerTitle = viewType === "month"
    ? `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : viewType === "week"
    ? (() => {
        const days = getWeekDays(currentDate);
        const start = days[0]; const end = days[6];
        return `${start.getDate()} ${MONTH_NAMES[start.getMonth()].slice(0, 3)} - ${end.getDate()} ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
      })()
    : currentDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  /* ─── Check if anything is visible ─── */
  const hasAnySources = Object.values(erpSources).some(Boolean) || calendars.some(c => c.enabled);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Calendar className="text-blue-600" size={20} />
          <h1 className="text-lg font-bold text-slate-800">{headerTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* New item button */}
          <button onClick={() => setCreateModal({ type: "event", date: formatDateKey(currentDate) })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 cursor-pointer">
            <Plus size={14} /> Nieuw
          </button>

          <div className="w-px h-6 bg-slate-200" />

          {/* View type buttons */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            {(["month", "week", "day"] as ViewType[]).map((v) => (
              <button key={v} onClick={() => setViewType(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  viewType === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}>
                {v === "month" ? "Maand" : v === "week" ? "Week" : "Dag"}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-200" />

          <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-slate-100 rounded cursor-pointer"><ChevronLeft size={16} className="text-slate-600" /></button>
          <button onClick={goToday} className="px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded cursor-pointer">Vandaag</button>
          <button onClick={() => navigate(1)} className="p-1.5 hover:bg-slate-100 rounded cursor-pointer"><ChevronRight size={16} className="text-slate-600" /></button>

          <div className="w-px h-6 bg-slate-200" />

          <button onClick={loadEvents} disabled={loading} className="p-1.5 hover:bg-slate-100 rounded cursor-pointer disabled:opacity-50">
            <RefreshCw size={14} className={`text-slate-500 ${loading ? "animate-spin" : ""}`} />
          </button>

          {/* Settings toggle */}
          <button onClick={() => setShowSettings(s => !s)}
            className={`p-1.5 rounded cursor-pointer transition-colors ${showSettings ? "bg-slate-200 text-slate-700" : "hover:bg-slate-100 text-slate-500"}`}
            title="Bronnen & agenda's">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
        {activeLegend.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-[10px] text-slate-500">{item.label}</span>
          </div>
        ))}
        {activeLegend.length === 0 && (
          <span className="text-[10px] text-slate-400 italic">Geen bronnen actief -- open instellingen om bronnen te activeren</span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-slate-400">Dubbelklik op een tijdslot om een item aan te maken</span>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Calendar views */}
        {viewType === "month" && renderMonthView()}
        {viewType === "week" && renderWeekView()}
        {viewType === "day" && renderDayView()}

        {/* Day detail panel (month view) */}
        {viewType === "month" && selectedDate && renderDayDetail()}

        {/* Settings panel */}
        {showSettings && (
          <SettingsPanel
            erpSources={erpSources}
            calendars={calendars}
            onErpToggle={handleErpToggle}
            onCalendarToggle={handleCalendarToggle}
            onCalendarRemove={handleCalendarRemove}
            onAddCalendar={() => setAddCalendarModal(true)}
          />
        )}
      </div>

      {/* Create modal */}
      {createModal && (
        <CreateModal
          initial={createModal}
          onClose={() => setCreateModal(null)}
          onCreated={loadEvents}
        />
      )}

      {/* Add calendar modal */}
      {addCalendarModal && (
        <AddCalendarModal
          onClose={() => setAddCalendarModal(false)}
          onAdd={handleAddCalendar}
        />
      )}
    </div>
  );
}
