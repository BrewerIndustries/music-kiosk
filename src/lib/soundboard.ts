// Soundboard integration: clips are managed in the Soundboard app; the kiosk reads
// its open API (boards → pages → sounds) and proxies the audio so the browser stays
// same-origin.
export const SOUNDBOARD_URL = (process.env.SOUNDBOARD_URL ?? "https://soundboard.dabrewer.dev").replace(/\/$/, "");

export type SbSound = { id: string; label: string; accent: string; key: string; filename: string };
export type SbPage = { id: string; name: string; sounds: SbSound[] };
export type SbBoard = { id: string; name: string; icon: string; accent: string; pages: SbPage[] };
