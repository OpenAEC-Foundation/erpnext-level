/**
 * Messenger — Multi-platform messaging proxy
 * Supports: NextCloud Talk, Telegram, WhatsApp (placeholder), Signal (placeholder)
 * Credentials passed per request from client localStorage via query/body params.
 */

import type { Request, Response } from "express";

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
      isOwn: m.actorId === user,
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
