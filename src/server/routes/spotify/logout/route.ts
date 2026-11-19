import { NextRequest, NextResponse } from "next/server";
import { disconnect } from "@/lib/spotify";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/spotify/logout — forget the stored Spotify tokens.
export function POST(req: NextRequest) {
  return adminRoute(req, () => {
    disconnect();
    return NextResponse.json({ ok: true });
  });
}
