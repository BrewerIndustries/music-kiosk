"use client";
import { call, fmtTime } from "@/lib/client";
import type { KioskState, Notify, QueueItem, TrackSummary } from "./types";

export function UpNext({ state, notify }: { state: KioskState; notify: Notify }) {
  const items = state.upNext ?? [];
  const upcoming = state.upcoming ?? [];
  const ctx = state.playback?.contextUri;
  const fromName = ctx && ctx === state.settings?.playlistUri ? state.settings?.playlistName : null;
  const patch = (id: string, action: string) =>
    call("PATCH", `/api/queue/${id}`, { action }).catch((e) => notify(e.message));
  const remove = (id: string) => call("DELETE", `/api/queue/${id}`).catch((e) => notify(e.message));

  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Up Next</h2>
        {items.some((i) => i.status === "queued") && (
          <button
            className="text-xs text-muted hover:text-ink"
            onClick={() => confirm("Clear everything in Up Next?") && call("DELETE", "/api/queue").catch((e) => notify(e.message))}
          >
            Clear
          </button>
        )}
      </div>
      {items.length > 0 ? (
        <ol className="space-y-1">
          {items.map((it, i) => (
            <Row
              key={it.id}
              item={it}
              first={i === 0}
              last={i === items.length - 1}
              onUp={() => patch(it.id, "up")}
              onDown={() => patch(it.id, "down")}
              onPlayNow={() => patch(it.id, "playNow")}
              onRemove={() => remove(it.id)}
            />
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
          Songs and sounds you add slot in here, ahead of the playlist.
        </p>
      )}

      {upcoming.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 truncate text-xs font-semibold uppercase tracking-wider text-muted">
            Then from {fromName ?? "Spotify"}
          </h3>
          <ol className="space-y-0.5">
            {upcoming.map((t, i) => (
              <PlaylistRow key={`${t.uri}-${i}`} track={t} />
            ))}
          </ol>
        </>
      )}
      {upcoming.length === 0 && items.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">Start a playlist to see what&apos;s coming up.</p>
      )}
    </section>
  );
}

function PlaylistRow({ track }: { track: TrackSummary }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1 opacity-70">
      <div className="art h-9 w-9 shrink-0 text-sm">
        {track.art ? <img src={track.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.title}</div>
        <div className="truncate text-xs text-muted">{track.subtitle}</div>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted">{fmtTime(track.durationMs)}</span>
    </li>
  );
}

function Row({
  item,
  first,
  last,
  onUp,
  onDown,
  onPlayNow,
  onRemove,
}: {
  item: QueueItem;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onPlayNow: () => void;
  onRemove: () => void;
}) {
  const locked = item.status === "handed_off"; // already in Spotify's queue / playing
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-line/50">
      <div className="art h-10 w-10 shrink-0 text-base">
        {item.art ? <img src={item.art} alt="" className="h-full w-full object-cover" /> : <span>{item.kind === "clip" ? "🔊" : "♪"}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.title}</div>
        <div className="truncate text-xs text-muted">
          {item.kind === "clip" ? "Sound clip" : item.subtitle}
          {item.requestedBy ? ` · ${item.requestedBy}` : ""}
          {item.durationMs ? ` · ${fmtTime(item.durationMs)}` : ""}
        </div>
      </div>
      {locked ? (
        <span className="text-xs text-accent">{item.kind === "clip" ? "playing" : "next"}</span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button className="icon-btn" aria-label="Play now" title="Play now" onClick={onPlayNow}>▶</button>
          <button className="icon-btn" aria-label="Move up" disabled={first} onClick={onUp}>↑</button>
          <button className="icon-btn" aria-label="Move down" disabled={last} onClick={onDown}>↓</button>
          <button className="icon-btn" aria-label="Remove" onClick={onRemove}>✕</button>
        </div>
      )}
    </li>
  );
}
