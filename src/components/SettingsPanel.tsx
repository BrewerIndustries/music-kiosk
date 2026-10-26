"use client";
import { useState } from "react";
import { call } from "@/lib/client";
import { PlaylistPicker } from "./PlaylistPicker";
import type { KioskState, Notify } from "./types";

export function SettingsPanel({
  state,
  notify,
  sdk,
  onClaimAudio,
}: {
  state: KioskState;
  notify: Notify;
  sdk: { supported: boolean; deviceId: string | null; error: string | null };
  onClaimAudio: () => void;
}) {
  const s = state.settings;
  const [duck, setDuck] = useState(s?.duckPercent ?? 20);
  const [guestBase, setGuestBase] = useState(s?.guestBaseUrl ?? "");

  const save = (p: Record<string, unknown>) =>
    call("POST", "/api/settings", p)
      .then(() => notify("Saved"))
      .catch((e) => notify(e.message));

  const pickPlaylist = (uri: string, name: string) => save({ playlistUri: uri, playlistName: name });

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="section-title">Backdrop playlist</h2>
        <p className="mb-3 text-sm text-muted">
          Plays whenever Up Next is empty. Current:{" "}
          <span className="text-ink">{s?.playlistName ?? "none picked"}</span>
        </p>
        <PlaylistPicker currentUri={s?.playlistUri ?? null} notify={notify} onPick={pickPlaylist} maxHeight="max-h-72" />
      </section>

      <section className="card space-y-4 p-4 text-sm">
        <h2 className="section-title">Sounds</h2>
        <label className="block">
          Music volume while a clip plays over it: <span className="font-semibold">{duck}%</span>
          <input
            type="range"
            min={0}
            max={80}
            value={duck}
            onChange={(e) => setDuck(Number(e.target.value))}
            onPointerUp={() => save({ duckPercent: duck })}
            onKeyUp={() => save({ duckPercent: duck })}
            className="mt-2 w-full accent-[var(--accent)]"
          />
          <span className="text-xs text-muted">
            Used when the player allows volume control (this browser, the Spotify desktop app). On iPad/iPhone,
            iOS lowers the music itself.
          </span>
        </label>
        <div className="flex items-center justify-between gap-4">
          <span>
            Play queued clips on this device
            <span className="block text-xs text-muted">
              {state.isAudioHost ? "This device is playing queued clips." : "Another kiosk screen is playing them."}
            </span>
          </span>
          {!state.isAudioHost && (
            <button className="btn" onClick={onClaimAudio}>Use this device</button>
          )}
        </div>
      </section>

      <section className="card space-y-3 p-4 text-sm">
        <h2 className="section-title">Guest link</h2>
        <p className="text-xs text-muted">
          The address the QR code points to. Leave blank to use this kiosk&apos;s network address.
        </p>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="https://…"
            value={guestBase}
            onChange={(e) => setGuestBase(e.target.value)}
          />
          <button className="btn" onClick={() => save({ guestBaseUrl: guestBase })}>Save</button>
        </div>
      </section>

      <section className="card space-y-3 p-4 text-sm">
        <h2 className="section-title">Spotify</h2>
        <div>
          Signed in as <span className="font-semibold">{state.spotify?.user?.name ?? "—"}</span>
          {state.spotify?.user?.product && state.spotify.user.product !== "premium" && (
            <span className="ml-2 text-red-400">(Premium is required for playback control)</span>
          )}
        </div>
        <div className="text-xs text-muted">
          Browser player:{" "}
          {!sdk.supported
            ? "not available on this device — use the Spotify app here and pick it as the player."
            : sdk.error
              ? `error — ${sdk.error}`
              : sdk.deviceId
                ? "ready (“Music Kiosk (this browser)”)"
                : "starting…"}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            onClick={() =>
              confirm("Disconnect Spotify?") &&
              call("POST", "/api/spotify/logout").catch((e) => notify(e.message))
            }
          >
            Disconnect Spotify
          </button>
          {state.pinRequired && (
            <button className="btn" onClick={() => call("DELETE", "/api/unlock").then(() => location.reload())}>
              Lock this device
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
