"use client";
// A status dot in the header: green when everything the music needs is answering,
// amber when something is degraded, red when the music is (or is about to be) in
// trouble. Tap it for the details.
import { useEffect, useRef, useState } from "react";
import type { KioskState } from "./types";

type Level = "ok" | "warn" | "bad";
type Check = { name: string; level: Level; detail: string };

const RECENT_ERROR_MS = 10 * 60_000;
const STALE_MS = 20_000; // the server re-reads Spotify every few seconds while music plays

function checks(
  state: KioskState,
  offline: boolean,
  sdk: { supported: boolean; deviceId: string | null; error: string | null },
  now: number,
): Check[] {
  const out: Check[] = [];
  out.push(
    offline
      ? { name: "Kiosk server", level: "bad", detail: "Not answering — check the internet (switch to the hotspot?)" }
      : { name: "Kiosk server", level: "ok", detail: "Connected" },
  );
  const pb = state.playback;
  const age = pb?.at ? now - pb.at : null;
  if (!state.spotify?.connected) out.push({ name: "Spotify", level: "bad", detail: "Not connected — Settings ▸ Spotify" });
  else if (state.error) out.push({ name: "Spotify", level: "bad", detail: state.error });
  else if (pb?.isPlaying && age !== null && age > STALE_MS)
    out.push({ name: "Spotify", level: "warn", detail: `No word from Spotify for ${Math.round(age / 1000)} s` });
  else out.push({ name: "Spotify", level: "ok", detail: pb?.isPlaying ? "Playing" : state.youtubeNow ? "Waiting for YouTube" : "Connected" });

  const dev = pb?.device;
  if (state.youtubeNow) {
    // Spotify waits paused (and may drop its player) during a YouTube song: fine.
  } else if (!dev) out.push({ name: "Player", level: "warn", detail: "No Spotify player active — press ▶ or pick one" });
  else out.push({ name: "Player", level: "ok", detail: `${dev.name}${dev.volume_percent != null ? ` · volume ${dev.volume_percent}%` : ""}` });

  if (sdk.supported)
    out.push(
      sdk.error
        ? { name: "This browser's player", level: "warn", detail: sdk.error }
        : sdk.deviceId
          ? { name: "This browser's player", level: "ok", detail: "Ready" }
          : { name: "This browser's player", level: "warn", detail: "Starting…" },
    );

  out.push(
    state.audioHostAlive
      ? { name: "Sounds & YouTube screen", level: "ok", detail: state.isAudioHost ? "This screen" : "Another kiosk screen" }
      : { name: "Sounds & YouTube screen", level: "warn", detail: "No kiosk screen is playing queued clips / YouTube — Settings ▸ Sounds ▸ Use this device" },
  );

  if (state.settings?.youtubeEnabled)
    out.push(
      state.youtube?.connected
        ? { name: "YouTube", level: "ok", detail: state.youtubeNow ? `Playing “${state.youtubeNow.title}”` : "Connected" }
        : { name: "YouTube", level: "warn", detail: "Switched on but not connected — Settings ▸ YouTube" },
    );

  const recent = (state.errors ?? []).filter((e) => now - Date.parse(e.at) < RECENT_ERROR_MS);
  out.push(
    recent.length
      ? { name: "Recent errors", level: "warn", detail: `${recent.length} in the last 10 min — latest: ${recent[0].message}` }
      : { name: "Recent errors", level: "ok", detail: "None in the last 10 min" },
  );
  return out;
}

const COLORS: Record<Level, string> = { ok: "#3fbf6f", warn: "#f6c34a", bad: "#e23a4b" };
const LABEL: Record<Level, string> = { ok: "All good", warn: "Needs a look", bad: "Problem" };

export function HealthLight({
  state,
  offline,
  sdk,
}: {
  state: KioskState;
  offline: boolean;
  sdk: { supported: boolean; deviceId: string | null; error: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const list = checks(state, offline, sdk, now);
  const level: Level = list.some((c) => c.level === "bad") ? "bad" : list.some((c) => c.level === "warn") ? "warn" : "ok";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Health: ${LABEL[level]}`}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-muted hover:bg-line/50"
      >
        <span
          className={`health-dot ${level !== "ok" ? "health-pulse" : ""}`}
          style={{ ["--health" as string]: COLORS[level] }}
        />
        <span className="hidden sm:inline">{LABEL[level]}</span>
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] p-3 text-sm shadow-xl">
          <div className="mb-2 font-semibold">Kiosk health</div>
          <ul className="space-y-2">
            {list.map((c) => (
              <li key={c.name} className="flex gap-2">
                <span className="health-dot mt-1.5 shrink-0" style={{ ["--health" as string]: COLORS[c.level] }} />
                <div className="min-w-0">
                  <div className="font-medium">{c.name}</div>
                  <div className="break-words text-xs text-muted">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
