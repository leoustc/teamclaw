import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const PAM_SESSION_COOKIE = "teamclaw_pam_session";
const PAM_SESSION_VERSION = 1;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

type PamSessionPayload = {
  v: number;
  sub: string;
  username: string;
  exp: number;
};

function toBase64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function sign(payloadBase64Url: string, secret: string) {
  return toBase64Url(createHmac("sha256", secret).update(payloadBase64Url).digest());
}

function parseCookieHeader(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const index = part.indexOf("=");
      if (index <= 0) return acc;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key.length > 0) acc[key] = value;
      return acc;
    }, {});
}

export function readPamSessionCookieFromHeaders(headers: Headers): string | null {
  const cookies = parseCookieHeader(headers.get("cookie") ?? undefined);
  return cookies[PAM_SESSION_COOKIE] ?? null;
}

export function readPamSessionCookieFromRequest(req: Request): string | null {
  const cookies = parseCookieHeader(req.header("cookie") ?? undefined);
  return cookies[PAM_SESSION_COOKIE] ?? null;
}

export function createPamSessionToken(
  input: { userId: string; username: string; now?: number; ttlSeconds?: number },
  secret: string,
) {
  const now = input.now ?? Date.now();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const payload: PamSessionPayload = {
    v: PAM_SESSION_VERSION,
    sub: input.userId,
    username: input.username,
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadBase64, secret);
  return `${payloadBase64}.${signature}`;
}

export function verifyPamSessionToken(token: string, secret: string): { userId: string; username: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadBase64, signatureBase64] = parts;
  if (!payloadBase64 || !signatureBase64) return null;

  const expectedSignature = sign(payloadBase64, secret);
  const receivedSignature = signatureBase64;
  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(receivedSignature);
  if (expectedBuffer.length !== receivedBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) return null;

  let payload: PamSessionPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadBase64).toString("utf8")) as PamSessionPayload;
  } catch {
    return null;
  }

  if (payload.v !== PAM_SESSION_VERSION) return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  if (typeof payload.username !== "string" || payload.username.length === 0) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

  return { userId: payload.sub, username: payload.username };
}

export function pamSessionSetCookie(token: string, secure: boolean) {
  const parts = [
    `${PAM_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${DEFAULT_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function pamSessionClearCookie(secure: boolean) {
  const parts = [
    `${PAM_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

