import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getActiveInstanceId, getActiveInstance } from "../lib/instances";
import {
  Terminal as TerminalIcon, RefreshCw, X, Maximize2, Minimize2,
} from "lucide-react";

export default function TerminalPanel() {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [tall, setTall] = useState(false);

  const instance = getActiveInstance();

  const connect = useCallback(() => {
    // Cleanup previous
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }

    const instanceId = getActiveInstanceId();

    // Create terminal
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#c0caf5",
        selectionBackground: "#33467c",
        black: "#15161e",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: "#a9b1d6",
        brightBlack: "#414868",
        brightRed: "#f7768e",
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: "#7aa2f7",
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: "#c0caf5",
      },
      rows: 24,
      cols: 80,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (termRef.current) {
      terminal.open(termRef.current);
      setTimeout(() => fitAddon.fit(), 50);
    }

    terminal.writeln("\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m");
    terminal.writeln(`\x1b[1;36m║\x1b[0m  ERPNext Level Terminal                  \x1b[1;36m║\x1b[0m`);
    terminal.writeln(`\x1b[1;36m║\x1b[0m  Instance: \x1b[1;33m${(instance.name || instanceId).padEnd(28)}\x1b[0m \x1b[1;36m║\x1b[0m`);
    terminal.writeln("\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m");
    terminal.writeln("\x1b[90mVerbinden met Claude Code...\x1b[0m\n");

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.hostname}:3001/ws/terminal?instance=${encodeURIComponent(instanceId)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      terminal.writeln("\x1b[1;32m✓ Verbonden met Claude Code\x1b[0m\n");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          terminal.write(msg.data);
        } else if (msg.type === "exit") {
          terminal.writeln(`\n\x1b[90m[Claude process beëindigd met code ${msg.code}]\x1b[0m`);
          setConnected(false);
        } else if (msg.type === "error") {
          terminal.writeln(`\n\x1b[1;31mFout: ${msg.message}\x1b[0m`);
        }
      } catch {
        // Raw text
        terminal.write(event.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      terminal.writeln("\n\x1b[90m[Verbinding verbroken]\x1b[0m");
    };

    ws.onerror = () => {
      terminal.writeln("\n\x1b[1;31mWebSocket fout — is de server actief op poort 3001?\x1b[0m");
      setConnected(false);
    };

    // Terminal input → WebSocket
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });
  }, [instance.name]);

  // Auto-connect on mount
  useEffect(() => {
    if (expanded) {
      // Small delay to let the DOM render
      const timer = setTimeout(connect, 100);
      return () => {
        clearTimeout(timer);
        wsRef.current?.close();
        terminalRef.current?.dispose();
      };
    }
  }, [expanded, connect]);

  // Resize terminal on panel size change
  useEffect(() => {
    if (expanded && fitAddonRef.current) {
      const timer = setTimeout(() => fitAddonRef.current?.fit(), 100);
      return () => clearTimeout(timer);
    }
  }, [tall, expanded]);

  // Resize on window resize
  useEffect(() => {
    function handleResize() {
      fitAddonRef.current?.fit();
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-5 left-72 z-40 flex items-center gap-2 px-4 py-2.5 bg-[#1a1b26] text-[#7aa2f7] rounded-full shadow-lg hover:shadow-xl transition-all cursor-pointer border border-[#33467c]"
      >
        <TerminalIcon size={16} />
        <span className="text-sm font-medium font-mono">Terminal</span>
      </button>
    );
  }

  const panelHeight = tall ? "h-[600px]" : "h-[400px]";
  const panelWidth = tall ? "w-[700px]" : "w-[520px]";

  return (
    <div className={`fixed bottom-5 left-72 z-40 ${panelWidth} ${panelHeight} bg-[#1a1b26] rounded-xl shadow-2xl border border-[#33467c] flex flex-col overflow-hidden transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 bg-[#24283b] text-[#a9b1d6] flex-shrink-0 select-none rounded-t-xl">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon size={13} className="text-[#7aa2f7] flex-shrink-0" />
          <span className="text-xs font-medium font-mono">Claude Terminal</span>
          <span className="text-[10px] text-[#565f89]">{instance.name}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-[#9ece6a]" : "bg-[#f7768e]"}`} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={connect}
            className="p-1 hover:bg-[#33467c] rounded cursor-pointer"
            title="Herverbinden"
          >
            <RefreshCw size={11} className="text-[#565f89]" />
          </button>
          <button
            onClick={() => setTall(!tall)}
            className="p-1 hover:bg-[#33467c] rounded cursor-pointer"
            title={tall ? "Kleiner" : "Groter"}
          >
            {tall ? <Minimize2 size={11} className="text-[#565f89]" /> : <Maximize2 size={11} className="text-[#565f89]" />}
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="p-1 hover:bg-[#33467c] rounded cursor-pointer"
          >
            <X size={11} className="text-[#565f89]" />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div ref={termRef} className="flex-1 min-h-0 p-1" />
    </div>
  );
}
