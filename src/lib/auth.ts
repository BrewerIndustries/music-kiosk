// Kiosk admin gate. The kiosk itself runs unlocked once the PIN is entered (a
// cookie remembers it); guests only ever reach the /api/guest/* routes. If
// KIOSK_PIN is unset, admin routes are open (fine for local testing).
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

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
  return handle(fn);
}

export async function handle(fn: () => Promise<Response> | Response) {
  try {
    return await fn();
  } catch (e) {
    const status = (e as { status?: number }).status;
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 });
  }
}
