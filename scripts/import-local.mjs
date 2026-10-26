#!/usr/bin/env node
// Copies the settings from a local (pre-Cloudflare) kiosk.db into a deployed kiosk.
//
//   KIOSK_EMAIL=you@x KIOSK_PASSWORD=… node scripts/import-local.mjs \
//     --db ../music-kiosk/data/kiosk.db --url https://musickiosk-dev.dabrewer.dev [--no-spotify]
//
// Brings over playlist, volumes, fades, guest rules, party code, play history and
// the resume point. With the Spotify tokens too (the default), the Cloudflare kiosk
// takes over the same Spotify account — stop the local kiosk first, or the two will
// fight over playback. --no-spotify leaves Spotify to be connected by hand instead.
// The server only accepts a fixed allow-list of keys (src/server/routes/import).
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbPath = opt("--db") ?? "../music-kiosk/data/kiosk.db";
const base = (opt("--url") ?? "").replace(/\/$/, "");
const withSpotify = !args.includes("--no-spotify");
const { KIOSK_EMAIL: email, KIOSK_PASSWORD: password } = process.env;

if (!base || !email || !password) {
  console.error("Usage: KIOSK_EMAIL=… KIOSK_PASSWORD=… node scripts/import-local.mjs --url https://… [--db path] [--no-spotify]");
  process.exit(1);
}

const rows = JSON.parse(execFileSync("sqlite3", ["-readonly", "-json", dbPath, "SELECT key, value FROM settings"]).toString() || "[]");
const settings = Object.fromEntries(
  rows.filter((r) => withSpotify || !r.key.startsWith("spotify_")).map((r) => [r.key, r.value]),
);

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error("Sign-in failed:", login.status, await login.text());
  process.exit(1);
}
const cookie = login.headers.get("set-cookie")?.split(";")[0];

const res = await fetch(`${base}/api/import`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ settings }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Import failed:", res.status, body);
  process.exit(1);
}
console.log(`Imported ${body.imported.length} settings:`, body.imported.join(", "));
const skipped = Object.keys(settings).filter((k) => !body.imported.includes(k));
if (skipped.length) console.log("Not imported (not on the allow-list):", skipped.join(", "));
