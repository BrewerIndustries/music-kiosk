import { NextRequest, NextResponse } from "next/server";
import { accessToken } from "@/lib/spotify";
import { adminRoute } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/spotify/token — short-lived access token for the browser's Web Playback SDK.
export function GET(req: NextRequest) {
  return adminRoute(req, async () => NextResponse.json({ token: await accessToken() }));
}
