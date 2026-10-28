// Kiosk settings (stored in the settings table) with defaults.
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
  songTransitionMs: number; // fade between songs (0 = off)
  requireApproval: boolean; // guest requests wait for admin approval
  guestRequestsOpen: boolean; // guests can send songs at all
  guestLimit: number; // songs per guest phone per window (0 = no limit)
  guestWindowMin: number; // …this many minutes
  guestBlockDuplicates: boolean; // refuse a song that's already waiting/queued
  partyCode: string; // in the guest link; rotate to lock old QR codes out
  previousPartyCode: string | null; // the code before the last change, to put back printed QR codes
  guestBaseUrl: string | null; // override for the QR link (e.g. the public guest site)
  youtubeEnabled: boolean; // YouTube search/playlists on the kiosk (off = Spotify only)
  doNotPlay: DoNotPlay[]; // songs / artists that never play (see isBlocked)
  dedicationsOn: boolean; // guests can add a dedication, shown on the TV screen
};

// The do-not-play list: a song (by Spotify uri) or an artist (by name, matched
// against the song's artists — Spotify's subtitle, or a YouTube channel name).
export type DoNotPlay =
  | { kind: "track"; uri: string; title: string; subtitle: string }
  | { kind: "artist"; name: string };

function readDoNotPlay(): DoNotPlay[] {
  try {
    const v = JSON.parse(getSetting("do_not_play") ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+-\s+topic$/, "").trim();

// The do-not-play entry this song hits, if any.
export function isBlocked(t: { uri?: string | null; subtitle?: string | null }, list = readDoNotPlay()): DoNotPlay | null {
  const artists = (t.subtitle ?? "").split(/,\s*|\s+&\s+|\s+feat\.?\s+|\s+x\s+/i).map(norm).filter(Boolean);
  return (
    list.find((e) =>
      e.kind === "track" ? Boolean(t.uri) && e.uri === t.uri : artists.includes(norm(e.name)),
    ) ?? null
  );
}

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
}

// Party codes: 3–12 letters/digits, upper case (guest links are case-insensitive).
export function cleanPartyCode(input: string): string | null {
  const c = input.trim().toUpperCase();
  return /^[A-Z0-9]{3,12}$/.test(c) ? c : null;
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
    songTransitionMs: Number(getSetting("song_transition_ms") ?? 0),
    requireApproval: getSetting("require_approval") === "1",
    guestRequestsOpen: getSetting("guest_open") !== "0",
    guestLimit: Number(getSetting("guest_limit") ?? 3),
    guestWindowMin: Number(getSetting("guest_window_min") ?? 10),
    guestBlockDuplicates: getSetting("guest_block_dupes") !== "0",
    partyCode,
    previousPartyCode: getSetting("party_code_prev"),
    guestBaseUrl: getSetting("guest_base_url"),
    youtubeEnabled: getSetting("youtube_enabled") === "1",
    doNotPlay: readDoNotPlay(),
    dedicationsOn: getSetting("dedications_on") !== "0",
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
  if (typeof p.songTransitionMs === "number")
    setSetting("song_transition_ms", String(Math.max(0, Math.min(12_000, Math.round(p.songTransitionMs)))));
  if (typeof p.youtubeEnabled === "boolean") setSetting("youtube_enabled", p.youtubeEnabled ? "1" : "0");
  if (typeof p.dedicationsOn === "boolean") setSetting("dedications_on", p.dedicationsOn ? "1" : "0");
  // Do-not-play: { addDoNotPlay: entry } / { removeDoNotPlay: index }.
  const add = p.addDoNotPlay as Record<string, unknown> | undefined;
  if (add && typeof add === "object") {
    const list = readDoNotPlay();
    const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    let entry: DoNotPlay | null = null;
    if (add.kind === "track" && /^spotify:track:[A-Za-z0-9]{22}$/.test(str(add.uri)))
      entry = { kind: "track", uri: str(add.uri), title: str(add.title) || "Song", subtitle: str(add.subtitle) };
    else if (add.kind === "artist" && str(add.name, 100)) entry = { kind: "artist", name: str(add.name, 100) };
    const dupe = entry && list.some((e) => (e.kind === "track" && entry.kind === "track" ? e.uri === entry.uri : e.kind === "artist" && entry.kind === "artist" && norm(e.name) === norm(entry.name)));
    if (entry && !dupe && list.length < 500) setSetting("do_not_play", JSON.stringify([...list, entry]));
  }
  if (typeof p.removeDoNotPlay === "number") {
    const list = readDoNotPlay();
    list.splice(p.removeDoNotPlay, 1);
    setSetting("do_not_play", JSON.stringify(list));
  }
  if (typeof p.requireApproval === "boolean") setSetting("require_approval", p.requireApproval ? "1" : "0");
  if (typeof p.guestRequestsOpen === "boolean") setSetting("guest_open", p.guestRequestsOpen ? "1" : "0");
  if (typeof p.guestBlockDuplicates === "boolean") setSetting("guest_block_dupes", p.guestBlockDuplicates ? "1" : "0");
  if (typeof p.guestLimit === "number") setSetting("guest_limit", String(Math.max(0, Math.min(50, Math.round(p.guestLimit)))));
  if (typeof p.guestWindowMin === "number")
    setSetting("guest_window_min", String(Math.max(1, Math.min(240, Math.round(p.guestWindowMin)))));
  // Changing the code (new random one, or a specific one — e.g. the code on printed
  // QR cards) keeps the old one, so a mistaken rotate can be undone.
  const nextCode =
    p.rotatePartyCode === true ? randomCode() : typeof p.partyCode === "string" ? cleanPartyCode(p.partyCode) : null;
  if (nextCode && nextCode !== getSetting("party_code")) {
    setSetting("party_code_prev", getSetting("party_code"));
    setSetting("party_code", nextCode);
  }
  if ("guestBaseUrl" in p)
    setSetting("guest_base_url", typeof p.guestBaseUrl === "string" && p.guestBaseUrl.trim() ? p.guestBaseUrl.trim().replace(/\/$/, "") : null);
}

// Where guests' phones can reach this kiosk. Prefers the configured override; in
// local testing falls back to the Mac's LAN address (127.0.0.1 is useless to a phone).
export function guestBase(reqOrigin: string): string {
  const s = getSettings();
  if (s.guestBaseUrl) return s.guestBaseUrl;
  return new URL(reqOrigin).origin;
}
