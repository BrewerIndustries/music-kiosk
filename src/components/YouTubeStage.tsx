"use client";
// The YouTube song now playing. On the audio host (the kiosk tab that plays queued
// clips) this holds the visible embedded player; other screens show what's on and
// can skip it. Always mounted on the host so the player is reused between songs.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { call, fmtTime } from "@/lib/client";
import {
  attachYouTubeHost,
  playYouTube,
  setYouTubeVolume,
  skipYouTube,
  subscribeYouTube,
  tapToPlay,
  toggleYouTube,
  youtubeStatus,
} from "@/lib/youtubePlayer";
import type { KioskState, Notify } from "./types";

const videoIdOf = (uri: string | null) => /^youtube:video:([\w-]{11})$/.exec(uri ?? "")?.[1] ?? null;

export function YouTubeStage({ state, notify }: { state: KioskState; notify: Notify }) {
  const now = state.youtubeNow ?? null;
  const host = Boolean(state.isAudioHost);
  const yt = useSyncExternalStore(subscribeYouTube, youtubeStatus, youtubeStatus);
  const stageRef = useRef<HTMLDivElement>(null);
  const started = useRef(new Set<string>());

  useEffect(() => {
    attachYouTubeHost(stageRef.current);
  }, []);

  const volume = state.musicVolume ?? 70;
  const duck = state.settings?.duckPercent ?? 30;
  useEffect(() => setYouTubeVolume(volume, duck), [volume, duck]);

  // The engine handed this tab a YouTube song: play it, then report back.
  const clip = host && state.clip?.kind === "youtube" ? state.clip : null;
  useEffect(() => {
    const id = videoIdOf(clip?.uri ?? null);
    if (!clip || !id || started.current.has(clip.id)) return;
    started.current.add(clip.id);
    playYouTube(id).then(() =>
      call("POST", "/api/clip-done", { id: clip.id }).catch((e) => notify(e.message)),
    );
  }, [clip, notify]);

  // Skipped from another screen (or the engine moved on): stop the player here.
  const playingId = clip ? videoIdOf(clip.uri) : null;
  useEffect(() => {
    if (yt.videoId && yt.videoId !== playingId && !state.clip) skipYouTube();
  }, [yt.videoId, playingId, state.clip]);

  // Elapsed time: the player's own on the host, else estimated from the start.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!now || host) return;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [now, host]);
  const durationMs = (host && yt.durationMs) || now?.durationMs || 0;
  const positionMs = host ? yt.positionMs : now ? Math.max(0, tick - now.startedAt) : 0;
  const pct = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0;

  // On the kiosk screen, stop the video at once; ending it reports the song done
  // (the same path as a song finishing). Elsewhere, ask the server to skip it.
  const skip = () => {
    if (host && yt.videoId) return void skipYouTube();
    call("POST", "/api/player", { action: "next" })
      .then(() => notify("Skipped"))
      .catch((e) => notify(e.message));
  };

  const showing = Boolean(now) || (host && Boolean(yt.videoId));
  return (
    <section className={`card overflow-hidden ${showing ? "" : "hidden"}`} aria-hidden={!showing}>
      {/* YouTube requires a visible player of at least 200×200. */}
      <div className={host ? "relative aspect-video w-full min-h-[200px] bg-black" : "hidden"}>
        <div ref={stageRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
        {yt.needsTap && (
          <button onClick={tapToPlay} className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-semibold">
            ▶ Tap to play this YouTube song
          </button>
        )}
      </div>
      {now && (
        <div className="p-4">
          <div className="flex items-center gap-3">
            {!host && (
              <div className="art h-14 w-14 shrink-0">
                {now.art ? <img src={now.art} alt="" className="h-full w-full object-cover" /> : <span>▶</span>}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide text-accent">Now playing · YouTube</div>
              <div className="truncate font-semibold">{now.title}</div>
              <div className="truncate text-sm text-muted">
                {now.subtitle}
                {now.requestedBy && <> · requested by {now.requestedBy}</>}
              </div>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>{fmtTime(positionMs)}</span>
            <span>{fmtTime(durationMs)}</span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            {host && (
              <button className="btn" onClick={toggleYouTube} aria-label={yt.playing ? "Pause" : "Play"}>
                {yt.playing ? "⏸ Pause" : "▶ Play"}
              </button>
            )}
            <button className="btn" onClick={skip}>
              ⏭ Skip
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-muted">Spotify is paused and picks up after the YouTube songs.</p>
        </div>
      )}
    </section>
  );
}
