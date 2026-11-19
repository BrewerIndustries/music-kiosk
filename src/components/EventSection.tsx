"use client";
// Settings ▸ Event: pick a time range (e.g. the reception), then see what played,
// email that summary, or turn it into a keepsake Spotify playlist.
import { useState } from "react";
import { call } from "@/lib/client";
import type { Notify } from "./types";

type Play = { title: string; subtitle: string; playedAt: number; requestedBy: string | null; kind: string };
type Summary = {
  songs: number;
  minutes: number;
  youtubeSongs: number;
  first: Play | null;
  last: Play | null;
  topArtists: { name: string; count: number }[];
  topRequesters: { name: string; count: number }[];
  mostPlayed: { title: string; subtitle: string; count: number }[];
  guestRequests: number;
  soundsPlayed: number;
  dedications: { title: string; by: string | null; text: string }[];
  plays: Play[];
};
type Keepsake = { url: string | null; name: string; added: number; matched: number; unmatched: string[] };

// <input type="datetime-local"> wants local time without a zone.
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function EventSection({ notify }: { notify: Notify }) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [from, setFrom] = useState(() => toLocalInput(startOfToday.getTime()));
  const [to, setTo] = useState(() => toLocalInput(Date.now() + 60_000));
  const [sum, setSum] = useState<Summary | null>(null);
  const [canPlaylist, setCanPlaylist] = useState<boolean | null>(null);
  const [name, setName] = useState(() => `Our Wedding · ${new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`);
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [keepsake, setKeepsake] = useState<Keepsake | null>(null);
  const [showAll, setShowAll] = useState(false);

  const span = () => ({ from: new Date(from).getTime(), to: new Date(to).getTime() });
  const preset = (hours: number | "today") => {
    const end = Date.now() + 60_000;
    setTo(toLocalInput(end));
    setFrom(toLocalInput(hours === "today" ? startOfToday.getTime() : end - hours * 3_600_000));
  };
  const run = async <T,>(what: string, fn: () => Promise<T>) => {
    setBusy(what);
    try {
      return await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const load = () =>
    run("summary", async () => {
      const { from: f, to: t } = span();
      const r = await call<{ summary: Summary; canMakePlaylists: boolean }>("GET", `/api/event/summary?from=${f}&to=${t}`);
      setSum(r.summary);
      setCanPlaylist(r.canMakePlaylists);
    });

  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="section-title">Event: summary &amp; keepsake playlist</h2>
      <p className="text-xs text-muted">
        Pick the time the party ran. Everything that played (Spotify and YouTube, ≥ 10 s) is counted.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-muted">
          From
          <input type="datetime-local" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block text-xs text-muted">
          To
          <input type="datetime-local" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="chip" onClick={() => preset("today")}>Today</button>
        <button className="chip" onClick={() => preset(4)}>Last 4 h</button>
        <button className="chip" onClick={() => preset(8)}>Last 8 h</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy !== null} onClick={load}>
          {busy === "summary" ? "Counting…" : "Show summary"}
        </button>
        <button
          className="btn"
          disabled={busy !== null}
          onClick={() =>
            run("email", async () => {
              const r = await call<{ to: string }>("POST", "/api/event/email", {
                ...span(),
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
              });
              notify(`Summary emailed to ${r.to}`);
            })
          }
        >
          {busy === "email" ? "Sending…" : "✉️ Email it to me"}
        </button>
      </div>

      {sum && (
        <div className="space-y-2 rounded-lg bg-bg p-3">
          {sum.songs === 0 ? (
            <p className="text-muted">Nothing played in that range.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="songs" value={sum.songs} />
                <Stat label="of music" value={`${Math.floor(sum.minutes / 60)}h ${sum.minutes % 60}m`} />
                <Stat label="guest requests" value={sum.guestRequests} />
                <Stat label="sounds" value={sum.soundsPlayed} />
              </div>
              {sum.youtubeSongs > 0 && <p className="text-xs text-muted">{sum.youtubeSongs} of the songs came from YouTube.</p>}
              {sum.first && (
                <p>
                  <span className="text-muted">First:</span> {sum.first.title} — {sum.first.subtitle}{" "}
                  <span className="text-xs text-muted">({time(sum.first.playedAt)})</span>
                </p>
              )}
              {sum.last && sum.songs > 1 && (
                <p>
                  <span className="text-muted">Last:</span> {sum.last.title} — {sum.last.subtitle}{" "}
                  <span className="text-xs text-muted">({time(sum.last.playedAt)})</span>
                </p>
              )}
              <Top title="Top artists" list={sum.topArtists} />
              <Top title="Top requesters" list={sum.topRequesters} />
              {sum.mostPlayed.length > 0 && (
                <p>
                  <span className="text-muted">Played more than once:</span>{" "}
                  {sum.mostPlayed.map((m) => `${m.title} ×${m.count}`).join(", ")}
                </p>
              )}
              {sum.dedications.length > 0 && (
                <div>
                  <div className="text-muted">Dedications</div>
                  <ul className="mt-1 space-y-1">
                    {sum.dedications.map((d, i) => (
                      <li key={i} className="text-xs italic text-gold">
                        💌 “{d.text}” — {d.by ?? "a guest"} <span className="not-italic text-muted">({d.title})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="text-xs text-muted underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Hide" : "Show"} everything that played
              </button>
              {showAll && (
                <ol className="max-h-72 space-y-0.5 overflow-y-auto text-xs">
                  {sum.plays.map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-14 shrink-0 tabular-nums text-muted">{time(p.playedAt)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {p.kind === "youtube" && "▶ "}
                        {p.title} <span className="text-muted">— {p.subtitle}</span>
                        {p.requestedBy && <span className="text-gold"> · 🎁 {p.requestedBy}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        <div className="font-semibold">🎁 Keepsake playlist</div>
        <p className="text-xs text-muted">
          Saves everything that played in the range above, in order, as a new playlist in the kiosk&apos;s Spotify
          account. YouTube songs are matched to Spotify where possible.
        </p>
        {canPlaylist === false && (
          <p className="text-xs text-red-300">
            Spotify needs one more permission first: Settings ▸ Spotify ▸ Disconnect, then connect again.
          </p>
        )}
        <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" className="accent-[var(--accent)]" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Public on Spotify (anyone with the link can see it either way)
        </label>
        <button
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() =>
            run("keepsake", async () => {
              const r = await call<{ keepsake: Keepsake }>("POST", "/api/event/keepsake", { ...span(), name, public: isPublic });
              setKeepsake(r.keepsake);
              notify(`Created “${r.keepsake.name}” with ${r.keepsake.added} songs`);
            })
          }
        >
          {busy === "keepsake" ? "Creating…" : "Create Spotify playlist"}
        </button>
        {keepsake && (
          <div className="rounded-lg bg-bg p-3 text-xs">
            ✅ “{keepsake.name}”: {keepsake.added} songs
            {keepsake.matched > 0 && ` (${keepsake.matched} YouTube songs matched)`}.{" "}
            {keepsake.url && (
              <a className="underline" href={keepsake.url} target="_blank" rel="noreferrer">
                Open in Spotify ↗
              </a>
            )}
            {keepsake.unmatched.length > 0 && (
              <div className="mt-1 text-muted">Not found on Spotify: {keepsake.unmatched.join("; ")}</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-card px-3 py-2 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Top({ title, list }: { title: string; list: { name: string; count: number }[] }) {
  if (!list.length) return null;
  return (
    <p>
      <span className="text-muted">{title}:</span> {list.map((x) => `${x.name} (${x.count})`).join(", ")}
    </p>
  );
}
