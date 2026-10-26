// Guest (QR) request guards: party code + the request rules in Settings ▸ Guests.
import { NextRequest } from "next/server";
import { db } from "./db";
import { getSettings } from "./settings";

// Whole-network ceiling per window. Generous on purpose: at a venue every guest on
// the Wi-Fi shares one IP, so the real limit is per phone (guest id).
const NETWORK_CEILING = 150;

export function codeOk(code: string | null) {
  return Boolean(code) && code!.toUpperCase() === getSettings().partyCode;
}

export function clientIp(req: NextRequest) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

// Records a request and returns an error message if it's over the limits: the
// per-phone limit from Settings (phones without an id count by IP), plus a
// network-wide ceiling. guest_hits.ip holds the counting key.
export function takeGuestSlot(ip: string, guestId: string | null): string | null {
  const { guestLimit, guestWindowMin } = getSettings();
  const windowMs = guestWindowMin * 60_000;
  db().prepare(`DELETE FROM guest_hits WHERE at < ?`).run(Date.now() - Math.max(windowMs, 10 * 60_000));
  const count = (key: string, ms: number) =>
    (db().prepare(`SELECT COUNT(*) AS n FROM guest_hits WHERE ip = ? AND at >= ?`).get(key, Date.now() - ms) as { n: number }).n;
  const phone = guestId ? `g:${guestId}` : `ip:${ip}`;
  if (guestLimit > 0 && count(phone, windowMs) >= guestLimit)
    return `Easy, DJ — ${guestLimit} request${guestLimit === 1 ? "" : "s"} every ${guestWindowMin} minutes. Try again soon.`;
  if (count(`net:${ip}`, 10 * 60_000) >= NETWORK_CEILING) return "Lots of requests right now — try again in a few minutes.";
  const now = Date.now();
  db().prepare(`INSERT INTO guest_hits (ip, at) VALUES (?, ?)`).run(phone, now);
  db().prepare(`INSERT INTO guest_hits (ip, at) VALUES (?, ?)`).run(`net:${ip}`, now);
  return null;
}

// A random id each guest phone makes for itself (localStorage), so it can find
// its own requests again. Not a secret — it only reveals your own song list.
export function validGuestId(id: unknown): string | null {
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}
