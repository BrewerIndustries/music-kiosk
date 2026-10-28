// Queue engine runtime: one polling loop per server process. It watches Spotify
// playback, asks engine-core's decide() what to do, and does it. The kiosk UI reads
// the cached snapshot from here instead of hitting Spotify itself.
import { api, getPlayback, isConnected, summarize, SpotifyError, type SpPlayback, type SpTrack, type TrackSummary } from "./spotify";
import { CLIP_CUT_MS, decide, initialMemory, type Memory } from "./engine-core";
import { logError, recentErrors } from "./log";
import { getSettings, updateSettings } from "./settings";
import { getItem, head, moveToFront, playsInBrowser, setStatus, upNext, type QueueItem } from "./queue";
import { getSetting, setSetting } from "./db";
import { notePlayed, notePlaying, playHistory } from "./history";

const CLIP_TIMEOUT_MS = 5 * 60_000; // give up on a queued clip the browser never finished
const YOUTUBE_GRACE_MS = 3 * 60_000; // …or a YouTube song this long after it should have ended
const HOST_STALE_MS = 10_000; // a kiosk tab that hasn't polled in this long can't play clips
const UPCOMING_REFRESH_MS = 15_000; // re-read Spotify's upcoming list at least this often
const UPCOMING_SHOWN = 10;
const DUCK_WATCHDOG_MS = 3 * 60_000; // restore the volume if a duck is somehow left on
const VOLUME_SYNC_QUIET_MS = 6000;
const RESUME_MAX_AGE_MS = 6 * 60 * 60_000; // offer to resume playback lost up to 6 h ago
const FADE_STEP_MS = 200;
const IDLE_POLL_MS = 60_000; // engine poll with nothing playing and no kiosk page open
const STALE_SNAPSHOT_MS = 2500; // a polling page wakes the engine if its data is older

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
  // Spotify was started over a YouTube song: the id of that song, which the kiosk
  // tab pauses (snapshot.youtubeHeld) until its own ▶ takes over again.
  youtubeHeld: string | null;
  // What Spotify will play after the current track (playlist order, shuffle and
  // repeat included), minus our own handed-off track. Shown under Up Next.
  upcoming: TrackSummary[];
  upcomingAt: number;
  upcomingForUri: string | null;
  upcomingStale: boolean;
  burstUntil: number;
  ticking: boolean;
  tickAgain: boolean;
  // A music fade in progress (bumping the token cancels it).
  fadeToken: number;
  fading: boolean;
  fadingSince: number;
  // Song transition (fade the end of a song out, the next one in). transitionFor
  // is the song whose ending we've already handled.
  transitioning: boolean;
  transitionFor: string | null;
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
    youtubeHeld: null,
    upcoming: [],
    upcomingAt: 0,
    upcomingForUri: null,
    upcomingStale: true,
    burstUntil: 0,
    ticking: false,
    tickAgain: false,
    fadeToken: 0,
    fading: false,
    fadingSince: 0,
    transitioning: false,
    transitionFor: null,
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
  recoverAfterRestart();
  schedule(0);
}

// ---- Surviving restarts ----------------------------------------------------
// Engine memory is in-process. What must outlive a server restart (or a kiosk
// reload) is mirrored into the settings table: the music hold (ducked / paused
// for a clip), the player choice, and where playback was.

const HOLD_DUCK = "hold_duck";
const HOLD_PAUSED = "hold_paused";
const HOLD_TRANSITION = "hold_transition"; // music volume lowered for a song transition
const LAST_DEVICE = "last_device"; // the Spotify player last seen (to wake it again)
// The YouTube song in progress ({id, resume}) and where the kiosk tab last saw it
// ({uri, ms, at}), so a deploy (server restart) or a kiosk reload picks it back up
// at the same spot instead of dropping it.
const YT_CLIP = "youtube_clip";
const YT_POS = "youtube_pos";

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(getSetting(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function saveYouTubeClip() {
  const c = state().memory.clip;
  if (c && getItem(c.id)?.kind === "youtube") setSetting(YT_CLIP, JSON.stringify({ id: c.id, resume: Boolean(c.resume) }));
}

// The kiosk tab's YouTube position, reported on its state poll.
export function noteYouTubePosition(videoUri: string, ms: number) {
  if (Number.isFinite(ms) && ms >= 0) setSetting(YT_POS, JSON.stringify({ uri: videoUri, ms: Math.round(ms), at: Date.now() }));
}
// Where to start the current YouTube song (0 unless it was cut off part-way).
export function youtubeResumeMs(item: QueueItem | null): number {
  const pos = readJson<{ uri: string; ms: number }>(YT_POS);
  return item?.kind === "youtube" && pos?.uri === item.uri ? pos.ms : 0;
}

function recoverAfterRestart() {
  const s = state();
  // A track we'd already put in Spotify's queue: keep tracking it.
  const handed = upNext().filter((i) => i.status === "handed_off");
  const track = handed.find((i) => i.kind === "track" && i.uri);
  if (track) s.memory = { ...s.memory, handoff: { id: track.id, uri: track.uri!, trackChanges: 0 } };
  // A YouTube song that was mid-play (e.g. a deploy restarted us): carry on with it
  // where the kiosk tab last saw it; Spotify stays paused for it.
  const yt = handed.find((i) => i.kind === "youtube");
  if (yt) {
    const saved = readJson<{ id: string; resume: boolean }>(YT_CLIP);
    s.memory = {
      ...s.memory,
      clip: { id: yt.id, startedAt: Date.now() - youtubeResumeMs(yt), resume: saved?.id === yt.id && saved.resume },
    };
  }
  // A queued sound clip that was mid-play: it's gone; let the music carry on.
  const clips = handed.filter((i) => playsInBrowser(i.kind) && i.id !== yt?.id);
  for (const c of clips) setStatus(c.id, "played");
  // Music left lowered or paused for a clip: bring it back once we can talk to Spotify.
  if (getSetting(HOLD_DUCK) || getSetting(HOLD_PAUSED) || getSetting(HOLD_TRANSITION) || clips.length)
    setTimeout(() => releaseHolds().catch((e) => logError("engine", e, "restoring music after restart")), 1500);
}

// Drop any clip hold: restore the volume and/or resume. Used after a server restart
// and when a kiosk page loads (a reload mid-clip would otherwise leave it held).
export async function releaseHolds() {
  const s = state();
  const wasPaused = Boolean(s.pausedForInstant || getSetting(HOLD_PAUSED));
  const wasDucked = Boolean(s.duck || getSetting(HOLD_DUCK) || getSetting(HOLD_TRANSITION));
  s.pausedForInstant = null;
  setSetting(HOLD_PAUSED, null);
  if (wasDucked) await restoreVolume();
  if (wasPaused) await api("PUT", "/me/player/play").catch(() => {});
  if (wasPaused || wasDucked) poke();
}

export function holdActive() {
  const s = state();
  return Boolean(s.duck || s.pausedForInstant);
}

// The player the kiosk should play on: "browser" (this kiosk tab's Web Playback SDK
// device, whose id changes on every reload) or a Spotify Connect device id.
export function rememberPlayer(pref: string) {
  setSetting("player_pref", pref);
}

type ResumePoint = { uri: string; contextUri: string | null; progressMs: number; playing: boolean; at: number };

// Saved on every poll. "playing" means the music *should* be playing: a pause
// that the kiosk didn't make (the browser player dying with its tab) keeps the
// earlier "playing" for the same song; the kiosk's own stops go through markStopped().
function saveResumePoint(pb: SpPlayback) {
  if (!pb.item) return;
  const prev = resumePoint();
  const point: ResumePoint = {
    uri: pb.item.uri,
    contextUri: pb.context?.uri ?? null,
    progressMs: pb.progress_ms ?? 0,
    playing: pb.is_playing || Boolean(prev?.playing && prev.uri === pb.item.uri),
    at: Date.now(),
  };
  // While paused, the place for the same song only moves forward: a browser player
  // re-registering after a reload can report the song at 0:00, which must not
  // overwrite where it really was.
  if (prev && !pb.is_playing && prev.uri === point.uri && point.progressMs <= prev.progressMs && prev.playing === point.playing)
    return;
  setSetting("resume_point", JSON.stringify(point));
}

// Where to pick up: where the music stopped, backed up a beat. (Not "plus the time
// it was down" — after a reload you want to hear the bit you missed.)
const RESUME_BACKUP_MS = 2500;
function resumePosition(p: ResumePoint) {
  return Math.max(0, p.progressMs - RESUME_BACKUP_MS);
}

// After the music moves to a (new) player, make sure Spotify kept our place: a
// re-registered browser player sometimes starts the song from 0:00. Only acts
// when the same song is playing well short of where it was. Pass the place as it
// was *before* the move (placeBeforeMove()) — once a restarted song plays, the
// engine's next poll saves 0:00 as the place.
export function placeBeforeMove() {
  return resumePoint();
}
export async function keepPosition(p: ResumePoint | null) {
  if (!p || Date.now() - p.at > RESUME_MAX_AGE_MS) return;
  const want = resumePosition(p);
  if (want < 5000) return;
  for (const wait of [800, 1500]) {
    await new Promise((r) => setTimeout(r, wait));
    const pb = await getPlayback().catch(() => null);
    if (!pb?.item || pb.item.uri !== p.uri) return;
    const at = pb.progress_ms ?? 0;
    if (at >= want - 4000) return; // close enough: it kept its place
    if (at > 1500 || pb.is_playing) {
      await api("PUT", "/me/player/seek", undefined, { position_ms: String(want) }).catch((e) =>
        logError("engine", e, "restoring track position"),
      );
      return;
    }
  }
}

// The kiosk paused or faded the music out on purpose: nothing to resume.
export function markStopped() {
  const p = resumePoint();
  if (p) setSetting("resume_point", JSON.stringify({ ...p, playing: false, at: Date.now() }));
}

function resumePoint(): ResumePoint | null {
  try {
    const p = JSON.parse(getSetting("resume_point") ?? "null") as ResumePoint | null;
    return p && Date.now() - p.at < RESUME_MAX_AGE_MS ? p : null;
  } catch {
    return null;
  }
}

// What a kiosk page should offer to pick back up: music was playing (and the kiosk
// didn't stop it), but nothing is playing now. `deviceId` is the player that went
// quiet, so a reloaded page can tell its own dead browser player apart from a
// pause on some other device.
export function resumeOffer() {
  const s = state();
  const pref = getSetting("player_pref");
  const point = resumePoint();
  if (!point?.playing) return null;
  if (s.playback?.is_playing) return null;
  // Spotify waits paused while a YouTube song (or queued clip) has the floor, even
  // when that song is paused on the kiosk screen: the music hasn't "stopped".
  if (s.memory.clip) return null;
  const dev = s.playback?.device;
  return { pref: pref ?? "browser", uri: point.uri, deviceId: dev?.id ?? null, deviceName: dev?.name ?? null };
}

// Pick playback back up on `deviceId` (the new browser player after a reload):
// transfer if Spotify still has the session, else replay the saved point.
// Pick the music back up. Without a deviceId (the page's player never reported
// ready), use the kiosk's browser player from Spotify's device list — Spotify
// keeps the same id for it across reloads.
export async function resumeOn(deviceId?: string) {
  const s = state();
  const point = resumePoint();
  if (!deviceId) {
    const { devices } = (await api<{ devices: { id: string | null; name: string; is_active: boolean }[] }>(
      "GET",
      "/me/player/devices",
    )) ?? { devices: [] };
    const kiosk = devices
      .filter((d) => d.id && d.name.startsWith("Music Kiosk"))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active))[0];
    if (!kiosk?.id) return false;
    deviceId = kiosk.id;
  }
  const pb = await getPlayback().catch(() => null);
  const playFromPoint = async () => {
    if (!point) return false;
    const position = resumePosition(point);
    const body = point.contextUri
      ? { context_uri: point.contextUri, offset: { uri: point.uri }, position_ms: position }
      : { uris: [point.uri], position_ms: position };
    await api("PUT", "/me/player/play", body, { device_id: deviceId });
    return true;
  };
  if (pb?.item) {
    // Spotify still holds the song (paused): move it here and play. If the
    // transfer fails, rebuild playback from the saved point instead.
    try {
      await api("PUT", "/me/player", { device_ids: [deviceId], play: true });
    } catch (e) {
      logError("engine", e, "resume: transfer failed, replaying from saved point");
      if (!(await playFromPoint())) throw e;
    }
  } else if (!(await playFromPoint())) return false;
  await keepPosition(point);
  s.upcomingStale = true;
  poke();
  return true;
}

// Start the backdrop playlist from the top, looping. `paused` loads it without
// playing: Spotify can only load by playing, so mute, start, pause at 0:00, and
// put the volume back.
export async function startPlaylist(uri: string, deviceId: string | undefined, paused: boolean) {
  const dev = { device_id: deviceId };
  if (paused) await api("PUT", "/me/player/volume", undefined, { volume_percent: "0", ...dev }).catch(() => {});
  try {
    await api("PUT", "/me/player/play", { context_uri: uri }, dev);
    // Loop the playlist so the backdrop never runs dry.
    await api("PUT", "/me/player/repeat", undefined, { state: "context", ...dev }).catch(() => {});
    if (paused) {
      // A just-started player can refuse a pause for a moment; retry briefly.
      for (let i = 0; ; i++) {
        try {
          await api("PUT", "/me/player/pause", undefined, dev);
          break;
        } catch (e) {
          if (i >= 3) throw e;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      await api("PUT", "/me/player/seek", undefined, { position_ms: "0", ...dev }).catch(() => {});
      markStopped();
    }
  } finally {
    if (paused) {
      state().volumeSetAt = Date.now();
      await api("PUT", "/me/player/volume", undefined, {
        volume_percent: String(Math.round(musicVolume())),
        ...dev,
      }).catch((e) => logError("engine", e, "restoring volume after loading playlist"));
    }
    poke();
  }
}

// Run a tick now (after a user action) instead of waiting for the next poll, then
// keep re-reading Spotify quickly for a few seconds: it takes a beat to report a
// play/pause/skip, and the UI should catch it the moment it does.
const BURST_MS = 3000;
const BURST_POLL_MS = 400;
export function poke() {
  const s = state();
  s.upcomingStale = true;
  s.burstUntil = Date.now() + BURST_MS;
  schedule(50);
}

// On Cloudflare the loop runs on Durable Object alarms (they wake the object even
// when no kiosk page is open); elsewhere (tests) on setTimeout. Either way only
// one wake-up is pending at a time — a new schedule() replaces it.
let alarmScheduler: ((at: number) => void) | null = null;
export function attachAlarms(set: (at: number) => void) {
  alarmScheduler = set;
}

function schedule(ms: number) {
  const s = state();
  if (alarmScheduler) {
    alarmScheduler(Date.now() + ms);
    return;
  }
  if (s.timer) clearTimeout(s.timer);
  // Call through globalThis so a hot-reloaded module's tick takes over the loop.
  s.timer = setTimeout(() => g._kioskTick?.(), ms);
}

// The alarm handler.
export function runTick() {
  return g._kioskTick?.() ?? Promise.resolve();
}

// A kiosk page is polling: make sure what it sees is fresh even if the loop has
// backed off (nothing playing, nobody watching).
export function freshen() {
  const s = state();
  if (!s.ticking && Date.now() - s.playbackAt > STALE_SNAPSHOT_MS) schedule(0);
}

// Never two ticks at once: a wake-up that lands mid-tick runs right after it.
async function tick() {
  const s = state();
  if (s.ticking) {
    s.tickAgain = true;
    return;
  }
  s.ticking = true;
  try {
    await tickBody();
  } finally {
    s.ticking = false;
    if (s.tickAgain) {
      s.tickAgain = false;
      schedule(0);
    }
  }
}

async function tickBody() {
  const s = state();
  let delay = 5000;
  try {
    if (!isConnected()) {
      s.playback = null;
      s.error = null;
    } else {
      s.playback = await getPlayback();
      s.playbackAt = Date.now();
      // The player to wake if Spotify drops it while it waits (wakeSpotify).
      const devId = s.playback?.device?.id;
      if (devId && devId !== getSetting(LAST_DEVICE)) setSetting(LAST_DEVICE, devId);
      s.error = null;
      // Only remember *playing* moments: when a browser player dies (its tab reloaded),
      // Spotify reports the song as paused on the dead device, which must not read as
      // "someone stopped the music". Deliberate stops go through markStopped().
      if (s.playback?.item) saveResumePoint(s.playback);
      if (s.playback?.item) notePlaying(summarize(s.playback.item), s.playback.progress_ms ?? 0);

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
      // Spotify waits paused through a whole YouTube song; no need to watch it closely.
      if (s.memory.clip && getItem(s.memory.clip.id)?.kind === "youtube") delay = Math.max(delay, 2000);

      for (const a of decision.actions) {
        if (a.type === "enqueue") {
          await handOff(a.id, a.uri);
        } else if (a.type === "started" || a.type === "lost") {
          setStatus(a.id, "played");
        } else if (a.type === "pauseForClip") {
          await api("PUT", "/me/player/pause");
          setStatus(a.id, "handed_off");
          saveYouTubeClip();
          if (!hostAlive()) await finishClip(a.id); // nobody to play it: skip it
        }
      }

      if (s.memory.clip && clipOverdue(s.memory.clip)) await finishClip(s.memory.clip.id);

      await volumeHousekeeping();
      delay = maybeTransition(delay);

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
  if (Date.now() < (s.burstUntil ?? 0)) delay = Math.min(delay, BURST_POLL_MS);
  // Nothing playing and no kiosk page open: check in once a minute instead.
  else if (!s.playback?.is_playing && !s.memory.clip && !hostAlive()) delay = Math.max(delay, IDLE_POLL_MS);
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
async function handOff(id: string, uri: string, deviceId?: string) {
  const s = state();
  setStatus(id, "handed_off");
  s.memory = { ...s.memory, handoff: { id, uri, trackChanges: 0 } };
  try {
    await api("POST", "/me/player/queue", undefined, { uri, device_id: deviceId });
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

function youtubeNow() {
  const c = state().memory.clip;
  const item = c ? getItem(c.id) : null;
  return item?.kind === "youtube" ? { ...item, startedAt: c!.startedAt } : null;
}

// Only one player at a time. Something is starting Spotify (▶, fade in, Resume…)
// while a YouTube song has the floor: the kiosk tab pauses the video, and when the
// YouTube song finishes Spotify just carries on with its current song.
export function holdYouTube() {
  const s = state();
  const c = s.memory.clip;
  if (!c || getItem(c.id)?.kind !== "youtube") return;
  s.memory = { ...s.memory, clip: { ...c, resume: true } };
  saveYouTubeClip();
  s.youtubeHeld = c.id;
  poke();
}

// The YouTube song's own ▶ on the kiosk screen: it takes the floor back, so pause
// Spotify (not a deliberate stop: it picks up again after the YouTube song).
export async function youtubeResumed() {
  const s = state();
  s.youtubeHeld = null;
  const pb = await getPlayback().catch(() => null);
  if (pb?.is_playing) await api("PUT", "/me/player/pause");
  poke();
}

// ⏭ while the kiosk tab plays a clip / YouTube song skips that, not Spotify.
export async function skipCurrent() {
  const c = state().memory.clip;
  if (c) await finishClip(c.id);
  else await api("POST", "/me/player/next");
}

// A browser-played item that never reported back (tab closed, player stuck).
function clipOverdue(c: { id: string; startedAt: number }) {
  const item = getItem(c.id);
  const limit = item?.kind === "youtube" ? item.durationMs + YOUTUBE_GRACE_MS : CLIP_TIMEOUT_MS;
  return Date.now() - c.startedAt > limit;
}

// Hand a clip / YouTube song to the audio host (Spotify is already paused).
async function startInBrowser(id: string, resume = false) {
  const s = state();
  setStatus(id, "handed_off");
  s.memory = { ...s.memory, clip: { id, startedAt: Date.now(), resume } };
  saveYouTubeClip();
  if (!hostAlive()) await finishClip(id); // nobody to play it: skip it
}

// Spotify drops a player that sits paused for a few minutes (e.g. through a run of
// YouTube songs), and then every command fails with "no active device". Before
// handing back to Spotify: if nothing is active, re-attach the last player (paused,
// keeping its place); if Spotify has forgotten the session, rebuild it from the
// saved resume point. Returns the player to address commands to.
export async function wakeSpotify(): Promise<string | undefined> {
  const pb = await getPlayback().catch(() => null);
  if (pb?.device?.is_active && pb.device.id) return pb.device.id;
  let id = pb?.device?.id ?? getSetting(LAST_DEVICE) ?? undefined;
  if (!id) {
    const { devices } = (await api<{ devices: { id: string | null; name: string }[] }>("GET", "/me/player/devices").catch(
      () => null,
    )) ?? { devices: [] };
    id = devices.find((d) => d.id && d.name.startsWith("Music Kiosk"))?.id ?? devices.find((d) => d.id)?.id ?? undefined;
  }
  if (!id) return undefined;
  try {
    await api("PUT", "/me/player", { device_ids: [id], play: false });
    await new Promise((r) => setTimeout(r, 700));
    if ((await getPlayback().catch(() => null))?.item) return id;
  } catch (e) {
    logError("engine", e, "waking Spotify after YouTube/clip");
  }
  const point = resumePoint();
  if (point) {
    const body = point.contextUri
      ? { context_uri: point.contextUri, offset: { uri: point.uri }, position_ms: point.progressMs }
      : { uris: [point.uri], position_ms: point.progressMs };
    await api("PUT", "/me/player/play", body, { device_id: id }).catch((e) => logError("engine", e, "rebuilding Spotify session"));
  }
  return id;
}

// The browser finished (or skipped) a queued clip / YouTube song: move on.
export async function finishClip(id: string) {
  const s = state();
  if (s.memory.clip?.id !== id) return;
  const resume = Boolean(s.memory.clip.resume);
  s.youtubeHeld = null;
  const item = getItem(id);
  // Previously played: a YouTube song that got going (≥ 10 s) counts, like Spotify's.
  if (item?.kind === "youtube" && item.uri) {
    const heard = Math.max(youtubeResumeMs(item), Date.now() - s.memory.clip.startedAt);
    if (heard >= 10_000)
      notePlayed({ uri: item.uri, title: item.title, subtitle: item.subtitle, art: item.art, durationMs: item.durationMs, explicit: false });
  }
  setSetting(YT_CLIP, null);
  setSetting(YT_POS, null);
  setStatus(id, "played");
  s.memory = { ...s.memory, clip: null };
  // It cut into a Spotify song (▶ Now): carry on with that song; the rest of Up
  // Next follows it as usual.
  if (resume) {
    const dev = await wakeSpotify();
    await api("PUT", "/me/player/play", undefined, { device_id: dev }).catch(() => {});
    poke();
    return;
  }
  // Another browser item next (e.g. a run of YouTube songs): play it straight away
  // and keep Spotify waiting.
  const next = head();
  if (next && playsInBrowser(next.kind) && hostAlive()) {
    await startInBrowser(next.id);
    poke();
    return;
  }
  // If a track is next in Up Next, hand it off before skipping so it plays now;
  // otherwise skipping resumes the playlist.
  const dev = await wakeSpotify();
  const h = head();
  if (h?.kind === "track" && h.uri) await handOff(h.id, h.uri, dev);
  await api("POST", "/me/player/next", undefined, { device_id: dev });
  await api("PUT", "/me/player/play", undefined, { device_id: dev }).catch(() => {}); // some devices stay paused after next
  poke();
}

// Admin "Play now": jump this Up Next item to the front and start it immediately.
export async function playNow(id: string) {
  const s = state();
  const item = getItem(id);
  if (!item || item.status !== "queued") return;
  moveToFront(id);
  if (playsInBrowser(item.kind)) {
    // Interrupting a song (not just its last moments): resume it afterwards. A
    // browser item already playing passes its own resume point on.
    const pb = s.playback;
    const left = pb?.item ? pb.item.duration_ms - (pb.progress_ms ?? 0) : 0;
    const midSong = s.memory.clip?.resume || Boolean(pb?.is_playing && left > CLIP_CUT_MS + 3000);
    await api("PUT", "/me/player/pause").catch(() => {});
    // Replacing a browser item that's already playing: it counts as played.
    if (s.memory.clip) {
      setStatus(s.memory.clip.id, "played");
      s.memory = { ...s.memory, clip: null };
    }
    await startInBrowser(id, midSong);
    poke();
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
// Jump to a track in the upcoming playlist. `paused` cues it up at 0:00 without
// playing it: Spotify can only jump by starting playback, so the music is muted
// for the jump, paused, then put back to the music volume.
export async function skipToUpcoming(uri: string, index: number, paused = false) {
  const s = state();
  const ctx = s.playback?.context?.uri;
  const dev = s.playback?.device;
  const deviceId = dev?.id ?? undefined;
  const mute = paused && dev?.supports_volume;
  if (mute) {
    s.fadeToken++; // cancel any fade in flight
    await applyVolume(0).catch(() => {});
  }
  try {
    try {
      if (!ctx) throw new Error("no context");
      await api("PUT", "/me/player/play", { context_uri: ctx, offset: { uri } }, { device_id: deviceId });
    } catch {
      // Our handed-off track sits ahead of the playlist in Spotify's queue.
      const skips = index + 1 + (s.memory.handoff ? 1 : 0);
      for (let i = 0; i < skips; i++) await api("POST", "/me/player/next");
    }
    if (paused) {
      await api("PUT", "/me/player/pause");
      await api("PUT", "/me/player/seek", undefined, { position_ms: "0" }).catch(() => {});
      markStopped();
    }
  } finally {
    if (mute) await applyVolume(musicVolume()).catch(() => {});
    poke();
  }
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
  setSetting(HOLD_PAUSED, "1");
  return { paused: true };
}

export async function instantResume() {
  const s = state();
  if (!s.pausedForInstant) return;
  if (--s.pausedForInstant.holders > 0) return;
  s.pausedForInstant = null;
  setSetting(HOLD_PAUSED, null);
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
  s.fadeToken++; // a manual change wins over a fade in progress
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
    await restoreVolume();
    return;
  }
  if (!s.duck && !isFading() && !s.transitioning && Date.now() - s.volumeSetAt > VOLUME_SYNC_QUIET_MS && dev.volume_percent !== musicVolume())
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
  s.fadeToken++; // a clip wins over a fade or song transition in progress
  // Record the duck before the call, so a failure after Spotify acted still restores.
  s.duck = { holders: 1, since: Date.now() };
  setSetting(HOLD_DUCK, "1");
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
  s.fadeToken++;
  setSetting(HOLD_DUCK, null);
  setSetting(HOLD_TRANSITION, null);
  const base = musicVolume();
  try {
    await applyVolume(base);
  } catch (e) {
    logError("engine", e, "restoring music volume — retrying");
    await new Promise((r) => setTimeout(r, 700));
    await applyVolume(base).catch((e2) => logError("engine", e2, "restoring music volume failed twice"));
  }
}

// ---- Music fades ------------------------------------------------------------

// Step Spotify's volume from → to over ms. Returns false if another fade (or a
// manual volume change) took over.
// Paced by the clock, not by step count: each volume call takes a while, so
// counting steps would stretch a 3 s fade well past 3 s.
async function ramp(from: number, to: number, ms: number): Promise<boolean> {
  const s = state();
  const token = ++s.fadeToken;
  const start = Date.now();
  let last = NaN;
  for (;;) {
    if (s.fadeToken !== token) return false;
    const stepAt = Date.now();
    const t = Math.min(1, (stepAt - start) / Math.max(ms, 1));
    const v = Math.round(from + (to - from) * t);
    if (v !== last) await applyVolume(v);
    last = v;
    if (t >= 1) break;
    await new Promise((r) => setTimeout(r, Math.max(0, FADE_STEP_MS - (Date.now() - stepAt))));
  }
  return s.fadeToken === token;
}

// A fade can't legitimately run this long; treat an older flag as stale (e.g. a
// fade whose Spotify call hung before calls had timeouts).
function isFading() {
  const s = state();
  return s.fading && Date.now() - (s.fadingSince ?? 0) < 60_000;
}

// ---- Song transitions (Settings ▸ Music ▸ "Fade between songs") -------------
// Spotify's API has no crossfade and plays one song at a time, so the kiosk fades
// the last few seconds of a song out and the next song in. Skipped while a clip
// holds the music, during a manual fade, before a queued clip, or on players
// without volume control. Returns the tick delay, shortened to wake on time.
function maybeTransition(delay: number): number {
  const s = state();
  const ms = getSettings().songTransitionMs;
  const pb = s.playback;
  if (!ms || !pb?.item || !pb.is_playing || !pb.device?.supports_volume) return delay;
  if (s.duck || isFading() || s.transitioning || s.pausedForInstant || s.memory.clip) return delay;
  const h = head();
  if (h && playsInBrowser(h.kind)) return delay; // the clip / YouTube song will pause the music
  const uri = pb.item.uri;
  if (s.transitionFor === uri) return delay;
  const remaining = pb.item.duration_ms - (pb.progress_ms ?? 0);
  if (remaining > ms + 250) return Math.min(delay, Math.max(150, remaining - ms - 150));
  if (remaining < 600) return delay; // too late to fade this one
  s.transitionFor = uri;
  void runTransition(uri, remaining, ms);
  return delay;
}

async function runTransition(uri: string, remaining: number, ms: number) {
  const s = state();
  const base = musicVolume();
  s.transitioning = true;
  setSetting(HOLD_TRANSITION, "1");
  try {
    if (!(await ramp(base, 0, Math.max(300, remaining - 300)))) return; // someone else took the volume
    const token = s.fadeToken;
    // Wait for the next song to start (up to 6 s).
    let next = false;
    for (const until = Date.now() + 6000; Date.now() < until; ) {
      await new Promise((r) => setTimeout(r, 250));
      const pb = await getPlayback().catch(() => null);
      if (pb?.item && pb.item.uri !== uri) {
        next = true;
        break;
      }
      if (pb && !pb.is_playing && pb.item?.uri === uri && (pb.progress_ms ?? 0) < pb.item.duration_ms - 2000) break; // paused
    }
    if (s.fadeToken !== token) return;
    if (next) await ramp(0, base, ms);
    else await applyVolume(base);
  } catch (e) {
    logError("engine", e, "song transition");
  } finally {
    s.transitioning = false;
    // Whatever happened, never leave the music quiet (unless a clip owns it now).
    if (!s.duck && !isFading() && getSetting(HOLD_TRANSITION)) {
      await applyVolume(musicVolume()).catch((e) => logError("engine", e, "restoring volume after transition"));
    }
    setSetting(HOLD_TRANSITION, null);
  }
}

// Fade the music out (then pause, and put the volume back for next time) or in
// (from silence if paused, else from wherever it is, up to the music volume).
// Runs in the background; on players without volume control it just pauses/plays.
// cueNext (fade out only): then line up the next song, paused at its start, so ▶
// begins it fresh.
export async function fadeMusic(dir: "in" | "out", cueNext = false): Promise<"fading" | "instant"> {
  const s = state();
  const dev = s.playback?.device;
  const { musicFadeInMs, musicFadeOutMs } = getSettings();
  if (!dev?.supports_volume) {
    await api("PUT", dir === "out" ? "/me/player/pause" : "/me/player/play");
    if (dir === "out" && cueNext) await cueNextPaused();
    if (dir === "out") markStopped();
    poke();
    return "instant";
  }
  const base = musicVolume();
  const current = dev.volume_percent ?? base;
  const run = async () => {
    s.fading = true;
    s.fadingSince = Date.now();
    try {
      if (dir === "out") {
        if (await ramp(current, 0, musicFadeOutMs)) {
          await api("PUT", "/me/player/pause");
          if (cueNext) await cueNextPaused();
          markStopped();
          await applyVolume(base);
        }
      } else {
        const from = s.playback?.is_playing ? current : 0;
        if (!s.playback?.is_playing) {
          await applyVolume(0);
          await api("PUT", "/me/player/play");
        }
        await ramp(from, base, musicFadeInMs);
      }
    } catch (e) {
      logError("engine", e, `music fade ${dir}`);
      await applyVolume(base).catch(() => {});
    } finally {
      s.fading = false;
      poke();
    }
  };
  void run();
  return "fading";
}

// Skip to the next song (Up Next's head track first, else the playlist) and leave it
// paused at 0:00. Spotify starts playing on `next`, so wait for the change and pause.
// The music is silent (faded out) while this runs. A YouTube / clip head still plays
// at the end of the cued song, as usual.
async function cueNextPaused() {
  const s = state();
  const was = s.playback?.item?.uri;
  const dev = s.playback?.device?.id ?? undefined;
  const h = head();
  if (h?.kind === "track" && h.uri && !s.memory.handoff) await handOff(h.id, h.uri, dev);
  await api("POST", "/me/player/next", undefined, { device_id: dev });
  for (const until = Date.now() + 4000; Date.now() < until; ) {
    await new Promise((r) => setTimeout(r, 300));
    const pb = await getPlayback().catch(() => null);
    if (pb?.item && pb.item.uri !== was) break;
  }
  await api("PUT", "/me/player/pause", undefined, { device_id: dev }).catch(() => {});
  await api("PUT", "/me/player/seek", undefined, { position_ms: "0", device_id: dev }).catch(() => {});
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
    // A YouTube song playing in the kiosk tab (Spotify waits paused meanwhile).
    youtubeNow: youtubeNow(),
    youtubeHeld: Boolean(s.youtubeHeld && s.memory.clip?.id === s.youtubeHeld),
    ducked: Boolean(s.duck),
    // Belt and braces: never show a fade that has outlived any real fade.
    fading: isFading(),
    transitioning: s.transitioning,
    holdActive: holdActive(),
    resumeOffer: resumeOffer(),
    musicVolume: getSettings().musicVolume ?? pb?.device?.volume_percent ?? null,
    upcoming: s.upcoming,
    history: playHistory().slice(0, 30),
    errors: recentErrors().slice(0, 15),
  };
}
