"use client";
// Account screens: sign in / forgot password, the set-password page that invite
// and reset links open, and the Settings sections for your account and (admins)
// everyone else's.
import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "@/lib/client";
import type { KioskState, Notify } from "./types";

const MIN_PASSWORD = 10;

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <div className="text-center text-4xl">🎄</div>
        {children}
      </div>
    </div>
  );
}

// ---- Sign in ----------------------------------------------------------------------

export function SignIn() {
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await call("POST", "/api/auth/login", { email, password });
        location.reload();
      } else {
        await call("POST", "/api/auth/forgot", { email });
        setMode("sent");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <h1 className="festive mt-2 text-center text-3xl">Music Kiosk</h1>
      {mode === "sent" ? (
        <>
          <p className="mt-4 text-center text-sm text-muted">
            If <span className="text-ink">{email}</span> has an account, a reset link is on its way. It works for 1 hour.
          </p>
          <button className="btn mt-5 w-full" onClick={() => setMode("login")}>Back to sign in</button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <p className="text-center text-sm text-muted">
            {mode === "login" ? "Sign in to run the kiosk." : "We'll email you a link to set a new password."}
          </p>
          <input
            className="input"
            type="email"
            autoComplete="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode === "login" && (
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn btn-primary w-full py-2.5" disabled={busy}>
            {mode === "login" ? "Sign in" : "Send reset link"}
          </button>
          <button
            type="button"
            className="w-full text-center text-xs text-muted hover:text-ink"
            onClick={() => {
              setError(null);
              setMode(mode === "login" ? "forgot" : "login");
            }}
          >
            {mode === "login" ? "Forgot password?" : "Back to sign in"}
          </button>
        </form>
      )}
    </Screen>
  );
}

// ---- Set password (invite / reset links) ---------------------------------------

export function SetPasswordPage({ kind }: { kind: "invite" | "reset" }) {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ email: string } | "bad" | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(location.search).get("token") ?? "";
    setToken(t);
    call<{ email: string }>("GET", `/api/auth/link?token=${encodeURIComponent(t)}`)
      .then((r) => setInfo({ email: r.email }))
      .catch(() => setInfo("bad"));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirmPw) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await call("POST", "/api/auth/set-password", { token, password });
      location.replace("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <h1 className="festive mt-2 text-center text-3xl">{kind === "invite" ? "Welcome!" : "New password"}</h1>
      {info === null && <p className="mt-4 text-center text-sm text-muted">Checking your link…</p>}
      {info === "bad" && (
        <>
          <p className="mt-4 text-center text-sm text-muted">
            This link has expired or was already used. Ask an admin for a new invite, or use “Forgot password?” on the
            sign-in screen.
          </p>
          <Link className="btn mt-5 w-full" href="/">Go to sign in</Link>
        </>
      )}
      {info && info !== "bad" && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <p className="text-center text-sm text-muted">
            {kind === "invite" ? "Pick a password for" : "Set a new password for"}{" "}
            <span className="text-ink">{info.email}</span>
          </p>
          <input type="email" className="hidden" autoComplete="username" value={info.email} readOnly />
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={`New password (${MIN_PASSWORD}+ characters)`}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Type it again"
            required
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn btn-primary w-full py-2.5" disabled={busy}>
            {kind === "invite" ? "Set password & sign in" : "Save & sign in"}
          </button>
        </form>
      )}
    </Screen>
  );
}

// ---- Settings: your account ----------------------------------------------------

export function AccountSection({ state, notify }: { state: KioskState; notify: Notify }) {
  const me = state.me;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) return notify(`Use at least ${MIN_PASSWORD} characters.`);
    try {
      await call("POST", "/api/auth/change-password", { current, password: next });
      notify("Password changed — other devices were signed out");
      setOpen(false);
      setCurrent("");
      setNext("");
    } catch (err) {
      notify((err as Error).message);
    }
  };
  if (!me) return null;
  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="section-title">Your account</h2>
      <div>
        Signed in as <span className="font-semibold">{me.name}</span>{" "}
        <span className="text-muted">({me.email}{me.role === "admin" ? ", admin" : ""})</span>
      </div>
      {open && (
        <form onSubmit={change} className="space-y-2">
          <input type="email" className="hidden" autoComplete="username" value={me.email} readOnly />
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={`New password (${MIN_PASSWORD}+ characters)`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <button className="btn btn-primary">Save new password</button>
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => setOpen(!open)}>{open ? "Cancel" : "Change password"}</button>
        <button className="btn" onClick={() => call("POST", "/api/auth/logout").then(() => location.reload())}>
          Sign out
        </button>
      </div>
    </section>
  );
}

// ---- Settings: people (admins) -----------------------------------------------

type U = { id: string; email: string; name: string; role: "admin" | "member"; disabled: boolean; hasPassword: boolean };

export function UsersSection({ state, notify }: { state: KioskState; notify: Notify }) {
  const [users, setUsers] = useState<U[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const isAdmin = state.me?.role === "admin";

  const load = () =>
    call<{ users: U[] }>("GET", "/api/users")
      .then((r) => setUsers(r.users))
      .catch((e) => notify(e.message));
  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);
  if (!isAdmin) return null;

  // The email may not arrive (or sending isn't set up yet): offer the link to pass on.
  const handOver = (to: string, r: { emailed: boolean; link: string }, what: string) => {
    if (r.emailed) notify(`${what} emailed to ${to}`);
    else {
      setLink({ email: to, url: r.link });
      notify(`Couldn't email ${to} — copy the link below and send it yourself`);
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await call<{ emailed: boolean; link: string }>("POST", "/api/users", { email, name, role });
      handOver(email, r, "Invite");
      setEmail("");
      setName("");
      load();
    } catch (err) {
      notify((err as Error).message);
    }
  };
  const patch = (u: U, body: Record<string, unknown>) =>
    call("PATCH", `/api/users/${u.id}`, body).then(load).catch((e) => notify(e.message));
  const remove = (u: U) =>
    confirm(`Remove ${u.email}? They'll be signed out everywhere.`) &&
    call("DELETE", `/api/users/${u.id}`).then(load).catch((e) => notify(e.message));
  const resend = (u: U) =>
    call<{ emailed: boolean; link: string }>("POST", `/api/users/${u.id}/resend`)
      .then((r) => handOver(u.email, r, u.hasPassword ? "Reset link" : "Invite"))
      .catch((e) => notify(e.message));

  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="section-title">People</h2>
      <ul className="space-y-2">
        {(users ?? []).map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {u.name} {u.id === state.me?.id && <span className="text-muted">(you)</span>}
              </div>
              <div className="truncate text-xs text-muted">
                {u.email} · {u.disabled ? "disabled" : u.hasPassword ? u.role : "invited"}
              </div>
            </div>
            <select
              className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
              value={u.role}
              onChange={(e) => patch(u, { role: e.target.value })}
              aria-label={`Role for ${u.email}`}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn text-xs" onClick={() => resend(u)}>{u.hasPassword ? "Send reset" : "Resend invite"}</button>
            {u.id !== state.me?.id && (
              <>
                <button className="btn text-xs" onClick={() => patch(u, { disabled: !u.disabled })}>
                  {u.disabled ? "Enable" : "Disable"}
                </button>
                <button className="btn text-xs" onClick={() => remove(u)}>Remove</button>
              </>
            )}
          </li>
        ))}
      </ul>

      {link && (
        <div className="rounded-lg bg-accent/15 p-3 text-xs">
          Link for {link.email}:
          <div className="mt-1 break-all font-mono">{link.url}</div>
          <button
            className="btn mt-2 text-xs"
            onClick={() => navigator.clipboard?.writeText(link.url).then(() => notify("Link copied"))}
          >
            Copy link
          </button>
        </div>
      )}

      <form onSubmit={invite} className="space-y-2 border-t border-line pt-3">
        <div className="text-xs text-muted">Invite someone — they get an email to pick their password.</div>
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1" type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input flex-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select
            className="rounded-xl border border-line bg-bg px-3 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
            aria-label="Role"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn btn-primary">Send invite</button>
        <p className="text-xs text-muted">Members run the kiosk. Admins can also invite and manage people.</p>
      </form>
    </section>
  );
}
