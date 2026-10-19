import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/settings";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/settings — partial update (see KioskSettings).
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    updateSettings((await req.json()) as Record<string, unknown>);
    return NextResponse.json({ settings: getSettings() });
  });
}
