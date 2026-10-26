// Queue engine runtime: one polling loop per server process. It watches Spotify
// playback, asks engine-core's decide() what to do, and does it. The kiosk UI reads
// the cached snapshot from here instead of hitting Spotify itself.
import { api, getPlayback, isConnected, summarize, SpotifyError, type SpPlayback, type SpTrack, type TrackSummary } from "./spotify";
import { decide, initialMemory, type Memory } from "./engine-core";
import { logError, recentErrors } from "./log";
import { getSettings, updateSettings } from "./settings";
import { getItem, head, moveToFront, setStatus, type QueueItem } from "./queue";

const CLIP_TIMEOUT_MS = 5 * 60_000; // give up on a queued clip the browser never finished
const HOST_STALE_MS = 10_000; // a kiosk tab that hasn't polled in this long can't play clips
const UPCOMING_REFRESH_MS = 15_000; // re-read Spotify's upcoming list at least this often
const UPCOMING_SHOWN = 10;
const DUCK_WATCHDOG_MS = 3 * 60_000; // restore the volume if a duck is somehow left on
const VOLUME_SYNC_QUIET_MS = 6000;

type EngineState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  memory: Memory;
  playback: SpPlayback | null;
  playbackAt: number;
  error: string | null;
  // The kiosk browser tab that plays clips (latest to claim it, kept alive by polling).
  audioHost: { id: string; seenAt: number } | null;
  // Ducked for clips playing over the music. We always restore to the kiosk's own
  // music volume setting, never to a value read back from Spotify (a stale read
  // could capture the ducked level and leave the music quiet).
  duck: { holders: number; since: number } | null;
  // When we last changed the volume; device reports lag behind, so don't sync the
  // music-volume setting from the device right after our own change.
  volumeSetAt: number;
  pausedForInstant: { holders: number } | null;
  // What Spotify will play after the current track (playlist order, shuffle and
  // repeat included), minus our own handed-off track. Shown under Up Next.
  upcoming: TrackSummary[];
  upcomingAt: number;
  upcomingForUri: string | null;
  upcomingStale: boolean;
};

const g = globalThis as unknown as { _kioskEngine?: EngineState; _kioskTick?: () => Promise<void> };

function freshState(): EngineState {
  return {
    started: false,
    timer: null,
    memory: initialMemory(),
    playback: null,
    playbackAt: 0,
    error: null,
    audioHost: null,
    duck: null,
    volumeSetAt: 0,
    pausedForInstant: null,
    upcoming: [],
    upcomingAt: 0,
    upcomingForUri: null,
    upcomingStale: true,
  };
}

// The engine state survives dev hot reloads on globalThis; backfill fields added
// since it was created so new code doesn't read undefined.
let backfilled = false;

function state(): EngineState {
  if (!backfilled) {
    g._kioskEngine = Object.assign(freshState(), g._kioskEngine);
    backfilled = true;
  }
  return g._kioskEngine!;
}

export function ensureEngine() {
  const s = state();
  if (s.started) return;
  s.started = true;
  schedule(0);
}

// Run a tick now (after a user action) instead of waiting for the next poll.
export function poke() {
  state().upcomingStale = true;
  schedule(50);
}

function schedule(ms: number) {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  // Call through globalThis so a hot-reloaded module's tick takes over the loop.
  s.timer = setTimeout(() => g._kioskTick?.(), ms);
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
          await handOff(a.id, a.uri);
        } else if (a.type === "started" || a.type === "lost") {
          setStatus(a.id, "played");
        } else if (a.type === "pauseForClip") {
          await api("PUT", "/me/player/pause");
          setStatus(a.id, "handed_off");
          if (!hostAlive()) await finishClip(a.id); // nobody to play it: skip it
        }
      }

      if (s.memory.clip && Date.now() - s.memory.clip.startedAt > CLIP_TIMEOUT_MS) await finishClip(s.memory.clip.id);

      await volumeHousekeeping();

      const uri = pb?.item?.uri ?? null;
      if (s.upcomingStale || uri !== s.upcomingForUri || Date.now() - s.upcomingAt > UPCOMING_REFRESH_MS)
        await refreshUpcoming(uri).catch(() => {});
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The loop retries every few seconds; log each distinct failure once.
    if (message !== s.error) logError("engine", e, e instanceof SpotifyError ? `spotify ${e.endpoint}, HTTP ${e.status}` : undefined);
    s.error = message;
    delay = e instanceof SpotifyError && e.status === 429 ? 10_000 : 3000;
  }
  schedule(delay);
}

async function refreshUpcoming(currentUri: string | null) {
  const s = state();
  s.upcomingStale = false;
  s.upcomingAt = Date.now();
  s.upcomingForUri = currentUri;
  if (!currentUri) {
    s.upcoming = [];
    return;
  }
  const res = await api<{ queue: SpTrack[] }>("GET", "/me/player/queue");
  const tracks = (res?.queue ?? []).filter((t) => t?.uri?.startsWith("spotify:track:"));
  // Our handed-off track sits at the front of Spotify's queue; it's already shown in Up Next.
  const handoffUri = s.memory.handoff?.uri;
  if (handoffUri && tracks[0]?.uri === handoffUri) tracks.shift();
  s.upcoming = tracks.slice(0, UPCOMING_SHOWN).map(summarize);
}

g._kioskTick = tick;

// Put one of our tracks into Spotify's queue. Spotify's queue can't be edited, so a
// duplicate send means the song plays twice: mark it handed off FIRST, and only undo
// that when Spotify definitely refused it (4xx). On an ambiguous failure (network,
// 5xx) assume it went through rather than risk queueing it again.
async function handOff(id: string, uri: string) {
  const s = state();
  setStatus(id, "handed_off");
  s.memory = { ...s.memory, handoff: { id, uri, trackChanges: 0 } };
  try {
    await api("POST", "/me/player/queue", undefined, { uri });
  } catch (e) {
    if (e instanceof SpotifyError && e.status >= 400 && e.status < 500) {
      setStatus(id, "queued");
      if (s.memory.handoff?.id === id) s.memory = { ...s.memory, handoff: null };
    }
    throw e;
  }
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
  if (h?.kind === "track" && h.uri) await handOff(h.id, h.uri);
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
  await handOff(id, item.uri!);
  for (let i = 0; i < skips; i++) await api("POST", "/me/player/next");
  poke();
}

// Jump to a track in the "Then from <playlist>" list. Spotify has no "skip to queue
// position", so restart the current context at that track (keeps the playlist and
// anything already in Spotify's queue); if that's refused, press next enough times.
export async function skipToUpcoming(uri: string, index: number) {
  const s = state();
  const ctx = s.playback?.context?.uri;
  const deviceId = s.playback?.device?.id ?? undefined;
  try {
    if (!ctx) throw new Error("no context");
    await api("PUT", "/me/player/play", { context_uri: ctx, offset: { uri } }, { device_id: deviceId });
  } catch {
    // Our handed-off track sits ahead of the playlist in Spotify's queue.
    const skips = index + 1 + (s.memory.handoff ? 1 : 0);
    for (let i = 0; i < skips; i++) await api("POST", "/me/player/next");
  }
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

// ---- Volume ---------------------------------------------------------------

async function applyVolume(percent: number) {
  const s = state();
  s.volumeSetAt = Date.now();
  await api("PUT", "/me/player/volume", undefined, { volume_percent: String(Math.round(percent)) });
}

function duckedLevel(base: number) {
  return Math.round((base * getSettings().duckPercent) / 100);
}

// The music volume the kiosk restores to; seeded from the device the first time.
function musicVolume(): number {
  const { musicVolume } = getSettings();
  if (musicVolume != null) return musicVolume;
  const v = state().playback?.device?.volume_percent ?? 70;
  updateSettings({ musicVolume: v });
  return v;
}

// Manual music volume (the slider). While ducked, the new level applies after
// the clip; the ducked level follows it right away.
export async function setMusicVolume(percent: number) {
  const s = state();
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  updateSettings({ musicVolume: v });
  await applyVolume(s.duck ? duckedLevel(v) : v);
}

// Keep the setting in step with volume changes made elsewhere (Spotify app, the
// device's own buttons), and make sure a duck can't get stuck on.
async function volumeHousekeeping() {
  const s = state();
  const dev = s.playback?.device;
  if (!dev?.supports_volume || dev.volume_percent == null) return;
  if (s.duck && Date.now() - s.duck.since > DUCK_WATCHDOG_MS) {
    logError("engine", "duck left on too long — restoring the music volume");
    s.duck = null;
    await applyVolume(musicVolume());
    return;
  }
  if (!s.duck && Date.now() - s.volumeSetAt > VOLUME_SYNC_QUIET_MS && dev.volume_percent !== musicVolume())
    updateSettings({ musicVolume: dev.volume_percent });
}

// Duck: lower Spotify's volume if the device allows it. Returns "volume" when
// ducked via the API, or "unsupported" so the browser can try iOS audio-session
// ducking or fall back to pausing.
export async function duck(): Promise<"volume" | "unsupported"> {
  const s = state();
  if (s.duck) {
    s.duck.holders++;
    return "volume";
  }
  const dev = s.playback?.device;
  if (!dev?.supports_volume) return "unsupported";
  const base = musicVolume();
  // Record the duck before the call, so a failure after Spotify acted still restores.
  s.duck = { holders: 1, since: Date.now() };
  try {
    await applyVolume(duckedLevel(base));
  } catch (e) {
    s.duck = null;
    await applyVolume(base).catch(() => {});
    throw e;
  }
  return "volume";
}

export async function unduck() {
  const s = state();
  if (!s.duck) return;
  if (--s.duck.holders > 0) return;
  s.duck = null;
  await restoreVolume();
}

// Force the music back to its normal volume (also the "Restore" button).
export async function restoreVolume() {
  const s = state();
  s.duck = null;
  const base = musicVolume();
  try {
    await applyVolume(base);
  } catch (e) {
    logError("engine", e, "restoring music volume — retrying");
    await new Promise((r) => setTimeout(r, 700));
    await applyVolume(base).catch((e2) => logError("engine", e2, "restoring music volume failed twice"));
  }
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
    musicVolume: getSettings().musicVolume ?? pb?.device?.volume_percent ?? null,
    upcoming: s.upcoming,
    errors: recentErrors().slice(0, 15),
  };
}
