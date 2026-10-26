// Up Next — the kiosk's own queue (Spotify tracks + soundboard clips). Spotify's
// queue is append-only, so this table is the source of truth and the engine feeds
// Spotify one track at a time.
import { randomUUID } from "crypto";
import { db } from "./db";

export type QueueKind = "track" | "clip";
export type QueueStatus = "pending" | "queued" | "handed_off" | "played" | "rejected";

export type QueueItem = {
  id: string;
  kind: QueueKind;
  status: QueueStatus;
  position: number;
  uri: string | null;
  clipKey: string | null;
  title: string;
  subtitle: string;
  art: string | null;
  durationMs: number;
  requestedBy: string | null;
  source: "kiosk" | "guest";
  guestId: string | null;
  createdAt: string;
  playedAt: string | null;
};

type Row = {
  id: string;
  kind: QueueKind;
  status: QueueStatus;
  position: number;
  uri: string | null;
  clip_key: string | null;
  title: string;
  subtitle: string;
  art: string | null;
  duration_ms: number;
  requested_by: string | null;
  source: "kiosk" | "guest";
  guest_id: string | null;
  created_at: string;
  played_at: string | null;
};

function fromRow(r: Row): QueueItem {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    position: r.position,
    uri: r.uri,
    clipKey: r.clip_key,
    title: r.title,
    subtitle: r.subtitle,
    art: r.art,
    durationMs: r.duration_ms,
    requestedBy: r.requested_by,
    source: r.source,
    guestId: r.guest_id ?? null,
    createdAt: r.created_at,
    playedAt: r.played_at,
  };
}

export function getItem(id: string): QueueItem | null {
  const r = db().prepare(`SELECT * FROM queue WHERE id = ?`).get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

// Up Next in play order: whatever is already in Spotify's queue, then queued.
export function upNext(): QueueItem[] {
  return (
    db()
      .prepare(
        `SELECT * FROM queue WHERE status IN ('handed_off','queued')
         ORDER BY CASE status WHEN 'handed_off' THEN 0 ELSE 1 END, position`,
      )
      .all() as Row[]
  ).map(fromRow);
}

export function pendingRequests(): QueueItem[] {
  return (db().prepare(`SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at`).all() as Row[]).map(
    fromRow,
  );
}

export function recentlyPlayed(limit = 10): QueueItem[] {
  return (
    db()
      .prepare(`SELECT * FROM queue WHERE status = 'played' ORDER BY played_at DESC LIMIT ?`)
      .all(limit) as Row[]
  ).map(fromRow);
}

export function head(): QueueItem | null {
  const r = db().prepare(`SELECT * FROM queue WHERE status = 'queued' ORDER BY position LIMIT 1`).get() as
    | Row
    | undefined;
  return r ? fromRow(r) : null;
}

export type NewItem = {
  kind: QueueKind;
  uri?: string | null;
  clipKey?: string | null;
  title: string;
  subtitle?: string;
  art?: string | null;
  durationMs?: number;
  requestedBy?: string | null;
  source?: "kiosk" | "guest";
  guestId?: string | null;
};

function maxPosition(): number {
  const r = db().prepare(`SELECT MAX(position) AS p FROM queue WHERE status IN ('queued','pending')`).get() as {
    p: number | null;
  };
  return r.p ?? 0;
}

function minPosition(): number {
  const r = db().prepare(`SELECT MIN(position) AS p FROM queue WHERE status = 'queued'`).get() as {
    p: number | null;
  };
  return r.p ?? 1;
}

export function addItem(item: NewItem, opts: { status?: QueueStatus; atFront?: boolean } = {}): QueueItem {
  const id = randomUUID();
  const position = opts.atFront ? minPosition() - 1 : maxPosition() + 1;
  db()
    .prepare(
      `INSERT INTO queue (id, kind, status, position, uri, clip_key, title, subtitle, art, duration_ms,
                          requested_by, source, guest_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      item.kind,
      opts.status ?? "queued",
      position,
      item.uri ?? null,
      item.clipKey ?? null,
      item.title.slice(0, 200),
      (item.subtitle ?? "").slice(0, 200),
      item.art ?? null,
      item.durationMs ?? 0,
      item.requestedBy?.slice(0, 40) || null,
      item.source ?? "kiosk",
      item.guestId ?? null,
      new Date().toISOString(),
    );
  return getItem(id)!;
}

export function setStatus(id: string, status: QueueStatus) {
  db()
    .prepare(`UPDATE queue SET status = ?, played_at = CASE WHEN ? = 'played' THEN ? ELSE played_at END WHERE id = ?`)
    .run(status, status, new Date().toISOString(), id);
}

export function removeItem(id: string) {
  db().prepare(`DELETE FROM queue WHERE id = ? AND status IN ('queued','pending','rejected')`).run(id);
}

export function moveToFront(id: string) {
  db().prepare(`UPDATE queue SET position = ? WHERE id = ?`).run(minPosition() - 1, id);
}

// Swap with the neighbour above/below among queued items.
export function move(id: string, dir: "up" | "down") {
  const items = upNext().filter((i) => i.status === "queued");
  const idx = items.findIndex((i) => i.id === id);
  const other = items[dir === "up" ? idx - 1 : idx + 1];
  if (idx < 0 || !other) return;
  const tx = db().transaction(() => {
    db().prepare(`UPDATE queue SET position = ? WHERE id = ?`).run(other.position, id);
    db().prepare(`UPDATE queue SET position = ? WHERE id = ?`).run(items[idx].position, other.id);
  });
  tx();
}

export function approve(id: string) {
  db().prepare(`UPDATE queue SET status = 'queued', position = ? WHERE id = ? AND status = 'pending'`).run(
    maxPosition() + 1,
    id,
  );
}

// One guest phone's requests, newest first.
export function guestRequests(guestId: string, limit = 20): QueueItem[] {
  return (
    db()
      .prepare(`SELECT * FROM queue WHERE guest_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(guestId, limit) as Row[]
  ).map(fromRow);
}

export function isQueued(uri: string): boolean {
  return Boolean(
    db().prepare(`SELECT 1 FROM queue WHERE uri = ? AND status IN ('queued','handed_off','pending')`).get(uri),
  );
}

export function clearQueue() {
  db().prepare(`DELETE FROM queue WHERE status IN ('queued','pending')`).run();
}
