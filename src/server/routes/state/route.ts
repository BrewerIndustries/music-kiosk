import { NextRequest, NextResponse } from "next/server";
import { activeClip, ensureEngine, freshen, heartbeat, poke, snapshot } from "@/lib/engine";
import { pendingRequests, recentlyPlayed, upNext } from "@/lib/queue";
import { clientConfig, isConnected } from "@/lib/spotify";
import { ytConfig, ytConnected, ytUser } from "@/lib/youtube";
import { getSetting } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/state?client=<id>[&claim=1][&poke=1] — everything the kiosk UI renders,
// polled ~1/s. Also the audio-host heartbeat: the tab that is host plays queued
// clips. poke=1: the page saw the player change (its browser player reported it),
// so re-read Spotify now.
export function GET(req: NextRequest) {
  ensureEngine();
  const me = currentUser(req);
  if (!me) return NextResponse.json({ locked: true });
  const client = req.nextUrl.searchParams.get("client");
  if (req.nextUrl.searchParams.get("poke") === "1") poke();
  const isAudioHost = heartbeat(client, req.nextUrl.searchParams.get("claim") === "1");
  freshen();
  const user = getSetting("spotify_user");
  return NextResponse.json({
    locked: false,
    me,
    spotify: { configured: clientConfig().configured, connected: isConnected(), user: user ? JSON.parse(user) : null },
    youtube: { configured: ytConfig().configured, connected: ytConnected(), user: ytUser() },
    ...snapshot(),
    upNext: upNext(),
    pending: pendingRequests(),
    recent: recentlyPlayed(8),
    clip: isAudioHost ? activeClip() : null,
    isAudioHost,
    settings: getSettings(),
  });
}
