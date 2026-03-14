import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

function resolveTerminalWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/terminal/ws`;
}

export function TerminalPage({ active = true }: { active?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let fitAddon: FitAddon | null = null;
    let xterm: Terminal | null = null;
    let dataSub: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    if (!hostRef.current) return;

    xterm = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
      theme: {
        background: "#000000",
        foreground: "#f4f4f5",
      },
    });
    fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(hostRef.current);
    fitAddon.fit();
    xterm.focus();
    terminalRef.current = xterm;
    fitAddonRef.current = fitAddon;

    dataSub = xterm.onData((data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input", data }));
    });

    ws = new WebSocket(resolveTerminalWsUrl());
    ws.addEventListener("message", (event) => {
      let msg: { type?: string; data?: string; cwd?: string };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        xterm?.write(String(event.data));
        return;
      }
      if (msg.type === "ready") {
        return;
      }
      if (msg.type === "output") {
        xterm?.write(msg.data ?? "");
        return;
      }
      if (msg.type === "exit") {
        xterm?.write("\\r\\n\\x1b[31mTerminal process exited\\x1b[0m\\r\\n");
      }
    });
    ws.addEventListener("close", () => {
      xterm?.write("\\r\\n\\x1b[31mDisconnected\\x1b[0m\\r\\n");
    });
    ws.addEventListener("error", () => {
      xterm?.write("\\r\\n\\x1b[31mWebSocket error\\x1b[0m\\r\\n");
    });

    const onResize = () => {
      fitAddon?.fit();
    };
    window.addEventListener("resize", onResize);
    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      dataSub?.dispose();
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      xterm?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div className="h-full w-full bg-black overflow-hidden">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
