"use client";
// Guest page (reached by QR): search Spotify and send one song to Up Next.
import { useEffect, useState } from "react";
import { call, fmtTime } from "@/lib/client";
import type { TrackSummary } from "@/lib/spotify";

type Info = {
  ok: boolean;
  ready: boolean;
  requireApproval: boolean;
  nowPlaying: { title: string; subtitle: string; art: string | null } | null;
};

export function GuestRequest({ code }: { code: string }) {
  const [info, setInfo] = useState<Info | null | "bad">(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TrackSummary[]>([]);
  const [name, setName] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setName(localStorage.getItem("guest.name") ?? "");
    } catch {}
    const load = () =>
      call<Info>("GET", `/api/guest/info?code=${encodeURIComponent(code)}`)
        .then(setInfo)
        .catch(() => setInfo("bad"));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [code]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      call<{ tracks: TrackSummary[] }>(
        "GET",
        `/api/guest/search?code=${encodeURIComponent(code)}&q=${encodeURIComponent(term)}`,
      )
        .then((r) => setResults(r.tracks))
        .catch((e) => setError(e.message));
    }, 400);
    return () => clearTimeout(t);
  }, [q, code]);

  const send = async (t: TrackSummary) => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("guest.name", name);
    } catch {}
    try {
      const r = await call<{ pending: boolean }>("POST", "/api/guest/request", { code, uri: t.uri, name });
      setSent(r.pending ? `“${t.title}” was sent — the host will approve it shortly.` : `“${t.title}” is in the queue!`);
      setQ("");
      setResults([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (info === "bad")
    return (
      <Centered>
        <div className="text-4xl">🤔</div>
        <p className="mt-3 text-muted">This party link isn&apos;t valid anymore. Scan the QR code on the kiosk again.</p>
      </Centered>
    );
  if (!info) return <Centered>Loading…</Centered>;

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 py-6">
      <h1 className="text-2xl font-semibold">🎶 Request a song</h1>
      {info.nowPlaying && (
        <div className="card mt-4 flex items-center gap-3 p-3">
          <div className="art h-12 w-12 shrink-0">
            {info.nowPlaying.art ? <img src={info.nowPlaying.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted">Now playing</div>
            <div className="truncate text-sm font-medium">{info.nowPlaying.title}</div>
            <div className="truncate text-xs text-muted">{info.nowPlaying.subtitle}</div>
          </div>
        </div>
      )}

      {sent && (
        <div className="mt-4 rounded-xl bg-accent/15 p-4 text-sm">
          ✅ {sent}
          <button className="ml-2 underline" onClick={() => setSent(null)}>Request another</button>
        </div>
      )}

      {!info.ready ? (
        <p className="mt-6 text-muted">The kiosk isn&apos;t ready for requests yet.</p>
      ) : (
        !sent && (
          <>
            <input
              className="input mt-4"
              placeholder="Your name (optional)"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="search"
              className="input mt-3 text-lg"
              placeholder="Search for a song…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-3 space-y-1">
              {results.map((t) => (
                <button
                  key={t.uri}
                  disabled={busy}
                  onClick={() => send(t)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-line/50 disabled:opacity-50"
                >
                  <div className="art h-12 w-12 shrink-0">
                    {t.art ? <img src={t.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="truncate text-xs text-muted">
                      {t.subtitle} · {fmtTime(t.durationMs)}
                    </div>
                  </div>
                  <span className="btn btn-primary">Send</span>
                </button>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}
