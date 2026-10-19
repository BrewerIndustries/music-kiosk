import { NextRequest, NextResponse } from "next/server";
import { api, type SpDevice } from "@/lib/spotify";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/devices — Spotify Connect devices the kiosk can play to.
export function GET(req: NextRequest) {
  return adminRoute(req, async () => {
    const res = await api<{ devices: SpDevice[] }>("GET", "/me/player/devices");
    return NextResponse.json({ devices: res?.devices ?? [] });
  });
}
