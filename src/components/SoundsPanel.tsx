"use client";
import { useEffect, useState } from "react";
import { call } from "@/lib/client";
import { playClip, stopAllClips, type ClipMode } from "@/lib/clipPlayer";
import type { SbBoard, SbSound } from "@/lib/soundboard";
import type { Notify } from "./types";

type Mode = ClipMode | "queue";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "pause", label: "⏸ Pause & play", hint: "Pauses the song, plays the clip, picks the song back up." },
  { id: "duck", label: "🔉 Play over", hint: "Turns the music down and plays the clip over it." },
  { id: "queue", label: "＋ Up Next", hint: "Queues the clip to play after the current song." },
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

export function SoundsPanel({ notify }: { notify: Notify }) {
  const [boards, setBoards] = useState<SbBoard[] | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("pause");
  const [playing, setPlaying] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModeState(loadMode());
    call<{ boards: SbBoard[]; manageUrl: string }>("GET", "/api/soundboard/boards")
      .then((r) => {
        setBoards(r.boards);
        setManageUrl(r.manageUrl);
        setBoardId(r.boards[0]?.id ?? null);
        setPageId(r.boards[0]?.pages[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem("kiosk.clipMode", m);
    } catch {}
  };

  const board = boards?.find((b) => b.id === boardId) ?? null;
  const page = board?.pages.find((p) => p.id === pageId) ?? board?.pages[0] ?? null;

  const fire = async (s: SbSound) => {
    if (mode === "queue") {
      call("POST", "/api/queue", { kind: "clip", clipKey: s.key, title: s.label, subtitle: "Sound clip" })
        .then(() => notify(`“${s.label}” added to Up Next`))
        .catch((e) => notify(e.message));
      return;
    }
    setPlaying((p) => ({ ...p, [s.id]: (p[s.id] ?? 0) + 1 }));
    try {
      const note = await playClip(s.key, mode);
      if (note) notify(note);
    } finally {
      setPlaying((p) => ({ ...p, [s.id]: Math.max(0, (p[s.id] ?? 1) - 1) }));
    }
  };

  const anyPlaying = Object.values(playing).some((n) => n > 0);

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
            <button
              key={s.id}
              onClick={() => fire(s)}
              className={`pad ${playing[s.id] ? "pad-playing" : ""}`}
              style={{ "--pad": ACCENTS[s.accent] ?? ACCENTS.purple } as React.CSSProperties}
            >
              <span className="line-clamp-3 break-words">{s.label}</span>
            </button>
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
