/**
 * Terminal WebSocket handler.
 *
 * Spawns a local `claude` CLI process and bridges stdin/stdout/stderr
 * to a WebSocket connection. The frontend renders output via xterm.js.
 *
 * Each WebSocket connection gets its own claude process.
 * Instance context (ERPNext URL, API credentials) is passed as
 * a system prompt so Claude knows which instance to work with.
 */

import { spawn, type ChildProcess } from "child_process";
import type { WebSocket } from "ws";
import { getInstance, getAllInstances } from "./erpnext-client.js";

interface TerminalSession {
  process: ChildProcess;
  instanceId: string;
}

const sessions = new Map<WebSocket, TerminalSession>();

function buildSystemPrompt(instanceId: string): string {
  const inst = getInstance(instanceId);
  if (!inst) {
    const all = getAllInstances();
    return `ERPNext Level Dashboard. Beschikbare instances: ${all.map((i) => `${i.name} (${i.url})`).join(", ")}`;
  }

  return [
    `Je bent verbonden met ERPNext instance "${inst.name}" op ${inst.url}.`,
    `API authenticatie: token ${inst.apiKey}:${inst.apiSecret}`,
    `Gebruik deze credentials voor alle ERPNext API calls.`,
    `Basis API URL: ${inst.url}/api/resource/<DocType> voor CRUD, ${inst.url}/api/method/<method> voor methodes.`,
    `Antwoord altijd in het Nederlands tenzij anders gevraagd.`,
  ].join("\n");
}

export function handleTerminalConnection(ws: WebSocket, instanceId: string): void {
  console.log(`[terminal] New connection for instance: ${instanceId}`);

  const systemPrompt = buildSystemPrompt(instanceId);

  // Spawn claude CLI in interactive mode
  const claudeProcess = spawn("claude", [], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    env: {
      ...process.env,
      // Force color output for better terminal experience
      FORCE_COLOR: "1",
      TERM: "xterm-256color",
    },
  });

  sessions.set(ws, { process: claudeProcess, instanceId });

  // Send initial system prompt to claude
  if (claudeProcess.stdin) {
    // Give claude a moment to start, then send context
    setTimeout(() => {
      const initPrompt = `/system ${systemPrompt}\n`;
      claudeProcess.stdin?.write(initPrompt);
    }, 500);
  }

  // Pipe claude stdout → WebSocket
  claudeProcess.stdout?.on("data", (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data: data.toString("utf-8") }));
    }
  });

  // Pipe claude stderr → WebSocket
  claudeProcess.stderr?.on("data", (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data: data.toString("utf-8") }));
    }
  });

  // Process exit
  claudeProcess.on("exit", (code) => {
    console.log(`[terminal] Claude process exited with code ${code}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code }));
    }
    sessions.delete(ws);
  });

  claudeProcess.on("error", (err) => {
    console.error(`[terminal] Claude process error:`, err);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    }
  });

  // WebSocket messages → claude stdin
  ws.on("message", (rawMsg) => {
    try {
      const msg = JSON.parse(rawMsg.toString());

      if (msg.type === "input" && claudeProcess.stdin) {
        claudeProcess.stdin.write(msg.data);
      } else if (msg.type === "resize") {
        // Could be used with node-pty for terminal resize
        // Not applicable with basic spawn, but kept for future
      }
    } catch {
      // Raw text input fallback
      if (claudeProcess.stdin) {
        claudeProcess.stdin.write(rawMsg.toString());
      }
    }
  });

  // Cleanup on WebSocket close
  ws.on("close", () => {
    console.log(`[terminal] Connection closed for instance: ${instanceId}`);
    const session = sessions.get(ws);
    if (session) {
      session.process.kill();
      sessions.delete(ws);
    }
  });
}
