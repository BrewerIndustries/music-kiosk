// Kiosk settings (stored in the settings table) with defaults.
import { networkInterfaces } from "os";
import { getSetting, setSetting } from "./db";

export type KioskSettings = {
  playlistUri: string | null; // the backdrop playlist
  playlistName: string | null;
  duckPercent: number; // Spotify volume while a clip plays over the music
  requireApproval: boolean; // guest requests wait for admin approval
  partyCode: string; // in the guest link; rotate to lock old QR codes out
  guestBaseUrl: string | null; // override for the QR link (e.g. the public guest site)
};

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
}

export function getSettings(): KioskSettings {
  let partyCode = getSetting("party_code");
  if (!partyCode) {
    partyCode = randomCode();
    setSetting("party_code", partyCode);
  }
  return {
    playlistUri: getSetting("playlist_uri"),
    playlistName: getSetting("playlist_name"),
    duckPercent: Number(getSetting("duck_percent") ?? 20),
    requireApproval: getSetting("require_approval") === "1",
    partyCode,
    guestBaseUrl: getSetting("guest_base_url"),
  };
}

export function updateSettings(p: Record<string, unknown>) {
  if ("playlistUri" in p) setSetting("playlist_uri", typeof p.playlistUri === "string" ? p.playlistUri : null);
  if ("playlistName" in p) setSetting("playlist_name", typeof p.playlistName === "string" ? p.playlistName : null);
  if (typeof p.duckPercent === "number")
    setSetting("duck_percent", String(Math.max(0, Math.min(100, Math.round(p.duckPercent)))));
  if (typeof p.requireApproval === "boolean") setSetting("require_approval", p.requireApproval ? "1" : "0");
  if (p.rotatePartyCode === true) setSetting("party_code", randomCode());
  if ("guestBaseUrl" in p)
    setSetting("guest_base_url", typeof p.guestBaseUrl === "string" && p.guestBaseUrl.trim() ? p.guestBaseUrl.trim().replace(/\/$/, "") : null);
}

// Where guests' phones can reach this kiosk. Prefers the configured override; in
// local testing falls back to the Mac's LAN address (127.0.0.1 is useless to a phone).
export function guestBase(reqOrigin: string): string {
  const s = getSettings();
  if (s.guestBaseUrl) return s.guestBaseUrl;
  const u = new URL(reqOrigin);
  if (["127.0.0.1", "localhost", "0.0.0.0"].includes(u.hostname)) {
    for (const list of Object.values(networkInterfaces()))
      for (const a of list ?? [])
        if (a.family === "IPv4" && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address))
          return `${u.protocol}//${a.address}${u.port ? ":" + u.port : ""}`;
  }
  return u.origin;
}
