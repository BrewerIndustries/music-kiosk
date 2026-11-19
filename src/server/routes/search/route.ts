import { NextRequest, NextResponse } from "next/server";
import { isBlocked } from "@/lib/settings";
import { searchTracks } from "@/lib/spotify";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/search?q= — Spotify track search.
export function GET(req: NextRequest) {
  return adminRoute(req, async () => {
    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q) return NextResponse.json({ tracks: [] });
    // Mark do-not-play songs (adding one is refused).
    return NextResponse.json({ tracks: (await searchTracks(q)).map((t) => ({ ...t, blocked: Boolean(isBlocked(t)) })) });
  });
}
