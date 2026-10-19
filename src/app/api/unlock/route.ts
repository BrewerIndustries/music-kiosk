import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieValue, checkPin, pinRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/unlock { pin } — sets the admin cookie on this device.
export async function POST(req: NextRequest) {
  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  if (pinRequired() && !checkPin(String(pin ?? ""))) return NextResponse.json({ error: "wrong PIN" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

// DELETE /api/unlock — lock this device again.
export function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
