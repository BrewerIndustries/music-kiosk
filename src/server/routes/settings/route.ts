import { NextRequest, NextResponse } from "next/server";
import { cleanPartyCode, getSettings, updateSettings } from "@/lib/settings";
import { adminRoute } from "@/lib/auth";
import { clearBackdropItems } from "@/lib/queue";

export const dynamic = "force-dynamic";

// POST /api/settings — partial update (see KioskSettings).
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.partyCode === "string" && !cleanPartyCode(body.partyCode))
      return NextResponse.json({ error: "Party codes are 3–12 letters or numbers." }, { status: 400 });
    // A new backdrop: songs fed from the old kiosk-playlist backdrop no longer belong in Up Next.
    if ("playlistUri" in body && body.playlistUri !== getSettings().playlistUri) clearBackdropItems();
    updateSettings(body);
    return NextResponse.json({ settings: getSettings() });
  });
}
