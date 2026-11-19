import { NextRequest, NextResponse } from "next/server";
import { adminRoute } from "@/lib/auth";
import { createKioskPlaylist, listKioskPlaylists } from "@/lib/kioskPlaylists";

export const dynamic = "force-dynamic";

// GET /api/kiosk-playlists — kiosk playlists (Spotify + YouTube mixed).
export function GET(req: NextRequest) {
  return adminRoute(req, () => NextResponse.json({ playlists: listKioskPlaylists() }));
}

// POST /api/kiosk-playlists { name } — a new, empty one.
export function POST(req: NextRequest) {
  return adminRoute(req, async () => {
    const b = (await req.json()) as { name?: string };
    return NextResponse.json({ playlist: createKioskPlaylist(b.name ?? "") }, { status: 201 });
  });
}
