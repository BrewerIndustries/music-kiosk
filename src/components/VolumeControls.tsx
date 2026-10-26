"use client";
// Music + Sounds volume sliders. Ducking for clips is automatic; these set the
// normal levels (the music slider is what ducking restores to).
import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/client";
import type { KioskState, Notify } from "./types";

export function VolumeControls({ state, notify }: { state: KioskState; notify: Notify }) {
  const dev = state.playback?.device;
  const musicSupported = Boolean(dev?.supports_volume);

  const setMusic = (v: number) => call("POST", "/api/player", { action: "volume", percent: v });
  const setSounds = (v: number) => call("POST", "/api/settings", { clipVolume: v });

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-bg/60 px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs text-muted">🎵 Music</span>
        {musicSupported ? (
          <Slider value={state.musicVolume ?? dev?.volume_percent ?? 70} onCommit={setMusic} notify={notify} />
        ) : (
          <span className="flex-1 text-xs text-muted">
            {dev ? `Use the volume on ${dev.name}` : "Start the music to adjust"}
          </span>
        )}
      </div>
      {state.ducked && (
        <div className="flex items-center justify-between pl-[76px] text-xs">
          <span className="text-accent">Lowered while a sound plays</span>
          <button
            className="text-muted underline hover:text-ink"
            onClick={() => call("POST", "/api/player", { action: "restoreVolume" }).catch((e) => notify(e.message))}
          >
            Restore now
          </button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs text-muted">🔊 Sounds</span>
        <Slider value={state.settings?.clipVolume ?? 100} onCommit={setSounds} notify={notify} />
      </div>
    </div>
  );
}

// A slider that follows the server value except while you're dragging it, and
// sends changes at most every 250 ms (the last one always goes out).
function Slider({
  value,
  onCommit,
  notify,
}: {
  value: number;
  onCommit: (v: number) => Promise<unknown>;
  notify: Notify;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const lastSent = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
      if (release.current) clearTimeout(release.current);
    },
    [],
  );

  const onInput = (v: number) => {
    setLocal(v);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(
      () => {
        lastSent.current = Date.now();
        onCommit(v).catch((e) => notify(e.message));
      },
      Math.max(0, 250 - (Date.now() - lastSent.current)),
    );
    // Hand control back to the server value once it has had time to catch up.
    if (release.current) clearTimeout(release.current);
    release.current = setTimeout(() => setLocal(null), 2000);
  };

  const shown = local ?? value;
  return (
    <>
      <input
        type="range"
        min={0}
        max={100}
        value={shown}
        onChange={(e) => onInput(Number(e.target.value))}
        className="flex-1 accent-[var(--accent)]"
        aria-label="Volume"
      />
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted">{shown}</span>
    </>
  );
}
