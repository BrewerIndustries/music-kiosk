"use client";
import { useEffect, useState } from "react";
import { call, toPlaylistUri } from "@/lib/client";
import type { Notify } from "./types";

export type Playlist = { uri: string; name: string; image: string | null; total: number };

// The user's Spotify playlists, filterable, plus "paste a link" for anyone else's.
export function PlaylistPicker({
  currentUri,
  notify,
  onPick,
  maxHeight = "max-h-80",
}: {
  currentUri: string | null;
  notify: Notify;
  onPick: (uri: string, name: string) => void;
  maxHeight?: string;
}) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    call<{ playlists: Playlist[] }>("GET", "/api/playlists")
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => notify(e.message));
  }, [notify]);

  const f = filter.trim();
  const pastedUri = toPlaylistUri(f);
  const shown = (playlists ?? []).filter((p) => !f || pastedUri || p.name.toLowerCase().includes(f.toLowerCase()));

  return (
    <div>
      <input
        className="input"
        placeholder="Filter, or paste a Spotify playlist link…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {pastedUri && (
        <button
          className="btn btn-primary mt-2 w-full"
          onClick={() => onPick(pastedUri, playlists?.find((p) => p.uri === pastedUri)?.name ?? "Pasted playlist")}
        >
          Use pasted playlist
        </button>
      )}
      {playlists === null && <p className="py-4 text-center text-sm text-muted">Loading playlists…</p>}
      {playlists?.length === 0 && <p className="py-4 text-center text-sm text-muted">No playlists on this account.</p>}
      <div className={`mt-2 space-y-1 overflow-y-auto ${maxHeight}`}>
        {shown.map((p) => (
          <button
            key={p.uri}
            onClick={() => onPick(p.uri, p.name)}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-line/50 ${
              p.uri === currentUri ? "text-accent" : ""
            }`}
          >
            <div className="art h-10 w-10 shrink-0">
              {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
            </div>
            <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
            <span className="text-xs text-muted">
              {p.uri === currentUri ? "current" : p.total ? `${p.total} songs` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
