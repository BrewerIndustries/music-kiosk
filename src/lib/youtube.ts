// YouTube (and YouTube Music) through the YouTube Data API v3. YouTube Music has
// no public API of its own, but its playlists are ordinary YouTube playlists and
// its songs are YouTube videos, so one Google sign-in (read-only) covers search and
// "your playlists". Playback is never server-side: the kiosk tab plays the video in
// YouTube's embedded player (src/lib/youtubePlayer.ts) while Spotify is paused.
//
// Quota: 10,000 units/day per Google project. search.list costs 100 (so ~100
// searches/day), everything else 1 — searches are cached for an hour, and guests
// never search YouTube.
import { getSetting, setSetting } from "./db";

export const YT_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";
const API = "https://www.googleapis.com/youtube/v3";
const SEARCH_CACHE_MS = 60 * 60_000;
const PLAYLIST_ITEM_CAP = 200;

export type YtVideo = {
  uri: string; // youtube:video:<id> (what the queue stores)
  videoId: string;
  title: string;
  subtitle: string; // channel ("Artist - Topic" → "Artist")
  art: string | null;
  durationMs: number;
};

export type YtPlaylist = { id: string; title: string; art: string | null; count: number };

export class YouTubeError extends Error {
  constructor(
    public status: number,
    message: string,
    public endpoint?: string,
  ) {
    super(message);
  }
}

export function ytConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://127.0.0.1:8787/api/youtube/callback";
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret) };
}

export const ytConnected = () => Boolean(getSetting("google_refresh_token"));
export const ytUser = (): { name?: string; email?: string } | null => JSON.parse(getSetting("google_user") ?? "null");

export const videoUri = (id: string) => `youtube:video:${id}`;
export const videoIdOf = (uri: string | null) => /^youtube:video:([\w-]{11})$/.exec(uri ?? "")?.[1] ?? null;

async function tokenRequest(body: Record<string, string>) {
  const { clientId, clientSecret } = ytConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // A revoked/expired refresh token: drop it so the UI offers to reconnect.
    if (body.grant_type === "refresh_token" && /invalid_grant/.test(text)) disconnectYouTube();
    throw new YouTubeError(res.status, `Google sign-in: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in: number };
  setSetting("google_access_token", json.access_token);
  setSetting("google_expires_at", String(Date.now() + (json.expires_in - 60) * 1000));
  if (json.refresh_token) setSetting("google_refresh_token", json.refresh_token);
  return json.access_token;
}

export function ytAuthUrl(state: string) {
  const { clientId, redirectUri } = ytConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${YT_SCOPES} openid email profile`,
    access_type: "offline", // a refresh token, so it stays connected
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url;
}

export async function ytExchangeCode(code: string) {
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: ytConfig().redirectUri });
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const me = res.ok ? ((await res.json()) as { name?: string; email?: string }) : {};
  setSetting("google_user", JSON.stringify({ name: me.name, email: me.email }));
}

export function disconnectYouTube() {
  for (const k of ["google_access_token", "google_refresh_token", "google_expires_at", "google_user"]) setSetting(k, null);
  searchCache.clear();
}

let refreshing: Promise<string> | null = null;

async function accessToken(): Promise<string> {
  const token = getSetting("google_access_token");
  if (token && Date.now() < Number(getSetting("google_expires_at") ?? 0)) return token;
  const refresh = getSetting("google_refresh_token");
  if (!refresh) throw new YouTubeError(401, "YouTube isn't connected — connect it in Settings");
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: refresh }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function yt<T>(path: string, query: Record<string, string>): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 && attempt === 0) {
      setSetting("google_expires_at", "0");
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const err = JSON.parse(text).error;
        msg = err?.errors?.[0]?.reason === "quotaExceeded" ? "YouTube's daily search limit is used up — try again tomorrow" : (err?.message ?? text);
      } catch {}
      throw new YouTubeError(res.status, msg.slice(0, 300), `GET ${path}`);
    }
    return JSON.parse(text) as T;
  }
  throw new YouTubeError(401, "YouTube sign-in expired — reconnect it in Settings");
}

// ---- Shapes ----------------------------------------------------------------------

type Thumbs = Record<string, { url: string; width?: number } | undefined>;
type ApiVideo = {
  id: string;
  snippet?: { title: string; channelTitle: string; thumbnails?: Thumbs };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
};

const thumb = (t?: Thumbs) => (t?.medium ?? t?.high ?? t?.default)?.url ?? null;

// ISO 8601 duration (PT3M45S) → ms.
export function isoDurationMs(d: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return 0;
  const [, days, h, min, s] = m.map((x) => Number(x ?? 0));
  return (((days * 24 + h) * 60 + min) * 60 + s) * 1000;
}

// YouTube Music's auto-generated channels are "Artist - Topic".
const artistOf = (channel: string) => channel.replace(/ - Topic$/, "");

const decode = (s: string) =>
  s.replace(/&(amp|quot|#39|lt|gt);/g, (_, e: string) => ({ amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">" })[e]!);

// Details for up to 50 ids per call (1 unit each call); drops videos that can't be
// played in an embed (the kiosk could never play them) and live streams.
async function videos(ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt<{ items: ApiVideo[] }>("/videos", {
      part: "snippet,contentDetails,status",
      id: ids.slice(i, i + 50).join(","),
      maxResults: "50",
    });
    const byId = new Map(r.items.map((v) => [v.id, v]));
    for (const id of ids.slice(i, i + 50)) {
      const v = byId.get(id);
      const durationMs = isoDurationMs(v?.contentDetails?.duration);
      if (!v?.snippet || v.status?.embeddable === false || v.status?.privacyStatus === "private" || !durationMs) continue;
      out.push({
        uri: videoUri(v.id),
        videoId: v.id,
        title: decode(v.snippet.title),
        subtitle: artistOf(v.snippet.channelTitle),
        art: thumb(v.snippet.thumbnails),
        durationMs,
      });
    }
  }
  return out;
}

// ---- Search (music category, cached) -------------------------------------------

const searchCache = new Map<string, { at: number; results: YtVideo[] }>();

export async function ytSearch(q: string): Promise<YtVideo[]> {
  const key = q.trim().toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.results;
  const r = await yt<{ items: { id: { videoId?: string } }[] }>("/search", {
    part: "id",
    q: q.trim(),
    type: "video",
    videoCategoryId: "10", // Music
    videoEmbeddable: "true",
    maxResults: "15",
  });
  const results = await videos(r.items.map((i) => i.id.videoId).filter((x): x is string => Boolean(x)));
  if (searchCache.size > 200) searchCache.clear();
  searchCache.set(key, { at: Date.now(), results });
  return results;
}

// ---- Your playlists (incl. ones made in YouTube Music) --------------------------

export async function ytPlaylists(): Promise<YtPlaylist[]> {
  const out: YtPlaylist[] = [];
  let pageToken = "";
  for (let page = 0; page < 4; page++) {
    const r = await yt<{
      items: { id: string; snippet: { title: string; thumbnails?: Thumbs }; contentDetails: { itemCount: number } }[];
      nextPageToken?: string;
    }>("/playlists", { part: "snippet,contentDetails", mine: "true", maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    for (const p of r.items)
      out.push({ id: p.id, title: decode(p.snippet.title), art: thumb(p.snippet.thumbnails), count: p.contentDetails.itemCount });
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

export async function ytPlaylistItems(playlistId: string): Promise<YtVideo[]> {
  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < PLAYLIST_ITEM_CAP) {
    const r = await yt<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>("/playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    ids.push(...r.items.map((i) => i.contentDetails.videoId));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return videos(ids.slice(0, PLAYLIST_ITEM_CAP));
}
