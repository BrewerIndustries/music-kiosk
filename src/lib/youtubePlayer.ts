"use client";
// Plays Up Next YouTube songs in the kiosk tab through YouTube's IFrame Player API
// (the only sanctioned way to play YouTube: a visible embedded player, ≥200×200 —
// no hidden or audio-only playback). The engine pauses Spotify first and waits for
// us to report the song done, exactly like a queued sound clip.
//
// Volume follows the kiosk's music volume. Instant sound clips hold it the same way
// they hold Spotify (pause, or duck to *duck %*) — clipPlayer asks youtubeHold().

type YTPlayer = {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(v: number): void;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId?: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: Record<string, (e: { data: number; target: YTPlayer }) => void>;
    },
  ) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
const AUTOPLAY_CHECK_MS = 3000;

export type YtStatus = {
  videoId: string | null;
  playing: boolean;
  needsTap: boolean; // the browser blocked autoplay: a tap starts it
  positionMs: number;
  durationMs: number;
};

let api: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  api ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return api;
}

let host: HTMLElement | null = null;
let player: YTPlayer | null = null;
let ready: Promise<YTPlayer> | null = null;
let current: { videoId: string; done: () => void } | null = null;
let status: YtStatus = { videoId: null, playing: false, needsTap: false, positionMs: 0, durationMs: 0 };
let baseVolume = 70;
let held: "pause" | "duck" | null = null;
let holders = 0;
let duckPercent = 30;
let autoplayTimer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit(patch: Partial<YtStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}
export const subscribeYouTube = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const youtubeStatus = () => status;

const applyVolume = () => player?.setVolume(held === "duck" ? Math.round((baseVolume * duckPercent) / 100) : baseVolume);

export function setYouTubeVolume(percent: number, duck?: number) {
  baseVolume = Math.max(0, Math.min(100, Math.round(percent)));
  if (duck != null) duckPercent = duck;
  applyVolume();
}

// The stage component hands us its (visible) container once it mounts.
export function attachYouTubeHost(el: HTMLElement | null) {
  host = el;
}

function finish() {
  const c = current;
  current = null;
  if (autoplayTimer) clearTimeout(autoplayTimer);
  if (ticker) clearInterval(ticker);
  ticker = null;
  held = null;
  holders = 0;
  try {
    player?.stopVideo();
  } catch {}
  emit({ videoId: null, playing: false, needsTap: false, positionMs: 0, durationMs: 0 });
  c?.done();
}

function onState(state: number) {
  if (!current) return;
  if (state === S.ENDED) return finish();
  const playing = state === S.PLAYING;
  if (playing && autoplayTimer) {
    clearTimeout(autoplayTimer);
    autoplayTimer = null;
  }
  emit({ playing, needsTap: playing ? false : status.needsTap, durationMs: (player?.getDuration() ?? 0) * 1000 });
}

function getPlayer(videoId: string): Promise<YTPlayer> {
  if (ready) return ready;
  ready = loadApi().then(
    (YT) =>
      new Promise<YTPlayer>((resolve) => {
        const el = document.createElement("div");
        host?.appendChild(el);
        new YT.Player(el, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: (e) => {
              player = e.target;
              applyVolume();
              resolve(e.target);
            },
            onStateChange: (e) => onState(e.data),
            // 2/5/100/101/150: bad id, can't play in HTML5, removed, embedding refused.
            onError: () => finish(),
          },
        });
      }),
  );
  return ready;
}

// Play one song; resolves when it ends, errors, or is skipped.
export function playYouTube(videoId: string): Promise<void> {
  if (current) finish();
  return new Promise((resolve) => {
    current = { videoId, done: resolve };
    emit({ videoId, playing: false, needsTap: false, positionMs: 0, durationMs: 0 });
    const fresh = !ready;
    getPlayer(videoId).then((p) => {
      if (current?.videoId !== videoId) return;
      applyVolume();
      if (!fresh) p.loadVideoById(videoId);
      else p.playVideo();
      // Autoplay with sound can be refused (iOS, or a tab never tapped): ask for a tap.
      autoplayTimer = setTimeout(() => {
        if (current?.videoId === videoId && p.getPlayerState() !== S.PLAYING) emit({ needsTap: true });
      }, AUTOPLAY_CHECK_MS);
      ticker ??= setInterval(() => {
        if (player && current) emit({ positionMs: player.getCurrentTime() * 1000 });
      }, 1000);
    });
  });
}

// Jump to a point in the song (from the progress bar).
export function seekYouTube(ms: number) {
  if (!player || !current) return;
  player.seekTo(Math.max(0, ms) / 1000, true);
  emit({ positionMs: Math.max(0, ms) });
}

export function tapToPlay() {
  player?.playVideo();
}
export function toggleYouTube() {
  if (!player || !current) return;
  if (status.playing) player.pauseVideo();
  else player.playVideo();
}
export const skipYouTube = () => current && finish();

// For clipPlayer: hold the YouTube song while an instant clip plays, if one is
// playing here. Returns null when there's nothing to hold (the clip then holds
// Spotify as usual).
export function youtubeHold(mode: "pause" | "duck"): { release: () => Promise<void> } | null {
  if (!player || !current || (!status.playing && !held)) return null;
  holders++;
  if (!held) {
    held = mode;
    if (mode === "pause") player.pauseVideo();
    else applyVolume();
  }
  return {
    release: async () => {
      if (--holders > 0 || !held) return;
      const was = held;
      held = null;
      if (!player || !current) return;
      if (was === "pause") player.playVideo();
      else applyVolume();
    },
  };
}
