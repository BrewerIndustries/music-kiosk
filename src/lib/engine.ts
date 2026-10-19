// Queue engine runtime: one polling loop per server process. It watches Spotify
// playback, asks engine-core's decide() what to do, and does it. The kiosk UI reads
// the cached snapshot from here instead of hitting Spotify itself.
import { api, getPlayback, isConnected, summarize, SpotifyError, type SpPlayback } from "./spotify";
import { decide, initialMemory, type Memory } from "./engine-core";
import { getItem, head, moveToFront, setStatus, type QueueItem } from "./queue";

const CLIP_TIMEOUT_MS = 5 * 60_000; // give up on a queued clip the browser never finished
const HOST_STALE_MS = 10_000; // a kiosk tab that hasn't polled in this long can't play clips

type EngineState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  memory: Memory;
  playback: SpPlayback | null;
  playbackAt: number;
  error: string | null;
  // The kiosk browser tab that plays clips (latest to claim it, kept alive by polling).
  audioHost: { id: string; seenAt: number } | null;
  duck: { previousVolume: number; holders: number } | null;
  pausedForInstant: { holders: number } | null;
};

const g = globalThis as unknown as { _kioskEngine?: EngineState };

function state(): EngineState {
  g._kioskEngine ??= {
    started: false,
    timer: null,
    memory: initialMemory(),
    playback: null,
    playbackAt: 0,
    error: null,
    audioHost: null,
    duck: null,
    pausedForInstant: null,
  };
  return g._kioskEngine;
}

export function ensureEngine() {
  const s = state();
  if (s.started) return;
  s.started = true;
  schedule(0);
}

// Run a tick now (after a user action) instead of waiting for the next poll.
export function poke() {
  schedule(50);
}

function schedule(ms: number) {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(tick, ms);
}

async function tick() {
  const s = state();
  let delay = 5000;
  try {
    if (!isConnected()) {
      s.playback = null;
      s.error = null;
    } else {
      s.playback = await getPlayback();
      s.playbackAt = Date.now();
      s.error = null;

      const pb = s.playback;
      const h = head();
      const decision = decide(
        pb?.item
          ? {
              isPlaying: pb.is_playing,
              uri: pb.item.uri,
              progressMs: pb.progress_ms ?? 0,
              durationMs: pb.item.duration_ms,
            }
          : null,
        h ? { id: h.id, kind: h.kind, uri: h.uri } : null,
        s.memory,
      );
      s.memory = decision.memory;
      delay = decision.delayMs;

      for (const a of decision.actions) {
        if (a.type === "enqueue") {
          await api("POST", "/me/player/queue", undefined, { uri: a.uri });
          setStatus(a.id, "handed_off");
        } else if (a.type === "started" || a.type === "lost") {
          setStatus(a.id, "played");
        } else if (a.type === "pauseForClip") {
          await api("PUT", "/me/player/pause");
          setStatus(a.id, "handed_off");
          if (!hostAlive()) await finishClip(a.id); // nobody to play it: skip it
        }
      }

      if (s.memory.clip && Date.now() - s.memory.clip.startedAt > CLIP_TIMEOUT_MS) await finishClip(s.memory.clip.id);
    }
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e);
    delay = e instanceof SpotifyError && e.status === 429 ? 10_000 : 3000;
  }
  schedule(delay);
}

function hostAlive(): boolean {
  const h = state().audioHost;
  return Boolean(h && Date.now() - h.seenAt < HOST_STALE_MS);
}

// Called by every kiosk tab's state poll. `claim` forces this tab to become the
// clip player; otherwise it takes over only when the current host has gone quiet.
export function heartbeat(clientId: string | null, claim = false): boolean {
  const s = state();
  if (!clientId) return false;
  if (claim || !hostAlive() || s.audioHost?.id === clientId) s.audioHost = { id: clientId, seenAt: Date.now() };
  return s.audioHost?.id === clientId;
}

// The queued clip the audio host should be playing right now, if any.
export function activeClip(): QueueItem | null {
  const c = state().memory.clip;
  return c ? getItem(c.id) : null;
}

// The browser finished (or skipped) a queued clip: move on to the next thing.
export async function finishClip(id: string) {
  const s = state();
  if (s.memory.clip?.id !== id) return;
  setStatus(id, "played");
  s.memory = { ...s.memory, clip: null };
  // If a track is next in Up Next, hand it off before skipping so it plays now;
  // otherwise skipping resumes the playlist.
  const h = head();
  if (h?.kind === "track" && h.uri) {
    await api("POST", "/me/player/queue", undefined, { uri: h.uri });
    setStatus(h.id, "handed_off");
    s.memory = { ...s.memory, handoff: { id: h.id, uri: h.uri, trackChanges: 0 } };
  }
  await api("POST", "/me/player/next");
  await api("PUT", "/me/player/play").catch(() => {}); // some devices stay paused after next
  poke();
}

// Admin "Play now": jump this Up Next item to the front and start it immediately.
export async function playNow(id: string) {
  const s = state();
  const item = getItem(id);
  if (!item || item.status !== "queued") return;
  moveToFront(id);
  if (item.kind === "clip") {
    await api("PUT", "/me/player/pause").catch(() => {});
    setStatus(id, "handed_off");
    s.memory = { ...s.memory, clip: { id, startedAt: Date.now() } };
    if (!hostAlive()) await finishClip(id);
    return;
  }
  // A track already handed off would play first; skip past it and re-queue it.
  const skips = s.memory.handoff ? 2 : 1;
  if (s.memory.handoff) {
    setStatus(s.memory.handoff.id, "queued");
    s.memory = { ...s.memory, handoff: null };
  }
  await api("POST", "/me/player/queue", undefined, { uri: item.uri! });
  setStatus(id, "handed_off");
  s.memory = { ...s.memory, handoff: { id, uri: item.uri!, trackChanges: 0 } };
  for (let i = 0; i < skips; i++) await api("POST", "/me/player/next");
  poke();
}

// ---- Instant clips (fired from a pad, not queued) --------------------------

// Pause & play: pause Spotify while any instant clip plays, resume after the last.
export async function instantPause() {
  const s = state();
  if (s.pausedForInstant) {
    s.pausedForInstant.holders++;
    return { paused: true };
  }
  if (!s.playback?.is_playing) return { paused: false };
  await api("PUT", "/me/player/pause");
  s.pausedForInstant = { holders: 1 };
  return { paused: true };
}

export async function instantResume() {
  const s = state();
  if (!s.pausedForInstant) return;
  if (--s.pausedForInstant.holders > 0) return;
  s.pausedForInstant = null;
  await api("PUT", "/me/player/play").catch(() => {});
  poke();
}

// Duck: lower Spotify's volume if the device allows it. Returns "volume" when
// ducked via the API, or "unsupported" so the browser can try iOS audio-session
// ducking or fall back to pausing.
export async function duck(percent: number): Promise<"volume" | "unsupported"> {
  const s = state();
  if (s.duck) {
    s.duck.holders++;
    return "volume";
  }
  const dev = s.playback?.device;
  if (!dev?.supports_volume || dev.volume_percent == null) return "unsupported";
  await api("PUT", "/me/player/volume", undefined, { volume_percent: String(Math.round(percent)) });
  s.duck = { previousVolume: dev.volume_percent, holders: 1 };
  return "volume";
}

export async function unduck() {
  const s = state();
  if (!s.duck) return;
  if (--s.duck.holders > 0) return;
  const vol = s.duck.previousVolume;
  s.duck = null;
  await api("PUT", "/me/player/volume", undefined, { volume_percent: String(vol) }).catch(() => {});
}

// Snapshot for the UI.
export function snapshot() {
  const s = state();
  const pb = s.playback;
  return {
    error: s.error,
    playback: pb
      ? {
          isPlaying: pb.is_playing,
          progressMs: pb.progress_ms ?? 0,
          at: s.playbackAt,
          track: pb.item ? summarize(pb.item) : null,
          device: pb.device,
          contextUri: pb.context?.uri ?? null,
          shuffle: pb.shuffle_state,
        }
      : null,
    nowPlayingItem: s.memory.nowPlayingId ? getItem(s.memory.nowPlayingId) : null,
    ducked: Boolean(s.duck),
  };
}
