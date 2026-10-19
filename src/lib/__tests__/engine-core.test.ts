import { describe, expect, it } from "vitest";
import { CLIP_CUT_MS, decide, HANDOFF_MS, initialMemory, type Memory, type PlaybackSnapshot } from "../engine-core";

const pb = (uri: string, progressMs: number, durationMs = 200_000, isPlaying = true): PlaybackSnapshot => ({
  isPlaying,
  uri,
  progressMs,
  durationMs,
});
const track = (id: string, uri = `spotify:track:${id}`) => ({ id, kind: "track" as const, uri });
const clip = (id: string) => ({ id, kind: "clip" as const, uri: null });

function run(steps: [PlaybackSnapshot | null, ReturnType<typeof track> | ReturnType<typeof clip> | null][]) {
  let mem: Memory = initialMemory();
  const all = [];
  for (const [p, h] of steps) {
    const d = decide(p, h, mem);
    mem = d.memory;
    all.push(d);
  }
  return { mem, all };
}

describe("decide", () => {
  it("does nothing with an empty Up Next", () => {
    const { all } = run([[pb("A", 199_000), null]]);
    expect(all[0].actions).toEqual([]);
  });

  it("waits until the handoff window before queueing a track", () => {
    const { all } = run([
      [pb("A", 100_000), track("x")],
      [pb("A", 200_000 - HANDOFF_MS - 1), track("x")],
    ]);
    expect(all.flatMap((d) => d.actions)).toEqual([]);
  });

  it("hands the head track to Spotify near the end, exactly once", () => {
    const { all, mem } = run([
      [pb("A", 200_000 - HANDOFF_MS), track("x")],
      [pb("A", 200_000 - 3000), track("x")],
    ]);
    expect(all[0].actions).toEqual([{ type: "enqueue", id: "x", uri: "spotify:track:x" }]);
    expect(all[1].actions).toEqual([]);
    expect(mem.handoff?.id).toBe("x");
  });

  it("marks the handed-off track started when Spotify plays it, then hands off the next", () => {
    const { all, mem } = run([
      [pb("A", 195_000), track("x")],
      [pb("spotify:track:x", 500), track("y")],
      [pb("spotify:track:x", 200_000 - 5000), track("y")],
    ]);
    expect(all[1].actions).toEqual([{ type: "started", id: "x" }]);
    expect(mem.nowPlayingId).toBe("x"); // stays x until the uri changes
    expect(all[2].actions).toEqual([{ type: "enqueue", id: "y", uri: "spotify:track:y" }]);
  });

  it("tracks the requested item as now playing", () => {
    const { mem } = run([
      [pb("A", 195_000), track("x")],
      [pb("spotify:track:x", 500), null],
    ]);
    expect(mem.nowPlayingId).toBe("x");
  });

  it("detects a request for the song that's already playing (same uri restarts)", () => {
    const { all } = run([
      [pb("spotify:track:x", 195_000), track("x")],
      [pb("spotify:track:x", 800), null],
    ]);
    expect(all[1].actions).toEqual([{ type: "started", id: "x" }]);
  });

  it("gives up on a handoff after two unrelated track changes", () => {
    const { all, mem } = run([
      [pb("A", 195_000), track("x")],
      [pb("B", 1000), track("x")],
      [pb("C", 1000), track("x")],
    ]);
    expect(all[2].actions).toEqual([{ type: "lost", id: "x" }]);
    expect(mem.handoff).toBe(null);
  });

  it("pauses for a queued clip just before the track ends, and then waits", () => {
    const { all, mem } = run([
      [pb("A", 200_000 - HANDOFF_MS), clip("c")],
      [pb("A", 200_000 - CLIP_CUT_MS), clip("c")],
      [pb("A", 200_000 - CLIP_CUT_MS + 100, 200_000, false), clip("c")],
    ]);
    expect(all[0].actions).toEqual([]);
    expect(all[1].actions).toEqual([{ type: "pauseForClip", id: "c" }]);
    expect(all[2].actions).toEqual([]);
    expect(mem.clip?.id).toBe("c");
  });

  it("does not act while paused", () => {
    const { all } = run([[pb("A", 199_000, 200_000, false), track("x")]]);
    expect(all[0].actions).toEqual([]);
  });

  it("polls fast near the end of a track", () => {
    const { all } = run([
      [pb("A", 10_000), null],
      [pb("A", 195_000), null],
    ]);
    expect(all[0].delayMs).toBeGreaterThan(all[1].delayMs);
  });
});
