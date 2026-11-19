"use client";
// The YouTube song's video on the TV screen: a second, MUTED embed of the same
// video (the sound comes from the kiosk screen's player), kept in step with it —
// re-seeked when it drifts more than a couple of seconds, paused when it's paused.
import { useEffect, useRef } from "react";

type P = {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, ahead: boolean): void;
  mute(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};
type YTNs = { Player: new (el: HTMLElement, o: Record<string, unknown>) => P };

const DRIFT_MS = 2500;

let apiPromise: Promise<YTNs> | null = null;
function loadApi(): Promise<YTNs> {
  const w = window as unknown as { YT?: YTNs; onYouTubeIframeAPIReady?: () => void };
  apiPromise ??= new Promise((resolve) => {
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}

export function TvVideo({ videoId, positionMs, playing }: { videoId: string; positionMs: number; playing: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<P | null>(null);
  const loaded = useRef<string | null>(null);
  const want = useRef({ positionMs, playing });
  want.current = { positionMs, playing };

  // One player for the life of the component; a new song loads into it.
  useEffect(() => {
    let dead = false;
    loadApi().then((YT) => {
      if (dead || !host.current) return;
      const el = document.createElement("div");
      host.current.appendChild(el);
      new YT.Player(el, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, disablekb: 1, start: Math.floor(positionMs / 1000) },
        events: {
          onReady: (e: { target: P }) => {
            if (dead) return e.target.destroy();
            player.current = e.target;
            loaded.current = videoId;
            e.target.mute();
            if (want.current.playing) e.target.playVideo();
          },
        },
      });
    });
    return () => {
      dead = true;
      player.current?.destroy();
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; songs change below
  }, []);

  // Follow the kiosk: song, position, play/pause.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (loaded.current !== videoId) {
      loaded.current = videoId;
      p.loadVideoById({ videoId, startSeconds: positionMs / 1000 });
      p.mute();
      if (!playing) p.pauseVideo();
      return;
    }
    if (Math.abs(p.getCurrentTime() * 1000 - positionMs) > DRIFT_MS) p.seekTo(positionMs / 1000, true);
    const state = p.getPlayerState(); // 1 playing, 2 paused
    if (playing && state !== 1) p.playVideo();
    if (!playing && state === 1) p.pauseVideo();
  }, [videoId, positionMs, playing]);

  return <div ref={host} className="pointer-events-none absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />;
}
