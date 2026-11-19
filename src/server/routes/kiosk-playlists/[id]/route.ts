import { NextRequest, NextResponse } from "next/server";
import { adminRoute } from "@/lib/auth";
import {
  addToKioskPlaylist,
  deleteKioskPlaylist,
  getKioskPlaylist,
  kioskPlaylistId,
  moveInKioskPlaylist,
  playlistItems,
  removeFromKioskPlaylist,
  updateKioskPlaylist,
  type KioskPlaylistItem,
} from "@/lib/kioskPlaylists";
import { getSettings } from "@/lib/settings";
import { api, SpotifyError, summarize, type SpTrack } from "@/lib/spotify";
import { videoIdOf, ytPlaylistItems } from "@/lib/youtube";
import { poke } from "@/lib/engine";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type NewSong = Omit<KioskPlaylistItem, "id">;

// GET /api/kiosk-playlists/<id> — the playlist and its songs.
export function GET(req: NextRequest, ctx: Ctx) {
  return adminRoute(req, async () => {
    const { id } = await ctx.params;
    const playlist = getKioskPlaylist(id);
    if (!playlist) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ playlist, items: playlistItems(id) });
  });
}

// PATCH /api/kiosk-playlists/<id>
//   { name? , shuffle? }                          rename / shuffle on-off
//   { add: [{kind, uri, title, subtitle, art, durationMs}] }   append songs
//   { remove: itemId } · { move: {itemId, dir: "up"|"down"|"top"} }
//   { importFrom: {source: "spotify", uri} | {source: "youtube", id} }   append a whole playlist
export function PATCH(req: NextRequest, ctx: Ctx) {
  return adminRoute(req, async () => {
    const { id } = await ctx.params;
    if (!getKioskPlaylist(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const b = (await req.json()) as Record<string, unknown>;
    updateKioskPlaylist(id, { name: b.name as string | undefined, shuffle: b.shuffle as boolean | undefined });
    let added: number | undefined;
    if (Array.isArray(b.add)) {
      const songs = b.add.map(cleanSong).filter((x): x is NewSong => x !== null);
      added = addToKioskPlaylist(id, songs);
    }
    if (typeof b.remove === "string") removeFromKioskPlaylist(b.remove);
    const mv = b.move as { itemId?: string; dir?: string } | undefined;
    if (mv?.itemId && (mv.dir === "up" || mv.dir === "down" || mv.dir === "top")) moveInKioskPlaylist(id, mv.itemId, mv.dir);
    const imp = b.importFrom as { source?: string; uri?: string; id?: string } | undefined;
    if (imp?.source === "spotify" && imp.uri) added = addToKioskPlaylist(id, await spotifyPlaylistSongs(imp.uri));
    if (imp?.source === "youtube" && imp.id)
      added = addToKioskPlaylist(
        id,
        (await ytPlaylistItems(imp.id)).map((v) => ({ kind: "youtube" as const, uri: v.uri, title: v.title, subtitle: v.subtitle, art: v.art, durationMs: v.durationMs })),
      );
    if (kioskPlaylistId(getSettings().playlistUri) === id) poke(); // the backdrop's "next up" may have changed
    return NextResponse.json({ playlist: getKioskPlaylist(id), items: playlistItems(id), added });
  });
}

// DELETE /api/kiosk-playlists/<id> (not while it's the backdrop).
export function DELETE(req: NextRequest, ctx: Ctx) {
  return adminRoute(req, async () => {
    const { id } = await ctx.params;
    if (kioskPlaylistId(getSettings().playlistUri) === id)
      return NextResponse.json({ error: "It's the backdrop playlist — pick another backdrop first." }, { status: 409 });
    deleteKioskPlaylist(id);
    return NextResponse.json({ ok: true });
  });
}

function cleanSong(x: unknown): NewSong | null {
  const o = x as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const uri = str(o?.uri);
  const kind = o?.kind === "youtube" ? "youtube" : o?.kind === "track" ? "track" : null;
  if (kind === "track" && !/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) return null;
  if (kind === "youtube" && !videoIdOf(uri)) return null;
  if (!kind) return null;
  return {
    kind,
    uri,
    title: str(o.title) || "Untitled",
    subtitle: str(o.subtitle),
    art: str(o.art) || null,
    durationMs: typeof o.durationMs === "number" ? o.durationMs : 0,
  };
}

// Every song in a Spotify playlist (up to 1000). Spotify renamed /tracks to /items
// in 2026 (and the track field to item); accept either.
async function spotifyPlaylistSongs(uri: string): Promise<NewSong[]> {
  const pid = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(uri)?.[1] ?? /playlist\/([A-Za-z0-9]+)/.exec(uri)?.[1];
  if (!pid) throw new Error("That isn't a Spotify playlist.");
  type Page = { items: { track?: SpTrack | null; item?: SpTrack | null }[]; next: string | null };
  const out: NewSong[] = [];
  let path = `/playlists/${pid}/items`;
  for (let offset = 0; offset < 1000; offset += 100) {
    let page: Page | null;
    try {
      page = await api<Page>("GET", path, undefined, { limit: "100", offset: String(offset) });
    } catch (e) {
      if (offset === 0 && path.endsWith("/items") && e instanceof SpotifyError && e.status === 404) {
        path = `/playlists/${pid}/tracks`;
        offset -= 100;
        continue;
      }
      throw e;
    }
    for (const row of page?.items ?? []) {
      const t = row.item ?? row.track;
      if (t?.uri?.startsWith("spotify:track:")) {
        const s = summarize(t);
        out.push({ kind: "track", uri: s.uri, title: s.title, subtitle: s.subtitle, art: s.art, durationMs: s.durationMs });
      }
    }
    if (!page?.next) break;
  }
  return out;
}
