// The event, after the fact (Settings ▸ Event): a summary of what played between
// two times, and a "keepsake" Spotify playlist of it. Both read the plays log
// (src/lib/history.ts), so they cover YouTube songs and every source.
import { db, getSetting } from "./db";
import { playsBetween, type Play } from "./history";
import { api, searchTracks, SpotifyError } from "./spotify";

export type Summary = {
  from: number;
  to: number;
  songs: number;
  minutes: number;
  youtubeSongs: number;
  first: Play | null;
  last: Play | null;
  topArtists: { name: string; count: number }[];
  topRequesters: { name: string; count: number }[];
  mostPlayed: { title: string; subtitle: string; count: number }[];
  guestRequests: number;
  soundsPlayed: number;
  dedications: { title: string; by: string | null; text: string }[];
  plays: Play[];
};

function top<T extends string>(names: T[], n = 5) {
  const counts = new Map<string, number>();
  for (const x of names) if (x) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

export function summary(from: number, to: number): Summary {
  const plays = playsBetween(from, to);
  const iso = (ms: number) => new Date(ms).toISOString();
  const count = (sql: string) => (db().prepare(sql).get(iso(from), iso(to)) as { n: number }).n;
  const songKey = (p: Play) => `${p.title}\u0000${p.subtitle}`;
  const mostPlayed = top(plays.map(songKey), 5)
    .filter((x) => x.count > 1)
    .map((x) => {
      const [title, subtitle] = x.name.split("\u0000");
      return { title, subtitle, count: x.count };
    });
  return {
    from,
    to,
    songs: plays.length,
    minutes: Math.round(plays.reduce((n, p) => n + p.playedMs, 0) / 60_000),
    youtubeSongs: plays.filter((p) => p.kind === "youtube").length,
    first: plays[0] ?? null,
    last: plays.at(-1) ?? null,
    topArtists: top(plays.flatMap((p) => p.subtitle.split(/,\s*/).map((a) => a.replace(/\s+-\s+Topic$/, "").trim()))),
    topRequesters: top(plays.map((p) => p.requestedBy ?? "").filter(Boolean)),
    mostPlayed,
    guestRequests: count(`SELECT COUNT(*) AS n FROM queue WHERE source = 'guest' AND created_at >= ? AND created_at <= ?`),
    soundsPlayed: count(`SELECT COUNT(*) AS n FROM queue WHERE kind = 'clip' AND status = 'played' AND played_at >= ? AND played_at <= ?`),
    dedications: plays
      .filter((p) => p.dedication)
      .map((p) => ({ title: p.title, by: p.requestedBy, text: p.dedication! })),
    plays,
  };
}

// Plain-text and HTML versions of a summary (for the email).
export function summaryText(s: Summary, tz?: string) {
  const when = (ms: number) =>
    new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeStyle: "short", timeZone: tz });
  const lines = [
    `🎄 Music Kiosk — ${when(s.from)} to ${when(s.to)}`,
    "",
    `${s.songs} songs · ${Math.floor(s.minutes / 60)} h ${s.minutes % 60} min of music${s.youtubeSongs ? ` (${s.youtubeSongs} from YouTube)` : ""}`,
    `${s.guestRequests} guest requests · ${s.soundsPlayed} sounds played`,
    s.first ? `First song: ${s.first.title} — ${s.first.subtitle} (${time(s.first.playedAt)})` : "",
    s.last ? `Last song: ${s.last.title} — ${s.last.subtitle} (${time(s.last.playedAt)})` : "",
    s.topArtists.length ? `\nTop artists: ${s.topArtists.map((a) => `${a.name} (${a.count})`).join(", ")}` : "",
    s.topRequesters.length ? `Top requesters: ${s.topRequesters.map((a) => `${a.name} (${a.count})`).join(", ")}` : "",
    s.mostPlayed.length ? `Played more than once: ${s.mostPlayed.map((m) => `${m.title} ×${m.count}`).join(", ")}` : "",
    s.dedications.length ? `\nDedications:\n${s.dedications.map((d) => `  💌 “${d.text}” — ${d.by ?? "a guest"} (${d.title})`).join("\n")}` : "",
    `\nEverything that played:\n${s.plays.map((p) => `  ${time(p.playedAt)}  ${p.title} — ${p.subtitle}${p.requestedBy ? `  (🎁 ${p.requestedBy})` : ""}`).join("\n")}`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

// ---- Keepsake playlist ------------------------------------------------------

// "Artist - Song (Official Video) [HD]" → a Spotify search query.
function youtubeQuery(p: Play) {
  let title = p.title
    .replace(/\(([^)]*)\)|\[([^\]]*)\]/g, " ")
    .replace(/\b(official|music|lyric|lyrics|video|audio|hd|hq|4k|remaster(ed)?|visualizer)\b/gi, " ")
    .replace(/\s+(ft\.?|feat\.?)\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  let artist = p.subtitle.replace(/\s+-\s+Topic$/, "").replace(/VEVO$/i, "").trim();
  const dash = title.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) {
    artist = dash[0];
    title = dash.slice(1).join(" ");
  }
  return `${title} ${artist}`.trim();
}

// Spotify renamed some playlist endpoints in 2026; try the new path, fall back.
async function tryBoth<T>(method: string, paths: string[], body: unknown): Promise<T | null> {
  let last: unknown;
  for (const p of paths) {
    try {
      return await api<T>(method, p, body);
    } catch (e) {
      last = e;
      if (!(e instanceof SpotifyError) || (e.status !== 404 && e.status !== 405 && e.status !== 410)) throw e;
    }
  }
  throw last;
}

export type Keepsake = { url: string | null; name: string; added: number; matched: number; unmatched: string[] };

export async function makeKeepsake(from: number, to: number, name: string, isPublic: boolean): Promise<Keepsake> {
  const plays = playsBetween(from, to);
  if (!plays.length) throw new Error("Nothing played in that time range.");
  const uris: string[] = [];
  const unmatched: string[] = [];
  let matched = 0;
  for (const p of plays) {
    let uri: string | null = p.kind === "track" ? p.uri : null;
    if (!uri) {
      const hit = (await searchTracks(youtubeQuery(p), 5).catch(() => []))[0];
      if (hit) {
        uri = hit.uri;
        matched++;
      } else unmatched.push(`${p.title} — ${p.subtitle}`);
    }
    if (uri && !uris.includes(uri)) uris.push(uri);
  }
  const user = JSON.parse(getSetting("spotify_user") ?? "{}") as { id?: string };
  const description = `${plays.length} songs played at the party · ${new Date(from).toDateString()} · made by Music Kiosk 🎄`;
  const pl = await tryBoth<{ id: string; external_urls?: { spotify?: string } }>(
    "POST",
    ["/me/playlists", ...(user.id ? [`/users/${encodeURIComponent(user.id)}/playlists`] : [])],
    { name: name.slice(0, 100), description: description.slice(0, 300), public: isPublic },
  );
  if (!pl?.id) throw new Error("Spotify didn't create the playlist.");
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await tryBoth("POST", [`/playlists/${pl.id}/items`, `/playlists/${pl.id}/tracks`], { uris: chunk });
  }
  return { url: pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${pl.id}`, name, added: uris.length, matched, unmatched };
}
