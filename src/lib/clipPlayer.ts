// Plays Soundboard clips in the kiosk browser, in one of two "instant" modes:
//   pause — pause Spotify, play the clip, resume the song where it stopped
//   duck  — lower Spotify, play the clip over it, restore the volume
// Ducking goes: Spotify volume API (desktop/browser players) → iOS audio-session
// "transient" (asks iOS to lower the Spotify app) → fall back to pause.
import { call } from "./client";

export type ClipMode = "pause" | "duck";

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

export const clipUrl = (key: string) => `/api/soundboard/audio/${encodeURIComponent(key)}`;

const active = new Set<HTMLAudioElement>();

function playToEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      active.delete(audio);
      resolve();
    };
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("error", done, { once: true });
    audio.addEventListener("pause", done, { once: true }); // stopAll()
    active.add(audio);
    audio.play().catch(done);
  });
}

export function stopAllClips() {
  for (const a of active) a.pause();
}

export function activeClipCount() {
  return active.size;
}

// Returns a note for the UI when the requested mode had to change.
export async function playClip(key: string, mode: ClipMode): Promise<string | null> {
  const audio = new Audio(clipUrl(key)); // created inside the tap → allowed to play
  let note: string | null = null;

  if (mode === "duck") {
    const { method } = await call<{ method: string }>("POST", "/api/player", { action: "duck" }).catch(() => ({
      method: "unsupported",
    }));
    if (method === "volume") {
      await playToEnd(audio);
      await call("POST", "/api/player", { action: "unduck" }).catch(() => {});
      return null;
    }
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) {
      const prev = nav.audioSession.type;
      nav.audioSession.type = "transient";
      await playToEnd(audio);
      nav.audioSession.type = prev || "auto";
      return null;
    }
    note = "This player can't lower its volume — paused the music instead.";
  }

  const { paused } = await call<{ paused: boolean }>("POST", "/api/player", { action: "instantPause" }).catch(() => ({
    paused: false,
  }));
  await playToEnd(audio);
  if (paused) await call("POST", "/api/player", { action: "instantResume" }).catch(() => {});
  return note;
}

// Queued clips play on a long-lived element unlocked by the "start kiosk" tap, since
// they start without a user gesture.
let hostAudio: HTMLAudioElement | null = null;

export function unlockAudio() {
  hostAudio ??= new Audio();
  // A tiny silent WAV: playing anything inside a gesture unlocks the element on iOS.
  hostAudio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  hostAudio.play().catch(() => {});
}

export async function playQueuedClip(key: string): Promise<void> {
  hostAudio ??= new Audio();
  hostAudio.src = clipUrl(key);
  await playToEnd(hostAudio);
}
