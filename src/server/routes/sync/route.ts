import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, setSetting } from "@/lib/db";
import { poke } from "@/lib/engine";
import { IMPORTABLE } from "../import/route";

// The import allow-list plus the YouTube (Google) sign-in, which the old local kiosk never had.
const SYNCABLE = (k: string) => IMPORTABLE.test(k) || /^google_/.test(k);

// Kiosk-to-kiosk copy (scripts/sync-kiosk.mjs), e.g. dev → prod. Guarded by a bearer
// SYNC_TOKEN secret instead of a sign-in, so it needs nobody's password; with no
// SYNC_TOKEN set the route doesn't exist.
//   GET  → { settings, kioskPlaylists, kioskPlaylistItems, users }
//   POST ← the same shape: settings on the import allow-list, kiosk playlists
//          replaced wholesale, users added only where the email is new.
function authorized(req: NextRequest) {
  const want = process.env.SYNC_TOKEN;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!want) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Row = Record<string, unknown>;
const USER_COLS = ["id", "email", "name", "password_hash", "salt", "role", "disabled", "created_at"];
const KPL_COLS = ["id", "name", "shuffle", "created_at"];
const ITEM_COLS = ["id", "playlist_id", "position", "kind", "uri", "title", "subtitle", "art", "duration_ms"];

export function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const d = db();
  const settings = Object.fromEntries(
    (d.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[])
      .filter((r) => SYNCABLE(r.key))
      .map((r) => [r.key, r.value]),
  );
  return NextResponse.json({
    settings,
    kioskPlaylists: d.prepare("SELECT * FROM kiosk_playlists").all(),
    kioskPlaylistItems: d.prepare("SELECT * FROM kiosk_playlist_items").all(),
    users: d.prepare(`SELECT ${USER_COLS.join(",")} FROM users`).all(),
  });
}

const insert = (table: string, cols: string[], r: Row, verb = "INSERT") =>
  db()
    .prepare(`${verb} INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...cols.map((c) => (r[c] ?? null) as never));

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as {
    settings?: Record<string, string>;
    kioskPlaylists?: Row[];
    kioskPlaylistItems?: Row[];
    users?: Row[];
  };
  const settings: string[] = [];
  for (const [k, v] of Object.entries(body.settings ?? {}))
    if (SYNCABLE(k) && typeof v === "string") {
      setSetting(k, v);
      settings.push(k);
    }
  if (body.kioskPlaylists) {
    db().prepare("DELETE FROM kiosk_playlist_items").run();
    db().prepare("DELETE FROM kiosk_playlists").run();
    for (const p of body.kioskPlaylists) insert("kiosk_playlists", KPL_COLS, p);
    for (const i of body.kioskPlaylistItems ?? []) insert("kiosk_playlist_items", ITEM_COLS, i);
  }
  const usersAdded: string[] = [];
  for (const u of body.users ?? []) {
    const email = String(u.email ?? "").toLowerCase();
    if (!email || db().prepare("SELECT 1 FROM users WHERE email = ?").get(email)) continue;
    insert("users", USER_COLS, { ...u, email }, "INSERT OR IGNORE");
    usersAdded.push(email);
  }
  poke();
  return NextResponse.json({
    settings,
    kioskPlaylists: body.kioskPlaylists?.length ?? 0,
    kioskPlaylistItems: body.kioskPlaylistItems?.length ?? 0,
    usersAdded,
  });
}
