/**
 * Messenger — Multi-platform messaging proxy
 * Supports: NextCloud Talk, MS Teams (Graph API), Telegram, WhatsApp (placeholder), Signal (placeholder)
 * Credentials passed per request from client localStorage via query/body params.
 */

import type { Request, Response } from "express";
import { mailAutoConfigInternal } from "./mail.js";

/* ─── Types ─── */

interface Conversation {
  id: string;
  name: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  participants: number;
  type: string; // "one-to-one" | "group" | "public" | "bot"
  avatar?: string;
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

/* ─── NextCloud Talk helpers ─── */

async function ncTalkRequest(
  ncUrl: string,
  user: string,
  pass: string,
  path: string,
  method: string = "GET",
  body?: string
): Promise<{ status: number; data: any }> {
  const url = `${ncUrl}${path}`;
  const headers: Record<string, string> = {
    "OCS-APIRequest": "true",
    Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
    Accept: "application/json",
  };
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const resp = await fetch(url, { method, headers, body });
  const json = await resp.json();
  return { status: resp.status, data: json };
}

function ncConversationTypeLabel(type: number): string {
  switch (type) {
    case 1: return "one-to-one";
    case 2: return "group";
    case 3: return "public";
    case 4: return "changelog";
    default: return "unknown";
  }
}

async function ncListConversations(ncUrl: string, user: string, pass: string): Promise<Conversation[]> {
  const result = await ncTalkRequest(
    ncUrl, user, pass,
    "/ocs/v2.php/apps/spreed/api/v4/room?format=json"
  );
  const rooms = result.data?.ocs?.data || [];
  return rooms.map((r: any) => ({
    id: r.token,
    name: r.displayName || r.name || "Gesprek",
    lastMessage: r.lastMessage?.message || "",
    lastMessageTime: r.lastMessage?.timestamp
      ? new Date(r.lastMessage.timestamp * 1000).toISOString()
      : "",
    unreadCount: r.unreadMessages || 0,
    participants: r.participantCount || 0,
    type: ncConversationTypeLabel(r.type),
    platform: "nextcloud-talk",
  }));
}

async function ncGetMessages(ncUrl: string, user: string, pass: string, token: string): Promise<Message[]> {
  const result = await ncTalkRequest(
    ncUrl, user, pass,
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(token)}?lookIntoFuture=0&limit=100`
  );
  const messages = result.data?.ocs?.data || [];
  return messages
    .map((m: any) => ({
      id: String(m.id),
      text: m.message || "",
      sender: m.actorId || "",
      senderDisplayName: m.actorDisplayName || m.actorId || "",
      timestamp: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : "",
      isOwn: m.actorType === "users" && (m.actorId === user || m.actorId?.toLowerCase() === user.toLowerCase()),
      platform: "nextcloud-talk",
    }))
    .reverse(); // OCS returns newest first; we want oldest first
}

async function ncSendMessage(ncUrl: string, user: string, pass: string, token: string, message: string) {
  return ncTalkRequest(
    ncUrl, user, pass,
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(token)}`,
    "POST",
    `message=${encodeURIComponent(message)}`
  );
}

async function ncMarkRead(ncUrl: string, user: string, pass: string, token: string) {
  return ncTalkRequest(
    ncUrl, user, pass,
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(token)}/read`,
    "POST"
  );
}

/* ─── Telegram helpers ─── */

async function tgRequest(botToken: string, method: string, params?: Record<string, any>): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  if (params && Object.keys(params).length > 0) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return resp.json();
  }
  const resp = await fetch(url);
  return resp.json();
}

async function tgListConversations(botToken: string): Promise<Conversation[]> {
  const result = await tgRequest(botToken, "getUpdates", { limit: 100 });
  if (!result.ok) throw new Error(result.description || "Telegram API error");

  // Extract unique chats from updates
  const chatMap = new Map<number, any>();
  for (const update of result.result || []) {
    const msg = update.message || update.edited_message || update.channel_post;
    if (msg?.chat) {
      chatMap.set(msg.chat.id, {
        chat: msg.chat,
        lastMessage: msg.text || "",
        date: msg.date || 0,
      });
    }
  }

  return Array.from(chatMap.values()).map((entry) => {
    const c = entry.chat;
    const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || String(c.id);
    return {
      id: String(c.id),
      name,
      lastMessage: entry.lastMessage,
      lastMessageTime: entry.date ? new Date(entry.date * 1000).toISOString() : "",
      unreadCount: 0,
      participants: c.type === "private" ? 2 : 0,
      type: c.type || "private",
      platform: "telegram",
    };
  });
}

async function tgGetMessages(botToken: string, chatId: string): Promise<Message[]> {
  // Telegram Bot API doesn't have a "get messages for chat" endpoint.
  // We use getUpdates and filter by chat_id.
  const result = await tgRequest(botToken, "getUpdates", { limit: 100 });
  if (!result.ok) throw new Error(result.description || "Telegram API error");

  const messages: Message[] = [];
  const botInfo = await tgRequest(botToken, "getMe");
  const botId = botInfo.ok ? botInfo.result.id : 0;

  for (const update of result.result || []) {
    const msg = update.message || update.edited_message || update.channel_post;
    if (msg && String(msg.chat.id) === chatId) {
      const senderName = msg.from
        ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")
        : "Onbekend";
      messages.push({
        id: String(msg.message_id),
        text: msg.text || "",
        sender: String(msg.from?.id || 0),
        senderDisplayName: senderName,
        timestamp: msg.date ? new Date(msg.date * 1000).toISOString() : "",
        isOwn: msg.from?.id === botId,
        platform: "telegram",
      });
    }
  }

  return messages;
}

async function tgSendMessage(botToken: string, chatId: string, text: string) {
  return tgRequest(botToken, "sendMessage", { chat_id: chatId, text });
}

/* ─── MS Teams (Microsoft Graph) helpers ─── */

async function getGraphToken(instanceId: string, email: string): Promise<string | null> {
  const config = await mailAutoConfigInternal(instanceId, email);
  if (!config?.refreshToken || !config?.clientId || !config?.clientSecret || !config?.tokenUri) return null;

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
  const data = await tokenResp.json() as { access_token?: string };
  return data.access_token || null;
}

async function graphRequest(token: string, path: string, method = "GET", body?: string): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(15000),
  };
  if (body) opts.body = body;
  const resp = await fetch(`https://graph.microsoft.com/v1.0${path}`, opts);
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Graph API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  return resp.json();
}

async function teamsListConversations(instanceId: string, email: string): Promise<Conversation[]> {
  const token = await getGraphToken(instanceId, email);
  if (!token) throw new Error("Geen OAuth2 token beschikbaar voor MS Teams");

  // Get chats (1:1 and group chats)
  const data = await graphRequest(token, "/me/chats?$expand=members&$top=50&$orderby=lastMessagePreview/createdDateTime desc");
  const chats = data.value || [];

  return chats.map((c: any) => {
    const members = c.members || [];
    // For 1:1 chats, use the other person's name
    let name = c.topic || "";
    if (!name && c.chatType === "oneOnOne") {
      const other = members.find((m: any) => m.email?.toLowerCase() !== email.toLowerCase());
      name = other?.displayName || "Chat";
    }
    if (!name) name = members.map((m: any) => m.displayName).filter(Boolean).join(", ") || "Chat";

    return {
      id: c.id,
      name,
      lastMessage: c.lastMessagePreview?.body?.content?.replace(/<[^>]*>/g, "").slice(0, 100) || "",
      lastMessageTime: c.lastMessagePreview?.createdDateTime || "",
      unreadCount: 0,
      participants: members.length,
      type: c.chatType === "oneOnOne" ? "one-to-one" : "group",
      platform: "ms-teams",
    };
  });
}

async function teamsGetMessages(instanceId: string, email: string, chatId: string): Promise<Message[]> {
  const token = await getGraphToken(instanceId, email);
  if (!token) throw new Error("Geen OAuth2 token beschikbaar voor MS Teams");

  const data = await graphRequest(token, `/me/chats/${encodeURIComponent(chatId)}/messages?$top=50&$orderby=createdDateTime desc`);
  const msgs = (data.value || []).reverse(); // oldest first

  return msgs
    .filter((m: any) => m.messageType === "message")
    .map((m: any) => ({
      id: m.id,
      text: m.body?.content?.replace(/<[^>]*>/g, "") || "",
      sender: m.from?.user?.id || "",
      senderDisplayName: m.from?.user?.displayName || "Onbekend",
      timestamp: m.createdDateTime || "",
      isOwn: m.from?.user?.email?.toLowerCase() === email.toLowerCase()
        || m.from?.user?.displayName?.toLowerCase().includes(email.split("@")[0].toLowerCase()),
      platform: "ms-teams",
    }));
}

async function teamsSendMessage(instanceId: string, email: string, chatId: string, message: string) {
  const token = await getGraphToken(instanceId, email);
  if (!token) throw new Error("Geen OAuth2 token beschikbaar voor MS Teams");

  return graphRequest(
    token,
    `/me/chats/${encodeURIComponent(chatId)}/messages`,
    "POST",
    JSON.stringify({ body: { content: message } })
  );
}

/* ─── Placeholder platforms ─── */

function whatsappPlaceholder() {
  return {
    platform: "whatsapp",
    status: "not_configured",
    message: "WhatsApp Business API vereist een apart account en goedkeuring van Meta. " +
      "Configureer de volgende gegevens om WhatsApp te activeren:",
    setup: [
      "1. Maak een Meta Business Account aan op business.facebook.com",
      "2. Registreer een WhatsApp Business API nummer",
      "3. Verkrijg een permanent access token via de Meta Developer Console",
      "4. Configureer een webhook URL voor inkomende berichten",
      "5. Voer het telefoonnummer-ID en token hieronder in",
    ],
    fields: ["phone_number_id", "access_token", "webhook_verify_token"],
  };
}

function signalPlaceholder() {
  return {
    platform: "signal",
    status: "not_configured",
    message: "Signal vereist signal-cli of signal-cli-rest-api als backend. " +
      "Volg deze stappen om Signal te activeren:",
    setup: [
      "1. Installeer signal-cli: https://github.com/AsamK/signal-cli",
      "2. Of gebruik signal-cli-rest-api via Docker:",
      "   docker run -p 8080:8080 bbernhard/signal-cli-rest-api",
      "3. Registreer je telefoonnummer met signal-cli",
      "4. Configureer de API URL hieronder",
    ],
    fields: ["signal_api_url", "phone_number"],
  };
}

/* ─── Express Handlers ─── */

export async function messengerListConversations(req: Request, res: Response) {
  const platform = req.query.platform as string;

  try {
    switch (platform) {
      case "nextcloud-talk": {
        const ncUrl = (req.query.url as string || "").replace(/\/+$/, "");
        const user = req.query.user as string;
        const pass = req.query.pass as string;
        if (!ncUrl || !user || !pass) {
          return res.status(400).json({ error: "Missende parameters: url, user, pass" });
        }
        const conversations = await ncListConversations(ncUrl, user, pass);
        return res.json({ data: conversations });
      }
      case "telegram": {
        const botToken = req.query.token as string;
        if (!botToken) {
          return res.status(400).json({ error: "Missende parameter: token" });
        }
        const conversations = await tgListConversations(botToken);
        return res.json({ data: conversations });
      }
      case "ms-teams": {
        const instanceId = req.query.instance as string;
        const email = req.query.email as string;
        if (!instanceId || !email) {
          return res.status(400).json({ error: "Missende parameters: instance, email" });
        }
        const conversations = await teamsListConversations(instanceId, email);
        return res.json({ data: conversations });
      }
      case "whatsapp":
        return res.json({ data: [], config: whatsappPlaceholder() });
      case "signal":
        return res.json({ data: [], config: signalPlaceholder() });
      default:
        return res.status(400).json({ error: `Onbekend platform: ${platform}` });
    }
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}

export async function messengerGetMessages(req: Request, res: Response) {
  const platform = req.query.platform as string;
  const conversationId = req.query.conversation as string;

  if (!conversationId) {
    return res.status(400).json({ error: "Missende parameter: conversation" });
  }

  try {
    switch (platform) {
      case "nextcloud-talk": {
        const ncUrl = (req.query.url as string || "").replace(/\/+$/, "");
        const user = req.query.user as string;
        const pass = req.query.pass as string;
        if (!ncUrl || !user || !pass) {
          return res.status(400).json({ error: "Missende parameters: url, user, pass" });
        }
        const messages = await ncGetMessages(ncUrl, user, pass, conversationId);
        return res.json({ data: messages });
      }
      case "telegram": {
        const botToken = req.query.token as string;
        if (!botToken) {
          return res.status(400).json({ error: "Missende parameter: token" });
        }
        const messages = await tgGetMessages(botToken, conversationId);
        return res.json({ data: messages });
      }
      case "ms-teams": {
        const instanceId = req.query.instance as string;
        const email = req.query.email as string;
        if (!instanceId || !email) {
          return res.status(400).json({ error: "Missende parameters: instance, email" });
        }
        const messages = await teamsGetMessages(instanceId, email, conversationId);
        return res.json({ data: messages });
      }
      case "whatsapp":
        return res.json({ data: [], config: whatsappPlaceholder() });
      case "signal":
        return res.json({ data: [], config: signalPlaceholder() });
      default:
        return res.status(400).json({ error: `Onbekend platform: ${platform}` });
    }
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}

export async function messengerSendMessage(req: Request, res: Response) {
  const platform = req.body.platform || req.query.platform;
  const conversationId = req.body.conversation || req.query.conversation;
  const message = req.body.message;

  if (!conversationId || !message) {
    return res.status(400).json({ error: "Missende parameters: conversation, message" });
  }

  try {
    switch (platform) {
      case "nextcloud-talk": {
        const ncUrl = (req.body.url || req.query.url || "").replace(/\/+$/, "");
        const user = req.body.user || req.query.user;
        const pass = req.body.pass || req.query.pass;
        if (!ncUrl || !user || !pass) {
          return res.status(400).json({ error: "Missende parameters: url, user, pass" });
        }
        await ncSendMessage(ncUrl, user, pass, conversationId, message);
        return res.json({ ok: true });
      }
      case "telegram": {
        const botToken = req.body.token || req.query.token;
        if (!botToken) {
          return res.status(400).json({ error: "Missende parameter: token" });
        }
        const result = await tgSendMessage(botToken, conversationId, message);
        return res.json({ ok: true, data: result });
      }
      case "ms-teams": {
        const instanceId = req.body.instance || req.query.instance;
        const email = req.body.email || req.query.email;
        if (!instanceId || !email) {
          return res.status(400).json({ error: "Missende parameters: instance, email" });
        }
        await teamsSendMessage(instanceId, email, conversationId, message);
        return res.json({ ok: true });
      }
      case "whatsapp":
        return res.json({ ok: false, config: whatsappPlaceholder() });
      case "signal":
        return res.json({ ok: false, config: signalPlaceholder() });
      default:
        return res.status(400).json({ error: `Onbekend platform: ${platform}` });
    }
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}

/** Load conversations from ALL configured platforms in parallel */
export async function messengerAllConversations(req: Request, res: Response) {
  const ncUrl = (req.query.nc_url as string || "").replace(/\/+$/, "");
  const ncUser = req.query.nc_user as string;
  const ncPass = req.query.nc_pass as string;
  const tgToken = req.query.tg_token as string;
  const instanceId = req.query.instance as string;
  const email = req.query.email as string;

  const results: Conversation[] = [];
  const errors: string[] = [];

  const tasks: Promise<void>[] = [];

  if (ncUrl && ncUser && ncPass) {
    tasks.push(
      ncListConversations(ncUrl, ncUser, ncPass)
        .then(convos => results.push(...convos))
        .catch(err => errors.push(`NextCloud: ${err.message}`))
    );
  }

  if (tgToken) {
    tasks.push(
      tgListConversations(tgToken)
        .then(convos => results.push(...convos))
        .catch(err => errors.push(`Telegram: ${err.message}`))
    );
  }

  if (instanceId && email) {
    tasks.push(
      teamsListConversations(instanceId, email)
        .then(convos => results.push(...convos))
        .catch(err => errors.push(`MS Teams: ${err.message}`))
    );
  }

  await Promise.all(tasks);

  // Sort all conversations by last message time (newest first)
  results.sort((a, b) => {
    const ta = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
    const tb = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
    return tb - ta;
  });

  res.json({ data: results, errors: errors.length ? errors : undefined });
}

export async function messengerMarkRead(req: Request, res: Response) {
  const platform = req.body.platform || req.query.platform;
  const conversationId = req.body.conversation || req.query.conversation;

  if (!conversationId) {
    return res.status(400).json({ error: "Missende parameter: conversation" });
  }

  try {
    switch (platform) {
      case "nextcloud-talk": {
        const ncUrl = (req.body.url || req.query.url || "").replace(/\/+$/, "");
        const user = req.body.user || req.query.user;
        const pass = req.body.pass || req.query.pass;
        if (!ncUrl || !user || !pass) {
          return res.status(400).json({ error: "Missende parameters: url, user, pass" });
        }
        await ncMarkRead(ncUrl, user, pass, conversationId);
        return res.json({ ok: true });
      }
      case "telegram":
        // Telegram Bot API doesn't have a "mark as read" concept
        return res.json({ ok: true, note: "Telegram bots markeren niet als gelezen" });
      case "ms-teams":
        // Graph API doesn't have a simple mark-read for chats
        return res.json({ ok: true });
      case "whatsapp":
        return res.json({ ok: false, config: whatsappPlaceholder() });
      case "signal":
        return res.json({ ok: false, config: signalPlaceholder() });
      default:
        return res.status(400).json({ error: `Onbekend platform: ${platform}` });
    }
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}
