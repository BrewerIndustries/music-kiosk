// Previously played: every song that actually played (≥ 10 s), newest first,
// whatever started it (playlist, Up Next, Spotify app), plus YouTube songs. Kept in settings so it
// survives restarts.
import { db, getSetting, setSetting } from "./db";
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
    logPlay(cur.track, cur.maxMs, Date.now() - cur.maxMs);
    const list = playHistory();
    if (list[0]?.uri !== cur.track.uri) {
      list.unshift({ ...cur.track, playedAt: new Date().toISOString() });
      setSetting(KEY, JSON.stringify(list.slice(0, MAX)));
    }
  }
  setSetting(CURRENT, JSON.stringify({ track, maxMs: progressMs }));
}

// A song played outside Spotify (a YouTube song in the kiosk tab) finished.
export function notePlayed(track: TrackSummary, playedMs: number, startedAt: number) {
  logPlay(track, playedMs, startedAt);
  const list = playHistory();
  if (list[0]?.uri === track.uri) return;
  list.unshift({ ...track, playedAt: new Date().toISOString() });
  setSetting(KEY, JSON.stringify(list.slice(0, MAX)));
}

// ---- The event log (plays table): every song that played, for the event summary
// and the keepsake playlist. Who asked for it (and their dedication) comes from the
// Up Next item it played as, if any.
export type Play = {
  uri: string;
  kind: "track" | "youtube";
  title: string;
  subtitle: string;
  art: string | null;
  durationMs: number;
  playedMs: number;
  playedAt: number;
  requestedBy: string | null;
  source: string | null;
  dedication: string | null;
};

function logPlay(t: TrackSummary, playedMs: number, startedAt: number) {
  try {
    const q = db()
      .prepare(
        `SELECT requested_by, source, dedication FROM queue
         WHERE uri = ? AND status IN ('played','handed_off') AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(t.uri, new Date(startedAt - 6 * 60 * 60_000).toISOString()) as
      | { requested_by: string | null; source: string | null; dedication: string | null }
      | undefined;
    db()
      .prepare(
        `INSERT INTO plays (uri, kind, title, subtitle, art, duration_ms, played_ms, played_at, requested_by, source, dedication)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.uri,
        t.uri.startsWith("youtube:") ? "youtube" : "track",
        t.title,
        t.subtitle,
        t.art,
        t.durationMs,
        Math.round(playedMs),
        Math.round(startedAt),
        q?.requested_by ?? null,
        q?.source ?? null,
        q?.dedication ?? null,
      );
  } catch (e) {
    console.error("play log", e);
  }
}

// Songs that started between from and to (ms), oldest first; includes the song
// playing now if it has played long enough.
export function playsBetween(from: number, to: number): Play[] {
  const rows = db()
    .prepare(`SELECT * FROM plays WHERE played_at >= ? AND played_at <= ? ORDER BY played_at`)
    .all(from, to) as Record<string, unknown>[];
  const out: Play[] = rows.map((r) => ({
    uri: r.uri as string,
    kind: r.kind as Play["kind"],
    title: r.title as string,
    subtitle: r.subtitle as string,
    art: (r.art as string) ?? null,
    durationMs: Number(r.duration_ms),
    playedMs: Number(r.played_ms),
    playedAt: Number(r.played_at),
    requestedBy: (r.requested_by as string) ?? null,
    source: (r.source as string) ?? null,
    dedication: (r.dedication as string) ?? null,
  }));
  const cur = read<{ track: TrackSummary; maxMs: number } | null>(CURRENT, null);
  const started = cur ? Date.now() - cur.maxMs : 0;
  if (cur && cur.maxMs >= COUNTS_AS_PLAYED_MS && started >= from && started <= to && out.at(-1)?.uri !== cur.track.uri)
    out.push({
      ...cur.track,
      kind: "track",
      playedMs: cur.maxMs,
      playedAt: started,
      requestedBy: null,
      source: null,
      dedication: null,
    });
  return out;
}

