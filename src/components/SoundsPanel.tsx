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
const ACCENTS: Record<string, string> = {
  blue: "#60a5fa",
  sky: "#38bdf8",
  teal: "#2dd4bf",
  green: "#4ade80",
  purple: "#a78bfa",
  amber: "#fbbf24",
  coral: "#fb923c",
  red: "#f87171",
  rose: "#fb7185",
  gray: "#a1a1aa",
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
  // Re-render whenever any clip changes state (playing, paused, fading…).
  useSyncExternalStore(subscribeClips, clipsVersion, () => 0);
  const fadeInMs = state.settings?.fadeInMs ?? 2000;
  const fadeOutMs = state.settings?.fadeOutMs ?? 3000;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModeState(loadMode());
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
    const note = await startClip(s.id, s.key, mode);
    if (note) notify(note);
  };

  // The card buttons always play live; in Up Next mode they use Pause & play.
  const liveMode: ClipMode = mode === "queue" ? "pause" : mode;
  const showNote = (p: Promise<string | null> | void) => p?.then((n) => n && notify(n));
  const controls = (s: SbSound) => ({
    status: clipStatus(s.id),
    onPlayPause: () => {
      const st = clipStatus(s.id);
      if (st === "stopped") showNote(startClip(s.id, s.key, liveMode));
      else if (st === "paused") resumeClip(s.id);
      else pauseClip(s.id);
    },
    onStop: () => stopClip(s.id),
    onFadeIn: () => showNote(fadeInClip(s.id, s.key, liveMode, fadeInMs)),
    onFadeOut: () => fadeOutClip(s.id, fadeOutMs),
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
      <p className="mt-2 text-xs text-muted">{MODES.find((m) => m.id === mode)?.hint}</p>

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
  onFadeIn,
  onFadeOut,
}: {
  sound: SbSound;
  color: string;
  queueMode: boolean;
  status: ClipStatus;
  onFire: () => void;
  onPlayPause: () => void;
  onStop: () => void;
  onFadeIn: () => void;
  onFadeOut: () => void;
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
        <button className="pad-btn" onClick={onFadeIn} aria-label="Fade in" title="Fade in">
          <FadeIcon dir="in" />
        </button>
        <button className="pad-btn" onClick={onFadeOut} disabled={!live} aria-label="Fade out" title="Fade out">
          <FadeIcon dir="out" />
        </button>
      </div>
    </div>
  );
}
