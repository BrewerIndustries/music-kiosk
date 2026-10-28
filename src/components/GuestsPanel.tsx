"use client";
import { useEffect, useState } from "react";
import { call } from "@/lib/client";
import type { KioskState, Notify } from "./types";

export function GuestsPanel({ state, notify }: { state: KioskState; notify: Notify }) {
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const code = state.settings?.partyCode;

  useEffect(() => {
    call<{ url: string; svg: string }>("GET", "/api/qr")
      .then(setQr)
      .catch((e) => notify(e.message));
  }, [code, state.settings?.guestBaseUrl, notify]);

  const pending = state.pending ?? [];
  const patch = (id: string, action: string) =>
    call("PATCH", `/api/queue/${id}`, { action }).catch((e) => notify(e.message));
  const save = (p: Record<string, unknown>) => call("POST", "/api/settings", p).catch((e) => notify(e.message));

  return (
    <div className="space-y-4">
      <section className="card flex flex-col items-center p-6 text-center">
        <h2 className="text-xl font-semibold">Request a song</h2>
        <p className="mt-1 text-sm text-muted">Scan with your phone camera to send a song to the queue.</p>
        <div
          className="mt-4 w-full max-w-[260px] rounded-2xl bg-white p-3 [&_svg]:h-auto [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: qr?.svg ?? "" }}
        />
        {qr && <div className="mt-3 break-all text-xs text-muted">{qr.url}</div>}
        <div className="mt-1 text-sm">
          Party code <span className="font-mono font-semibold tracking-widest text-accent">{code}</span>
        </div>
      </section>

      {pending.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Waiting for approval</h2>
          <ul className="space-y-1">
            {pending.map((it) => (
              <li key={it.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                <div className="art h-10 w-10 shrink-0">
                  {it.art ? <img src={it.art} alt="" className="h-full w-full object-cover" /> : <span>♪</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.title}</div>
                  <div className="truncate text-xs text-muted">
                    {it.subtitle} · {it.requestedBy}
                  </div>
                  {it.dedication && <div className="mt-0.5 break-words text-xs italic text-gold">💌 “{it.dedication}”</div>}
                </div>
                <button className="btn btn-primary" onClick={() => patch(it.id, "approve")}>Approve</button>
                <button className="icon-btn" aria-label="Reject" onClick={() => patch(it.id, "reject")}>✕</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-3 p-4 text-sm">
        <h2 className="section-title">Request rules</h2>
        <label className="flex items-center justify-between gap-4">
          <span>
            Guests can request songs
            <span className="block text-xs text-muted">Off: the QR page says requests are closed.</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={state.settings?.guestRequestsOpen ?? true}
            onChange={(e) => save({ guestRequestsOpen: e.target.checked })}
          />
        </label>
        <GuestLimit state={state} save={save} />
        <label className="flex items-center justify-between gap-4">
          <span>
            Block duplicates
            <span className="block text-xs text-muted">Refuse a song that&apos;s already waiting or in Up Next.</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={state.settings?.guestBlockDuplicates ?? true}
            onChange={(e) => save({ guestBlockDuplicates: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            Approve requests first
            <span className="block text-xs text-muted">Guest songs wait here until you OK them.</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={Boolean(state.settings?.requireApproval)}
            onChange={(e) => save({ requireApproval: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            Dedications
            <span className="block text-xs text-muted">
              Guests can add a short message to their song; it shows on the TV screen while the song plays. Turn on
              “Approve requests first” to read them before they go up.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={state.settings?.dedicationsOn ?? true}
            onChange={(e) => save({ dedicationsOn: e.target.checked })}
          />
        </label>
        <PartyCode state={state} save={save} />
      </section>
    </div>
  );
}

// The code in every guest link / QR. Rotate for a random new one (old links stop
// working), set a specific one (e.g. what's on printed QR cards), or put back the
// one before.
function PartyCode({ state, save }: { state: KioskState; save: (p: Record<string, unknown>) => void }) {
  const code = state.settings?.partyCode ?? "";
  const prev = state.settings?.previousPartyCode ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const valid = /^[A-Za-z0-9]{3,12}$/.test(draft.trim());
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span>
          Party code <span className="font-mono font-semibold tracking-widest text-accent">{code}</span>
          <span className="block text-xs text-muted">Changing it makes old QR codes and links stop working.</span>
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            className="btn"
            onClick={() => {
              setDraft(code);
              setEditing(!editing);
            }}
          >
            {editing ? "Cancel" : "Set…"}
          </button>
          <button className="btn" onClick={() => confirm("Make a new random party code? Printed QR codes will stop working.") && save({ rotatePartyCode: true })}>
            Rotate
          </button>
        </div>
      </div>
      {editing && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            save({ partyCode: draft.trim().toUpperCase() });
            setEditing(false);
          }}
        >
          <input
            className="input font-mono uppercase tracking-widest"
            value={draft}
            maxLength={12}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. the code on your printed cards"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn-primary" disabled={!valid}>Save</button>
        </form>
      )}
      {editing && !valid && draft && <p className="text-xs text-red-400">3–12 letters or numbers.</p>}
      {prev && prev !== code && (
        <button className="text-xs text-accent underline" onClick={() => save({ partyCode: prev })}>
          Put back the previous code ({prev})
        </button>
      )}
    </div>
  );
}

// Songs per phone per window (0 = unlimited). Saved when a field is left.
function GuestLimit({ state, save }: { state: KioskState; save: (p: Record<string, unknown>) => void }) {
  const [limit, setLimit] = useState(String(state.settings?.guestLimit ?? 3));
  const [minutes, setMinutes] = useState(String(state.settings?.guestWindowMin ?? 10));
  const commit = () => {
    const l = Math.max(0, Math.min(50, Math.round(Number(limit) || 0)));
    const m = Math.max(1, Math.min(240, Math.round(Number(minutes) || 10)));
    setLimit(String(l));
    setMinutes(String(m));
    save({ guestLimit: l, guestWindowMin: m });
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>
        Requests per guest
        <span className="block text-xs text-muted">Per phone. 0 = no limit.</span>
      </span>
      <span className="flex items-center gap-2">
        <input
          className="input w-16 px-2 py-1 text-center"
          inputMode="numeric"
          aria-label="Requests allowed"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          onBlur={commit}
        />
        every
        <input
          className="input w-16 px-2 py-1 text-center"
          inputMode="numeric"
          aria-label="Minutes"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          onBlur={commit}
        />
        min
      </span>
    </div>
  );
}
