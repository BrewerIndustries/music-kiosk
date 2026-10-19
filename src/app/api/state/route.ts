import { NextRequest, NextResponse } from "next/server";
import { activeClip, ensureEngine, heartbeat, snapshot } from "@/lib/engine";
import { pendingRequests, recentlyPlayed, upNext } from "@/lib/queue";
import { clientConfig, isConnected } from "@/lib/spotify";
import { getSetting } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { isAdmin, pinRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/state?client=<id>[&claim=1] — everything the kiosk UI renders, polled
// ~1/s. Also the audio-host heartbeat: the tab that is host plays queued clips.
export function GET(req: NextRequest) {
  ensureEngine();
  const admin = isAdmin(req);
  if (!admin) return NextResponse.json({ locked: true, pinRequired: true });
  const client = req.nextUrl.searchParams.get("client");
  const isAudioHost = heartbeat(client, req.nextUrl.searchParams.get("claim") === "1");
  const user = getSetting("spotify_user");
  return NextResponse.json({
    locked: false,
    pinRequired: pinRequired(),
    spotify: { configured: clientConfig().configured, connected: isConnected(), user: user ? JSON.parse(user) : null },
    ...snapshot(),
    upNext: upNext(),
    pending: pendingRequests(),
    recent: recentlyPlayed(8),
    clip: isAudioHost ? activeClip() : null,
    isAudioHost,
    settings: getSettings(),
  });
}
