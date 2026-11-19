#!/usr/bin/env node
// Copies one deployed kiosk into another (default dev → prod) via /api/sync.
//   SYNC_TOKEN=… node scripts/sync-kiosk.mjs [--from URL] [--to URL] [--no-spotify] [--dry-run]
// Both Workers need the same SYNC_TOKEN secret. Spotify and YouTube (google_) sign-ins come along
// unless --no-spotify; then both kiosks drive the same accounts — don't play on both.
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const from = opt("--from", "https://musickiosk-dev.dabrewer.dev");
const to = opt("--to", "https://musickiosk.dabrewer.dev");
const token = process.env.SYNC_TOKEN;
if (!token) throw new Error("SYNC_TOKEN not set");
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const res = await fetch(`${from}/api/sync`, { headers });
if (!res.ok) throw new Error(`export failed: ${res.status} ${await res.text()}`);
const data = await res.json();
if (args.includes("--no-spotify"))
  for (const k of Object.keys(data.settings)) if (/^(spotify_|google_)/.test(k)) delete data.settings[k];
console.log(`From ${from}: ${Object.keys(data.settings).length} settings, ${data.kioskPlaylists.length} kiosk playlists (${data.kioskPlaylistItems.length} items), ${data.users.length} users`);
if (args.includes("--dry-run")) {
  console.log("settings:", Object.keys(data.settings).join(", "));
  process.exit(0);
}
const put = await fetch(`${to}/api/sync`, { method: "POST", headers, body: JSON.stringify(data) });
if (!put.ok) throw new Error(`import failed: ${put.status} ${await put.text()}`);
console.log(`Into ${to}:`, await put.json());
