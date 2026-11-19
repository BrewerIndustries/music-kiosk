// Route guards. Kiosk controls need a signed-in account (src/lib/accounts.ts);
// managing accounts needs an admin. Guests only ever reach /api/guest/* (party code).
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionUser, type User } from "./accounts";
import { logError } from "./log";

export function currentUser(req: NextRequest): User | null {
  return sessionUser(req.cookies.get(SESSION_COOKIE)?.value);
}

// Name kept from the PIN days: "may operate the kiosk".
export function isAdmin(req: NextRequest) {
  return Boolean(currentUser(req));
}

export function denied() {
  return NextResponse.json({ error: "signed out" }, { status: 401 });
}

// Wrap a handler body: 401 when signed out, Spotify/other errors → JSON 4xx/5xx.
export async function adminRoute(req: NextRequest, fn: () => Promise<Response> | Response) {
  if (!isAdmin(req)) return denied();
  return handle(fn, req);
}

// Account management: admins only.
export async function ownerRoute(req: NextRequest, fn: (me: User) => Promise<Response> | Response) {
  const me = currentUser(req);
  if (!me) return denied();
  if (me.role !== "admin") return NextResponse.json({ error: "admins only" }, { status: 403 });
  return handle(() => fn(me), req);
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
