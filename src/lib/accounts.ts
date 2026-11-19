// Invite-only email + password accounts (same design as the Soundboard app).
//
// - Passwords: PBKDF2-SHA256, 100k iterations (the Workers maximum), random salt.
// - Sessions: a random token in an HttpOnly cookie; the DB stores only
//   HMAC(token, SESSION_SECRET), so a leaked DB can't be replayed. 90-day rolling.
// - Invite / reset links: single-use tokens stored the same way (7 days / 1 hour).
// - Bootstrap: with no users yet, BOOTSTRAP_ADMIN_EMAIL becomes an admin with no
//   password; "Forgot password" sets it.
// Lookups are synchronous (Durable Object SQLite + node:crypto HMAC), so route
// guards stay simple; only password hashing is async (Web Crypto).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db";

export type Role = "admin" | "member";
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  salt: string | null;
  role: Role;
  disabled: number;
  created_at: string;
};

export const SESSION_COOKIE = "mk_session";
const SESSION_MS = 90 * 24 * 60 * 60_000;
const SESSION_EXTEND_MS = 24 * 60 * 60_000;
const INVITE_MS = 7 * 24 * 60 * 60_000;
const RESET_MS = 60 * 60_000;
export const MIN_PASSWORD = 10;
const PBKDF2_ITERATIONS = 100_000;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

const digest = (token: string) => createHmac("sha256", secret()).update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const newId = () => crypto.randomUUID();
export const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    disabled: Boolean(r.disabled),
    hasPassword: Boolean(r.password_hash),
    createdAt: r.created_at,
  };
}

// ---- Passwords ----------------------------------------------------------------

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return Buffer.from(bits).toString("hex");
}

export async function setPassword(userId: string, password: string) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt);
  db().prepare(`UPDATE users SET password_hash = ?, salt = ? WHERE id = ?`).run(hash, salt.toString("hex"), userId);
}

// Returns the user for a correct email + password (enabled accounts only).
export async function checkLogin(email: string, password: string): Promise<User | null> {
  const r = db().prepare(`SELECT * FROM users WHERE email = ?`).get(normEmail(email)) as UserRow | undefined;
  // Hash even when there's no such user, so timing doesn't reveal which emails exist.
  const salt = r?.salt ? Buffer.from(r.salt, "hex") : new Uint8Array(16);
  const hash = await pbkdf2(password, salt);
  if (!r || !r.password_hash || r.disabled) return null;
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(r.password_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? toUser(r) : null;
}

// ---- Users --------------------------------------------------------------------

export function bootstrap() {
  const email = normEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  if (!email) return;
  const n = (db().prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  if (n === 0)
    db()
      .prepare(`INSERT INTO users (id, email, name, role, disabled, created_at) VALUES (?, ?, ?, 'admin', 0, ?)`)
      .run(newId(), email, email.split("@")[0], new Date().toISOString());
}

export function listUsers(): User[] {
  return (db().prepare(`SELECT * FROM users ORDER BY created_at`).all() as UserRow[]).map(toUser);
}

export function getUser(id: string): User | null {
  const r = db().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function userByEmail(email: string): User | null {
  const r = db().prepare(`SELECT * FROM users WHERE email = ?`).get(normEmail(email)) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function createUser(email: string, name: string, role: Role): User {
  const id = newId();
  db()
    .prepare(`INSERT INTO users (id, email, name, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
    .run(id, normEmail(email), name.trim().slice(0, 80) || normEmail(email).split("@")[0], role, new Date().toISOString());
  return getUser(id)!;
}

const activeAdmins = () =>
  (db().prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0`).get() as { n: number }).n;

// Role / enabled changes, refusing anything that would leave no working admin.
export function updateUser(id: string, patch: { role?: Role; disabled?: boolean; name?: string }): string | null {
  const u = getUser(id);
  if (!u) return "No such user";
  const losesAdmin =
    u.role === "admin" && !u.disabled && ((patch.role && patch.role !== "admin") || patch.disabled === true);
  if (losesAdmin && activeAdmins() <= 1) return "There must always be at least one admin";
  if (patch.role) db().prepare(`UPDATE users SET role = ? WHERE id = ?`).run(patch.role, id);
  if (patch.name !== undefined) db().prepare(`UPDATE users SET name = ? WHERE id = ?`).run(patch.name.trim().slice(0, 80), id);
  if (patch.disabled !== undefined) {
    db().prepare(`UPDATE users SET disabled = ? WHERE id = ?`).run(patch.disabled ? 1 : 0, id);
    if (patch.disabled) revokeSessions(id);
  }
  return null;
}

export function deleteUser(id: string): string | null {
  const u = getUser(id);
  if (!u) return "No such user";
  if (u.role === "admin" && !u.disabled && activeAdmins() <= 1) return "There must always be at least one admin";
  db().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
  db().prepare(`DELETE FROM auth_tokens WHERE user_id = ?`).run(id);
  db().prepare(`DELETE FROM users WHERE id = ?`).run(id);
  return null;
}

// ---- Sessions -----------------------------------------------------------------

export function createSession(userId: string): string {
  const token = newToken();
  const now = Date.now();
  db()
    .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(digest(token), userId, now, now + SESSION_MS);
  return token;
}

// The signed-in user for a session token (rolling expiry), or null.
export function sessionUser(token: string | undefined | null): User | null {
  if (!token) return null;
  const id = digest(token);
  const row = db()
    .prepare(
      `SELECT s.expires_at AS expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(id) as (UserRow & { expires_at: number }) | undefined;
  const now = Date.now();
  if (!row || row.expires_at < now || row.disabled) return null;
  if (row.expires_at - now < SESSION_MS - SESSION_EXTEND_MS)
    db().prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(now + SESSION_MS, id);
  return toUser(row);
}

export function endSession(token: string | undefined | null) {
  if (token) db().prepare(`DELETE FROM sessions WHERE id = ?`).run(digest(token));
}

export function revokeSessions(userId: string, exceptToken?: string) {
  if (exceptToken)
    db().prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`).run(userId, digest(exceptToken));
  else db().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

export const sessionCookie = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: SESSION_MS / 1000 };

// ---- Invite / reset links -----------------------------------------------------

export function issueLinkToken(userId: string, purpose: "invite" | "reset"): string {
  const token = newToken();
  // A new link replaces any unused one of the same kind.
  db().prepare(`DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL`).run(userId, purpose);
  db()
    .prepare(`INSERT INTO auth_tokens (id, user_id, purpose, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)`)
    .run(digest(token), userId, purpose, Date.now() + (purpose === "invite" ? INVITE_MS : RESET_MS));
  return token;
}

// Marks a link used and returns its user id, or null if invalid/expired/used.
// Either kind of link can set a password, so the page needn't know which it got.
export function consumeLinkToken(token: string): { userId: string; purpose: string } | null {
  const id = digest(token);
  const row = db().prepare(`SELECT * FROM auth_tokens WHERE id = ?`).get(id) as
    | { user_id: string; purpose: string; expires_at: number; used_at: number | null }
    | undefined;
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  db().prepare(`UPDATE auth_tokens SET used_at = ? WHERE id = ?`).run(Date.now(), id);
  return { userId: row.user_id, purpose: row.purpose };
}

export function peekLinkToken(token: string): { email: string; purpose: string } | null {
  const row = db()
    .prepare(
      `SELECT t.purpose AS purpose, t.expires_at AS expires_at, t.used_at AS used_at, u.email AS email
       FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
    )
    .get(digest(token)) as { purpose: string; expires_at: number; used_at: number | null; email: string } | undefined;
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  return { email: row.email, purpose: row.purpose };
}

// ---- Rate limiting ------------------------------------------------------------

// Records a hit for `key` and returns false once it's over `max` in the window.
export function allow(key: string, max = 10, windowMs = 15 * 60_000): boolean {
  if (overLimit(key, max, windowMs)) return false;
  recordHit(key);
  return true;
}

// For sign-in: check first, and record only failures, so devices sharing venue
// Wi-Fi (one IP) can't lock each other out just by signing in.
export function overLimit(key: string, max = 10, windowMs = 15 * 60_000): boolean {
  db().prepare(`DELETE FROM auth_hits WHERE at < ?`).run(Date.now() - windowMs);
  return (db().prepare(`SELECT COUNT(*) AS n FROM auth_hits WHERE key = ?`).get(key) as { n: number }).n >= max;
}

export function recordHit(key: string) {
  db().prepare(`INSERT INTO auth_hits (key, at) VALUES (?, ?)`).run(key, Date.now());
}
