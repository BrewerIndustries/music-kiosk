import { NextRequest, NextResponse } from "next/server";
import { clearErrors, recentErrors } from "@/lib/log";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/errors — the recent error log (also included in /api/state).
export function GET(req: NextRequest) {
  return adminRoute(req, () => NextResponse.json({ errors: recentErrors() }));
}

// DELETE /api/errors — clear it.
export function DELETE(req: NextRequest) {
  return adminRoute(req, () => {
    clearErrors();
    return NextResponse.json({ ok: true });
  });
}
