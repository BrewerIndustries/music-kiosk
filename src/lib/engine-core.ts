// The queue engine's decision logic, kept pure so it can be unit-tested without
// Spotify. engine.ts polls playback, calls decide(), and carries out the actions.
//
// Strategy: Spotify's own queue holds at most ONE of our tracks, handed off a few
// seconds before the current track ends. Spotify plays it gaplessly, then falls
// back to the playlist context on its own. A clip at the head of Up Next pauses
// Spotify just before the track ends; the kiosk browser plays it and reports back.

export const HANDOFF_MS = 8000; // hand the next track to Spotify this close to the end
export const CLIP_CUT_MS = 1500; // pause for a queued clip this close to the end

export type PlaybackSnapshot = {
  isPlaying: boolean;
  uri: string | null;
  progressMs: number;
  durationMs: number;
};

export type HeadItem = { id: string; kind: "track" | "clip"; uri: string | null };

export type Memory = {
  lastUri: string | null;
  lastProgressMs: number;
  // A track we've put in Spotify's queue that hasn't started yet.
  handoff: { id: string; uri: string; trackChanges: number } | null;
  // A queued clip the browser is playing while Spotify is paused.
  clip: { id: string; startedAt: number } | null;
  // Up Next item currently playing on Spotify (for "requested by" display).
  nowPlayingId: string | null;
};

export const initialMemory = (): Memory => ({
  lastUri: null,
  lastProgressMs: 0,
  handoff: null,
  clip: null,
  nowPlayingId: null,
});

export type Action =
  | { type: "enqueue"; id: string; uri: string } // POST /me/player/queue, mark handed_off
  | { type: "started"; id: string } // handed-off track began: mark played
  | { type: "lost"; id: string } // handed-off track never showed up: mark played, forget it
  | { type: "pauseForClip"; id: string }; // pause Spotify, mark clip as playing

export type Decision = { actions: Action[]; memory: Memory; delayMs: number };

export function decide(pb: PlaybackSnapshot | null, headItem: HeadItem | null, prev: Memory): Decision {
  const memory: Memory = {
    ...prev,
    handoff: prev.handoff ? { ...prev.handoff } : null,
    clip: prev.clip ? { ...prev.clip } : null,
  };
  const actions: Action[] = [];

  if (!pb || !pb.uri) return { actions, memory, delayMs: 3000 };

  // A new track started: either a different URI, or the same URI restarting (the
  // requested song is the one already playing).
  const restarted =
    pb.uri === memory.lastUri && memory.lastProgressMs - pb.progressMs > 10_000 && pb.progressMs < 5000;
  const changed = memory.lastUri !== null && (pb.uri !== memory.lastUri || restarted);

  if (changed) {
    memory.nowPlayingId = null;
    if (memory.handoff) {
      if (pb.uri === memory.handoff.uri) {
        actions.push({ type: "started", id: memory.handoff.id });
        memory.nowPlayingId = memory.handoff.id;
        memory.handoff = null;
      } else if (++memory.handoff.trackChanges >= 2) {
        // Someone skipped around in the Spotify app; assume it played or was skipped.
        actions.push({ type: "lost", id: memory.handoff.id });
        memory.handoff = null;
      }
    }
  }
  memory.lastUri = pb.uri;
  memory.lastProgressMs = pb.progressMs;

  if (memory.clip) return { actions, memory, delayMs: 500 };
  if (!pb.isPlaying) return { actions, memory, delayMs: 1500 };

  const remaining = Math.max(0, pb.durationMs - pb.progressMs);

  if (!memory.handoff && headItem) {
    if (headItem.kind === "track" && headItem.uri && remaining <= HANDOFF_MS) {
      actions.push({ type: "enqueue", id: headItem.id, uri: headItem.uri });
      memory.handoff = { id: headItem.id, uri: headItem.uri, trackChanges: 0 };
    } else if (headItem.kind === "clip" && remaining <= CLIP_CUT_MS) {
      actions.push({ type: "pauseForClip", id: headItem.id });
      memory.clip = { id: headItem.id, startedAt: Date.now() };
      return { actions, memory, delayMs: 500 };
    }
  }

  // Poll fast near the end of a track so the clip cut lands on time.
  const delayMs = remaining < HANDOFF_MS + 4000 ? 250 : 1000;
  return { actions, memory, delayMs };
}
