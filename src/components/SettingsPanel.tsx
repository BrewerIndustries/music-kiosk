"use client";
import { useState } from "react";
import { call } from "@/lib/client";
import { PlaylistPicker } from "./PlaylistPicker";
import type { KioskState, Notify } from "./types";
import { AccountSection, UsersSection } from "./Account";
import { DoNotPlaySection } from "./DoNotPlay";
import { EventSection } from "./EventSection";
import { KioskPlaylistsSection } from "./KioskPlaylists";

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
  const [duck, setDuck] = useState(s?.duckPercent ?? 30);
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

      <KioskPlaylistsSection state={state} notify={notify} />

      <section className="card space-y-4 p-4 text-sm">
        <h2 className="section-title">Music</h2>
        <FadeSetting
          label="Music fade in"
          value={s?.musicFadeInMs ?? 3000}
          onSave={(ms) => save({ musicFadeInMs: ms })}
        />
        <FadeSetting
          label="Music fade out"
          value={s?.musicFadeOutMs ?? 5000}
          onSave={(ms) => save({ musicFadeOutMs: ms })}
        />
        <p className="text-xs text-muted">
          Fade out lowers the music, pauses it, and puts the volume back for next time. Fade in starts it from
          silence (or raises it) to the Music volume.
        </p>
        <TransitionSetting value={s?.songTransitionMs ?? 0} onSave={(ms) => save({ songTransitionMs: ms })} />
      </section>

      <section className="card space-y-4 p-4 text-sm">
        <h2 className="section-title">Sounds</h2>
        <label className="block">
          When a sound plays over the music, lower the music to{" "}
          <span className="font-semibold">{duck}%</span> of its volume
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={duck}
            onChange={(e) => setDuck(Number(e.target.value))}
            onPointerUp={() => save({ duckPercent: duck })}
            onKeyUp={() => save({ duckPercent: duck })}
            className="mt-2 w-full accent-[var(--accent)]"
          />
          <span className="text-xs text-muted">
            It comes back up automatically when the sound ends. Works when the player allows volume control (this
            browser, the Spotify desktop app); on iPad/iPhone, iOS lowers the music itself.
          </span>
        </label>
        <FadeSetting
          label="Fade in"
          value={s?.fadeInMs ?? 2000}
          onSave={(ms) => save({ fadeInMs: ms })}
        />
        <FadeSetting
          label="Fade out"
          value={s?.fadeOutMs ?? 3000}
          onSave={(ms) => save({ fadeOutMs: ms })}
        />
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

      <DoNotPlaySection state={state} notify={notify} />

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

      <EventSection notify={notify} />

      <section className="card p-4 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Recent errors</h2>
          {(state.errors?.length ?? 0) > 0 && (
            <button className="text-xs text-muted hover:text-ink" onClick={() => call("DELETE", "/api/errors")}>
              Clear
            </button>
          )}
        </div>
        {!state.errors?.length ? (
          <p className="text-xs text-muted">None. Failures also go to the server log.</p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {state.errors.map((e, i) => (
              <li key={`${e.at}-${i}`} className="rounded-lg bg-bg px-3 py-2">
                <div className="flex justify-between gap-2 text-xs text-muted">
                  <span className="truncate font-mono">{e.where}</span>
                  <span className="shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
                </div>
                <div className="mt-0.5 break-words text-red-300">{e.message}</div>
                {e.detail && <div className="mt-0.5 break-words font-mono text-xs text-muted">{e.detail}</div>}
              </li>
            ))}
          </ul>
        )}
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
        </div>
      </section>

      <section className="card space-y-3 p-4 text-sm">
        <h2 className="section-title">YouTube</h2>
        {!state.youtube?.configured ? (
          <p className="text-xs text-muted">
            Not set up yet: needs a Google OAuth client (<code>GOOGLE_CLIENT_ID</code> /{" "}
            <code>GOOGLE_CLIENT_SECRET</code>) on the server.
          </p>
        ) : state.youtube.connected ? (
          <>
            <div>
              Signed in as{" "}
              <span className="font-semibold">{state.youtube.user?.name ?? state.youtube.user?.email ?? "your Google account"}</span>
            </div>
            <label className="flex items-center justify-between gap-4">
              <span>
                YouTube on the kiosk
                <span className="block text-xs text-muted">
                  Adds a YouTube tab to search: songs and your playlists (incl. YouTube Music). YouTube songs play
                  on the kiosk screen while Spotify waits. Off = Spotify only.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--accent)]"
                checked={s?.youtubeEnabled ?? false}
                onChange={(e) => save({ youtubeEnabled: e.target.checked })}
              />
            </label>
            <button
              className="btn"
              onClick={() =>
                confirm("Disconnect YouTube?") && call("POST", "/api/youtube/logout").catch((e) => notify(e.message))
              }
            >
              Disconnect YouTube
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">
              Sign in with the Google account whose YouTube / YouTube Music playlists you want (read-only).
            </p>
            <a href="/api/youtube/login" className="btn btn-primary inline-flex">
              Connect YouTube
            </a>
          </>
        )}
      </section>

      <AccountSection state={state} notify={notify} />
      <UsersSection state={state} notify={notify} />
    </div>
  );
}

// Seconds slider for a sound card's fade-in / fade-out duration (saved as ms).
// Fade between songs: 0 = off. Spotify can't overlap two songs from here, so this
// fades the end of each song out and the next one in.
function TransitionSetting({ value, onSave }: { value: number; onSave: (ms: number) => void }) {
  const [sec, setSec] = useState(value / 1000);
  const commit = () => onSave(Math.round(sec * 1000));
  return (
    <label className="block">
      Fade between songs: <span className="font-semibold">{sec ? `${sec.toFixed(1)} s` : "off"}</span>
      <input
        type="range"
        min={0}
        max={12}
        step={0.5}
        value={sec}
        onChange={(e) => setSec(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className="mt-2 w-full accent-[var(--accent)]"
      />
      <span className="text-xs text-muted">
        Fades the last seconds of each song out and the next one in. A true overlapping crossfade is only possible
        in the Spotify app&apos;s own settings (Playback ▸ Crossfade) when it is the player, e.g. on the iPad — if you
        use that, leave this off.
      </span>
    </label>
  );
}

function FadeSetting({ label, value, onSave }: { label: string; value: number; onSave: (ms: number) => void }) {
  const [sec, setSec] = useState(value / 1000);
  const commit = () => onSave(Math.round(sec * 1000));
  return (
    <label className="block">
      {label} duration: <span className="font-semibold">{sec.toFixed(1)} s</span>
      <input
        type="range"
        min={0.5}
        max={15}
        step={0.5}
        value={sec}
        onChange={(e) => setSec(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className="mt-2 w-full accent-[var(--accent)]"
      />
    </label>
  );
}
