"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/client";
import { playQueuedClip, setClipVolume, unlockAudio } from "@/lib/clipPlayer";
import { useSpotifyPlayer } from "./useSpotifyPlayer";
import { NowPlaying } from "./NowPlaying";
import { UpNext } from "./UpNext";
import { SearchPanel } from "./SearchPanel";
import { SoundsPanel } from "./SoundsPanel";
import { GuestsPanel } from "./GuestsPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { KioskState } from "./types";

type Tab = "queue" | "search" | "sounds" | "guests" | "settings";

const TABS: { id: Tab; label: string; icon: string; mobileOnly?: boolean }[] = [
  { id: "queue", label: "Up Next", icon: "☰", mobileOnly: true },
  { id: "search", label: "Search", icon: "⌕" },
  { id: "sounds", label: "Sounds", icon: "🔊" },
  { id: "guests", label: "Guests", icon: "▦" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

function clientId() {
  try {
    let id = sessionStorage.getItem("kiosk.client");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("kiosk.client", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export function Kiosk({ envLabel }: { envLabel: string | null }) {
  const [state, setState] = useState<KioskState | null>(null);
  const [tab, setTab] = useState<Tab>("search");
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const claimRef = useRef(false);
  const playedClips = useRef(new Set<string>());

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  const connected = Boolean(state?.spotify?.connected);
  const sdk = useSpotifyPlayer(connected && !state?.locked);

  // Poll the server snapshot (~1/s). Doubles as the audio-host heartbeat.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = clientId();
    const tick = async () => {
      try {
        const claim = claimRef.current ? "&claim=1" : "";
        claimRef.current = false;
        const s = await call<KioskState>("GET", `/api/state?client=${id}${claim}`);
        if (alive) {
          setState(s);
          setOffline(false);
        }
      } catch {
        if (alive) setOffline(true);
      }
      if (alive) timer = setTimeout(tick, document.hidden ? 5000 : 1000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // OAuth errors come back as ?spotify_error=…
  useEffect(() => {
    const err = new URLSearchParams(location.search).get("spotify_error");
    if (err) {
      notify(`Spotify: ${err}`);
      history.replaceState(null, "", "/");
    }
  }, [notify]);

  const clipVolume = state?.settings?.clipVolume;
  useEffect(() => {
    if (clipVolume != null) setClipVolume(clipVolume);
  }, [clipVolume]);

  // Queued clip handed to this tab by the engine: play it, then report back.
  const clip = state?.clip;
  useEffect(() => {
    if (!clip?.clipKey || playedClips.current.has(clip.id)) return;
    playedClips.current.add(clip.id);
    playQueuedClip(clip.clipKey).finally(() =>
      call("POST", "/api/clip-done", { id: clip.id }).catch((e) => notify(e.message)),
    );
  }, [clip, notify]);

  const start = () => {
    unlockAudio();
    sdk.activate();
    claimRef.current = true;
    setStarted(true);
  };

  if (!state) return <Splash>{offline ? "Can’t reach the kiosk server…" : "Loading…"}</Splash>;
  if (state.locked) return <PinPad />;
  if (!state.spotify?.configured) return <SetupNeeded />;
  if (!connected)
    return (
      <Splash>
        <div className="text-5xl">🎶</div>
        <h1 className="mt-4 text-2xl font-semibold">Music Kiosk</h1>
        <p className="mt-2 max-w-sm text-muted">Connect the Spotify Premium account that will play the music.</p>
        <a href="/api/spotify/login" className="btn btn-primary mt-6 px-6 py-3 text-base">Connect Spotify</a>
      </Splash>
    );

  const main = (
    <>
      {tab === "queue" && (
        <div className="lg:hidden">
          <UpNext state={state} notify={notify} />
        </div>
      )}
      {(tab === "search" || tab === "queue") && (
        <div className={tab === "queue" ? "hidden lg:block" : ""}>
          <SearchPanel state={state} notify={notify} />
        </div>
      )}
      {tab === "sounds" && <SoundsPanel notify={notify} />}
      {tab === "guests" && <GuestsPanel state={state} notify={notify} />}
      {tab === "settings" && (
        <SettingsPanel
          state={state}
          notify={notify}
          sdk={sdk}
          onClaimAudio={() => {
            claimRef.current = true;
            notify("Queued clips will play on this device");
          }}
        />
      )}
    </>
  );

  const queueCount = state.upNext?.length ?? 0;
  const pendingCount = state.pending?.length ?? 0;

  return (
    <div className="flex min-h-dvh flex-col">
      {envLabel && <div className="env-banner">{envLabel}</div>}
      {(offline || state.error) && (
        <div className="bg-red-900/60 px-4 py-1.5 text-center text-xs">
          {offline ? "Lost connection to the kiosk server — retrying…" : `Spotify: ${state.error}`}
        </div>
      )}

      <header className="flex items-center justify-between px-4 pt-4 sm:px-6">
        <div className="text-lg font-semibold tracking-tight">🎶 Music Kiosk</div>
        <nav className="hidden gap-1 sm:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab ${t.mobileOnly ? "lg:hidden" : ""} ${tab === t.id ? "tab-on" : ""}`}
            >
              {t.label}
              {t.id === "queue" && queueCount > 0 && <span className="badge">{queueCount}</span>}
              {t.id === "guests" && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 pb-24 pt-4 sm:px-6 sm:pb-8 lg:grid-cols-[minmax(340px,420px)_1fr]">
        <div className="space-y-4">
          <NowPlaying state={state} notify={notify} sdkDeviceId={sdk.deviceId} />
          <div className="hidden lg:block">
            <UpNext state={state} notify={notify} />
          </div>
        </div>
        <div className="min-w-0 space-y-4">{main}</div>
      </main>

      {/* Phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${
              tab === t.id ? "text-accent" : "text-muted"
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
            {t.id === "queue" && queueCount > 0 && <span className="badge absolute right-3 top-1">{queueCount}</span>}
            {t.id === "guests" && pendingCount > 0 && (
              <span className="badge absolute right-3 top-1">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      {!started && (
        <button
          onClick={start}
          className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-bg/90 backdrop-blur"
        >
          <div className="text-6xl">🎶</div>
          <div className="mt-4 text-2xl font-semibold">Tap to start the kiosk</div>
          <div className="mt-2 max-w-xs text-sm text-muted">Lets this screen play sounds and music.</div>
        </button>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 sm:bottom-6">
          <div className="rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}

function SetupNeeded() {
  return (
    <Splash>
      <div className="text-5xl">🛠️</div>
      <h1 className="mt-4 text-2xl font-semibold">Spotify app not configured</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        Set <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code> in <code>.env.local</code> (from
        your app at developer.spotify.com), then restart the server. The app&apos;s redirect URI must match{" "}
        <code>SPOTIFY_REDIRECT_URI</code> (default <code>http://127.0.0.1:3000/api/spotify/callback</code>).
      </p>
    </Splash>
  );
}

function PinPad() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const submit = (p: string) =>
    call("POST", "/api/unlock", { pin: p })
      .then(() => location.reload())
      .catch(() => {
        setError(true);
        setPin("");
      });
  const press = (d: string) => {
    setError(false);
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };
  return (
    <Splash>
      <div className="text-4xl">🔒</div>
      <h1 className="mt-3 text-xl font-semibold">Enter kiosk PIN</h1>
      <div className={`mt-4 h-8 font-mono text-2xl tracking-[0.5em] ${error ? "text-red-400" : ""}`}>
        {pin.replace(/./g, "•") || (error ? "wrong" : "")}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
          <button
            key={k}
            className="btn-round btn-round-lg text-xl"
            onClick={() => (k === "⌫" ? setPin(pin.slice(0, -1)) : k === "OK" ? submit(pin) : press(k))}
          >
            {k}
          </button>
        ))}
      </div>
    </Splash>
  );
}
