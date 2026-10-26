import { NextRequest, NextResponse } from "next/server";
import { searchTracks } from "@/lib/spotify";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/search?q= — Spotify track search.
export function GET(req: NextRequest) {
  return adminRoute(req, async () => {
    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q) return NextResponse.json({ tracks: [] });
    return NextResponse.json({ tracks: await searchTracks(q) });
  });
}
