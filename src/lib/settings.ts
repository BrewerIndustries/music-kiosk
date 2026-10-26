// Kiosk settings (stored in the settings table) with defaults.
import { networkInterfaces } from "os";
import { getSetting, setSetting } from "./db";

export type KioskSettings = {
  playlistUri: string | null; // the backdrop playlist
  playlistName: string | null;
  duckPercent: number; // music drops to this % of its volume while a clip plays over it
  musicVolume: number | null; // the music's normal volume (restored after ducking)
  clipVolume: number; // soundboard clip volume, 0–100
  fadeInMs: number; // sound card "fade in" duration
  fadeOutMs: number; // sound card "fade out" duration
  musicFadeInMs: number; // music "fade in" duration
  musicFadeOutMs: number; // music "fade out" duration
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
    duckPercent: Number(getSetting("duck_percent") ?? 30),
    musicVolume: getSetting("music_volume") != null ? Number(getSetting("music_volume")) : null,
    clipVolume: Number(getSetting("clip_volume") ?? 100),
    fadeInMs: Number(getSetting("fade_in_ms") ?? 2000),
    fadeOutMs: Number(getSetting("fade_out_ms") ?? 3000),
    musicFadeInMs: Number(getSetting("music_fade_in_ms") ?? 3000),
    musicFadeOutMs: Number(getSetting("music_fade_out_ms") ?? 5000),
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
  if (typeof p.musicVolume === "number")
    setSetting("music_volume", String(Math.max(0, Math.min(100, Math.round(p.musicVolume)))));
  if (typeof p.clipVolume === "number")
    setSetting("clip_volume", String(Math.max(0, Math.min(100, Math.round(p.clipVolume)))));
  for (const [k, col] of [
    ["fadeInMs", "fade_in_ms"],
    ["fadeOutMs", "fade_out_ms"],
    ["musicFadeInMs", "music_fade_in_ms"],
    ["musicFadeOutMs", "music_fade_out_ms"],
  ] as const)
    if (typeof p[k] === "number") setSetting(col, String(Math.max(100, Math.min(30_000, Math.round(p[k] as number)))));
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
