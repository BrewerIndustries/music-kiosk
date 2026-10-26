import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

const DB_PATH = process.env.KIOSK_DB_PATH ?? join(process.cwd(), "data", "kiosk.db");

// Next.js reloads modules on every change in dev; cache the connection so we
// don't open a new handle (and re-run migrations) on each request.
const globalForDb = globalThis as unknown as { _kioskDb?: Database.Database; _kioskDbMigrated?: number };

// Column additions for existing databases. Runs once per process (and again after
// a hot reload that bumps MIGRATIONS), so a running kiosk picks them up.
const MIGRATIONS = 1;
function migrate(d: Database.Database) {
  const cols = new Set((d.prepare(`PRAGMA table_info(queue)`).all() as { name: string }[]).map((c) => c.name));
  // Which guest phone sent a request, so the guest page can show "your requests".
  if (!cols.has("guest_id")) d.exec(`ALTER TABLE queue ADD COLUMN guest_id TEXT`);
}

function init(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
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
      played_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status, position);
    CREATE TABLE IF NOT EXISTS guest_hits (
      ip TEXT NOT NULL,
      at INTEGER NOT NULL
    );
  `);
  return db;
}

export function db(): Database.Database {
  if (!globalForDb._kioskDb) globalForDb._kioskDb = init();
  if (globalForDb._kioskDbMigrated !== MIGRATIONS) {
    migrate(globalForDb._kioskDb);
    globalForDb._kioskDbMigrated = MIGRATIONS;
  }
  return globalForDb._kioskDb;
}

export function getSetting(key: string): string | null {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) db().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  else
    db()
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
}
