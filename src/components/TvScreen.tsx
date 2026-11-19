"use client";
// The big-screen "now playing" page for a TV or projector: /tv?code=<party code>.
// Album art, the song, who asked for it (and their dedication), what's next, and
// the QR code guests scan to request a song. Read-only; polls /api/tv.
import { useEffect, useState } from "react";
import { fmtTime } from "@/lib/client";
import { Christmas } from "./Christmas";
import { TvVideo } from "./TvVideo";

type Song = { title: string; subtitle: string; art: string | null; requestedBy: string | null };
type Tv = {
  ok: boolean;
  nowPlaying:
    | (Song & {
        source: "spotify" | "youtube";
        videoId?: string | null;
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

const DEMO: Tv = {
  ok: true,
  nowPlaying: {
    source: "spotify",
    title: "All I Want for Christmas Is You",
    subtitle: "Mariah Carey",
    art: null,
    requestedBy: "Aunt Linda",
    isPlaying: true,
    progressMs: 74_000,
    durationMs: 241_000,
    dedication: "To the happy couple — may every Christmas be as merry as this one! 💕",
  },
  upNext: [
    { title: "Last Christmas", subtitle: "Wham!", art: null, requestedBy: "Jake" },
    { title: "Rockin' Around the Christmas Tree", subtitle: "Brenda Lee", art: null, requestedBy: null },
    { title: "Feliz Navidad", subtitle: "José Feliciano", art: null, requestedBy: "Maria" },
    { title: "It's Beginning to Look a Lot like Christmas", subtitle: "Michael Bublé", art: null, requestedBy: null },
  ],
  request: {
    url: "https://example.com",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><path d="M1 1h3v3H1zM6 1h3v3H6zM1 6h3v3H1zM6 6h1v1H6zM8 7h1v2H8z" fill="#000"/></svg>',
  },
};

export function TvScreen() {
  const [code, setCode] = useState<string | null>(null);
  const [tv, setTv] = useState<(Tv & { fetchedAt: number }) | null>(null);
  const [bad, setBad] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setCode(new URLSearchParams(location.search).get("code")), []);

  useEffect(() => {
    if (!code) return;
    // /tv?code=demo: sample data, to see the look without live music.
    // demo-youtube: the same with a YouTube song (its video plays muted).
    if (code === "demo" || code === "demo-youtube") {
      const np = code === "demo" ? DEMO.nowPlaying : { ...DEMO.nowPlaying!, source: "youtube" as const, videoId: "aAkMkVFwAoo", progressMs: 30_000 };
      setTv({ ...DEMO, nowPlaying: np, fetchedAt: Date.now() });
      return;
    }
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
      {tv && code !== "demo" && code !== "demo-youtube" && now - tv.fetchedAt > 10_000 && (
        // Lost touch with the kiosk: say so rather than freeze silently on the last song.
        <div className="absolute bottom-[1vh] left-[1vh] z-10 rounded-full bg-black/60 px-[1.4vh] py-[0.5vh] text-[1.6vh] text-[#cfe3d5]">
          ⟳ Reconnecting…
        </div>
      )}
      <div className="grid h-full grid-rows-[1fr_auto] gap-[3vh] px-[4vh] pb-[4vh] pt-[9vh]">
        {np ? (
          <div className="flex min-h-0 items-center gap-[5vw]">
            <div className="relative shrink-0">
              {np.source === "youtube" && np.videoId ? (
                // A YouTube song: its video, muted and in step with the kiosk screen.
                <div className="tv-art relative aspect-video h-[44vh] overflow-hidden rounded-[2vh] bg-black">
                  {np.art && <img src={np.art} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                  <TvVideo videoId={np.videoId} positionMs={progress} playing={np.isPlaying} />
                </div>
              ) : (
                <div className="tv-art relative aspect-square h-[52vh] overflow-hidden rounded-[2vh]">
                  {np.art ? <img src={np.art} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-card text-[16vh]">🎄</div>}
                </div>
              )}
              {/* a bow on the present */}
              <div className="tv-bow" aria-hidden>🎀</div>
              <div className="tv-holly tv-holly-l" aria-hidden />
              <div className="tv-holly tv-holly-r" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="festive tv-glow text-[3.6vh] leading-none text-gold">
                {np.isPlaying ? "✨ Now playing ✨" : "⏸ Paused"}
                {np.source === "youtube" && <span className="ml-3 rounded bg-red-600/80 px-2 py-0.5 text-[1.6vh] tracking-normal text-white">YouTube</span>}
              </div>
              <h1 className="tv-title mt-[1.2vh] line-clamp-2 text-[6vh] font-bold leading-[1.05]">{np.title}</h1>
              <p className="mt-[0.8vh] truncate text-[3.2vh] text-[#cfe3d5]">{np.subtitle}</p>
              <div className="tv-track mt-[2.4vh] h-[1.4vh] w-full overflow-hidden rounded-full">
                <div className="tv-candy h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-[0.8vh] flex justify-between text-[2vh] tabular-nums text-muted">
                <span>{fmtTime(progress)}</span>
                <span>{fmtTime(np.durationMs)}</span>
              </div>
              {np.requestedBy && (
                <div className="tv-ribbon mt-[2.4vh] inline-flex items-center gap-[1vh] rounded-full px-[2.4vh] py-[1vh] text-[2.6vh] font-semibold">
                  🎁 Requested by {np.requestedBy}
                </div>
              )}
              {np.dedication && (
                <blockquote key={np.dedication} className="tv-dedication tv-tag mt-[2.6vh] max-w-[56vw] px-[3.4vh] py-[1.8vh]">
                  <div className="text-[2vh] font-semibold uppercase tracking-[0.25em] text-[#a3152d]">🎁 A dedication</div>
                  <p className="festive mt-[0.6vh] line-clamp-3 text-[3.8vh] leading-tight text-[#173b29]">“{np.dedication}”</p>
                  {np.requestedBy && <p className="mt-[1vh] text-right text-[2.4vh] text-[#2f5a43]">— {np.requestedBy}</p>}
                </blockquote>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center">
            <div className="festive tv-glow text-[12vh] leading-none text-gold">🎄 Music Kiosk 🎅</div>
            <p className="festive mt-[3vh] text-[4.5vh] text-[#cfe3d5]">The music will be right back…</p>
          </div>
        )}

        <div className="flex items-end gap-[3vh]">
          <div className="min-w-0 flex-1">
            {tv && tv.upNext.length > 0 && (
              <>
                <div className="festive mb-[1.2vh] text-[3.4vh] leading-none text-gold">🔔 Up next</div>
                <div className="grid grid-cols-4 gap-[2vh]">
                  {tv.upNext.map((s, i) => (
                    <div key={`${s.title}-${i}`} className="tv-card flex min-w-0 items-center gap-[1.4vh] rounded-[1.4vh] p-[1.2vh]">
                      <div className="h-[8vh] w-[8vh] shrink-0 overflow-hidden rounded-[1vh] bg-card">
                        {s.art && <img src={s.art} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[2.3vh] font-semibold">{s.title}</div>
                        <div className="truncate text-[1.8vh] text-[#cfe3d5]">{s.subtitle}</div>
                        {s.requestedBy && <div className="truncate text-[1.7vh] text-gold">🎁 {s.requestedBy}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {tv?.request && (
            <div className="tv-qr shrink-0 rounded-[2vh] p-[1.2vh] text-center">
              <div className="rounded-[1.2vh] bg-white p-[1vh]">
                <div className="h-[19vh] w-[19vh] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: tv.request.svg }} />
              </div>
              <div className="festive mt-[0.8vh] rounded-[1vh] bg-[#a3152d] px-[1vh] py-[0.7vh] text-[2.6vh] leading-none text-white shadow">🎅 Request a song!</div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ art, children }: { art?: string | null; children: React.ReactNode }) {
  return (
    <div className="tv-screen fixed inset-0 overflow-hidden text-ink">
      {/* The album art adds texture only (luminosity), so the room stays red & green whatever the cover's colours. */}
      {art && <img src={art} alt="" aria-hidden className="tv-backdrop" />}
      <div className="tv-vignette absolute inset-0" />
      <div className="tv-garland tv-garland-top" aria-hidden />
      <div className="tv-garland tv-garland-bottom" aria-hidden />
      <Christmas />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
