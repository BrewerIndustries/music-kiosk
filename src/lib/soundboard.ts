// Soundboard integration: clips are managed in the Soundboard app; the kiosk reads
// its API (boards → pages → sounds) and proxies the audio so the browser stays
// same-origin. On Cloudflare the call goes Worker-to-Worker over a service binding
// (SOUNDBOARD), authenticated with the Soundboard's API token.
export const SOUNDBOARD_URL = (process.env.SOUNDBOARD_URL ?? "https://soundboard.dabrewer.dev").replace(/\/$/, "");

export type SbSound = { id: string; label: string; accent: string; key: string; filename: string };
export type SbPage = { id: string; name: string; sounds: SbSound[] };
export type SbBoard = { id: string; name: string; icon: string; accent: string; pages: SbPage[] };

type Fetcher = { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
let binding: Fetcher | null = null;
let token: string | null = null;

export function attachSoundboard(b: Fetcher | undefined, t: string | undefined) {
  binding = b ?? null;
  token = t ?? null;
}

// GET a Soundboard API path (e.g. "/api/boards").
export function soundboardFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const url = `${SOUNDBOARD_URL}${path}`;
  return (binding ?? { fetch }).fetch(url, { ...init, headers });
}
