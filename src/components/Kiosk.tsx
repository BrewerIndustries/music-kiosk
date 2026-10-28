"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, KIOSK_CHANGED } from "@/lib/client";
import { playQueuedClip, setClipVolume, unlockAudio } from "@/lib/clipPlayer";
import { YouTubeStage } from "./YouTubeStage";
import { HealthLight } from "./HealthLight";
import { youtubeStatus } from "@/lib/youtubePlayer";
import { useSpotifyPlayer } from "./useSpotifyPlayer";
import { NowPlaying } from "./NowPlaying";
import { UpNext } from "./UpNext";
import { SearchPanel } from "./SearchPanel";
import { SoundsPanel } from "./SoundsPanel";
import { GuestsPanel } from "./GuestsPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { KioskState } from "./types";
import { SignIn } from "./Account";

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
  const [tab, setTabState] = useState<Tab>("search");
  const [started, setStarted] = useState(false);
  // After a reload: resume the music on this tab's new browser player once it's ready.
  const [pendingResume, setPendingResume] = useState(false);

  // Reopen the tab you were on.
  useEffect(() => {
    try {
      const t = localStorage.getItem("kiosk.tab") as Tab | null;
      if (t && TABS.some((x) => x.id === t)) setTabState(t);
    } catch {}
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem("kiosk.tab", t);
    } catch {}
  };
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

  // Poll the server snapshot (~1/s). Doubles as the audio-host heartbeat. After a
  // change, poll fast for a few seconds so the controls catch up right away.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let fastUntil = 0;
    let pokeServer = false;
    let inFlight = false;
    const id = clientId();
    const tick = async () => {
      clearTimeout(timer);
      if (inFlight) {
        timer = setTimeout(tick, 100);
        return;
      }
      inFlight = true;
      try {
        const claim = claimRef.current ? "&claim=1" : "";
        const poke = pokeServer ? "&poke=1" : "";
        // Where the YouTube song is, so a reload or deploy picks it back up there.
        const ytNow = youtubeStatus();
        const yt = ytNow.videoId && ytNow.positionMs > 0 ? `&yt=${ytNow.videoId}:${Math.round(ytNow.positionMs)}` : "";
        claimRef.current = false;
        pokeServer = false;
        const s = await call<KioskState>("GET", `/api/state?client=${id}${claim}${poke}${yt}`);
        if (alive) {
          setState(s);
          setOffline(false);
        }
      } catch {
        if (alive) setOffline(true);
      }
      inFlight = false;
      const ms = document.hidden ? 5000 : Date.now() < fastUntil ? 250 : 1000;
      if (alive) timer = setTimeout(tick, ms);
    };
    const onChange = (e: Event) => {
      fastUntil = Date.now() + 3000;
      if ((e as CustomEvent<{ fromPlayer?: boolean }>).detail?.fromPlayer) pokeServer = true;
      tick();
    };
    window.addEventListener(KIOSK_CHANGED, onChange);
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener(KIOSK_CHANGED, onChange);
    };
  }, []);

  // OAuth errors come back as ?spotify_error=…
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const err = q.get("spotify_error");
    const ytErr = q.get("youtube_error");
    if (err) notify(`Spotify: ${err}`);
    if (ytErr) notify(`YouTube: ${ytErr}`);
    if (q.get("youtube") === "connected") notify("YouTube connected");
    if (err || ytErr || q.has("youtube")) history.replaceState(null, "", "/");
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

  // Resume on this tab's player as soon as it reports ready. The SDK doesn't always
  // report it, so after a few seconds let the server find the kiosk player itself.
  useEffect(() => {
    if (!pendingResume) return;
    const go = (deviceId?: string) => {
      setPendingResume(false);
      call<{ resumed: boolean }>("POST", "/api/player", { action: "resumeOn", deviceId })
        .then((r) => notify(r.resumed ? "Picked the music back up" : "Couldn’t find the player — press ▶ or pick one"))
        .catch((e) => notify(e.message));
    };
    if (sdk.deviceId) return go(sdk.deviceId);
    const t = setTimeout(() => go(), 6000);
    return () => clearTimeout(t);
  }, [pendingResume, sdk.deviceId, notify]);

  // Remember this tab's browser player, so after a reload we can recognise the
  // player that went quiet as our own (now dead) one.
  const [prevSdkDevice] = useState(() => {
    try {
      return localStorage.getItem("kiosk.sdkDevice");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!sdk.deviceId) return;
    try {
      localStorage.setItem("kiosk.sdkDevice", sdk.deviceId);
    } catch {}
  }, [sdk.deviceId]);

  // The music died with this page (or a previous load of it): resume without asking.
  // A "Music Kiosk" player is always a kiosk browser tab.
  const offer = state?.resumeOffer;
  const ourPlayerDied = Boolean(
    offer &&
      (!offer.deviceId ||
        offer.deviceId === prevSdkDevice ||
        offer.pref === "browser" ||
        offer.deviceName?.startsWith("Music Kiosk")),
  );

  // Resume where the music left off: on this browser's player when that's what
  // was playing, otherwise ask for a player.
  const resume = () => {
    sdk.activate();
    if (ourPlayerDied && sdk.supported) setPendingResume(true);
    else notify("The music stopped — choose a player to continue");
  };

  const start = () => {
    unlockAudio();
    sdk.activate();
    claimRef.current = true;
    setStarted(true);
    // A fresh page has no clips playing, so any duck/pause hold is a leftover.
    if (state?.holdActive) call("POST", "/api/player", { action: "releaseHolds" }).catch(() => {});
    if (ourPlayerDied) resume();
  };

  if (!state) return <Splash>{offline ? "Can’t reach the kiosk server…" : "Loading…"}</Splash>;
  if (state.locked) return <SignIn />;
  if (!state.spotify?.configured) return <SetupNeeded />;
  if (!connected)
    return (
      <Splash>
        <div className="text-5xl">🎄</div>
        <h1 className="festive mt-4 text-3xl">Music Kiosk</h1>
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
      {tab === "sounds" && <SoundsPanel state={state} notify={notify} />}
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
      {started && state.resumeOffer && !pendingResume && (
        <div className="flex items-center justify-center gap-3 bg-accent/20 px-4 py-2 text-sm">
          The music stopped.
          <button className="btn btn-primary" onClick={resume}>
            ▶ Resume
          </button>
        </div>
      )}
      {pendingResume && (
        <div className="bg-accent/20 px-4 py-2 text-center text-sm">Starting the player… picking up where we left off</div>
      )}
      {(offline || state.error) && (
        <div className="bg-red-900/60 px-4 py-1.5 text-center text-xs">
          {offline ? "Lost connection to the kiosk server — retrying…" : `Spotify: ${state.error}`}
        </div>
      )}

      <header className="flex items-center justify-between px-4 pt-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="festive text-2xl">🎄 Music Kiosk 🎅</div>
          <HealthLight state={state} offline={offline} sdk={sdk} />
        </div>
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
          <YouTubeStage state={state} notify={notify} />
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
          <div className="text-6xl">🎄</div>
          <div className="festive mt-4 text-3xl">
            {ourPlayerDied ? "Tap to resume the music" : "Tap to start the kiosk"}
          </div>
          <div className="mt-2 max-w-xs text-sm text-muted">
            {ourPlayerDied
              ? "Picks up the song where it left off. Up Next and your settings are all still here."
              : "Lets this screen play sounds and music."}
          </div>
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

