/**
 * Intent-matching engine for the Open AEC Assistent.
 * Maps natural language to ERPNext API actions.
 */

import { createDocument, updateDocument, fetchList, callMethod } from "./erpnext";

/* ─── Types ─── */

export type SlotType = "number" | "text" | "project" | "employee" | "task" | "date" | "activity_type" | "priority" | "company";

export interface SlotDef {
  name: string;
  type: SlotType;
  required: boolean;
  label: string;        // shown in UI: "Project", "Uren", etc.
  defaultFn?: () => string; // e.g. () => localStorage.getItem("erpnext_default_employee")
}

export interface Intent {
  id: string;
  category: string;
  name: string;           // display name: "Uren boeken"
  description: string;    // shown in autocomplete
  patterns: string[];     // fuzzy match patterns
  slots: SlotDef[];
  execute: (slots: Record<string, string>, context: IntentContext) => Promise<string>;
}

export interface IntentContext {
  employees: { name: string; employee_name: string; user_id: string; company: string }[];
  projects: { name: string; project_name: string; status: string; company: string }[];
  companies: { name: string; company_name: string }[];
}

export interface MatchResult {
  intent: Intent;
  score: number;
  extractedSlots: Record<string, string>;
}

/* ─── Helpers ─── */

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function defaultEmployee(): string {
  return localStorage.getItem("erpnext_default_employee") || "";
}

function defaultCompany(): string {
  return localStorage.getItem("erpnext_default_company") || "";
}

/* ─── Intent Definitions ─── */

export const INTENTS: Intent[] = [

  // ━━━ UREN / TIMESHEET ━━━
  {
    id: "book_hours",
    category: "Uren",
    name: "Uren boeken",
    description: "Boek uren op een project of taak",
    patterns: [
      "boek uren", "uren boeken", "uren registreren", "tijd boeken", "timesheet",
      "boek {hours} uur", "schrijf uren", "registreer {hours} uur",
      "boek {hours} uur op {project}", "uren schrijven op {project}",
      "ik heb {hours} uur gewerkt", "{hours} uur gewerkt aan {project}",
      "log {hours} hours", "book time", "urenregistratie",
      "vandaag {hours} uur", "boek tijd", "uren invoeren",
      "schrijf {hours} uur op {project}", "boek mijn uren",
    ],
    slots: [
      { name: "employee", type: "employee", required: true, label: "Medewerker", defaultFn: defaultEmployee },
      { name: "hours", type: "number", required: true, label: "Uren" },
      { name: "project", type: "project", required: false, label: "Project" },
      { name: "task", type: "task", required: false, label: "Taak" },
      { name: "activity_type", type: "activity_type", required: true, label: "Type activiteit", defaultFn: () => "Execution" },
      { name: "date", type: "date", required: true, label: "Datum", defaultFn: today },
      { name: "description", type: "text", required: false, label: "Omschrijving" },
    ],
    execute: async (slots) => {
      const h = parseFloat(slots.hours);
      if (isNaN(h) || h <= 0) return "Ongeldig aantal uren.";
      const fromTime = "08:00";
      const toH = 8 + h;
      const toTime = `${String(Math.floor(toH)).padStart(2, "0")}:${String(Math.round((toH % 1) * 60)).padStart(2, "0")}`;
      await createDocument("Timesheet", {
        employee: slots.employee,
        company: slots.company || defaultCompany() || undefined,
        time_logs: [{
          activity_type: slots.activity_type || "Execution",
          from_time: `${slots.date} ${fromTime}:00`,
          to_time: `${slots.date} ${toTime}:00`,
          hours: h,
          project: slots.project || undefined,
          task: slots.task || undefined,
          description: slots.description || undefined,
        }],
      });
      return `✓ ${h} uur geboekt${slots.project ? ` op ${slots.project}` : ""} voor ${slots.date}`;
    },
  },

  // ━━━ PROJECT ━━━
  {
    id: "create_project",
    category: "Projecten",
    name: "Project aanmaken",
    description: "Maak een nieuw project aan",
    patterns: [
      "maak project aan", "nieuw project", "project aanmaken", "project maken",
      "maak project {name} aan", "create project", "start project",
      "maak een project aan voor {customer}", "nieuw project voor {customer}",
      "project opzetten", "project starten", "open project",
    ],
    slots: [
      { name: "project_name", type: "text", required: true, label: "Projectnaam" },
      { name: "company", type: "company", required: true, label: "Bedrijf", defaultFn: defaultCompany },
      { name: "expected_start_date", type: "date", required: false, label: "Startdatum", defaultFn: today },
    ],
    execute: async (slots) => {
      const doc = await createDocument<{ name: string }>("Project", {
        project_name: slots.project_name,
        company: slots.company || defaultCompany() || undefined,
        expected_start_date: slots.expected_start_date || today(),
        status: "Open",
      });
      return `✓ Project aangemaakt: ${doc.name} — ${slots.project_name}`;
    },
  },
  {
    id: "find_project",
    category: "Projecten",
    name: "Project zoeken",
    description: "Zoek een project op naam of nummer",
    patterns: [
      "zoek project", "vind project", "project zoeken", "welk project",
      "zoek project {query}", "project {query}", "toon project {query}",
      "find project", "search project", "waar is project",
    ],
    slots: [
      { name: "query", type: "text", required: true, label: "Zoekterm" },
    ],
    execute: async (slots, ctx) => {
      const q = slots.query.toLowerCase();
      const matches = ctx.projects.filter(
        (p) => p.name.toLowerCase().includes(q) || p.project_name?.toLowerCase().includes(q)
      ).slice(0, 5);
      if (matches.length === 0) return `Geen projecten gevonden voor "${slots.query}".`;
      return `Gevonden:\n${matches.map((p) => `• ${p.name} — ${p.project_name} (${p.status})`).join("\n")}`;
    },
  },

  // ━━━ TAAK ━━━
  {
    id: "create_task",
    category: "Taken",
    name: "Taak aanmaken",
    description: "Maak een nieuwe taak aan",
    patterns: [
      "maak taak aan", "nieuwe taak", "taak aanmaken", "taak maken",
      "maak taak {subject} aan", "create task", "add task",
      "maak een taak aan voor {project}", "taak toevoegen",
      "voeg taak toe", "nieuwe taak voor {project}",
    ],
    slots: [
      { name: "subject", type: "text", required: true, label: "Taaknaam" },
      { name: "project", type: "project", required: false, label: "Project" },
      { name: "priority", type: "priority", required: false, label: "Prioriteit", defaultFn: () => "Medium" },
      { name: "exp_end_date", type: "date", required: false, label: "Deadline" },
    ],
    execute: async (slots) => {
      const doc = await createDocument<{ name: string }>("Task", {
        subject: slots.subject,
        project: slots.project || undefined,
        priority: slots.priority || "Medium",
        exp_end_date: slots.exp_end_date || undefined,
        company: defaultCompany() || undefined,
      });
      return `✓ Taak aangemaakt: ${doc.name} — ${slots.subject}`;
    },
  },
  {
    id: "my_tasks",
    category: "Taken",
    name: "Mijn taken",
    description: "Toon mijn openstaande taken",
    patterns: [
      "mijn taken", "mijn openstaande taken", "wat moet ik doen",
      "taken", "takenlijst", "my tasks", "show tasks", "open taken",
      "welke taken heb ik", "to do", "what should i do",
    ],
    slots: [],
    execute: async (_slots, ctx) => {
      const emp = ctx.employees.find((e) => e.name === defaultEmployee());
      if (!emp?.user_id) return "Stel je medewerker-ID in via Instellingen.";
      const tasks = await fetchList<{ name: string; subject: string; status: string; priority: string; project: string }>("Task", {
        fields: ["name", "subject", "status", "priority", "project"],
        filters: [
          ["_assign", "like", `%${emp.user_id}%`],
          ["status", "not in", ["Cancelled", "Template", "Completed"]],
        ],
        limit_page_length: 10,
        order_by: "modified desc",
      });
      if (tasks.length === 0) return "Geen openstaande taken gevonden.";
      return `Mijn taken (${tasks.length}):\n${tasks.map((t) => `• [${t.priority}] ${t.subject} (${t.status})${t.project ? ` — ${t.project}` : ""}`).join("\n")}`;
    },
  },

  // ━━━ TODO ━━━
  {
    id: "create_todo",
    category: "ToDo",
    name: "ToDo aanmaken",
    description: "Maak een nieuwe todo/herinnering aan",
    patterns: [
      "maak todo aan", "nieuwe todo", "todo aanmaken", "herinnering",
      "onthoud {description}", "reminder", "herinner mij aan {description}",
      "todo: {description}", "notitie: {description}", "voeg toe: {description}",
      "maak notitie", "add todo", "remember {description}",
    ],
    slots: [
      { name: "description", type: "text", required: true, label: "Beschrijving" },
      { name: "date", type: "date", required: false, label: "Datum" },
      { name: "priority", type: "priority", required: false, label: "Prioriteit", defaultFn: () => "Medium" },
    ],
    execute: async (slots, ctx) => {
      const emp = ctx.employees.find((e) => e.name === defaultEmployee());
      await createDocument("ToDo", {
        description: slots.description,
        status: "Open",
        priority: slots.priority || "Medium",
        date: slots.date || null,
        allocated_to: emp?.user_id || undefined,
      });
      return `✓ ToDo aangemaakt: ${slots.description}`;
    },
  },

  // ━━━ FACTUREN ━━━
  {
    id: "find_invoice",
    category: "Facturen",
    name: "Factuur zoeken",
    description: "Zoek een verkoopfactuur",
    patterns: [
      "zoek factuur", "vind factuur", "factuur zoeken", "factuur van {query}",
      "invoice", "zoek factuur {query}", "openstaande facturen",
      "onbetaalde facturen", "find invoice", "search invoice",
    ],
    slots: [
      { name: "query", type: "text", required: false, label: "Zoekterm (klant/nummer)" },
    ],
    execute: async (slots) => {
      const filters: unknown[][] = [["docstatus", "=", 1]];
      if (slots.query) {
        filters.push(["customer_name", "like", `%${slots.query}%`]);
      } else {
        filters.push(["outstanding_amount", ">", 0]);
      }
      const invoices = await fetchList<{ name: string; customer_name: string; net_total: number; outstanding_amount: number; status: string }>("Sales Invoice", {
        fields: ["name", "customer_name", "net_total", "outstanding_amount", "status"],
        filters,
        limit_page_length: 10,
        order_by: "posting_date desc",
      });
      if (invoices.length === 0) return `Geen facturen gevonden${slots.query ? ` voor "${slots.query}"` : ""}.`;
      return invoices.map((i) =>
        `• ${i.name} — ${i.customer_name}: €${i.net_total?.toLocaleString("nl-NL")} (openstaand: €${i.outstanding_amount?.toLocaleString("nl-NL")}) [${i.status}]`
      ).join("\n");
    },
  },

  // ━━━ MEDEWERKERS ━━━
  {
    id: "find_employee",
    category: "Medewerkers",
    name: "Medewerker zoeken",
    description: "Zoek een medewerker",
    patterns: [
      "zoek medewerker", "wie is {query}", "medewerker zoeken",
      "vind medewerker {query}", "collega {query}", "find employee",
      "medewerkers", "wie werkt hier", "teamleden", "personeel",
    ],
    slots: [
      { name: "query", type: "text", required: false, label: "Naam" },
    ],
    execute: async (slots, ctx) => {
      let emps = ctx.employees.filter((e) => (e as unknown as { status: string }).status === "Active");
      if (slots.query) {
        const q = slots.query.toLowerCase();
        emps = emps.filter((e) => e.employee_name.toLowerCase().includes(q));
      }
      if (emps.length === 0) return `Geen medewerker gevonden${slots.query ? ` voor "${slots.query}"` : ""}.`;
      return emps.slice(0, 10).map((e) =>
        `• ${e.employee_name} (${e.name})`
      ).join("\n");
    },
  },

  // ━━━ VERLOF ━━━
  {
    id: "request_leave",
    category: "Verlof",
    name: "Verlof aanvragen",
    description: "Vraag verlof of vakantie aan",
    patterns: [
      "verlof aanvragen", "vakantie aanvragen", "vrij nemen", "dag vrij",
      "ik wil vrij op {date}", "verlofaanvraag", "leave request",
      "ik wil vakantie", "vrije dag", "ziek melden",
      "request leave", "request time off",
    ],
    slots: [
      { name: "employee", type: "employee", required: true, label: "Medewerker", defaultFn: defaultEmployee },
      { name: "from_date", type: "date", required: true, label: "Van datum" },
      { name: "to_date", type: "date", required: true, label: "Tot datum" },
      { name: "leave_type", type: "text", required: true, label: "Type verlof", defaultFn: () => "Leave Without Pay" },
    ],
    execute: async (slots) => {
      const doc = await createDocument<{ name: string }>("Leave Application", {
        employee: slots.employee,
        leave_type: slots.leave_type || "Leave Without Pay",
        from_date: slots.from_date,
        to_date: slots.to_date,
        status: "Open",
        company: defaultCompany() || undefined,
      });
      return `✓ Verlofaanvraag ingediend: ${doc.name} (${slots.from_date} t/m ${slots.to_date})`;
    },
  },

  // ━━━ ONKOSTEN ━━━
  {
    id: "create_expense",
    category: "Onkosten",
    name: "Onkostendeclaratie",
    description: "Dien een onkostendeclaratie in",
    patterns: [
      "onkosten declareren", "declaratie", "expense claim", "onkosten",
      "ik heb {amount} uitgegeven", "declareer {amount}", "kosten declareren",
      "onkostennota", "expense", "bonnetje indienen",
    ],
    slots: [
      { name: "employee", type: "employee", required: true, label: "Medewerker", defaultFn: defaultEmployee },
      { name: "amount", type: "number", required: true, label: "Bedrag (€)" },
      { name: "description", type: "text", required: true, label: "Omschrijving" },
      { name: "date", type: "date", required: true, label: "Datum", defaultFn: today },
    ],
    execute: async (slots) => {
      const doc = await createDocument<{ name: string }>("Expense Claim", {
        employee: slots.employee,
        company: defaultCompany() || undefined,
        posting_date: slots.date,
        expenses: [{
          expense_date: slots.date,
          expense_type: "Miscellaneous Expenses",
          amount: parseFloat(slots.amount),
          description: slots.description,
        }],
      });
      return `✓ Onkostendeclaratie ingediend: ${doc.name} — €${slots.amount}`;
    },
  },

  // ━━━ STATUS / INFO ━━━
  {
    id: "project_status",
    category: "Projecten",
    name: "Projectstatus",
    description: "Bekijk de status van een project",
    patterns: [
      "status van {project}", "hoe staat {project} ervoor",
      "projectstatus", "project voortgang", "project status",
      "hoever is {project}", "wat is de status van {project}",
    ],
    slots: [
      { name: "project", type: "project", required: true, label: "Project" },
    ],
    execute: async (slots, ctx) => {
      const p = ctx.projects.find((pr) => pr.name === slots.project || pr.project_name?.toLowerCase() === slots.project.toLowerCase());
      if (!p) return `Project "${slots.project}" niet gevonden.`;
      const tasks = await fetchList<{ status: string }>("Task", {
        fields: ["status"],
        filters: [["project", "=", p.name]],
        limit_page_length: 0,
      });
      const total = tasks.length;
      const done = tasks.filter((t) => t.status === "Completed").length;
      const open = tasks.filter((t) => !["Completed", "Cancelled", "Template"].includes(t.status)).length;
      return `Project: ${p.name} — ${p.project_name}\nStatus: ${p.status}\nVoortgang: ${(p as unknown as { percent_complete: number }).percent_complete || 0}%\nTaken: ${total} totaal, ${done} afgerond, ${open} open`;
    },
  },

  // ━━━ HELP ━━━
  {
    id: "help",
    category: "Help",
    name: "Help",
    description: "Toon wat ik allemaal kan",
    patterns: [
      "help", "wat kan je", "hulp", "welke commando's", "opties",
      "what can you do", "commands", "mogelijkheden", "features",
    ],
    slots: [],
    execute: async () => {
      const categories = new Map<string, string[]>();
      for (const intent of INTENTS) {
        if (intent.id === "help") continue;
        if (!categories.has(intent.category)) categories.set(intent.category, []);
        categories.get(intent.category)!.push(`• ${intent.name} — ${intent.description}`);
      }
      let result = "Dit kan ik voor je doen:\n\n";
      for (const [cat, items] of categories) {
        result += `**${cat}**\n${items.join("\n")}\n\n`;
      }
      result += "Typ gewoon wat je wilt doen, ik snap het wel!";
      return result;
    },
  },
];

/* ─── Matching Engine ─── */

/** Normalize text for matching */
function normalize(text: string): string {
  return text.toLowerCase().trim()
    .replace(/[?!.,;:'"]/g, "")
    .replace(/\s+/g, " ");
}

/** Calculate similarity between two strings (0-1) */
function similarity(a: string, b: string): number {
  const wordsA = normalize(a).split(" ");
  const wordsB = normalize(b).split(" ");

  // Count matching words
  let matches = 0;
  for (const wa of wordsA) {
    for (const wb of wordsB) {
      if (wb.startsWith("{")) continue; // skip slot placeholders
      if (wa === wb) { matches++; break; }
      // Partial match for longer words
      if (wa.length > 3 && wb.length > 3) {
        if (wa.includes(wb) || wb.includes(wa)) { matches += 0.7; break; }
      }
    }
  }

  const maxLen = Math.max(wordsA.length, wordsB.filter((w) => !w.startsWith("{")).length);
  return maxLen > 0 ? matches / maxLen : 0;
}

/** Extract slot values from input based on pattern */
function extractSlots(input: string, pattern: string): Record<string, string> {
  const slots: Record<string, string> = {};
  const normInput = normalize(input);

  // Extract numbers
  const numberMatch = normInput.match(/(\d+(?:[.,]\d+)?)\s*(?:uur|uren|hours?|u\b)/);
  if (numberMatch) slots.hours = numberMatch[1].replace(",", ".");

  const amountMatch = normInput.match(/€?\s*(\d+(?:[.,]\d+)?)\s*(?:euro)?/);
  if (amountMatch && !slots.hours) slots.amount = amountMatch[1].replace(",", ".");

  // Extract dates (dd-mm-yyyy, yyyy-mm-dd, or relative)
  const dateMatch = normInput.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) slots.date = dateMatch[1];

  const nlDateMatch = normInput.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (nlDateMatch) slots.date = `${nlDateMatch[3]}-${nlDateMatch[2].padStart(2, "0")}-${nlDateMatch[1].padStart(2, "0")}`;

  if (normInput.includes("vandaag")) slots.date = today();
  if (normInput.includes("morgen")) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    slots.date = d.toISOString().split("T")[0];
  }

  // Try to extract slot values from pattern positions
  // e.g. "boek {hours} uur op {project}" + "boek 4 uur op PROJ-001"
  const patternParts = pattern.replace(/[?!.,;:'"]/g, "").split(" ");
  const inputParts = normInput.split(" ");

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith("{") && pp.endsWith("}")) {
      const slotName = pp.slice(1, -1);
      // Find the corresponding position in input
      // Look for the word before this slot in the pattern
      if (i > 0) {
        const anchor = patternParts[i - 1].toLowerCase();
        const anchorIdx = inputParts.findIndex((w) => w.toLowerCase() === anchor);
        if (anchorIdx >= 0 && anchorIdx + 1 < inputParts.length) {
          // Collect remaining words until next pattern word
          const nextPatternWord = i + 1 < patternParts.length && !patternParts[i + 1].startsWith("{")
            ? patternParts[i + 1].toLowerCase()
            : null;

          const valueParts: string[] = [];
          for (let j = anchorIdx + 1; j < inputParts.length; j++) {
            if (nextPatternWord && inputParts[j].toLowerCase() === nextPatternWord) break;
            valueParts.push(inputParts[j]);
          }
          if (valueParts.length > 0 && !slots[slotName]) {
            slots[slotName] = valueParts.join(" ");
          }
        }
      }
    }
  }

  return slots;
}

/** Match user input against all intents, return ranked results */
export function matchIntents(input: string): MatchResult[] {
  if (!input.trim()) return [];

  const results: MatchResult[] = [];

  for (const intent of INTENTS) {
    let bestScore = 0;
    let bestSlots: Record<string, string> = {};

    for (const pattern of intent.patterns) {
      const score = similarity(input, pattern);
      if (score > bestScore) {
        bestScore = score;
        bestSlots = extractSlots(input, pattern);
      }
    }

    // Also match against intent name and description
    const nameScore = similarity(input, intent.name) * 0.8;
    const descScore = similarity(input, intent.description) * 0.6;
    bestScore = Math.max(bestScore, nameScore, descScore);

    if (bestScore > 0.15) {
      results.push({ intent, score: bestScore, extractedSlots: bestSlots });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/** Get autocomplete suggestions for partial input */
export function getAutocompleteSuggestions(input: string): MatchResult[] {
  return matchIntents(input).slice(0, 5);
}

/** Build the GitHub issue URL for an unmatched prompt */
export function buildUnmatchedIssueUrl(prompt: string): string {
  const url = new URL("https://github.com/OpenAEC-Foundation/erpnext-level/issues/new");
  url.searchParams.set("title", `[Intent] Onherkenbaar commando: "${prompt.slice(0, 80)}"`);
  url.searchParams.set("body", `## Onherkend commando\n\n\`\`\`\n${prompt}\n\`\`\`\n\nDit commando werd niet herkend door de Open AEC Assistent.\n\n**Verwachte actie:** _Beschrijf wat je verwachtte dat er zou gebeuren_\n\n---\n*Automatisch aangemaakt vanuit ERPNext Level*`);
  url.searchParams.set("labels", "enhancement,intent-request");
  return url.toString();
}
