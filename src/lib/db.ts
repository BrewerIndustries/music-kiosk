// The kiosk's SQLite lives in its Durable Object (src/server/worker.ts). This keeps
// the small better-sqlite3-style surface the rest of the code uses —
// db().prepare(sql).get/all/run, db().exec, db().transaction — on top of the
// Durable Object's `ctx.storage.sql`, so queue/settings code is unchanged.

// Structural types for the bits of the Durable Object storage API we use.
type SqlCursor = { toArray(): Record<string, unknown>[]; rowsWritten: number };
export type SqlStorageLike = { exec(query: string, ...bindings: unknown[]): SqlCursor };
type Storage = { sql: SqlStorageLike; transactionSync<T>(fn: () => T): T };

type Statement = {
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
  run(...args: unknown[]): { changes: number };
};
type Db = {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
};

let storage: Storage | null = null;
let handle: Db | null = null;

// SQLite bindings can't be undefined; booleans go in as 0/1.
const bind = (args: unknown[]) => args.map((a) => (a === undefined ? null : typeof a === "boolean" ? Number(a) : a));

// Called once by the Durable Object constructor.
export function attachStorage(s: Storage) {
  storage = s;
  const sql = s.sql;
  handle = {
    prepare: (q) => ({
      get: (...args) => sql.exec(q, ...bind(args)).toArray()[0],
      all: (...args) => sql.exec(q, ...bind(args)).toArray(),
      run: (...args) => ({ changes: sql.exec(q, ...bind(args)).rowsWritten }),
    }),
    exec: (q) => void sql.exec(q),
    transaction: (fn) => () => s.transactionSync(fn),
  };
  init(handle);
}

function init(d: Db) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- Up Next. kind = track | clip. status = pending (guest, awaiting approval) |
    -- queued | handed_off (sitting in Spotify's queue) | played | rejected.
    CREATE TABLE IF NOT EXISTS queue (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      status       TEXT NOT NULL,
      position     REAL NOT NULL,
      uri          TEXT,
      clip_key     TEXT,
      title        TEXT NOT NULL,
      subtitle     TEXT NOT NULL DEFAULT '',
      art          TEXT,
      duration_ms  INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT,
      source       TEXT NOT NULL DEFAULT 'kiosk',
      created_at   TEXT NOT NULL,
      played_at    TEXT,
      guest_id     TEXT  -- which guest phone sent it ("your requests" on the guest page)
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status, position);
    CREATE TABLE IF NOT EXISTS guest_hits (
      ip TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    -- Accounts (src/lib/accounts.ts): invite-only email + password.
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT,
      salt          TEXT,
      role          TEXT NOT NULL DEFAULT 'member',
      disabled      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,  -- HMAC of the cookie token
      user_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id         TEXT PRIMARY KEY,  -- HMAC of the link token
      user_id    TEXT NOT NULL,
      purpose    TEXT NOT NULL,     -- invite | reset
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );
    CREATE TABLE IF NOT EXISTS auth_hits (
      key TEXT NOT NULL,
      at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_hits ON auth_hits(key, at);
  `);
}

export function db(): Db {
  if (!handle) throw new Error("kiosk storage not attached");
  return handle;
}

export function hasStorage() {
  return Boolean(storage);
}

export function getSetting(key: string): string | null {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) db().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  else
    db()
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
}
