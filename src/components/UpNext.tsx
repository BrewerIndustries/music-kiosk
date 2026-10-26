"use client";
import { call, expect, fmtTime } from "@/lib/client";
import type { KioskState, Notify, QueueItem, TrackSummary } from "./types";

export function UpNext({ state, notify }: { state: KioskState; notify: Notify }) {
  const items = state.upNext ?? [];
  const upcoming = state.upcoming ?? [];
  const ctx = state.playback?.contextUri;
  const fromName = ctx && ctx === state.settings?.playlistUri ? state.settings?.playlistName : null;
  const patch = (id: string, action: string) =>
    call("PATCH", `/api/queue/${id}`, { action }).catch((e) => notify(e.message));
  const remove = (id: string) => call("DELETE", `/api/queue/${id}`).catch((e) => notify(e.message));
  const history = state.history ?? [];
  // Put a song (from the history or the playlist) into Up Next: first, or playing now.
  const enqueue = (t: TrackSummary, how: "top" | "playNow") => {
    if (how === "playNow") expect({ track: t, playing: true });
    return call("POST", "/api/queue", {
      kind: "track",
      uri: t.uri,
      title: t.title,
      subtitle: t.subtitle,
      art: t.art,
      durationMs: t.durationMs,
      [how]: true,
    })
      .then(() => notify(how === "playNow" ? `Playing “${t.title}”` : `“${t.title}” is up next`))
      .catch((e) => {
        if (how === "playNow") expect({});
        notify(e.message);
      });
  };

  return (
    <section className="card p-4">
      {history.length > 0 && (
        <>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted">Previously played</h2>
          {/* Three rows tall; scroll for more. */}
          <ol className="mb-4 max-h-[8.25rem] space-y-0.5 overflow-y-auto overscroll-contain rounded-lg border border-line/60">
            {history.map((t) => (
              <PlaylistRow
                key={`${t.uri}-${t.playedAt}`}
                track={t}
                onPlay={() => enqueue(t, "playNow")}
                onTop={() => enqueue(t, "top")}
              />
            ))}
          </ol>
        </>
      )}
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
              onPlayNow={() => {
                if (it.kind === "track" && it.uri)
                  expect({
                    playing: true,
                    track: { uri: it.uri, title: it.title, subtitle: it.subtitle, art: it.art, durationMs: it.durationMs },
                  });
                patch(it.id, "playNow");
              }}
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
              <PlaylistRow
                key={`${t.uri}-${i}`}
                track={t}
                onPlay={() => {
                  expect({ track: t, playing: true });
                  return call("POST", "/api/player", { action: "skipTo", uri: t.uri, index: i })
                    .then(() => notify(`Playing “${t.title}”`))
                    .catch((e) => {
                      expect({});
                      notify(e.message);
                    });
                }}
                onCue={() => {
                  expect({ track: t, playing: false });
                  return call("POST", "/api/player", { action: "skipTo", uri: t.uri, index: i, paused: true })
                    .then(() => notify(`“${t.title}” is loaded — press ▶ when ready`))
                    .catch((e) => {
                      expect({});
                      notify(e.message);
                    });
                }}
                onTop={() => enqueue(t, "top")}
              />
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

// A song from the playlist (or the history): play it now, load it paused (playlist
// only), or pull it to the top of Up Next.
function PlaylistRow({
  track,
  onPlay,
  onCue,
  onTop,
}: {
  track: TrackSummary;
  onPlay: () => void;
  onCue?: () => void;
  onTop: () => void;
}) {
  return (
    <li className="flex items-center gap-1 rounded-lg pr-1 opacity-70 hover:bg-line/50 hover:opacity-100">
      <button
        onClick={onPlay}
        title="Play now"
        className="group flex min-w-0 flex-1 items-center gap-3 px-2 py-1 text-left"
      >
        <div className="art relative h-9 w-9 shrink-0 text-sm">
          {track.art ? <img src={track.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
          <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex">▶</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{track.title}</div>
          <div className="truncate text-xs text-muted">{track.subtitle}</div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted">{fmtTime(track.durationMs)}</span>
      </button>
      <button className="icon-btn" aria-label="Play now" title="Play now" onClick={onPlay}>▶</button>
      {onCue && (
        <button className="icon-btn" aria-label="Load paused" title="Load it into the player, paused" onClick={onCue}>⏸</button>
      )}
      <button className="icon-btn" aria-label="Move to top of Up Next" title="Move to the top of Up Next" onClick={onTop}>⤒</button>
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
      <button
        onClick={locked ? undefined : onPlayNow}
        disabled={locked}
        title={locked ? undefined : "Play now"}
        className="group flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-100"
      >
        <div className="art relative h-10 w-10 shrink-0 text-base">
          {item.art ? <img src={item.art} alt="" className="h-full w-full object-cover" /> : <span>{item.kind === "clip" ? "🔊" : "♪"}</span>}
          {!locked && (
            <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex">▶</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.title}</div>
          <div className="truncate text-xs text-muted">
            {item.kind === "clip" ? "Sound clip" : item.subtitle}
            {item.requestedBy ? ` · ${item.requestedBy}` : ""}
            {item.durationMs ? ` · ${fmtTime(item.durationMs)}` : ""}
          </div>
        </div>
      </button>
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
