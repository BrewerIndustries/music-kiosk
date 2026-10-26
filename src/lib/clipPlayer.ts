// Soundboard clip playback in the kiosk browser.
//
// Each pad is one controllable instance (play/pause, stop, fade in, fade out),
// routed through Web Audio: a per-clip gain node (for fades) into a master gain
// (the Sounds volume). Web Audio also makes volume + fades work on iOS, which
// ignores HTMLMediaElement.volume.
//
// While a clip is live it holds the music in one of two modes, released when the
// clip is stopped or ends (pausing a clip keeps the hold):
//   pause — pause Spotify, resume the song where it stopped
//   duck  — lower Spotify (volume API → iOS audio-session "transient" → fall back
//           to pause), restore it afterwards
//   over  — leave the music alone (Play over with "Lower the music" off)
import { call } from "./client";

export type ClipMode = "pause" | "duck" | "over"; // over = play over the music untouched
export type ClipStatus = "stopped" | "playing" | "paused" | "fading-in" | "fading-out";

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

export const clipUrl = (key: string) => `/api/soundboard/audio/${encodeURIComponent(key)}`;

// ---- Audio graph -------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let clipVolume = 1;

function graph(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = clipVolume;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return { ctx, master: master! };
}

// A volume control for one element: a Web Audio gain node, or element.volume
// (stepped by a timer) when Web Audio isn't available.
type Fader = { value(): number; set(v: number): void; ramp(to: number, ms: number): void };

function fader(audio: HTMLAudioElement): Fader {
  const gr = graph();
  if (gr) {
    const g = gr.ctx.createGain();
    gr.ctx.createMediaElementSource(audio).connect(g).connect(gr.master);
    const c = gr.ctx;
    return {
      value: () => g.gain.value,
      set: (v) => {
        g.gain.cancelScheduledValues(c.currentTime);
        g.gain.setValueAtTime(v, c.currentTime);
      },
      ramp: (to, ms) => {
        const now = c.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(to, now + Math.max(ms, 10) / 1000);
      },
    };
  }
  let level = 1;
  let timer: ReturnType<typeof setInterval> | null = null;
  const apply = () => (audio.volume = Math.max(0, Math.min(1, level * clipVolume)));
  return {
    value: () => level,
    set: (v) => {
      if (timer) clearInterval(timer);
      level = v;
      apply();
    },
    ramp: (to, ms) => {
      if (timer) clearInterval(timer);
      const from = level;
      const start = Date.now();
      timer = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / Math.max(ms, 10));
        level = from + (to - from) * t;
        apply();
        if (t >= 1 && timer) clearInterval(timer);
      }, 30);
    },
  };
}

// Soundboard volume (0–100) — the master gain over every clip.
export function setClipVolume(percent: number) {
  clipVolume = Math.max(0, Math.min(1, percent / 100));
  if (master && ctx) master.gain.setTargetAtTime(clipVolume, ctx.currentTime, 0.05);
}

// ---- Holding the music while a clip is live ---------------------------------

type Hold = { release: () => Promise<void>; note: string | null };

async function acquireHold(mode: ClipMode): Promise<Hold> {
  if (mode === "over") return { note: null, release: async () => {} };
  if (mode === "duck") {
    const { method } = await call<{ method: string }>("POST", "/api/player", { action: "duck" }).catch(() => ({
      method: "unsupported",
    }));
    if (method === "volume")
      return {
        note: null,
        // Always bring the music back; retry once, then fall back to a hard restore.
        release: () =>
          call("POST", "/api/player", { action: "unduck" })
            .catch(() => call("POST", "/api/player", { action: "unduck" }))
            .catch(() => call("POST", "/api/player", { action: "restoreVolume" }))
            .then(() => {})
            .catch(() => {}),
      };
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) {
      const prev = nav.audioSession.type;
      nav.audioSession.type = "transient";
      return {
        note: null,
        release: async () => {
          if (nav.audioSession) nav.audioSession.type = prev || "auto";
        },
      };
    }
    const hold = await acquireHold("pause");
    return { ...hold, note: "This player can't lower its volume — paused the music instead." };
  }
  const { paused } = await call<{ paused: boolean }>("POST", "/api/player", { action: "instantPause" }).catch(() => ({
    paused: false,
  }));
  return {
    note: null,
    release: async () => {
      if (paused) await call("POST", "/api/player", { action: "instantResume" }).catch(() => {});
    },
  };
}

// ---- Clip instances ------------------------------------------------------------

type Handle = {
  audio: HTMLAudioElement;
  fader: Fader;
  status: Exclude<ClipStatus, "stopped">;
  hold: Promise<Hold>;
  timer: ReturnType<typeof setTimeout> | null;
};

const handles = new Map<string, Handle>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

// For useSyncExternalStore in the UI.
export function subscribeClips(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const clipsVersion = () => version;
export const clipStatus = (id: string): ClipStatus => handles.get(id)?.status ?? "stopped";
export const activeClipCount = () => handles.size;

function setStatus(id: string, h: Handle, status: Handle["status"], afterMs?: number, then?: () => void) {
  if (h.timer) clearTimeout(h.timer);
  h.timer = null;
  h.status = status;
  if (afterMs !== undefined)
    h.timer = setTimeout(() => {
      if (handles.get(id) === h) then?.();
    }, afterMs);
  emit();
}

// play() rejects with AbortError when pause() lands before playback starts (e.g.
// a quick play → pause). That's not a failure — the clip is just paused.
const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

function finish(id: string) {
  const h = handles.get(id);
  if (!h) return;
  handles.delete(id);
  if (h.timer) clearTimeout(h.timer);
  h.audio.pause();
  emit();
  h.hold.then((hold) => hold.release());
}

// Start a clip (or restart it from the top if it's already live). Returns a note
// for the UI when the mode had to change. Call from a tap so it's allowed to play.
export async function startClip(
  id: string,
  key: string,
  mode: ClipMode,
  fadeInMs = 0,
): Promise<string | null> {
  const existing = handles.get(id);
  if (existing) {
    existing.audio.currentTime = 0;
    if (fadeInMs > 0) existing.fader.set(0); // a faded restart rises from silence
    resumeClip(id, fadeInMs);
    return null;
  }
  const audio = new Audio(clipUrl(key));
  audio.preload = "auto";
  const f = fader(audio);
  f.set(fadeInMs > 0 ? 0 : 1);
  // Start the clip right away (inside the tap); the music hold follows a moment later.
  const h: Handle = { audio, fader: f, status: "playing", hold: acquireHold(mode), timer: null };
  handles.set(id, h);
  audio.addEventListener("ended", () => handles.get(id) === h && finish(id));
  audio.addEventListener("error", () => handles.get(id) === h && finish(id));
  audio.play().catch((e) => handles.get(id) === h && !isAbort(e) && finish(id));
  if (fadeInMs > 0) {
    f.ramp(1, fadeInMs);
    setStatus(id, h, "fading-in", fadeInMs, () => setStatus(id, h, "playing"));
  } else emit();
  return (await h.hold).note;
}

export function pauseClip(id: string) {
  const h = handles.get(id);
  if (!h || h.status === "paused") return;
  h.audio.pause();
  setStatus(id, h, "paused");
}

export function resumeClip(id: string, fadeInMs = 0) {
  const h = handles.get(id);
  if (!h) return;
  if (fadeInMs > 0) {
    if (h.status === "paused") h.fader.set(0);
    h.fader.ramp(1, fadeInMs);
    setStatus(id, h, "fading-in", fadeInMs, () => setStatus(id, h, "playing"));
  } else {
    h.fader.set(1);
    setStatus(id, h, "playing");
  }
  h.audio.play().catch((e) => !isAbort(e) && finish(id));
}

export function stopClip(id: string) {
  finish(id);
}

// Fade in: start silent and rise; resume a paused clip with a fade; or pull a
// fading-out clip back up.
export function fadeInClip(id: string, key: string, mode: ClipMode, ms: number): Promise<string | null> | void {
  if (!handles.has(id)) return startClip(id, key, mode, ms);
  resumeClip(id, ms);
}

// Fade out, then stop (which releases the music).
export function fadeOutClip(id: string, ms: number) {
  const h = handles.get(id);
  if (!h) return;
  if (h.status === "paused") return finish(id);
  h.fader.ramp(0, ms);
  setStatus(id, h, "fading-out", ms, () => finish(id));
}

export function stopAllClips() {
  for (const id of [...handles.keys()]) finish(id);
}

// ---- Queued clips (played by the engine's audio host) ---------------------------

// Queued clips start without a user gesture, so they use one long-lived element
// unlocked by the "start kiosk" tap.
let hostAudio: HTMLAudioElement | null = null;

export function unlockAudio() {
  graph(); // create/resume the AudioContext inside the gesture
  if (!hostAudio) {
    hostAudio = new Audio();
    fader(hostAudio); // route through the master gain (Sounds volume)
  }
  // A tiny silent WAV: playing anything inside a gesture unlocks the element on iOS.
  hostAudio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  hostAudio.play().catch(() => {});
}

export function playQueuedClip(key: string): Promise<void> {
  if (!hostAudio) {
    hostAudio = new Audio();
    fader(hostAudio);
  }
  const audio = hostAudio;
  audio.src = clipUrl(key);
  return new Promise((resolve) => {
    const done = () => {
      audio.removeEventListener("ended", done);
      audio.removeEventListener("error", done);
      resolve();
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    audio.play().catch(done);
  });
}
