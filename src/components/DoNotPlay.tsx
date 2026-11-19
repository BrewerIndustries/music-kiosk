"use client";
// Settings ▸ Do not play: songs and artists that never play. Guests can't find or
// request them, the kiosk refuses to queue them, and if one comes up from the
// playlist (or the Spotify app) the engine skips it.
import { useEffect, useState } from "react";
import { call, fmtTime } from "@/lib/client";
import type { KioskState, Notify, TrackSummary } from "./types";

export function DoNotPlaySection({ state, notify }: { state: KioskState; notify: Notify }) {
  const list = state.settings?.doNotPlay ?? [];
  const [artist, setArtist] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TrackSummary[]>([]);
  const save = (p: Record<string, unknown>, done?: string) =>
    call("POST", "/api/settings", p)
      .then(() => done && notify(done))
      .catch((e) => notify(e.message));

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const t = setTimeout(() => {
      call<{ tracks: TrackSummary[] }>("GET", `/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => setResults(r.tracks.slice(0, 6)))
        .catch((e) => notify(e.message));
    }, 350);
    return () => clearTimeout(t);
  }, [q, notify]);

  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="section-title">Do not play</h2>
      <p className="text-xs text-muted">
        Guests can&apos;t find or request these, the kiosk won&apos;t queue them, and if one comes up in the playlist it
        is skipped.
      </p>
      {list.length > 0 ? (
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {list.map((e, i) => (
            <li key={e.kind === "track" ? e.uri : `a:${e.name}`} className="flex items-center gap-2 rounded-lg bg-bg px-3 py-1.5">
              <span>{e.kind === "track" ? "🎵" : "🎤"}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.kind === "track" ? (
                  <>
                    {e.title} <span className="text-muted">· {e.subtitle}</span>
                  </>
                ) : (
                  <>
                    Anything by <b>{e.name}</b>
                  </>
                )}
              </span>
              <button className="icon-btn" aria-label="Remove" onClick={() => save({ removeDoNotPlay: i })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">Nothing on the list yet.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!artist.trim()) return;
          save({ addDoNotPlay: { kind: "artist", name: artist } }, `No ${artist.trim()} tonight`);
          setArtist("");
        }}
      >
        <input className="input" placeholder="Block an artist…" value={artist} onChange={(e) => setArtist(e.target.value)} />
        <button className="btn">Add</button>
      </form>
      <div>
        <input
          className="input"
          placeholder="Block a song — search Spotify…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value.trim()) setResults([]);
          }}
        />
        {results.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {results.map((t) => (
              <li key={t.uri} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-line/50">
                <span className="min-w-0 flex-1 truncate">
                  {t.title} <span className="text-xs text-muted">· {t.subtitle} · {fmtTime(t.durationMs)}</span>
                </span>
                {t.blocked ? (
                  <span className="text-xs text-muted">Blocked</span>
                ) : (
                  <button
                    className="btn"
                    onClick={() =>
                      save({ addDoNotPlay: { kind: "track", uri: t.uri, title: t.title, subtitle: t.subtitle } }, `Blocked “${t.title}”`).then(
                        () => setResults((r) => r.map((x) => (x.uri === t.uri ? { ...x, blocked: true } : x))),
                      )
                    }
                  >
                    🚫 Block
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
