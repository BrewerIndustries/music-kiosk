"use client";
// Guest page (reached by QR): search Spotify and send a song to Up Next, see
// what's queued, and follow your own requests through the queue.
import { useCallback, useEffect, useState } from "react";
import { call, fmtTime } from "@/lib/client";
import type { TrackSummary } from "@/lib/spotify";

type Info = {
  ok: boolean;
  ready: boolean;
  requireApproval: boolean;
  nowPlaying: { title: string; subtitle: string; art: string | null } | null;
};

type Art = { title: string; subtitle: string; art: string | null };
type GuestQueue = {
  nowPlaying: (Art & { isPlaying: boolean }) | null;
  queue: (Art & { place: number; requestedBy: string | null; mine: boolean })[];
  thenPlaylist: Art[];
  mine: (Art & { id: string; state: "pending" | "queued" | "playing" | "played" | "declined"; place: number | null })[];
};

// A random id this phone keeps, so it can find its own requests again.
function guestId() {
  try {
    let id = localStorage.getItem("guest.id");
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem("guest.id", id);
    }
    return id;
  } catch {
    return null;
  }
}

export function GuestRequest({ code }: { code: string }) {
  const [gid] = useState(() => (typeof window === "undefined" ? null : guestId()));
  const [gq, setGq] = useState<GuestQueue | null>(null);
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

  // The queue and your requests, refreshed every few seconds.
  const loadQueue = useCallback(
    () =>
      call<GuestQueue>("GET", `/api/guest/queue?code=${encodeURIComponent(code)}&guest=${encodeURIComponent(gid ?? "")}`)
        .then(setGq)
        .catch(() => {}),
    [code, gid],
  );
  useEffect(() => {
    loadQueue();
    const t = setInterval(() => !document.hidden && loadQueue(), 5000);
    return () => clearInterval(t);
  }, [loadQueue]);

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
      const r = await call<{ pending: boolean }>("POST", "/api/guest/request", {
        code,
        uri: t.uri,
        name,
        guestId: gid,
      });
      loadQueue();
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
      <h1 className="festive text-3xl">🎄 Request a song 🎁</h1>
      {(gq?.nowPlaying ?? info.nowPlaying) && (
        <div className="card mt-4 flex items-center gap-3 p-3">
          <div className="art h-12 w-12 shrink-0">
            {(gq?.nowPlaying ?? info.nowPlaying)!.art ? (
              <img src={(gq?.nowPlaying ?? info.nowPlaying)!.art!} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>♪</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted">Now playing</div>
            <div className="truncate text-sm font-medium">{(gq?.nowPlaying ?? info.nowPlaying)!.title}</div>
            <div className="truncate text-xs text-muted">{(gq?.nowPlaying ?? info.nowPlaying)!.subtitle}</div>
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

      {gq && gq.mine.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Your requests</h2>
          <ol className="mt-2 space-y-1">
            {gq.mine.map((r) => (
              <SongLine key={r.id} song={r} right={<RequestState state={r.state} place={r.place} />} highlight={r.state === "playing" || r.state === "queued"} />
            ))}
          </ol>
        </section>
      )}

      {gq && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Up next</h2>
          {gq.queue.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing requested yet — be the first!</p>
          ) : (
            <ol className="mt-2 space-y-1">
              {gq.queue.map((q) => (
                <SongLine
                  key={`${q.place}-${q.title}`}
                  song={q}
                  lead={q.place}
                  highlight={q.mine}
                  sub={q.mine ? "Your request" : q.requestedBy ? `Requested by ${q.requestedBy}` : undefined}
                />
              ))}
            </ol>
          )}
          {gq.thenPlaylist.length > 0 && (
            <>
              <h3 className="mt-4 text-xs uppercase tracking-wider text-muted">Then from the playlist</h3>
              <ol className="mt-2 space-y-1 opacity-70">
                {gq.thenPlaylist.map((t, i) => (
                  <SongLine key={`${i}-${t.title}`} song={t} />
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function RequestState({ state, place }: { state: GuestQueue["mine"][number]["state"]; place: number | null }) {
  const label =
    state === "playing"
      ? "▶ Playing now"
      : state === "pending"
        ? "Waiting for the host"
        : state === "declined"
          ? "Not this time"
          : state === "played"
            ? "Played ✓"
            : place === 1
              ? "Up next!"
              : place
                ? `#${place} in line`
                : "In the queue";
  const strong = state === "playing" || state === "queued";
  return <span className={`shrink-0 text-xs ${strong ? "font-semibold text-accent" : "text-muted"}`}>{label}</span>;
}

function SongLine({
  song,
  lead,
  sub,
  right,
  highlight,
}: {
  song: Art;
  lead?: number;
  sub?: string;
  right?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <li className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${highlight ? "bg-accent/15" : ""}`}>
      {lead !== undefined && <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{lead}</span>}
      <div className="art h-10 w-10 shrink-0">
        {song.art ? <img src={song.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{song.title}</div>
        <div className="truncate text-xs text-muted">
          {song.subtitle}
          {sub ? ` · ${sub}` : ""}
        </div>
      </div>
      {right}
    </li>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}
