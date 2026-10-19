// Guest (QR) request guards: party code + per-IP rate limit.
import { NextRequest } from "next/server";
import { db } from "./db";
import { getSettings } from "./settings";

export const GUEST_LIMIT = 3; // requests…
export const GUEST_WINDOW_MS = 10 * 60_000; // …per this window, per IP

export function codeOk(code: string | null) {
  return Boolean(code) && code!.toUpperCase() === getSettings().partyCode;
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

// Records a hit and returns false if this IP is over the limit.
export function takeGuestSlot(ip: string): boolean {
  const since = Date.now() - GUEST_WINDOW_MS;
  db().prepare(`DELETE FROM guest_hits WHERE at < ?`).run(since);
  const { n } = db().prepare(`SELECT COUNT(*) AS n FROM guest_hits WHERE ip = ?`).get(ip) as { n: number };
  if (n >= GUEST_LIMIT) return false;
  db().prepare(`INSERT INTO guest_hits (ip, at) VALUES (?, ?)`).run(ip, Date.now());
  return true;
}
