import { NextRequest, NextResponse } from "next/server";
import { codeOk, validGuestId } from "@/lib/guest";
import { guestRequests, upNext, type QueueItem } from "@/lib/queue";
import { snapshot } from "@/lib/engine";
import { playHistory } from "@/lib/history";

export const dynamic = "force-dynamic";

// GET /api/guest/queue?code=&guest= — what guests see: now playing, what played
// before, the songs in Up Next (with their place), what the playlist plays after that, and this
// phone's own requests with where each one stands. Songs only — sound clips stay
// a surprise.
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (!codeOk(p.get("code"))) return NextResponse.json({ ok: false }, { status: 403 });
  const guest = validGuestId(p.get("guest"));
  const snap = snapshot();
  const nowId = snap.nowPlayingItem?.id ?? null;
  const track = snap.playback?.track ?? null;

  const songs = upNext().filter((i) => i.kind === "track");
  const place = new Map(songs.map((i, idx) => [i.id, idx + 1]));
  const show = (i: QueueItem) => ({ title: i.title, subtitle: i.subtitle, art: i.art });

  return NextResponse.json({
    ok: true,
    nowPlaying: track
      ? { title: track.title, subtitle: track.subtitle, art: track.art, isPlaying: snap.playback?.isPlaying ?? false }
      : null,
    queue: songs.map((i) => ({
      ...show(i),
      place: place.get(i.id)!,
      requestedBy: i.requestedBy,
      mine: Boolean(guest && i.guestId === guest),
    })),
    previouslyPlayed: playHistory()
      .slice(0, 15)
      .map((t) => ({ title: t.title, subtitle: t.subtitle, art: t.art })),
    thenPlaylist: (snap.upcoming ?? []).slice(0, 8).map((t) => ({ title: t.title, subtitle: t.subtitle, art: t.art })),
    mine: guest
      ? guestRequests(guest).map((i) => ({
          ...show(i),
          id: i.id,
          state:
            i.id === nowId
              ? "playing"
              : i.status === "pending"
                ? "pending"
                : i.status === "rejected"
                  ? "declined"
                  : i.status === "played"
                    ? "played"
                    : "queued",
          place: place.get(i.id) ?? null,
        }))
      : [],
  });
}
