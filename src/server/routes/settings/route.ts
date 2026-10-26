import { NextRequest, NextResponse } from "next/server";
import { cleanPartyCode, getSettings, updateSettings } from "@/lib/settings";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/settings — partial update (see KioskSettings).
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.partyCode === "string" && !cleanPartyCode(body.partyCode))
      return NextResponse.json({ error: "Party codes are 3–12 letters or numbers." }, { status: 400 });
    updateSettings(body);
    return NextResponse.json({ settings: getSettings() });
  });
}
