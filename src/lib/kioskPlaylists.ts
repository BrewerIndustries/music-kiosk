// Kiosk playlists: playlists kept by the kiosk itself, mixing Spotify and YouTube
// songs, that can be the backdrop (setting playlist_uri = "kiosk:playlist:<id>").
// The engine plays one by feeding its songs into Up Next one at a time (source
// "backdrop"), so the normal Up Next machinery plays Spotify songs on Spotify and
// YouTube songs in the kiosk tab. See feedBackdrop() in engine.ts.
import { db, getSetting, setSetting } from "./db";

export type KioskPlaylistItem = {
  id: string;
  kind: "track" | "youtube";
  uri: string;
  title: string;
  subtitle: string;
  art: string | null;
  durationMs: number;
};
export type KioskPlaylist = { id: string; name: string; shuffle: boolean; count: number; youtube: number };

export const KIOSK_PREFIX = "kiosk:playlist:";
export const kioskPlaylistId = (uri: string | null | undefined) =>
  uri?.startsWith(KIOSK_PREFIX) ? uri.slice(KIOSK_PREFIX.length) : null;

const MAX_ITEMS = 1000;
const newId = () => crypto.randomUUID();

export function listKioskPlaylists(): KioskPlaylist[] {
  return (
    db()
      .prepare(
        `SELECT p.id, p.name, p.shuffle,
                (SELECT COUNT(*) FROM kiosk_playlist_items i WHERE i.playlist_id = p.id) AS count,
                (SELECT COUNT(*) FROM kiosk_playlist_items i WHERE i.playlist_id = p.id AND i.kind = 'youtube') AS youtube
         FROM kiosk_playlists p ORDER BY p.created_at`,
      )
      .all() as { id: string; name: string; shuffle: number; count: number; youtube: number }[]
  ).map((r) => ({ id: r.id, name: r.name, shuffle: Boolean(r.shuffle), count: Number(r.count), youtube: Number(r.youtube) }));
}

export function getKioskPlaylist(id: string): KioskPlaylist | null {
  return listKioskPlaylists().find((p) => p.id === id) ?? null;
}

export function playlistItems(id: string): KioskPlaylistItem[] {
  return (
    db()
      .prepare(`SELECT * FROM kiosk_playlist_items WHERE playlist_id = ? ORDER BY position`)
      .all(id) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    kind: r.kind as KioskPlaylistItem["kind"],
    uri: r.uri as string,
    title: r.title as string,
    subtitle: r.subtitle as string,
    art: (r.art as string) ?? null,
    durationMs: Number(r.duration_ms),
  }));
}

export function createKioskPlaylist(name: string): KioskPlaylist {
  const id = newId();
  db()
    .prepare(`INSERT INTO kiosk_playlists (id, name, shuffle, created_at) VALUES (?, ?, 0, ?)`)
    .run(id, name.trim().slice(0, 80) || "New playlist", new Date().toISOString());
  return getKioskPlaylist(id)!;
}

export function updateKioskPlaylist(id: string, p: { name?: string; shuffle?: boolean }) {
  if (typeof p.name === "string" && p.name.trim())
    db().prepare(`UPDATE kiosk_playlists SET name = ? WHERE id = ?`).run(p.name.trim().slice(0, 80), id);
  if (typeof p.shuffle === "boolean") db().prepare(`UPDATE kiosk_playlists SET shuffle = ? WHERE id = ?`).run(p.shuffle, id);
}

export function deleteKioskPlaylist(id: string) {
  db().transaction(() => {
    db().prepare(`DELETE FROM kiosk_playlist_items WHERE playlist_id = ?`).run(id);
    db().prepare(`DELETE FROM kiosk_playlists WHERE id = ?`).run(id);
  })();
}

// Append songs (duplicates of a song already in the playlist are skipped).
export function addToKioskPlaylist(id: string, items: Omit<KioskPlaylistItem, "id">[]): number {
  const have = new Set(playlistItems(id).map((i) => i.uri));
  const room = MAX_ITEMS - have.size;
  const row = db().prepare(`SELECT MAX(position) AS p FROM kiosk_playlist_items WHERE playlist_id = ?`).get(id) as {
    p: number | null;
  };
  let pos = row.p ?? 0;
  let added = 0;
  db().transaction(() => {
    for (const it of items) {
      if (added >= room || have.has(it.uri)) continue;
      have.add(it.uri);
      db()
        .prepare(
          `INSERT INTO kiosk_playlist_items (id, playlist_id, position, kind, uri, title, subtitle, art, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(newId(), id, ++pos, it.kind, it.uri, it.title.slice(0, 200), (it.subtitle ?? "").slice(0, 200), it.art ?? null, it.durationMs ?? 0);
      added++;
    }
  })();
  return added;
}

export function removeFromKioskPlaylist(itemId: string) {
  db().prepare(`DELETE FROM kiosk_playlist_items WHERE id = ?`).run(itemId);
}

export function moveInKioskPlaylist(playlistId: string, itemId: string, dir: "up" | "down" | "top") {
  const items = db()
    .prepare(`SELECT id, position FROM kiosk_playlist_items WHERE playlist_id = ? ORDER BY position`)
    .all(playlistId) as { id: string; position: number }[];
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return;
  if (dir === "top") {
    if (idx > 0) db().prepare(`UPDATE kiosk_playlist_items SET position = ? WHERE id = ?`).run(items[0].position - 1, itemId);
    return;
  }
  const other = items[dir === "up" ? idx - 1 : idx + 1];
  if (!other) return;
  db().transaction(() => {
    db().prepare(`UPDATE kiosk_playlist_items SET position = ? WHERE id = ?`).run(other.position, itemId);
    db().prepare(`UPDATE kiosk_playlist_items SET position = ? WHERE id = ?`).run(items[idx].position, other.id);
  })();
}

// ---- Backdrop cursor: where the kiosk playlist is up to ----------------------
// {playlistId, index (of the last song fed), recent: item ids fed lately (shuffle
// avoids repeating them)}.
type Cursor = { playlistId: string; index: number; recent: string[] };
const CURSOR = "kiosk_backdrop_cursor";

function readCursor(playlistId: string): Cursor {
  try {
    const c = JSON.parse(getSetting(CURSOR) ?? "null") as Cursor | null;
    if (c?.playlistId === playlistId) return c;
  } catch {}
  return { playlistId, index: -1, recent: [] };
}

// Start the playlist from the top (or anywhere, when shuffled) next time.
export function resetCursor(playlistId: string) {
  setSetting(CURSOR, JSON.stringify({ playlistId, index: -1, recent: [] }));
}

// The next song to play from the playlist, advancing the cursor. Loops; shuffle
// picks at random among songs not played lately. `skip` filters songs out (e.g.
// do-not-play); returns null if nothing is left.
export function nextFromPlaylist(playlistId: string, skip: (i: KioskPlaylistItem) => boolean = () => false) {
  const pl = getKioskPlaylist(playlistId);
  const items = playlistItems(playlistId).filter((i) => !skip(i));
  if (!pl || !items.length) return null;
  const c = readCursor(playlistId);
  let index: number;
  if (pl.shuffle) {
    const avoid = new Set(c.recent.slice(-Math.floor(items.length / 2)));
    const pool = items.map((_, i) => i).filter((i) => !avoid.has(items[i].id));
    index = pool[Math.floor(Math.random() * pool.length)] ?? 0;
  } else index = (c.index + 1) % items.length;
  const item = items[index];
  setSetting(CURSOR, JSON.stringify({ playlistId, index, recent: [...c.recent, item.id].slice(-50) }));
  return item;
}

// What the playlist plays after the cursor (for the "Then from …" list). Shuffled
// playlists can't say; they show nothing.
export function upcomingFromPlaylist(playlistId: string, n: number, skip: (i: KioskPlaylistItem) => boolean = () => false) {
  const pl = getKioskPlaylist(playlistId);
  if (!pl || pl.shuffle) return [];
  const items = playlistItems(playlistId).filter((i) => !skip(i));
  if (!items.length) return [];
  const c = readCursor(playlistId);
  const out: KioskPlaylistItem[] = [];
  for (let k = 1; k <= Math.min(n, items.length); k++) out.push(items[(c.index + k) % items.length]);
  return out;
}
