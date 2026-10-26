"use client";
import { useEffect, useState } from "react";
import { call, expect, fmtTime, KIOSK_EXPECT, type Expectation } from "@/lib/client";
import { PlaylistPicker } from "./PlaylistPicker";
import { VolumeControls } from "./VolumeControls";
import { FadeIcon } from "./FadeIcon";
import type { KioskState, Notify, SpDevice } from "./types";

type Props = {
  state: KioskState;
  notify: Notify;
  sdkDeviceId: string | null;
};

export function NowPlaying({ state, notify, sdkDeviceId }: Props) {
  const pb = state.playback;
  const [now, setNow] = useState(() => Date.now());
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // What a tap just asked for, shown at once and held until Spotify agrees (or
  // for a few seconds, after which Spotify's word wins).
  const [want, setWant] = useState<(Expectation & { at: number }) | null>(null);
  useEffect(() => {
    const on = (e: Event) => setWant({ ...(e as CustomEvent<Expectation>).detail, at: Date.now() });
    window.addEventListener(KIOSK_EXPECT, on);
    return () => window.removeEventListener(KIOSK_EXPECT, on);
  }, []);
  const wantLive = want && now - want.at < 4000 ? want : null;
  const realTrack = pb?.track ?? null;
  const shownTrack =
    wantLive?.track && wantLive.track.uri !== realTrack?.uri ? { ...wantLive.track, explicit: false } : realTrack;
  const pendingTrack = shownTrack !== realTrack;
  const isPlaying =
    wantLive?.playing !== undefined && (pendingTrack || pb?.isPlaying !== wantLive.playing)
      ? wantLive.playing
      : Boolean(pb?.isPlaying);

  const track = shownTrack;
  // Freeze the bar the moment pause is tapped; restart it for a song being loaded.
  const until = pb?.isPlaying ? (isPlaying ? now : (wantLive?.at ?? now)) : pb?.at ?? now;
  const progress = pendingTrack
    ? 0
    : pb
      ? Math.min(pb.progressMs + Math.max(0, until - pb.at), track?.durationMs ?? 0)
      : 0;
  const pct = track?.durationMs ? (progress / track.durationMs) * 100 : 0;

  // Transport actions. If the target player has vanished (the classic case: this
  // tab reloaded, so its old browser player is gone), move playback to this tab's
  // new browser player and try once more.
  const act = async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    if (action === "play" || action === "fadeIn") expect({ playing: true });
    if (action === "pause") expect({ playing: false });
    try {
      await call("POST", "/api/player", { action, ...extra });
      return true;
    } catch (e) {
      const gone = /device not found|no active device/i.test((e as Error).message);
      if (!gone || !sdkDeviceId) {
        expect({}); // it didn't happen: show Spotify's real state again
        notify((e as Error).message);
        return false;
      }
      try {
        if (action === "startPlaylist") {
          await call("POST", "/api/player", { action, deviceId: sdkDeviceId });
        } else {
          await call("POST", "/api/player", { action: "transfer", deviceId: sdkDeviceId, browser: true, play: true });
          if (action !== "play") await call("POST", "/api/player", { action, ...extra });
        }
        notify("That player was gone — moved the music to this browser");
        return true;
      } catch (e2) {
        expect({});
        notify((e2 as Error).message);
        return false;
      }
    }
  };

  const playlistUri = state.settings?.playlistUri ?? null;
  // Prefer the live player; if nothing is active, this tab's browser player.
  const targetDevice = (pb?.device?.is_active ? pb.device.id : null) ?? sdkDeviceId ?? pb?.device?.id ?? undefined;

  const startPlaylist = () => {
    if (!playlistUri) {
      setPlaylistOpen(true);
      return;
    }
    act("startPlaylist", { deviceId: targetDevice });
  };

  // Picking a playlist makes it the backdrop and starts it right away.
  const choosePlaylist = async (uri: string, name: string) => {
    setPlaylistOpen(false);
    try {
      await call("POST", "/api/settings", { playlistUri: uri, playlistName: name });
      if (!targetDevice) {
        notify(`“${name}” is set — choose a player to start it`);
        setDevicesOpen(true);
        return;
      }
      if (await act("startPlaylist", { deviceId: targetDevice })) notify(`Playing “${name}”`);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <section className="card p-4">
      <div className="flex gap-4">
        <div className="art h-24 w-24 shrink-0 sm:h-28 sm:w-28">
          {track?.art ? <img src={track.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wider text-muted">
            {pendingTrack ? "Loading…" : pb ? (isPlaying ? "Now playing" : "Paused") : "Nothing playing"}
            {state.ducked && <span className="ml-2 text-accent">· ducked</span>}
            {state.fading && <span className="ml-2 text-accent">· fading…</span>}
          </div>
          <div className="truncate text-lg font-semibold">{track?.title ?? "—"}</div>
          <div className="truncate text-sm text-muted">{track?.subtitle ?? ""}</div>
          {state.nowPlayingItem && (
            <div className="mt-1 truncate text-xs text-accent">
              Requested{state.nowPlayingItem.requestedBy ? ` by ${state.nowPlayingItem.requestedBy}` : ""}
            </div>
          )}
          {!state.nowPlayingItem && pb?.contextUri && pb.contextUri === state.settings?.playlistUri && (
            <div className="mt-1 truncate text-xs text-muted">From {state.settings?.playlistName ?? "the playlist"}</div>
          )}
        </div>
      </div>

      {track && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
            <span>{fmtTime(progress)}</span>
            <span>-{fmtTime((track.durationMs ?? 0) - progress)}</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-center gap-2">
        <button className="btn-round" aria-label="Previous" onClick={() => act("previous")}>⏮</button>
        <button
          className="btn-round"
          aria-label="Fade in"
          title={`Fade in (${((state.settings?.musicFadeInMs ?? 3000) / 1000).toFixed(1)} s)`}
          disabled={state.fading}
          onClick={() => (pb?.track ? act("fadeIn") : startPlaylist())}
        >
          <FadeIcon dir="in" />
        </button>
        {isPlaying ? (
          <button className="btn-round btn-round-lg" aria-label="Pause" onClick={() => act("pause")}>⏸</button>
        ) : (
          <button
            className="btn-round btn-round-lg"
            aria-label="Play"
            onClick={() => (pb?.track ? act("play") : startPlaylist())}
          >
            ▶
          </button>
        )}
        <button
          className="btn-round"
          aria-label="Fade out"
          title={`Fade out (${((state.settings?.musicFadeOutMs ?? 5000) / 1000).toFixed(1)} s)`}
          disabled={!isPlaying || state.fading}
          onClick={() => act("fadeOut")}
        >
          <FadeIcon dir="out" />
        </button>
        <button className="btn-round" aria-label="Next" onClick={() => act("next")}>⏭</button>
      </div>

      <VolumeControls state={state} notify={notify} />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button
          className={`chip ${playlistOpen ? "chip-on" : ""} ${!playlistUri ? "border-accent text-accent" : ""}`}
          onClick={() => {
            setPlaylistOpen((o) => !o);
            setDevicesOpen(false);
          }}
        >
          🎵 {state.settings?.playlistName ?? "Choose a playlist"} ▾
        </button>
        <button
          className={`chip ${devicesOpen ? "chip-on" : ""}`}
          onClick={() => {
            setDevicesOpen((o) => !o);
            setPlaylistOpen(false);
          }}
        >
          🔈 {pb?.device?.name ?? "Choose a player"}
        </button>
        {playlistUri && (
          <button className="chip" onClick={startPlaylist} title="Start the playlist from the top">
            ↺ Restart
          </button>
        )}
        {pb && (
          <button className="chip" onClick={() => act("shuffle", { on: !pb.shuffle })}>
            🔀 Shuffle {pb.shuffle ? "on" : "off"}
          </button>
        )}
      </div>

      {playlistOpen && (
        <div className="mt-3 rounded-xl border border-line p-2">
          <div className="mb-2 px-1 text-xs uppercase tracking-wider text-muted">Play this playlist when Up Next is empty</div>
          <PlaylistPicker currentUri={playlistUri} notify={notify} onPick={choosePlaylist} />
        </div>
      )}

      {devicesOpen && (
        <DevicePicker
          sdkDeviceId={sdkDeviceId}
          currentId={pb?.device?.id ?? null}
          notify={notify}
          onPicked={() => setDevicesOpen(false)}
        />
      )}
    </section>
  );
}

function DevicePicker({
  sdkDeviceId,
  currentId,
  notify,
  onPicked,
}: {
  sdkDeviceId: string | null;
  currentId: string | null;
  notify: Notify;
  onPicked: () => void;
}) {
  const [devices, setDevices] = useState<SpDevice[] | null>(null);

  const load = () =>
    call<{ devices: SpDevice[] }>("GET", "/api/devices")
      .then((r) => setDevices(r.devices))
      .catch((e) => notify(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = [...(devices ?? [])];
  if (sdkDeviceId && !list.some((d) => d.id === sdkDeviceId))
    list.unshift({
      id: sdkDeviceId,
      name: "Music Kiosk (this browser)",
      type: "Computer",
      is_active: false,
      supports_volume: true,
      volume_percent: null,
    });

  // Any "Music Kiosk" player is a kiosk browser tab (this one or another) — remember
  // it as "browser" so a reload resumes on that tab's new player.
  const pick = (id: string, name: string) =>
    call("POST", "/api/player", {
      action: "transfer",
      deviceId: id,
      play: true,
      browser: id === sdkDeviceId || name.startsWith("Music Kiosk"),
    })
      .then(onPicked)
      .catch((e) => notify(e.message));

  return (
    <div className="mt-3 rounded-xl border border-line p-2">
      <div className="mb-1 flex items-center justify-between px-2 text-xs uppercase tracking-wider text-muted">
        Play music on
        <button className="text-accent normal-case tracking-normal" onClick={load}>Refresh</button>
      </div>
      {devices === null && <div className="p-2 text-sm text-muted">Looking for players…</div>}
      {devices !== null && list.length === 0 && (
        <div className="p-2 text-sm text-muted">
          No players found. Open the Spotify app on this device (or another) and hit Refresh.
        </div>
      )}
      {list.map((d) => (
        <button
          key={d.id ?? d.name}
          disabled={!d.id}
          onClick={() => d.id && pick(d.id, d.name)}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-line ${
            d.id === currentId ? "text-accent" : ""
          }`}
        >
          <span className="truncate">
            {d.id === sdkDeviceId ? "💻 " : ""}
            {d.name}
          </span>
          <span className="text-xs text-muted">{d.id === currentId ? "playing here" : d.type}</span>
        </button>
      ))}
    </div>
  );
}
