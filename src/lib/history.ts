// Previously played: every song that actually played (≥ 10 s), newest first,
// whatever started it (playlist, Up Next, Spotify app), plus YouTube songs. Kept in settings so it
// survives restarts.
import { getSetting, setSetting } from "./db";
import type { TrackSummary } from "./spotify";

const KEY = "play_history";
const CURRENT = "play_history_current";
const MAX = 50;
const COUNTS_AS_PLAYED_MS = 10_000;

export type PlayedTrack = TrackSummary & { playedAt: string };

function read<T>(key: string, fallback: T): T {
  try {
    const v = getSetting(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function playHistory(): PlayedTrack[] {
  return read<PlayedTrack[]>(KEY, []);
}

// Called on every engine poll with what's playing now. When the song changes, the
// one before goes into the history if it got far enough.
export function notePlaying(track: TrackSummary | null, progressMs: number) {
  if (!track) return;
  const cur = read<{ track: TrackSummary; maxMs: number } | null>(CURRENT, null);
  if (cur?.track.uri === track.uri) {
    if (progressMs > cur.maxMs + 5000) setSetting(CURRENT, JSON.stringify({ track, maxMs: progressMs }));
    return;
  }
  if (cur && cur.maxMs >= COUNTS_AS_PLAYED_MS) {
    const list = playHistory();
    if (list[0]?.uri !== cur.track.uri) {
      list.unshift({ ...cur.track, playedAt: new Date().toISOString() });
      setSetting(KEY, JSON.stringify(list.slice(0, MAX)));
    }
  }
  setSetting(CURRENT, JSON.stringify({ track, maxMs: progressMs }));
}

// A song played outside Spotify (a YouTube song in the kiosk tab) finished.
export function notePlayed(track: TrackSummary) {
  const list = playHistory();
  if (list[0]?.uri === track.uri) return;
  list.unshift({ ...track, playedAt: new Date().toISOString() });
  setSetting(KEY, JSON.stringify(list.slice(0, MAX)));
}
