// Kiosk admin gate. The kiosk itself runs unlocked once the PIN is entered (a
// cookie remembers it); guests only ever reach the /api/guest/* routes. If
// KIOSK_PIN is unset, admin routes are open (fine for local testing).
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { logError } from "./log";

export const ADMIN_COOKIE = "kiosk_admin";

function pin() {
  return process.env.KIOSK_PIN ?? "";
}

export function pinRequired() {
  return Boolean(pin());
}

export function adminCookieValue() {
  return createHmac("sha256", pin()).update("music-kiosk-admin").digest("hex");
}

export function checkPin(candidate: string) {
  const a = Buffer.from(candidate);
  const b = Buffer.from(pin());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdmin(req: NextRequest) {
  if (!pinRequired()) return true;
  return req.cookies.get(ADMIN_COOKIE)?.value === adminCookieValue();
}

export function denied() {
  return NextResponse.json({ error: "locked" }, { status: 401 });
}

// Wrap a handler body: 401 when locked, Spotify/other errors → JSON 4xx/5xx.
export async function adminRoute(req: NextRequest, fn: () => Promise<Response> | Response) {
  if (!isAdmin(req)) return denied();
  return handle(fn, req);
}

// Runs a route body; any throw is logged (with the route and, for Spotify errors,
// the upstream endpoint + status) and returned as JSON.
export async function handle(fn: () => Promise<Response> | Response, req?: NextRequest) {
  try {
    return await fn();
  } catch (e) {
    const status = (e as { status?: number }).status;
    const endpoint = (e as { endpoint?: string }).endpoint;
    const message = e instanceof Error ? e.message : String(e);
    const where = req ? `${req.method} ${req.nextUrl.pathname}` : "route";
    logError(where, e, [endpoint && `spotify ${endpoint}`, status && `HTTP ${status}`].filter(Boolean).join(", ") || undefined);
    if (!status && e instanceof Error && e.stack) console.error(e.stack);
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 });
  }
}
