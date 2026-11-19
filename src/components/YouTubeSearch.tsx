"use client";
// YouTube side of the search panel: search (music category) and the signed-in
// account's playlists, incl. ones made in YouTube Music. Songs go into Up Next as
// "youtube" items, which the kiosk tab plays while Spotify waits.
// A YouTube search costs 1% of the day's API allowance, so it runs on Enter / the
// button rather than on every keystroke (and the server caches results for an hour).
import { useEffect, useState } from "react";
import { call, fmtTime } from "@/lib/client";
import type { KioskState, Notify } from "./types";
import { AddToPlaylist } from "./KioskPlaylists";

type YtVideo = { uri: string; videoId: string; title: string; subtitle: string; art: string | null; durationMs: number };
type YtPlaylist = { id: string; title: string; art: string | null; count: number };

const asItem = (v: YtVideo) => ({
  kind: "youtube",
  uri: v.uri,
  title: v.title,
  subtitle: v.subtitle,
  art: v.art,
  durationMs: v.durationMs,
});

export function YouTubeSearch({ state, notify }: { state: KioskState; notify: Notify }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<YtVideo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"search" | "playlists">("search");
  const [playlists, setPlaylists] = useState<YtPlaylist[] | null>(null);
  const [open, setOpen] = useState<{ list: YtPlaylist; videos: YtVideo[] | null } | null>(null);
  const queued = new Set((state.upNext ?? []).map((i) => i.uri));

  useEffect(() => {
    try {
      setQ(localStorage.getItem("kiosk.ytSearch") ?? "");
    } catch {}
  }, []);

  const search = () => {
    const term = q.trim();
    if (!term) return;
    try {
      localStorage.setItem("kiosk.ytSearch", term);
    } catch {}
    setLoading(true);
    call<{ videos: YtVideo[] }>("GET", `/api/youtube/search?q=${encodeURIComponent(term)}`)
      .then((r) => setResults(r.videos))
      .catch((e) => notify(e.message))
      .finally(() => setLoading(false));
  };

  const showPlaylists = () => {
    setView("playlists");
    if (playlists) return;
    call<{ playlists: YtPlaylist[] }>("GET", "/api/youtube/playlists")
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => notify(e.message));
  };

  const openList = (list: YtPlaylist) => {
    setOpen({ list, videos: null });
    call<{ videos: YtVideo[] }>("GET", `/api/youtube/playlist?id=${encodeURIComponent(list.id)}`)
      .then((r) => setOpen((o) => (o?.list.id === list.id ? { list, videos: r.videos } : o)))
      .catch((e) => {
        notify(e.message);
        setOpen(null);
      });
  };

  const add = (v: YtVideo, playNow = false) =>
    call("POST", "/api/queue", { ...asItem(v), playNow })
      .then(() => notify(playNow ? `Playing “${v.title}”` : `“${v.title}” is up next`))
      .catch((e) => notify(e.message));

  const addAll = (videos: YtVideo[], name: string) =>
    call<{ added: number }>("POST", "/api/queue", { items: videos.filter((v) => !queued.has(v.uri)).map(asItem) })
      .then((r) => notify(`Added ${r.added} songs from “${name}” to Up Next`))
      .catch((e) => notify(e.message));

  const rows = (videos: YtVideo[]) =>
    videos.map((v) => (
      <div key={v.uri} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-line/50">
        <div className="art h-12 w-16 shrink-0">
          {v.art ? <img src={v.art} alt="" className="h-full w-full object-cover" /> : <span>▶</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{v.title}</div>
          <div className="truncate text-xs text-muted">
            {v.subtitle} · {fmtTime(v.durationMs)}
          </div>
        </div>
        {queued.has(v.uri) ? (
          <span className="text-xs text-accent">Queued</span>
        ) : (
          <div className="flex shrink-0 gap-1">
            <button className="btn btn-primary" onClick={() => add(v)}>+ Next</button>
            <button className="btn hidden sm:inline-flex" onClick={() => add(v, true)}>▶ Now</button>
            <AddToPlaylist
              notify={notify}
              song={{ kind: "youtube", uri: v.uri, title: v.title, subtitle: v.subtitle, art: v.art, durationMs: v.durationMs }}
            />
          </div>
        )}
      </div>
    ));

  return (
    <div>
      <div className="mb-3 flex gap-1">
        <button className={`tab ${view === "search" ? "tab-on" : ""}`} onClick={() => setView("search")}>
          Search
        </button>
        <button className={`tab ${view === "playlists" ? "tab-on" : ""}`} onClick={showPlaylists}>
          Your playlists
        </button>
      </div>

      {view === "search" && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search YouTube music…"
              className="input text-lg"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="btn btn-primary shrink-0" disabled={loading || !q.trim()}>
              Search
            </button>
          </form>
          <div className="mt-3 space-y-1">
            {loading && <p className="py-4 text-center text-sm text-muted">Searching YouTube…</p>}
            {!loading && results?.length === 0 && <p className="py-4 text-center text-sm text-muted">No matches.</p>}
            {!loading && results && rows(results)}
            {!results && !loading && (
              <p className="py-4 text-center text-xs text-muted">Press Enter to search. YouTube songs play on the kiosk screen.</p>
            )}
          </div>
        </>
      )}

      {view === "playlists" && !open && (
        <div className="space-y-1">
          {!playlists && <p className="py-4 text-center text-sm text-muted">Loading your playlists…</p>}
          {playlists?.length === 0 && <p className="py-4 text-center text-sm text-muted">No playlists on this account.</p>}
          {playlists?.map((p) => (
            <button
              key={p.id}
              onClick={() => openList(p)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-line/50"
            >
              <div className="art h-12 w-16 shrink-0">
                {p.art ? <img src={p.art} alt="" className="h-full w-full object-cover" /> : <span>▶</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.title}</div>
                <div className="text-xs text-muted">{p.count} songs</div>
              </div>
              <span className="text-muted">›</span>
            </button>
          ))}
        </div>
      )}

      {view === "playlists" && open && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <button className="btn" onClick={() => setOpen(null)}>‹ Back</button>
            <div className="min-w-0 flex-1 truncate font-semibold">{open.list.title}</div>
            {open.videos && open.videos.length > 0 && (
              <button className="btn btn-primary shrink-0" onClick={() => addAll(open.videos!, open.list.title)}>
                + Add all
              </button>
            )}
          </div>
          {!open.videos && <p className="py-4 text-center text-sm text-muted">Loading songs…</p>}
          {open.videos?.length === 0 && (
            <p className="py-4 text-center text-sm text-muted">Nothing here can be played on another site.</p>
          )}
          <div className="space-y-1">{open.videos && rows(open.videos)}</div>
        </div>
      )}
    </div>
  );
}
