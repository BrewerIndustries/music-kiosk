import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/db";
import { ownerRoute } from "@/lib/auth";
import { poke } from "@/lib/engine";

// Settings that are safe to carry over from another kiosk (scripts/import-local.mjs):
// the Spotify connection, the playlist and every kiosk setting, play history and
// the resume point. Holds and engine bookkeeping are left behind on purpose.
const IMPORTABLE = /^(spotify_|playlist_|duck_percent$|music_volume$|clip_volume$|fade_|music_fade_|song_transition_ms$|require_approval$|party_code$|guest_open$|guest_limit$|guest_window_min$|guest_block_dupes$|youtube_enabled$|do_not_play$|dedications_on$|play_history|resume_point$|player_pref$)/;

// POST /api/import { settings: { key: value } } — admins only.
export function POST(req: NextRequest) {
  return ownerRoute(req, async () => {
    const { settings } = (await req.json()) as { settings?: Record<string, string> };
    const taken: string[] = [];
    for (const [k, v] of Object.entries(settings ?? {}))
      if (IMPORTABLE.test(k) && typeof v === "string") {
        setSetting(k, v);
        taken.push(k);
      }
    poke();
    return NextResponse.json({ imported: taken });
  });
}
