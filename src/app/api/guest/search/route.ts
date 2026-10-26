import { NextRequest, NextResponse } from "next/server";
import { codeOk } from "@/lib/guest";
import { searchTracks } from "@/lib/spotify";
import { handle } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/guest/search?code=&q= — track search for guests (server-side token).
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (!codeOk(p.get("code"))) return NextResponse.json({ error: "bad party code" }, { status: 403 });
  return handle(async () => {
    const q = p.get("q")?.trim().slice(0, 100);
    return NextResponse.json({ tracks: q ? await searchTracks(q, 10) : [] });
  });
}
