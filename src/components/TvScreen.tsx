"use client";
// The big-screen "now playing" page for a TV or projector: /tv?code=<party code>.
// Album art, the song, who asked for it (and their dedication), what's next, and
// the QR code guests scan to request a song. Read-only; polls /api/tv.
import { useEffect, useState } from "react";
import { fmtTime } from "@/lib/client";
import { Christmas } from "./Christmas";

type Song = { title: string; subtitle: string; art: string | null; requestedBy: string | null };
type Tv = {
  ok: boolean;
  nowPlaying:
    | (Song & {
        source: "spotify" | "youtube";
        isPlaying: boolean;
        progressMs: number;
        durationMs: number;
        dedication: string | null;
      })
    | null;
  upNext: Song[];
  request: { url: string; svg: string } | null;
};

const POLL_MS = 2000;

export function TvScreen() {
  const [code, setCode] = useState<string | null>(null);
  const [tv, setTv] = useState<(Tv & { fetchedAt: number }) | null>(null);
  const [bad, setBad] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setCode(new URLSearchParams(location.search).get("code")), []);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch(`/api/tv?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        if (r.status === 403) return alive && setBad(true);
        const j = (await r.json()) as Tv;
        if (alive && j.ok) {
          setTv({ ...j, fetchedAt: Date.now() });
          setBad(false);
        }
      } catch {
        // keep showing the last state; try again
      }
      if (alive) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Keep the TV awake (where the browser allows it).
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } })
      .wakeLock;
    const get = () => wl?.request("screen").then((l) => (lock = l)).catch(() => {});
    get();
    const onVis = () => document.visibilityState === "visible" && get();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, []);

  if (code === null && typeof window === "undefined") return null;
  if (!code || bad)
    return (
      <Shell>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="festive text-6xl">🎄 Music Kiosk</div>
          <p className="mt-4 text-xl text-muted">Open this screen from the kiosk (Guests ▸ TV screen) to get the right link.</p>
        </div>
      </Shell>
    );

  const np = tv?.nowPlaying ?? null;
  const progress = np ? Math.min(np.durationMs, np.progressMs + (np.isPlaying ? now - tv!.fetchedAt : 0)) : 0;
  const pct = np?.durationMs ? (progress / np.durationMs) * 100 : 0;

  return (
    <Shell art={np?.art ?? null}>
      <div className="grid h-full grid-rows-[1fr_auto] gap-[3vh] p-[4vh]">
        {np ? (
          <div className="flex min-h-0 items-center gap-[5vw]">
            <div className="tv-art relative aspect-square h-[52vh] shrink-0 overflow-hidden rounded-[2vh]">
              {np.art ? <img src={np.art} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-card text-[16vh]">♪</div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[2.2vh] font-semibold uppercase tracking-[0.3em] text-gold">
                {np.isPlaying ? "Now playing" : "Paused"}
                {np.source === "youtube" && <span className="ml-3 rounded bg-red-600/80 px-2 py-0.5 text-[1.6vh] tracking-normal text-white">YouTube</span>}
              </div>
              <h1 className="mt-[1.5vh] line-clamp-2 text-[7vh] font-bold leading-[1.05]">{np.title}</h1>
              <p className="mt-[1vh] truncate text-[3.6vh] text-muted">{np.subtitle}</p>
              <div className="mt-[3vh] h-[0.9vh] w-full overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-[0.8vh] flex justify-between text-[2vh] tabular-nums text-muted">
                <span>{fmtTime(progress)}</span>
                <span>{fmtTime(np.durationMs)}</span>
              </div>
              {np.requestedBy && (
                <div className="mt-[3vh] inline-flex items-center gap-[1vh] rounded-full bg-accent/80 px-[2.4vh] py-[1vh] text-[2.8vh] font-semibold">
                  🎁 Requested by {np.requestedBy}
                </div>
              )}
              {np.dedication && (
                <blockquote key={np.dedication} className="tv-dedication mt-[3vh] max-w-[60vw] rounded-[2vh] border-2 border-gold/70 bg-black/35 px-[3vh] py-[2.2vh]">
                  <div className="text-[2vh] uppercase tracking-[0.25em] text-gold">💌 Dedication</div>
                  <p className="festive mt-[1vh] text-[4.4vh] leading-tight">“{np.dedication}”</p>
                  {np.requestedBy && <p className="mt-[1vh] text-right text-[2.4vh] text-muted">— {np.requestedBy}</p>}
                </blockquote>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center">
            <div className="festive text-[12vh] leading-none">🎄 Music Kiosk 🎅</div>
            <p className="mt-[3vh] text-[3.5vh] text-muted">The music will be right back…</p>
          </div>
        )}

        <div className="flex items-end gap-[3vh]">
          <div className="min-w-0 flex-1">
            {tv && tv.upNext.length > 0 && (
              <>
                <div className="mb-[1.2vh] text-[2vh] font-semibold uppercase tracking-[0.3em] text-gold">Up next</div>
                <div className="grid grid-cols-4 gap-[2vh]">
                  {tv.upNext.map((s, i) => (
                    <div key={`${s.title}-${i}`} className="flex min-w-0 items-center gap-[1.4vh] rounded-[1.4vh] bg-black/35 p-[1.2vh]">
                      <div className="h-[8vh] w-[8vh] shrink-0 overflow-hidden rounded-[1vh] bg-card">
                        {s.art && <img src={s.art} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[2.3vh] font-semibold">{s.title}</div>
                        <div className="truncate text-[1.8vh] text-muted">{s.subtitle}</div>
                        {s.requestedBy && <div className="truncate text-[1.7vh] text-gold">🎁 {s.requestedBy}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {tv?.request && (
            <div className="shrink-0 rounded-[2vh] bg-white p-[1.4vh] text-center text-black shadow-2xl">
              <div className="h-[20vh] w-[20vh] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: tv.request.svg }} />
              <div className="mt-[0.8vh] text-[2.1vh] font-bold">📱 Request a song!</div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ art, children }: { art?: string | null; children: React.ReactNode }) {
  return (
    <div className="tv-screen fixed inset-0 overflow-hidden bg-bg text-ink">
      {art && <img src={art} alt="" aria-hidden className="tv-backdrop" />}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/80" />
      <Christmas />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
