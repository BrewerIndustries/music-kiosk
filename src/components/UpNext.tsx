"use client";
import { call, fmtTime } from "@/lib/client";
import type { KioskState, Notify, QueueItem } from "./types";

export function UpNext({ state, notify }: { state: KioskState; notify: Notify }) {
  const items = state.upNext ?? [];
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
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          Nothing queued — the playlist keeps going.
          <br />
          Search for a song or add a sound to slot it in next.
        </p>
      ) : (
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
      )}
      {items.length > 0 && (
        <p className="mt-3 text-xs text-muted">Then back to {state.settings?.playlistName ?? "the playlist"}.</p>
      )}
    </section>
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
