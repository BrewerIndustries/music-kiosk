"use client";
import { useEffect, useState } from "react";
import { call, fmtTime } from "@/lib/client";
import type { KioskState, Notify, TrackSummary } from "./types";
import { YouTubeSearch } from "./YouTubeSearch";

// Spotify | YouTube tabs (YouTube only when it's connected and switched on).
export function SearchPanel({ state, notify }: { state: KioskState; notify: Notify }) {
  const ytOn = Boolean(state.settings?.youtubeEnabled && state.youtube?.connected);
  const [source, setSourceState] = useState<"spotify" | "youtube">("spotify");
  useEffect(() => {
    try {
      if (localStorage.getItem("kiosk.searchSource") === "youtube") setSourceState("youtube");
    } catch {}
  }, []);
  const setSource = (v: "spotify" | "youtube") => {
    setSourceState(v);
    try {
      localStorage.setItem("kiosk.searchSource", v);
    } catch {}
  };
  const showYt = ytOn && source === "youtube";
  return (
    <section className="card p-4">
      {ytOn && (
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-line/40 p-1">
          {(["spotify", "youtube"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSource(v)}
              className={`rounded-lg py-1.5 text-sm font-medium ${source === v ? "bg-accent text-white" : "text-muted"}`}
            >
              {v === "spotify" ? "Spotify" : "YouTube"}
            </button>
          ))}
        </div>
      )}
      {showYt ? <YouTubeSearch state={state} notify={notify} /> : <SpotifySearch state={state} notify={notify} />}
    </section>
  );
}

function SpotifySearch({ state, notify }: { state: KioskState; notify: Notify }) {
  const [q, setQState] = useState("");
  useEffect(() => {
    try {
      setQState(localStorage.getItem("kiosk.search") ?? "");
    } catch {}
  }, []);
  const setQ = (v: string) => {
    setQState(v);
    try {
      localStorage.setItem("kiosk.search", v);
    } catch {}
  };
  const [results, setResults] = useState<TrackSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const queued = new Set((state.upNext ?? []).map((i) => i.uri));

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      call<{ tracks: TrackSummary[] }>("GET", `/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => setResults(r.tracks))
        .catch((e) => notify(e.message))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [q, notify]);

  const add = (t: TrackSummary, playNow = false) =>
    call("POST", "/api/queue", {
      kind: "track",
      uri: t.uri,
      title: t.title,
      subtitle: t.subtitle,
      art: t.art,
      durationMs: t.durationMs,
      playNow,
    })
      .then(() => notify(playNow ? `Playing “${t.title}”` : `“${t.title}” is up next`))
      .catch((e) => notify(e.message));

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search all of Spotify…"
        className="input text-lg"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="mt-3 space-y-1">
        {loading && results.length === 0 && <p className="py-4 text-center text-sm text-muted">Searching…</p>}
        {!loading && q.trim() && results.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">No matches.</p>
        )}
        {results.map((t) => (
          <div key={t.uri} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-line/50">
            <div className="art h-12 w-12 shrink-0">
              {t.art ? <img src={t.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {t.title}
                {t.explicit && <span className="ml-1.5 rounded bg-line px-1 text-[10px] text-muted">E</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {t.subtitle} · {fmtTime(t.durationMs)}
              </div>
            </div>
            {queued.has(t.uri) ? (
              <span className="text-xs text-accent">Queued</span>
            ) : (
              <div className="flex shrink-0 gap-1">
                <button className="btn btn-primary" onClick={() => add(t)}>+ Next</button>
                <button className="btn hidden sm:inline-flex" onClick={() => add(t, true)}>▶ Now</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
