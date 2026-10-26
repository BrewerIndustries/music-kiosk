"use client";
import { useEffect, useState } from "react";
import { call, fmtTime } from "@/lib/client";
import { PlaylistPicker } from "./PlaylistPicker";
import { VolumeControls } from "./VolumeControls";
import type { KioskState, Notify, SpDevice } from "./types";

type Props = {
  state: KioskState;
  notify: Notify;
  sdkDeviceId: string | null;
};

export function NowPlaying({ state, notify, sdkDeviceId }: Props) {
  const pb = state.playback;
  const track = pb?.track;
  const [now, setNow] = useState(() => Date.now());
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const progress = pb ? Math.min(pb.progressMs + (pb.isPlaying ? now - pb.at : 0), track?.durationMs ?? 0) : 0;
  const pct = track?.durationMs ? (progress / track.durationMs) * 100 : 0;

  const act = (action: string, extra: Record<string, unknown> = {}) =>
    call("POST", "/api/player", { action, ...extra }).catch((e) => notify(e.message));

  const playlistUri = state.settings?.playlistUri ?? null;
  const targetDevice = pb?.device?.id ?? sdkDeviceId ?? undefined;

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
      await call("POST", "/api/player", { action: "startPlaylist", deviceId: targetDevice });
      notify(`Playing “${name}”`);
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
            {pb ? (pb.isPlaying ? "Now playing" : "Paused") : "Nothing playing"}
            {state.ducked && <span className="ml-2 text-accent">· ducked</span>}
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
        {pb?.isPlaying ? (
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

  const pick = (id: string) =>
    call("POST", "/api/player", { action: "transfer", deviceId: id, play: true })
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
          onClick={() => d.id && pick(d.id)}
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
