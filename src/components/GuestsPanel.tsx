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
                </div>
                <button className="btn btn-primary" onClick={() => patch(it.id, "approve")}>Approve</button>
                <button className="icon-btn" aria-label="Reject" onClick={() => patch(it.id, "reject")}>✕</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-3 p-4 text-sm">
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
        <div className="flex items-center justify-between gap-4">
          <span>
            New party code
            <span className="block text-xs text-muted">Old QR codes and links stop working.</span>
          </span>
          <button className="btn" onClick={() => confirm("Make a new party code?") && save({ rotatePartyCode: true })}>
            Rotate
          </button>
        </div>
        <p className="text-xs text-muted">
          Guests get 3 requests per 10 minutes, and duplicates are blocked.
        </p>
      </section>
    </div>
  );
}
