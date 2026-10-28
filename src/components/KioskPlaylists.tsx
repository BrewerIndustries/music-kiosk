"use client";
// Kiosk playlists: the kiosk's own playlists, mixing Spotify and YouTube songs.
// Any of them can be the backdrop (Settings ▸ Backdrop, or the 🎵 chip). Songs are
// added from search (＋☰ on a result), or a whole Spotify / YouTube playlist is
// imported.
import { useCallback, useEffect, useRef, useState } from "react";
import { call, fmtTime } from "@/lib/client";
import { PlaylistPicker } from "./PlaylistPicker";
import type { KioskState, Notify } from "./types";

export type KioskPlaylist = { id: string; name: string; shuffle: boolean; count: number; youtube: number };
type Item = { id: string; kind: "track" | "youtube"; uri: string; title: string; subtitle: string; art: string | null; durationMs: number };
export type NewSong = Omit<Item, "id">;

export const kioskUri = (id: string) => `kiosk:playlist:${id}`;

// Someone added / changed a kiosk playlist: pickers reload.
const CHANGED = "kiosk-playlists-changed";
export const playlistsChanged = () => window.dispatchEvent(new Event(CHANGED));

export function useKioskPlaylists(notify: Notify) {
  const [list, setList] = useState<KioskPlaylist[] | null>(null);
  const load = useCallback(
    () =>
      call<{ playlists: KioskPlaylist[] }>("GET", "/api/kiosk-playlists")
        .then((r) => setList(r.playlists))
        .catch((e) => notify(e.message)),
    [notify],
  );
  useEffect(() => {
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [load]);
  return list;
}

// ＋☰ on a search result: add the song to a kiosk playlist.
export function AddToPlaylist({ song, notify }: { song: NewSong; notify: Notify }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<KioskPlaylist[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    call<{ playlists: KioskPlaylist[] }>("GET", "/api/kiosk-playlists")
      .then((r) => setList(r.playlists))
      .catch((e) => notify(e.message));
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open, notify]);
  const add = (p: KioskPlaylist) =>
    call<{ added: number }>("PATCH", `/api/kiosk-playlists/${p.id}`, { add: [song] })
      .then((r) => {
        notify(r.added ? `Added to “${p.name}”` : `Already in “${p.name}”`);
        playlistsChanged();
        setOpen(false);
      })
      .catch((e) => notify(e.message));
  return (
    <div ref={ref} className="relative">
      <button className="btn" aria-label="Add to a kiosk playlist" title="Add to a kiosk playlist" onClick={() => setOpen((o) => !o)}>
        ＋☰
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-40 mt-1 w-56 p-1 text-sm shadow-xl">
          <div className="px-2 py-1 text-xs text-muted">Add to kiosk playlist</div>
          {list === null && <div className="px-2 py-1 text-xs text-muted">Loading…</div>}
          {list?.length === 0 && <div className="px-2 py-1 text-xs text-muted">None yet — make one in Settings ▸ Kiosk playlists.</div>}
          {list?.map((p) => (
            <button key={p.id} className="block w-full truncate rounded px-2 py-1.5 text-left hover:bg-line/50" onClick={() => add(p)}>
              {p.name} <span className="text-xs text-muted">· {p.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Settings ▸ Kiosk playlists.
export function KioskPlaylistsSection({ state, notify }: { state: KioskState; notify: Notify }) {
  const list = useKioskPlaylists(notify);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const backdrop = state.settings?.playlistUri ?? null;

  const create = () =>
    call<{ playlist: KioskPlaylist }>("POST", "/api/kiosk-playlists", { name })
      .then((r) => {
        setName("");
        setOpenId(r.playlist.id);
        playlistsChanged();
      })
      .catch((e) => notify(e.message));

  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="section-title">Kiosk playlists (Spotify + YouTube)</h2>
      <p className="text-xs text-muted">
        Mix Spotify and YouTube songs in one playlist and use it as the backdrop. Add songs with ＋☰ on any search
        result, or import a whole Spotify or YouTube playlist. YouTube songs play on the kiosk screen while Spotify waits.
      </p>
      {list?.map((p) => (
        <div key={p.id} className="rounded-lg bg-bg">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
            <span className="min-w-0 flex-1 truncate font-medium">
              {p.name}
              {backdrop === kioskUri(p.id) && <span className="ml-2 text-xs text-accent">backdrop</span>}
            </span>
            <span className="text-xs text-muted">
              {p.count} songs{p.youtube ? ` · ${p.youtube} YouTube` : ""}
              {p.shuffle ? " · 🔀" : ""}
            </span>
            <span className="text-muted">{openId === p.id ? "▴" : "▾"}</span>
          </button>
          {openId === p.id && <Editor id={p.id} state={state} notify={notify} onClose={() => setOpenId(null)} />}
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input className="input" placeholder="New playlist name…" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary">Create</button>
      </form>
    </section>
  );
}

function Editor({ id, state, notify, onClose }: { id: string; state: KioskState; notify: Notify; onClose: () => void }) {
  const [pl, setPl] = useState<KioskPlaylist | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [importing, setImporting] = useState<null | "spotify" | "youtube" | "busy">(null);
  const [ytLists, setYtLists] = useState<{ id: string; title: string; count: number }[] | null>(null);
  const backdrop = state.settings?.playlistUri === kioskUri(id);

  const apply = (r: { playlist: KioskPlaylist; items: Item[]; added?: number }) => {
    setPl(r.playlist);
    setItems(r.items);
    playlistsChanged();
    return r;
  };
  useEffect(() => {
    call<{ playlist: KioskPlaylist; items: Item[] }>("GET", `/api/kiosk-playlists/${id}`)
      .then((r) => {
        setPl(r.playlist);
        setItems(r.items);
      })
      .catch((e) => notify(e.message));
  }, [id, notify]);
  const patch = (body: Record<string, unknown>) =>
    call<{ playlist: KioskPlaylist; items: Item[]; added?: number }>("PATCH", `/api/kiosk-playlists/${id}`, body).then(apply);

  const doImport = (body: Record<string, unknown>) => {
    setImporting("busy");
    patch({ importFrom: body })
      .then((r) => notify(`Imported ${r.added ?? 0} songs`))
      .catch((e) => notify(e.message))
      .finally(() => setImporting(null));
  };
  useEffect(() => {
    if (importing !== "youtube" || ytLists) return;
    call<{ playlists: { id: string; title: string; count: number }[] }>("GET", "/api/youtube/playlists")
      .then((r) => setYtLists(r.playlists))
      .catch((e) => notify(e.message));
  }, [importing, ytLists, notify]);

  if (!pl) return <p className="px-3 pb-3 text-xs text-muted">Loading…</p>;
  return (
    <div className="space-y-3 border-t border-line px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1"
          defaultValue={pl.name}
          maxLength={80}
          onBlur={(e) => e.target.value.trim() !== pl.name && patch({ name: e.target.value }).catch((er) => notify(er.message))}
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" className="accent-[var(--accent)]" checked={pl.shuffle} onChange={(e) => patch({ shuffle: e.target.checked }).catch((er) => notify(er.message))} />
          Shuffle
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {!backdrop ? (
          <button
            className="btn btn-primary"
            disabled={!items.length}
            onClick={() =>
              call("POST", "/api/settings", { playlistUri: kioskUri(id), playlistName: pl.name })
                .then(() => notify(`“${pl.name}” is the backdrop — press ▶ (or ↺ Restart) to start it`))
                .catch((e) => notify(e.message))
            }
          >
            Use as backdrop
          </button>
        ) : (
          <span className="chip chip-on">✓ The backdrop</span>
        )}
        <button className="btn" onClick={() => setImporting(importing === "spotify" ? null : "spotify")}>
          Import Spotify playlist
        </button>
        {state.youtube?.connected && (
          <button className="btn" onClick={() => setImporting(importing === "youtube" ? null : "youtube")}>
            Import YouTube playlist
          </button>
        )}
        <button
          className="btn"
          onClick={() =>
            confirm(`Delete “${pl.name}”?`) &&
            call("DELETE", `/api/kiosk-playlists/${id}`)
              .then(() => {
                playlistsChanged();
                onClose();
              })
              .catch((e) => notify(e.message))
          }
        >
          Delete
        </button>
      </div>
      {importing === "busy" && <p className="text-xs text-muted">Importing…</p>}
      {importing === "spotify" && (
        <PlaylistPicker currentUri={null} notify={notify} spotifyOnly maxHeight="max-h-60" onPick={(uri) => doImport({ source: "spotify", uri })} />
      )}
      {importing === "youtube" && (
        <ul className="max-h-60 space-y-0.5 overflow-y-auto">
          {ytLists === null && <li className="text-xs text-muted">Loading your YouTube playlists…</li>}
          {ytLists?.map((y) => (
            <li key={y.id}>
              <button className="w-full truncate rounded px-2 py-1.5 text-left hover:bg-line/50" onClick={() => doImport({ source: "youtube", id: y.id })}>
                {y.title} <span className="text-xs text-muted">· {y.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
          Empty. Add songs with ＋☰ on a search result (Spotify or YouTube tab), or import a playlist.
        </p>
      ) : (
        <ol className="max-h-80 space-y-0.5 overflow-y-auto">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-line/50">
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
              <div className="art h-8 w-8 shrink-0 text-xs">
                {it.art ? <img src={it.art} alt="" className="h-full w-full object-cover" /> : <span>{it.kind === "youtube" ? "▶" : "♪"}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{it.title}</div>
                <div className="truncate text-xs text-muted">
                  {it.kind === "youtube" && <span className="mr-1 rounded bg-red-600/80 px-1 text-[10px] font-semibold text-white">YouTube</span>}
                  {it.subtitle} · {fmtTime(it.durationMs)}
                </div>
              </div>
              <button className="icon-btn" aria-label="Move to top" disabled={i === 0} onClick={() => patch({ move: { itemId: it.id, dir: "top" } }).catch((e) => notify(e.message))}>⇈</button>
              <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => patch({ move: { itemId: it.id, dir: "up" } }).catch((e) => notify(e.message))}>↑</button>
              <button className="icon-btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => patch({ move: { itemId: it.id, dir: "down" } }).catch((e) => notify(e.message))}>↓</button>
              <button className="icon-btn" aria-label="Remove" onClick={() => patch({ remove: it.id }).catch((e) => notify(e.message))}>✕</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
