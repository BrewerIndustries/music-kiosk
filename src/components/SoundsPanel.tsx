"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { call } from "@/lib/client";
import {
  activeClipCount,
  clipStatus,
  clipsVersion,
  fadeInClip,
  fadeOutClip,
  pauseClip,
  resumeClip,
  startClip,
  stopAllClips,
  stopClip,
  subscribeClips,
  type ClipMode,
  type ClipStatus,
} from "@/lib/clipPlayer";
import type { SbBoard, SbSound } from "@/lib/soundboard";
import { FadeIcon } from "./FadeIcon";
import type { KioskState, Notify } from "./types";

type Mode = ClipMode | "queue";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "pause", label: "⏸ Pause & play", hint: "Pauses the song, plays the clip, picks the song back up." },
  { id: "duck", label: "🔉 Play over", hint: "Turns the music down and plays the clip over it." },
  { id: "queue", label: "＋ Up Next", hint: "Tapping a pad queues it after the current song; its buttons still play it live (as Pause & play)." },
];

// Soundboard accent keys (src/lib/types.ts there) → pad colours on the dark kiosk.
// Soundboard accent names → the Christmas palette (the Soundboard default, purple,
// becomes cranberry), so cards still differ but match the theme.
const ACCENTS: Record<string, string> = {
  purple: "#e0435a", // cranberry
  red: "#c8203a", // deep cranberry
  rose: "#f08aa0", // candy cane
  coral: "#e0894f", // gingerbread
  amber: "#f6d27a", // tinsel gold
  green: "#4fb26b", // evergreen
  teal: "#3aa98a", // holly
  blue: "#8fc3e6", // frost
  sky: "#cfe6f5", // snow
  gray: "#c4c8cc", // silver
};

function loadMode(): Mode {
  try {
    const m = localStorage.getItem("kiosk.clipMode");
    if (m === "pause" || m === "duck" || m === "queue") return m;
  } catch {}
  return "pause";
}

export function SoundsPanel({ state, notify }: { state: KioskState; notify: Notify }) {
  const [boards, setBoards] = useState<SbBoard[] | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("pause");
  // Play over: lower the music under the clip (on), or leave it alone (off).
  const [duckOn, setDuckOnState] = useState(true);
  const setDuckOn = (on: boolean) => {
    setDuckOnState(on);
    try {
      localStorage.setItem("kiosk.duckOn", on ? "1" : "0");
    } catch {}
  };
  // Per-sound fade toggles: ▶ fades in / ■ fades out when on (kept per device).
  const [fades, setFades] = useState<Record<string, { in?: boolean; out?: boolean }>>({});
  const toggleFade = (id: string, dir: "in" | "out") =>
    setFades((prev) => {
      const next = { ...prev, [id]: { ...prev[id], [dir]: !prev[id]?.[dir] } };
      try {
        localStorage.setItem("kiosk.padFades", JSON.stringify(next));
      } catch {}
      return next;
    });
  // Re-render whenever any clip changes state (playing, paused, fading…).
  useSyncExternalStore(subscribeClips, clipsVersion, () => 0);
  const fadeInMs = state.settings?.fadeInMs ?? 2000;
  const fadeOutMs = state.settings?.fadeOutMs ?? 3000;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModeState(loadMode());
    try {
      setDuckOnState(localStorage.getItem("kiosk.duckOn") !== "0");
      setFades(JSON.parse(localStorage.getItem("kiosk.padFades") ?? "{}"));
    } catch {}
    call<{ boards: SbBoard[]; manageUrl: string }>("GET", "/api/soundboard/boards")
      .then((r) => {
        setBoards(r.boards);
        setManageUrl(r.manageUrl);
        // Reopen the board/page you were on (survives a reload).
        let saved: { boardId?: string; pageId?: string } = {};
        try {
          saved = JSON.parse(localStorage.getItem("kiosk.soundsPage") ?? "{}");
        } catch {}
        const b = r.boards.find((x) => x.id === saved.boardId) ?? r.boards[0];
        setBoardId(b?.id ?? null);
        setPageId(b?.pages.find((p) => p.id === saved.pageId)?.id ?? b?.pages[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem("kiosk.clipMode", m);
    } catch {}
  };

  useEffect(() => {
    if (!boardId) return;
    try {
      localStorage.setItem("kiosk.soundsPage", JSON.stringify({ boardId, pageId }));
    } catch {}
  }, [boardId, pageId]);

  const board = boards?.find((b) => b.id === boardId) ?? null;
  const page = board?.pages.find((p) => p.id === pageId) ?? board?.pages[0] ?? null;

  const fire = async (s: SbSound) => {
    if (mode === "queue") {
      call("POST", "/api/queue", { kind: "clip", clipKey: s.key, title: s.label, subtitle: "Sound clip" })
        .then(() => notify(`“${s.label}” added to Up Next`))
        .catch((e) => notify(e.message));
      return;
    }
    const note = await startClip(s.id, s.key, liveMode, fades[s.id]?.in ? fadeInMs : 0);
    if (note) notify(note);
  };

  // The card buttons always play live; in Up Next mode they use Pause & play.
  const liveMode: ClipMode = mode === "queue" ? "pause" : mode === "duck" && !duckOn ? "over" : mode;
  const showNote = (p: Promise<string | null> | void) => p?.then((n) => n && notify(n));
  const controls = (s: SbSound) => ({
    status: clipStatus(s.id),
    fadeIn: Boolean(fades[s.id]?.in),
    fadeOut: Boolean(fades[s.id]?.out),
    onPlayPause: () => {
      const st = clipStatus(s.id);
      if (st === "stopped" || st === "paused") {
        if (fades[s.id]?.in) showNote(fadeInClip(s.id, s.key, liveMode, fadeInMs));
        else if (st === "paused") resumeClip(s.id);
        else showNote(startClip(s.id, s.key, liveMode));
      } else pauseClip(s.id);
    },
    // A second ■ while fading out stops at once.
    onStop: () => {
      const st = clipStatus(s.id);
      if (fades[s.id]?.out && st !== "fading-out" && st !== "paused") fadeOutClip(s.id, fadeOutMs);
      else stopClip(s.id);
    },
    onToggleFadeIn: () => toggleFade(s.id, "in"),
    onToggleFadeOut: () => toggleFade(s.id, "out"),
  });

  const anyPlaying = activeClipCount() > 0;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap gap-1 rounded-xl bg-line/60 p-1" role="radiogroup" aria-label="Clip mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
              mode === m.id ? "bg-card text-ink shadow" : "text-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {mode === "duck" && !duckOn
            ? "Plays the clip over the music at full volume."
            : MODES.find((m) => m.id === mode)?.hint}
        </p>
        {mode === "duck" && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs">
            Lower the music
            <button
              type="button"
              role="switch"
              aria-checked={duckOn}
              aria-label="Lower the music while a sound plays"
              onClick={() => setDuckOn(!duckOn)}
              className={`relative h-6 w-11 rounded-full transition-colors ${duckOn ? "bg-accent" : "bg-line"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${duckOn ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </label>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-400">Couldn’t reach Soundboard: {error}</p>}
      {boards === null && !error && <p className="mt-4 text-sm text-muted">Loading sounds…</p>}

      {boards && boards.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {boards.map((b) => (
            <button
              key={b.id}
              className={`chip ${b.id === board?.id ? "chip-on" : ""}`}
              onClick={() => {
                setBoardId(b.id);
                setPageId(b.pages[0]?.id ?? null);
              }}
            >
              {b.icon} {b.name}
            </button>
          ))}
        </div>
      )}
      {board && board.pages.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {board.pages.map((p) => (
            <button
              key={p.id}
              className={`chip text-xs ${p.id === page?.id ? "chip-on" : ""}`}
              onClick={() => setPageId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {page && page.sounds.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">
          No sounds on this page yet.
          {manageUrl && (
            <>
              {" "}
              Upload clips in{" "}
              <a href={manageUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                Soundboard
              </a>
              .
            </>
          )}
        </p>
      )}

      {page && page.sounds.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {page.sounds.map((s) => (
            <SoundCard
              key={s.id}
              sound={s}
              color={ACCENTS[s.accent] ?? ACCENTS.purple}
              queueMode={mode === "queue"}
              onFire={() => fire(s)}
              {...controls(s)}
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        {anyPlaying ? (
          <button className="btn" onClick={stopAllClips}>■ Stop sounds</button>
        ) : (
          <span />
        )}
        {manageUrl && (
          <a href={manageUrl} target="_blank" rel="noreferrer" className="hover:text-ink">
            Manage sounds in Soundboard ↗
          </a>
        )}
      </div>
    </section>
  );
}

const STATUS_LABEL: Partial<Record<ClipStatus, string>> = {
  playing: "Playing",
  paused: "Paused",
  "fading-in": "Fading in…",
  "fading-out": "Fading out…",
};

function SoundCard({
  sound,
  color,
  queueMode,
  status,
  onFire,
  onPlayPause,
  onStop,
  fadeIn,
  fadeOut,
  onToggleFadeIn,
  onToggleFadeOut,
}: {
  sound: SbSound;
  color: string;
  queueMode: boolean;
  status: ClipStatus;
  onFire: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  fadeIn: boolean;
  fadeOut: boolean;
  onToggleFadeIn: () => void;
  onToggleFadeOut: () => void;
}) {
  const live = status !== "stopped";
  const playingNow = status === "playing" || status === "fading-in" || status === "fading-out";
  return (
    <div className={`pad-card ${live ? "pad-playing" : ""}`} style={{ "--pad": color } as React.CSSProperties}>
      <button
        onClick={onFire}
        className="pad-main"
        title={queueMode ? "Add to Up Next" : live ? "Restart" : "Play"}
      >
        <span className="line-clamp-2 break-words">{sound.label}</span>
        <span className="pad-status">{STATUS_LABEL[status] ?? (queueMode ? "Tap to queue" : "\u00a0")}</span>
      </button>
      <div className="grid grid-cols-4 gap-1 p-1.5 pt-0">
        <button className="pad-btn" onClick={onPlayPause} aria-label={playingNow ? "Pause" : "Play"} title={playingNow ? "Pause" : "Play"}>
          {playingNow ? "⏸" : "▶"}
        </button>
        <button className="pad-btn" onClick={onStop} disabled={!live} aria-label="Stop" title="Stop">
          ■
        </button>
        <button
          className="pad-btn"
          onClick={onToggleFadeIn}
          aria-pressed={fadeIn}
          aria-label="Fade in on play"
          title={fadeIn ? "Fade in on ▶: on" : "Fade in on ▶: off"}
        >
          <FadeIcon dir="in" />
        </button>
        <button
          className="pad-btn"
          onClick={onToggleFadeOut}
          aria-pressed={fadeOut}
          aria-label="Fade out on stop"
          title={fadeOut ? "Fade out on ■: on" : "Fade out on ■: off"}
        >
          <FadeIcon dir="out" />
        </button>
      </div>
    </div>
  );
}
