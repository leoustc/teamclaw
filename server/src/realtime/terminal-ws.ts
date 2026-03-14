import os from "node:os";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { and, eq } from "drizzle-orm";
import type { Db } from "@teamclawai/db";
import { companyMemberships, instanceUserRoles } from "@teamclawai/db";
import type { DeploymentMode } from "@teamclawai/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "../middleware/logger.js";

interface WsSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface WsServer {
  on(event: "connection", listener: (socket: WsSocket, req: IncomingMessage) => void): void;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WsSocket) => void,
  ): void;
  emit(event: "connection", ws: WsSocket, req: IncomingMessage): boolean;
}

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean }) => WsServer;
};

function rejectUpgrade(socket: Duplex, statusLine: string, message: string) {
  const safe = message.replace(/[\r\n]+/g, " ").trim();
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${safe}`);
  socket.destroy();
}

function headersFromIncomingMessage(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(req.headers)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

async function authorizeUpgrade(
  db: Db,
  req: IncomingMessage,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
): Promise<boolean> {
  if (opts.deploymentMode === "local_trusted") return true;
  if (opts.deploymentMode !== "authenticated" || !opts.resolveSessionFromHeaders) return false;

  const session = await opts.resolveSessionFromHeaders(headersFromIncomingMessage(req));
  const userId = session?.user?.id;
  if (!userId) return false;

  const [roleRow, membershipRow] = await Promise.all([
    db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null),
    db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .then((rows) => rows[0] ?? null),
  ]);

  return Boolean(roleRow || membershipRow);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function parseClientMessage(raw: unknown): { type: string; data?: string; cols?: number; rows?: number } {
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
  if (!text) return { type: "unknown" };
  try {
    const parsed = JSON.parse(text) as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
    return {
      type: asString(parsed.type),
      ...(typeof parsed.data === "string" ? { data: parsed.data } : {}),
      ...(asPositiveInteger(parsed.cols) ? { cols: asPositiveInteger(parsed.cols) } : {}),
      ...(asPositiveInteger(parsed.rows) ? { rows: asPositiveInteger(parsed.rows) } : {}),
    };
  } catch {
    return { type: "input", data: text };
  }
}

function send(socket: WsSocket, payload: Record<string, unknown>) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function spawnTerminalProcess(): ChildProcessWithoutNullStreams {
  const shell = process.env.SHELL?.trim() || "/bin/bash";
  const escapedShell = shell.replace(/'/g, `'\\''`);

  // Prefer a PTY-backed process for correct prompt/editing behavior in web terminals.
  const hasScript = spawnSync("sh", ["-lc", "command -v script >/dev/null 2>&1"], {
    stdio: "ignore",
  }).status === 0;
  if (hasScript) {
    return spawn("script", ["-qefc", `'${escapedShell}' -li`, "/dev/null"], {
      cwd: os.homedir(),
      env: process.env,
      stdio: "pipe",
    });
  }

  return spawn(shell, ["-li"], {
    cwd: os.homedir(),
    env: process.env,
    stdio: "pipe",
  });
}

function applyTerminalResize(child: ChildProcessWithoutNullStreams, cols: number, rows: number) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  child.stdin.write(`stty cols ${safeCols} rows ${safeRows}\n`);
}

export function setupTerminalWebSocketServer(
  server: HttpServer,
  db: Db,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    const child = spawnTerminalProcess();
    send(socket, { type: "ready", cwd: os.homedir() });

    child.stdout.on("data", (chunk: Buffer) => {
      send(socket, { type: "output", stream: "stdout", data: chunk.toString("utf8") });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      send(socket, { type: "output", stream: "stderr", data: chunk.toString("utf8") });
    });

    child.on("close", (code, signal) => {
      send(socket, { type: "exit", code, signal });
      socket.close(1000, "terminal exited");
    });

    socket.on("message", (raw) => {
      const message = parseClientMessage(raw);
      if (message.type === "input") {
        const data = message.data ?? "";
        if (data.length === 0) return;
        child.stdin.write(data);
        return;
      }
      if (message.type === "resize") {
        if (!message.cols || !message.rows) return;
        applyTerminalResize(child, message.cols, message.rows);
      }
    });

    socket.on("close", () => {
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // no-op
        }
      }
    });

    socket.on("error", (err) => {
      logger.warn({ err }, "terminal websocket error");
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // no-op
        }
      }
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url) {
      rejectUpgrade(socket, "400 Bad Request", "missing url");
      return;
    }

    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/terminal/ws") {
      return;
    }

    void authorizeUpgrade(db, req, opts)
      .then((allowed) => {
        if (!allowed) {
          rejectUpgrade(socket, "403 Forbidden", "forbidden");
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      })
      .catch((err) => {
        logger.error({ err, path: req.url }, "failed terminal websocket upgrade authorization");
        rejectUpgrade(socket, "500 Internal Server Error", "upgrade failed");
      });
  });
}
