import { NextRequest, NextResponse } from "next/server";
import { SOUNDBOARD_URL, type SbBoard } from "@/lib/soundboard";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/soundboard/boards — the Soundboard tree, passed through.
export function GET(req: NextRequest) {
  return adminRoute(req, async () => {
    const res = await fetch(`${SOUNDBOARD_URL}/api/boards`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return NextResponse.json({ error: `soundboard: HTTP ${res.status}` }, { status: 502 });
    const { boards } = (await res.json()) as { boards: SbBoard[] };
    return NextResponse.json({ boards, manageUrl: SOUNDBOARD_URL });
  });
}
