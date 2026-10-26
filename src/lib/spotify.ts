// Spotify Web API client. Tokens (Authorization Code flow, client secret held
// server-side) persist in the settings table; access tokens refresh on demand.
import { getSetting, setSetting } from "./db";

export const SCOPES = [
  "streaming", // Web Playback SDK (browser player)
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const API = "https://api.spotify.com/v1";

export function clientConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000/api/spotify/callback";
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret) };
}

export function isConnected(): boolean {
  return Boolean(getSetting("spotify_refresh_token"));
}

async function tokenRequest(body: Record<string, string>) {
  const { clientId, clientSecret } = clientConfig();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new SpotifyError(res.status, `token: ${await res.text()}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  setSetting("spotify_access_token", json.access_token);
  setSetting("spotify_expires_at", String(Date.now() + (json.expires_in - 60) * 1000));
  if (json.refresh_token) setSetting("spotify_refresh_token", json.refresh_token);
  return json.access_token;
}

export async function exchangeCode(code: string) {
  await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: clientConfig().redirectUri });
  const me = await api<{ id: string; display_name: string; product: string }>("GET", "/me");
  setSetting("spotify_user", JSON.stringify({ id: me?.id, name: me?.display_name, product: me?.product }));
}

export function disconnect() {
  for (const k of ["spotify_access_token", "spotify_refresh_token", "spotify_expires_at", "spotify_user"])
    setSetting(k, null);
}

let refreshing: Promise<string> | null = null;

export async function accessToken(): Promise<string> {
  const token = getSetting("spotify_access_token");
  const expiresAt = Number(getSetting("spotify_expires_at") ?? 0);
  if (token && Date.now() < expiresAt) return token;
  const refresh = getSetting("spotify_refresh_token");
  if (!refresh) throw new SpotifyError(401, "Spotify not connected");
  // Collapse concurrent refreshes (engine loop + UI requests) into one.
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: refresh }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export class SpotifyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Calls the Web API. Returns null for 204/202 (player endpoints return no body).
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | undefined>,
): Promise<T | null> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (res.status === 401 && attempt === 0) {
      setSetting("spotify_expires_at", "0"); // force refresh and retry once
      continue;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
      continue;
    }
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).error?.message ?? text;
      } catch {}
      throw new SpotifyError(res.status, msg);
    }
    return text ? (JSON.parse(text) as T) : null;
  }
  throw new SpotifyError(429, "rate limited");
}

// ---- Typed slices of the API we use --------------------------------------

export type SpTrack = {
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number }[] };
};

export type SpDevice = {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  supports_volume: boolean;
  volume_percent: number | null;
};

export type SpPlayback = {
  is_playing: boolean;
  progress_ms: number | null;
  item: SpTrack | null;
  device: SpDevice;
  context: { uri: string } | null;
  shuffle_state: boolean;
};

export type TrackSummary = {
  uri: string;
  title: string;
  subtitle: string;
  art: string | null;
  durationMs: number;
  explicit: boolean;
};

export function summarize(t: SpTrack): TrackSummary {
  const imgs = [...(t.album?.images ?? [])].sort((a, b) => a.width - b.width);
  const art = (imgs.find((i) => i.width >= 160) ?? imgs[imgs.length - 1])?.url ?? null;
  return {
    uri: t.uri,
    title: t.name,
    subtitle: t.artists.map((a) => a.name).join(", "),
    art,
    durationMs: t.duration_ms,
    explicit: t.explicit,
  };
}

// Spotify caps search at 10 results per request for development-mode apps (11+
// returns 400 "Invalid limit"), so larger result sets are fetched in pages of 10.
const SEARCH_PAGE = 10;

export async function searchTracks(q: string, total = 20): Promise<TrackSummary[]> {
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(total / SEARCH_PAGE) }, (_, i) =>
      api<{ tracks: { items: SpTrack[] } }>("GET", "/search", undefined, {
        q,
        type: "track",
        limit: String(SEARCH_PAGE),
        offset: String(i * SEARCH_PAGE),
      }),
    ),
  );
  const seen = new Set<string>();
  return pages
    .flatMap((p) => p?.tracks.items ?? [])
    .filter((t) => t && !seen.has(t.uri) && seen.add(t.uri))
    .map(summarize);
}

export async function getPlayback(): Promise<SpPlayback | null> {
  return api<SpPlayback>("GET", "/me/player", undefined, { additional_types: "track" });
}
